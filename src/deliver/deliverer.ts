import type { Hit, Target } from '../types.ts';
import { formatBatch, toDiscord, toNtfy } from './format.ts';
import type { Formatted } from './format.ts';
import { checkTargetUrl, safePost, trustedPost } from './ssrf.ts';
import type { PostResult } from './ssrf.ts';

export interface DeliveryResult { targetId: string; ok: boolean; status?: number; error?: string; errorCode?: number; hits: Hit[]; sentAt: number }
export interface DiscordDeliveryLink { discordUserId: string; channelId: string | null }
export interface DelivererDeps {
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (h: unknown) => void;
  post?: typeof safePost;
  /** Discord calls use fixed discord.com URLs and trustedPost's deadline in production. */
  discordPost?: typeof trustedPost;
  discordBotToken?: string;
  /** False when the complete Discord OAuth + bot configuration is not present. */
  discordAvailable?: boolean;
  getDiscordLink?: (userId: string) => DiscordDeliveryLink | undefined;
  cacheDiscordChannel?: (userId: string, channelId: string) => void;
  sleep?: (ms: number) => Promise<void>;
  getTarget?: (id: string) => Target | undefined;
  onResult: (r: DeliveryResult) => void;
  log?: (line: string) => void;
}

const WINDOW_MS = 10_000;
const TIMEOUT_MS = 5_000;
const MAX_RETRY_AFTER_MS = 300_000;
const RETRY_AFTER_TOO_LONG = 'Retry-After exceeds five-minute retry limit';
const TEST_TEXT = 'Test von marbleNotification – wenn du das liest, kommt alles an.';
const DISCORD_API = 'https://discord.com/api/v10';
const DISCORD_DM_HINT = 'Discord lässt den Bot dir nicht schreiben. Tritt einem Server mit dem Bot bei oder erlaube DMs.';
const DISCORD_UNLINKED = 'Discord nicht verbunden. Verbinde dein Konto erneut.';

interface Win { target: Target; timer: unknown; pending: Hit[] }

