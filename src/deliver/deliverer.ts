import type { Hit, Target } from '../types.ts';
import { formatBatch, toDiscord, toNtfy } from './format.ts';
import type { Formatted } from './format.ts';
import { checkTargetUrl, safePost } from './ssrf.ts';

export interface DeliveryResult { targetId: string; ok: boolean; status?: number; error?: string; hits: Hit[]; sentAt: number }
export interface DelivererDeps {
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (h: unknown) => void;
  post?: typeof safePost;
  sleep?: (ms: number) => Promise<void>;
  getTarget?: (id: string) => Target | undefined;
  onResult: (r: DeliveryResult) => void;
  log?: (line: string) => void;
}

const WINDOW_MS = 10_000;
const TIMEOUT_MS = 5_000;
const MAX_RETRY_AFTER_MS = 300_000;
const TEST_TEXT = 'Test von marbleNotification – wenn du das liest, kommt alles an.';

interface Win { target: Target; timer: unknown; pending: Hit[] }

export function createDeliverer(deps: DelivererDeps) {
  const post = deps.post ?? safePost;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const wins = new Map<string, Win>();
  const inflight = new Set<Promise<unknown>>();

  function retryAfterMs(value: string | undefined): number {
    if (!value) return 1000;
    const seconds = Number(value);
    const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - deps.now();
    if (!Number.isFinite(delay)) return 1000;
    return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, delay));
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

  async function send(t: Target, f: Formatted): Promise<{ ok: boolean; status?: number; error?: string }> {
    const c = checkTargetUrl(t.kind, t.url);
    if (!c.ok) return { ok: false, error: c.error };
    let r = await sendOnce(t, f);
    if (!r.ok && r.retry) {
      if (r.status === 429) await sleep(retryAfterMs(r.retryAfter));
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
      if (current.kind === 'discord' && batch.length && toDiscord(formatBatch(next)).content.length > 2000) {
        batches.push(batch);
        batch = [hit];
      } else batch = next;
    }
    if (batch.length) batches.push(batch);
    for (const group of batches) {
      const formatted = formatBatch(group);
      if (current.kind === 'discord' && toDiscord(formatted).content.length > 2000) {
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
    async sendTest(t: Target): Promise<{ ok: boolean; error?: string }> {
      const f: Formatted = { title: 'marbleNotification', text: TEST_TEXT, url: 'https://twitch.tv' };
      const r = await send(t, f);
      return r.ok ? { ok: true } : { ok: false, error: r.error };
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
