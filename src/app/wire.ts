import type { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import type { ChatMessage, Hit, Target } from '../types.ts';
import type { Repo } from '../db/repo.ts';
import type { Config } from '../api/config.ts';
import type { Twitch } from '../api/twitch.ts';
import { createDiscord } from '../api/discord.ts';
import { createApi } from '../api/app.ts';
import { createReader } from '../reader/reader.ts';
import type { Reader } from '../reader/reader.ts';
import { createFakeReader } from '../reader/fake.ts';
import type { FakeReader } from '../reader/fake.ts';
import { createEngine } from '../rules/engine.ts';
import { validateRegex } from '../rules/matcher.ts';
import { createDeliverer } from '../deliver/deliverer.ts';
import { createAdminAlert } from '../deliver/admin-alert.ts';
import { checkTargetUrl } from '../deliver/ssrf.ts';
import type { safePost, trustedPost } from '../deliver/ssrf.ts';
import { vacuumInto } from '../db/backup.ts';
import { createR2 } from './r2.ts';

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(h: unknown): void;
  every(fn: () => void, ms: number): unknown;
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as NodeJS.Timeout),
  every: (fn, ms) => setInterval(fn, ms).unref(),
};

export interface ServiceDeps {
  config: Config;
  db: DatabaseSync;
  repo: Repo;
  twitch: Twitch;
  now?: () => number;
  timers?: Timers;
  /** Defaults to the real twurple reader (READER=twurple) or the fake reader (READER=fake). */
  readerFactory?: (opts: { onMessage: (m: ChatMessage) => void }) => Reader;
  post?: typeof safePost;
  discordPost?: typeof trustedPost;
  alertPost?: typeof trustedPost;
  r2?: { enabled: boolean; uploadAndPrune(file: string): Promise<void> };
  log?: (line: string) => void;
}

const MIN = 60_000;
const DOWN_MS = 2 * MIN;
const SILENT_MS = 10 * MIN;