export function createDeliverer(deps: DelivererDeps) {
  const post = deps.post ?? safePost;
  const discordPost = deps.discordPost ?? trustedPost;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const wins = new Map<string, Win>();
  const inflight = new Set<Promise<unknown>>();

  function retryAfterMs(value: string | undefined): number | null {
    if (!value) return 1000;
    const seconds = Number(value);
    const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - deps.now();
    if (!Number.isFinite(delay)) return 1000;
    return delay > MAX_RETRY_AFTER_MS ? null : Math.max(0, delay);
  }

  function track(promise: Promise<unknown>): void {
    const tracked = promise.catch((e) => (deps.log ?? console.error)(`delivery result handling failed: ${e}`)).finally(() => inflight.delete(tracked));
    inflight.add(tracked);
  }

  async function sendOnce(t: Target, f: Formatted): Promise<{ ok: boolean; status?: number; error?: string; retryAfter?: string; retry: boolean }> {
    const req = t.kind === 'discord'
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(toDiscord(f)) }
      : toNtfy(f);
    if (t.kind === 'ntfy' && t.token) req.headers.Authorization = `Bearer ${t.token}`;
    try {
      const r = await post(t.url, { ...req, timeoutMs: TIMEOUT_MS });
      if (r.status >= 200 && r.status < 300) return { ok: true, status: r.status, retry: false };
      return { ok: false, status: r.status, error: `HTTP ${r.status}`, retryAfter: r.retryAfter, retry: r.status === 429 || r.status >= 500 };
    } catch (e) {
      const code = (e as { code?: string }).code;
      return { ok: false, error: code === 'SSRF_BLOCKED' ? 'Zieladresse blockiert' : (e as Error).message, retry: code !== 'SSRF_BLOCKED' };
    }
  }

  function discordFailure(body: string): { code?: number; retryAfter?: string } {
    try {
      const j = JSON.parse(body);
      return {
        ...(typeof j.code === 'number' ? { code: j.code } : {}),
        ...(typeof j.retry_after === 'number' || typeof j.retry_after === 'string' ? { retryAfter: String(j.retry_after) } : {}),
      };
    } catch { return {}; }
  }

  function discordError(status: number, body: string): { error: string; errorCode?: number } {
    const { code } = discordFailure(body);
    if (code === 50007 || code === 50278) return { error: DISCORD_DM_HINT, errorCode: code };
    return { error: `HTTP ${status}`, ...(code !== undefined ? { errorCode: code } : {}) };
  }

  function currentDiscordLink(t: Target, recipientId: string): boolean {
    const current = deps.getTarget ? deps.getTarget(t.id) : t;
    const link = deps.getDiscordLink?.(t.ownerId);
    return Boolean(current && current.ownerId === t.ownerId && current.kind === 'discord_dm' && link?.discordUserId === recipientId);
  }

  async function discordRequest(t: Target, recipientId: string, url: string, body: string): Promise<{ ok: boolean; status?: number; error?: string; errorCode?: number; response?: PostResult }> {
    if (!deps.discordBotToken) return { ok: false, error: 'Discord-Bot ist nicht konfiguriert.' };
    const request = () => discordPost(url, {
      headers: { 'Content-Type': 'application/json', Authorization: `Bot ${deps.discordBotToken}` }, body, timeoutMs: TIMEOUT_MS,
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      let r: PostResult;
      try { r = await request(); }
      catch (e) {
        const code = (e as { code?: string }).code;
        if (code === 'SSRF_BLOCKED') return { ok: false, error: 'Discord-Adresse blockiert' };
        if (attempt > 0) return { ok: false, error: e instanceof Error ? e.message : String(e) };
        if (!currentDiscordLink(t, recipientId)) return { ok: false, error: DISCORD_UNLINKED };
        continue;
      }
      if (r.status >= 200 && r.status < 300) return { ok: true, status: r.status, response: r };
      const failure = discordFailure(r.body);
      if (failure.code === 50007 || failure.code === 50278) return { ok: false, status: r.status, ...discordError(r.status, r.body) };
      if (r.status !== 429 && r.status < 500) return { ok: false, status: r.status, ...discordError(r.status, r.body) };
      if (attempt > 0) return { ok: false, status: r.status, ...discordError(r.status, r.body) };
      if (r.status === 429) {
        const delay = retryAfterMs(failure.retryAfter ?? r.retryAfter);
        if (delay === null) return { ok: false, status: r.status, error: RETRY_AFTER_TOO_LONG };
        await sleep(delay);
      }
      if (!currentDiscordLink(t, recipientId)) return { ok: false, status: r.status, error: DISCORD_UNLINKED };
    }
    return { ok: false, error: 'Discord-Zustellung fehlgeschlagen.' };
  }

  async function sendDiscordDm(t: Target, f: Formatted): Promise<{ ok: boolean; status?: number; error?: string; errorCode?: number }> {
    if (deps.discordAvailable === false) return { ok: false, error: 'Discord-Direktnachrichten sind nicht eingerichtet.' };
    const linked = deps.getDiscordLink?.(t.ownerId);
    if (!linked) return { ok: false, error: DISCORD_UNLINKED };
    const recipientId = linked.discordUserId;
    let channelId = linked.channelId;
    if (!channelId) {
      const opened = await discordRequest(t, recipientId, `${DISCORD_API}/users/@me/channels`, JSON.stringify({ recipient_id: recipientId }));
      if (!opened.ok) return opened;
      let channel: { id?: unknown };
      try { channel = JSON.parse(opened.response?.body ?? '{}'); } catch { return { ok: false, error: 'Ungültige Discord-Antwort.' }; }
      if (typeof channel.id !== 'string' || !channel.id) return { ok: false, error: 'Discord hat keinen DM-Kanal zurückgegeben.' };
      const currentLink = deps.getDiscordLink?.(t.ownerId);
      if (!currentLink || currentLink.discordUserId !== recipientId) return { ok: false, error: DISCORD_UNLINKED };
      channelId = channel.id;
      deps.cacheDiscordChannel?.(t.ownerId, channelId);
    }
    return discordRequest(t, recipientId, `${DISCORD_API}/channels/${encodeURIComponent(channelId)}/messages`, JSON.stringify(toDiscord(f)));
  }

  async function send(t: Target, f: Formatted): Promise<{ ok: boolean; status?: number; error?: string; errorCode?: number }> {
    if (t.kind === 'discord_dm') return sendDiscordDm(t, f);
    const c = checkTargetUrl(t.kind, t.url);
    if (!c.ok) return { ok: false, error: c.error };
    let r = await sendOnce(t, f);
    if (!r.ok && r.retry) {
      if (r.status === 429) {
        const delay = retryAfterMs(r.retryAfter);
        if (delay === null) return { ok: false, status: r.status, error: RETRY_AFTER_TOO_LONG };
        await sleep(delay);
      }
      const current = deps.getTarget ? deps.getTarget(t.id) : t;
      if (!current || current.url !== t.url) return { ok: false, status: r.status, error: 'Ziel wurde entfernt oder geändert' };
      const retryCheck = checkTargetUrl(current.kind, current.url);
      if (!retryCheck.ok) return { ok: false, status: r.status, error: retryCheck.error };
      r = await sendOnce(current, f);
    }
    return { ok: r.ok, status: r.status, error: r.error };
  }

  function dispatch(t: Target, hits: Hit[]) {
    const current = deps.getTarget ? deps.getTarget(t.id) : t;
    if (!current) return;
    const batches: Hit[][] = [];
    let batch: Hit[] = [];
    for (const hit of hits) {
      const next = [...batch, hit];
      if ((current.kind === 'discord' || current.kind === 'discord_dm') && batch.length && toDiscord(formatBatch(next)).content.length > 2000) {
        batches.push(batch);
        batch = [hit];
      } else batch = next;
    }
    if (batch.length) batches.push(batch);
    for (const group of batches) {
      const formatted = formatBatch(group);
      if ((current.kind === 'discord' || current.kind === 'discord_dm') && toDiscord(formatted).content.length > 2000) {
        track(Promise.resolve().then(() => deps.onResult({ targetId: current.id, ok: false, error: 'Discord-Nachricht überschreitet 2000 Zeichen', hits: group, sentAt: deps.now() })));
        continue;
      }
      track(send(current, formatted).then((r) => {
        deps.onResult({ targetId: current.id, ...r, hits: group, sentAt: deps.now() });
      }));
    }
  }

  function openWindow(w: Win) {
    w.timer = deps.setTimer(() => {
      const hits = w.pending;
      w.pending = [];
      if (!hits.length) { wins.delete(w.target.id); return; }
      dispatch(w.target, hits);
      openWindow(w);
    }, WINDOW_MS);
  }

  return {
    deliver(hit: Hit, targets: Target[]): void {
      for (const t of targets) {
        const w = wins.get(t.id);
        if (w) { w.target = t; w.pending.push(hit); continue; }
        const nw: Win = { target: t, timer: null, pending: [] };
        wins.set(t.id, nw);
        dispatch(t, [hit]);
        openWindow(nw);
      }
    },
    async sendTest(t: Target): Promise<{ ok: boolean; error?: string; errorCode?: number }> {
      const f: Formatted = { title: 'marbleNotification', text: TEST_TEXT, url: 'https://twitch.tv' };
      const r = await send(t, f);
      return r.ok ? { ok: true } : { ok: false, error: r.error, ...(r.errorCode !== undefined ? { errorCode: r.errorCode } : {}) };
    },
    /** Sends everything still collected and waits for all in-flight sends. */
    async flushAll(): Promise<void> {
      for (const w of wins.values()) {
        deps.clearTimer(w.timer);
        if (w.pending.length) dispatch(w.target, w.pending);
      }
      wins.clear();
      while (inflight.size) await Promise.allSettled([...inflight]);
    },
  };
}