export function createService(deps: ServiceDeps) {
  const { config, repo, twitch } = deps;
  const now = deps.now ?? Date.now;
  const timers = deps.timers ?? realTimers;
  const log = deps.log ?? ((l: string) => console.log(l));
  const alert = createAdminAlert({ url: config.adminNtfyUrl || null, token: config.adminNtfyToken || null, post: deps.alertPost });
  const r2 = deps.r2 ?? createR2(config.r2);

  // Tokens for our own ntfy server are never stored per target.
  const sameOrigin = (a: string, b: string): boolean => {
    try { return new URL(a).origin === new URL(b).origin; } catch { return false; }
  };
  const withToken = <T extends { kind: string; url: string; token: string | null }>(t: T): T =>
    t.kind === 'ntfy' && config.ntfyAppToken && config.ntfyBaseUrl && sameOrigin(t.url, config.ntfyBaseUrl) ? { ...t, token: config.ntfyAppToken } : t;

  const hitIds = new WeakMap<Hit, number>();
  const deliverer = createDeliverer({
    now,
    setTimer: (fn, ms) => timers.set(fn, ms),
    clearTimer: (h) => timers.clear(h),
    post: deps.post,
    discordPost: deps.discordPost,
    discordBotToken: config.discordBotToken,
    discordAvailable: config.discordAvailable,
    getDiscordLink: (userId) => {
      const l = repo.getDiscordLink(userId);
      return l ? { discordUserId: l.discordUserId, channelId: l.channelId } : undefined;
    },
    cacheDiscordChannel: repo.cacheDiscordChannel,
    log,
    getTarget: (id) => {
      const t = repo.getTarget(id);
      return t ? withToken(t) : undefined;
    },
    onResult(r) {
      repo.recordDeliveryResult(r.targetId, r.ok, r.error, r.errorCode === 50007 || r.errorCode === 50278);
      for (const h of r.hits) {
        const id = hitIds.get(h);
        if (id !== undefined) repo.appendHitResult(id, r.targetId, r.ok, r.sentAt);
      }
    },
  });

  const engine = createEngine({
    now,
    log,
    getLastFired: repo.getLastFired,
    setLastFired: repo.setLastFired,
    onHit(hit) {
      const rule = repo.getRule(hit.ruleId);
      const owner = rule && repo.getUser(rule.ownerId);
      if (!rule || !rule.enabled || !owner || owner.locked) return;
      hitIds.set(hit, repo.recordHit({ ruleId: hit.ruleId, channelId: hit.channelId, count: hit.count, firedAt: hit.firedAt, sentTs: hit.sample.sentAt }));
      const targets = rule.targetIds.map((id) => repo.getTarget(id)).filter((t): t is Target => !!t && t.ownerId === rule.ownerId).map(withToken);
      if (targets.length) deliverer.deliver(hit, targets);
    },
  });

  const onMessage = (m: ChatMessage) => {
    try { engine.ingest(m); } catch (e) { log(`ingest failed: ${e}`); }
  };
  const reader: Reader = deps.readerFactory
    ? deps.readerFactory({ onMessage })
    : config.reader === 'fake' ? createFakeReader({ onMessage, now }) : createReader({ onMessage, now });
  const fakeReader = config.reader === 'fake' && !deps.readerFactory ? (reader as FakeReader) : null;

  // ---- config propagation (debounced) ----
  let debounce: unknown = null;
  function applyConfig(): void {
    debounce = null;
    engine.setRules(repo.listEnabledRules());
    reader.setChannels(repo.desiredChannelLogins()).catch((e) => log(`setChannels failed: ${e}`));
  }
  function onConfigChanged(immediate = false): void {
    if (immediate) {
      if (debounce !== null) timers.clear(debounce);
      applyConfig();
      return;
    }
    if (debounce !== null) timers.clear(debounce);
    debounce = timers.set(applyConfig, 250);
  }

  // ---- dead-man (D3) ----
  // gstack-shortcut(dec-ffde5ffb-4905-4910-9803-1b28883ca7f6): in-process alert only, no alarm on process hang/VM/tunnel outage; upgrade when first unnoticed outage or nightly false alarms → external heartbeat + process exit + live check
  let alarmed = false;
  async function checkDeadMan(): Promise<void> {
    const h = reader.health();
    const t = now();
    const down = !h.connected && t - h.since > DOWN_MS;
    const silent = h.connected && h.desired >= 1 && t - (h.lastMessageAt ?? h.since) > SILENT_MS;
    if ((down || silent) && !alarmed) {
      alarmed = true;
      await alert.send('twitchPinger Alarm', down ? 'Chat-Verbindung seit über 2 Minuten getrennt.' : 'Seit über 10 Minuten keine Chat-Nachricht in allen Kanälen.');
    } else if (!down && !silent && alarmed) {
      alarmed = false;
      await alert.send('twitchPinger Entwarnung', 'Chat-Verbindung wieder in Ordnung.');
    }
  }

  // ---- daily jobs ----
  async function reresolveChannels(): Promise<void> {
    const chans = repo.desiredChannels();
    if (!chans.length) return;
    let changed = false;
    for (const u of await twitch.getUsersById(chans.map((c) => c.id))) {
      const c = chans.find((x) => x.id === u.id);
      if (c && c.login !== u.login) { repo.updateChannelLogin(u.id, u.login, u.displayName); changed = true; }
    }
    if (changed) onConfigChanged();
  }

  let backupFailed = false;
  async function backup(): Promise<void> {
    try {
      const file = vacuumInto(deps.db, join(config.dataDir, 'backups'), 7);
      if (r2.enabled) await r2.uploadAndPrune(file);
      backupFailed = false;
    } catch (e) {
      log(`backup failed: ${e}`);
      if (!backupFailed) { backupFailed = true; await alert.send('twitchPinger Backup fehlgeschlagen', String(e instanceof Error ? e.message : e)); }
    }
  }

  async function runDaily(): Promise<void> {
    const step = async (name: string, fn: () => unknown) => { try { await fn(); } catch (e) { log(`${name} failed: ${e}`); } };
    await step('purge', () => { repo.purgeOldHits(30, now()); repo.purgeExpiredSessions(now()); });
    await step('re-resolve', reresolveChannels);
    await backup();
  }

  function logMetrics(): void {
    const s = engine.stats();
    const h = reader.health();
    log(`metrics messages=${s.messages} avgMatchMicros=${s.avgMatchMicros.toFixed(1)} maxMatchMicros=${s.maxMatchMicros.toFixed(1)} joined=${h.joined}/${h.desired}`);
  }

  const discord = createDiscord({ clientId: config.discordClientId, clientSecret: config.discordClientSecret, botToken: config.discordBotToken, baseUrl: config.discordBaseUrl });
  const api = createApi({
    config, db: deps.db, repo, twitch, discord, now,
    reader,
    deliverer: {
      sendTest: (t) => deliverer.sendTest(withToken(t) as Target),
      sendRuleTest: (t, hit) => deliverer.sendRuleTest(withToken(t), hit),
    },
    validateRegex,
    checkTargetUrl: (kind, url) => { const r = checkTargetUrl(kind, url); return r.ok ? null : r.error; },
    onConfigChanged,
  });

  const handles: unknown[] = [];
  return {
    api, reader, fakeReader, engine, deliverer,
    onConfigChanged, checkDeadMan, runDaily, logMetrics, reresolveChannels,
    async start(): Promise<void> {
      applyConfig();
      await reader.start();
      reresolveChannels().catch((e) => log(`re-resolve failed: ${e}`));
      handles.push(
        timers.every(() => { checkDeadMan(); }, 30_000),
        timers.every(logMetrics, 5 * MIN),
        timers.set(() => { runDaily(); handles.push(timers.every(() => { runDaily(); }, 24 * 60 * MIN)); }, 5 * MIN),
      );
    },
    async stop(): Promise<void> {
      for (const h of handles) timers.clear(h);
      if (debounce !== null) timers.clear(debounce);
      await reader.stop();
      await deliverer.flushAll();
    },
  };
}
export type Service = ReturnType<typeof createService>;
