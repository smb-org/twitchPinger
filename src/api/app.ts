import { randomBytes, randomInt } from 'node:crypto';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Badge, ChatMessage, Hit, MatchMode, Rule, Target, TargetKind } from '../types.ts';
import type { RuleInput, UserRow } from '../db/repo.ts';
import type { ApiDeps } from './deps.ts';
import { DISCORD_STATE_COOKIE, SESSION_COOKIE, SESSION_TTL_MS, STATE_COOKIE, hashSessionId, newSessionId, randomId, sha256, signDiscordState, signState, verifyDiscordState, verifyState } from './session.ts';

type Env = { Variables: { user: UserRow; sessionHash: string } };
type Ctx = Context<Env>;

const MAX_TARGETS_PER_USER = 10;
const BADGES: Badge[] = ['broadcaster', 'moderator', 'vip', 'subscriber'];
const MODES: MatchMode[] = ['contains', 'word', 'prefix', 'regex'];
const LOGIN_RE = /^[a-z0-9_]{3,25}$/;
const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
const DAY = 86_400_000;
const TEST_COOLDOWN_MS = 10_000;
const TEST_HOUR_MS = 3_600_000;
const TESTS_PER_USER_HOUR = 20;
const HEALTH_DISCONNECT_GRACE_MS = 2 * 60_000;
const HEALTH_JOIN_GRACE_MS = 60_000;

class ApiError extends Error {
  status: number; code: string; field?: string; retryAfterMs?: number;
  constructor(status: number, code: string, message: string, field?: string, retryAfterMs?: number) { super(message); this.status = status; this.code = code; this.field = field; this.retryAfterMs = retryAfterMs; }
}
const bad = (field: string, message: string) => new ApiError(400, 'validation', message, field);

export function createApi(deps: ApiDeps) {
  const { config, repo, twitch, discord, reader, deliverer } = deps;
  const now = () => (deps.now ?? Date.now)();
  const origin = new URL(config.publicUrl).origin;
  const redirectUri = `${config.publicUrl}/api/auth/callback`;
  const cookieBase = { httpOnly: true, secure: !config.insecureCookies, sameSite: 'Lax' as const, path: '/' };
  const userTestAt = new Map<string, number[]>();
  const targetTestAt = new Map<string, Map<string, number>>();
  let incompleteJoinSince: number | null = null;

  const app = new Hono<Env>().basePath('/api');

  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json({ error: { code: err.code, message: err.message, ...(err.field ? { field: err.field } : {}), ...(err.retryAfterMs !== undefined ? { retryAfterMs: err.retryAfterMs } : {}) } }, err.status as 400);
    console.error('api error', err);
    return c.json({ error: { code: 'internal', message: 'Interner Fehler.' } }, 500);
  });
  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Nicht gefunden.' } }, 404));

  // CSRF: state-changing requests must come from our own origin.
  app.use('*', async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && c.req.header('Origin') !== origin) throw new ApiError(403, 'bad_origin', 'Anfrage von unzulässigem Ursprung.');
    await next();
  });

  // Session auth for everything except health and the OAuth endpoints.
  app.use('*', async (c, next) => {
    const p = c.req.path;
    if (p === '/api/health' || p.startsWith('/api/auth/')) return next();
    const id = getCookie(c, SESSION_COOKIE);
    const hash = id ? hashSessionId(id) : '';
    const s = id ? repo.getSession(hash, now()) : undefined;
    const u = s && repo.getUser(s.userId);
    if (!u || u.locked) throw new ApiError(401, 'unauthorized', 'Bitte anmelden.');
    c.set('user', u);
    c.set('sessionHash', hash);
    await next();
  });

  const me = (c: Ctx) => c.get('user');
  const admin = (c: Ctx) => { if (!me(c).isAdmin) throw new ApiError(403, 'forbidden', 'Nur für Admins.'); };
  async function body(c: Ctx): Promise<Record<string, any>> {
    const b = await c.req.json().catch(() => null);
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new ApiError(400, 'bad_json', 'Ungültige Anfrage.');
    return b;
  }
  const changed = (immediate = false) => deps.onConfigChanged(immediate);
  const notFound = (what: string) => new ApiError(404, 'not_found', `${what} nicht gefunden.`);
  const checkTestQuota = (userId: string, targets: Target[], testedAt: number) => {
    const targetTests = targetTestAt.get(userId);
    for (const target of targets) {
      const lastTestAt = targetTests?.get(target.id);
      if (lastTestAt !== undefined && testedAt - lastTestAt < TEST_COOLDOWN_MS) {
        throw new ApiError(429, 'test_rate_limited', 'Dieses Ziel kann nur alle 10 Sekunden getestet werden.', undefined, TEST_COOLDOWN_MS - (testedAt - lastTestAt));
      }
    }

    const history = userTestAt.get(userId) ?? [];
    const recentTests = history.filter((ts) => testedAt - ts < TEST_HOUR_MS);
    if (recentTests.length !== history.length) {
      if (recentTests.length) userTestAt.set(userId, recentTests);
      else userTestAt.delete(userId);
    }
    const lastTestAt = recentTests.at(-1);
    if (lastTestAt !== undefined && testedAt - lastTestAt < TEST_COOLDOWN_MS) {
      throw new ApiError(429, 'test_rate_limited', 'Du kannst nur alle 10 Sekunden einen Test auslösen.', undefined, TEST_COOLDOWN_MS - (testedAt - lastTestAt));
    }
    if (recentTests.length >= TESTS_PER_USER_HOUR) {
      throw new ApiError(429, 'test_rate_limited', 'Du kannst höchstens 20 Tests pro Stunde auslösen.', undefined, recentTests[0]! + TEST_HOUR_MS - testedAt);
    }

    userTestAt.set(userId, [...recentTests, testedAt]);
    const nextTargetTests = targetTests ?? new Map<string, number>();
    for (const target of targets) nextTargetTests.set(target.id, testedAt);
    targetTestAt.set(userId, nextTargetTests);
  };

  // ---- health & auth ----
  app.get('/health', (c) => {
    const h = reader.health();
    const t = now();
    if (h.connected && h.desired > h.joined) incompleteJoinSince ??= t;
    else incompleteJoinSince = null;
    const disconnectedTooLong = !h.connected && t - h.since > HEALTH_DISCONNECT_GRACE_MS;
    const joinShortfallTooLong = incompleteJoinSince !== null && t - incompleteJoinSince > HEALTH_JOIN_GRACE_MS;
    const ok = !disconnectedTooLong && !joinShortfallTooLong;
    return c.json({ ok, reader: h }, ok ? 200 : 503);
  });

  app.get('/auth/login', (c) => {
    const invite = (c.req.query('invite') ?? '').slice(0, 200) || null;
    const { state, cookie } = signState(config.sessionSecret, invite, now());
    setCookie(c, STATE_COOKIE, cookie, { ...cookieBase, path: '/api/auth', maxAge: 600 });
    return c.redirect(twitch.authorizeUrl(state, redirectUri));
  });

  app.get('/auth/callback', async (c) => {
    const fail = (code: string) => c.redirect(`/login?error=${code}`);
    const st = verifyState(config.sessionSecret, getCookie(c, STATE_COOKIE), c.req.query('state'), now());
    deleteCookie(c, STATE_COOKIE, { path: '/api/auth' });
    const code = c.req.query('code');
    if (!st || !code || c.req.query('error')) return fail('oauth_failed');

    let tu, follows;
    try {
      const token = await twitch.exchangeCode(code, redirectUri);
      tu = await twitch.getUserByToken(token);
      follows = await twitch.getFollowedChannels(token, tu.id).catch(() => []);
      // The token goes out of scope here and is never stored.
    } catch {
      return fail('oauth_failed');
    }

    const t = now();
    const existing = repo.getUser(tu.id);
    let isNew = false;
    if (existing) {
      if (existing.locked) return fail('locked');
      repo.updateUserNames(tu.id, tu.login, tu.displayName);
    } else if (config.adminTwitchUserId && tu.id === config.adminTwitchUserId) {
      repo.createUser({ id: tu.id, login: tu.login, displayName: tu.displayName, isAdmin: true, invitedBy: null, now: t });
      isNew = true;
    } else {
      const rejectNewLogin = (reason: string) => {
        console.warn(`Rejected Twitch login: user id=${tu.id} login=${tu.login} reason=${reason}`);
        return fail(reason);
      };
      if (!st.invite) return rejectNewLogin('no_invite');
      const inv = st.invite ? repo.getInviteByHash(sha256(st.invite)) : undefined;
      if (!inv || inv.revoked) return rejectNewLogin('invite_invalid');
      if (inv.usedBy) return rejectNewLogin('invite_used');
      if (inv.expiresAt <= t) return rejectNewLogin('invite_expired');
      if (repo.countUsers() >= config.limits.MAX_ACCOUNTS) return rejectNewLogin('accounts_full');
      repo.tx(() => {
        repo.createUser({ id: tu.id, login: tu.login, displayName: tu.displayName, isAdmin: false, invitedBy: inv.createdBy, now: t });
        repo.markInviteUsed(inv.id, tu.id, t);
      });
      isNew = true;
    }

    const sid = newSessionId();
    repo.insertSession(hashSessionId(sid), tu.id, t, t + SESSION_TTL_MS, follows);
    setCookie(c, SESSION_COOKIE, sid, { ...cookieBase, maxAge: SESSION_TTL_MS / 1000 });
    if (isNew) changed();
    return c.redirect(isNew ? '/onboarding' : '/');
  });

  // ---- Discord account linking ----
  const discordAvailable = config.discordAvailable && discord.enabled;
  const requireDiscord = () => {
    if (!discordAvailable) throw new ApiError(404, 'discord_unavailable', 'Discord-Direktnachrichten sind nicht eingerichtet.');
  };
  const discordRedirectUri = `${config.publicUrl}/api/discord/callback`;

  app.get('/discord/link', (c) => {
    requireDiscord();
    const returnTo = c.req.query('returnTo') === '/onboarding' ? '/onboarding' : '/targets';
    const { state, cookie } = signDiscordState(config.sessionSecret, c.get('sessionHash'), returnTo, now());
    setCookie(c, DISCORD_STATE_COOKIE, cookie, { ...cookieBase, path: '/api/discord', maxAge: 600 });
    return c.redirect(discord.authorizeUrl(state, discordRedirectUri));
  });

  app.get('/discord/callback', async (c) => {
    requireDiscord();
    const stateCookie = getCookie(c, DISCORD_STATE_COOKIE);
    const st = verifyDiscordState(config.sessionSecret, stateCookie, c.req.query('state'), c.get('sessionHash'), now());
    deleteCookie(c, DISCORD_STATE_COOKIE, { path: '/api/discord' });
    const redirectBase = (returnTo: '/onboarding' | '/targets') => returnTo === '/onboarding' ? '/onboarding?step=2&target=discord_dm' : '/targets?target=discord_dm';
    const fail = (returnTo: '/onboarding' | '/targets' = st?.returnTo ?? '/targets') => c.redirect(`${redirectBase(returnTo)}&error=discord_oauth_failed`);
    const code = c.req.query('code');
    if (!st || !code || c.req.query('error')) return fail();

    try {
      const token = await discord.exchangeCode(code, discordRedirectUri);
      const user = await discord.getUserByToken(token);
      // The OAuth token is intentionally short-lived in memory and never persisted.
      repo.linkDiscordUser(me(c).id, user.id, user.username, now());
    } catch {
      return fail(st.returnTo);
    }
    return c.redirect(`${redirectBase(st.returnTo)}&discord=linked`);
  });

  app.delete('/discord/link', (c) => {
    requireDiscord();
    repo.unlinkDiscordUser(me(c).id);
    return c.json({ ok: true });
  });

  app.post('/auth/logout', (c) => {
    const id = getCookie(c, SESSION_COOKIE);
    if (id) repo.deleteSession(hashSessionId(id));
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  // ---- me & overview ----
  const userDto = (u: UserRow) => ({ id: u.id, login: u.login, displayName: u.displayName });

  app.get('/me', (c) => {
    const u = me(c);
    const counts = { channels: repo.countUserChannels(u.id), rules: repo.countRules(u.id), targets: repo.countTargets(u.id), openInvites: repo.countOpenInvites(u.id, now()) };
    const s = repo.getSession(c.get('sessionHash'), now());
    return c.json({
      user: userDto(u), isAdmin: u.isAdmin, limits: config.limits, counts,
      onboarding: { hasChannel: counts.channels > 0, hasTarget: counts.targets > 0, hasRule: counts.rules > 0 },
      discordDm: { available: discordAvailable, username: discordAvailable ? repo.getDiscordLink(u.id)?.username ?? null : null },
      followSuggestions: s?.follows ?? [],
    });
  });

  app.get('/overview', (c) => {
    const t = now();
    const channels = new Map(repo.listUserChannels(me(c).id).map((ch) => [ch.id, ch]));
    const rules = repo.listRules(me(c).id).map((r) => {
      const lastFired = repo.listLastFired(r.id).map((l) => ({ channelId: l.channelId, channel: channels.get(l.channelId)?.login ?? null, ts: l.ts, cooldownUntil: l.ts + r.cooldownSec * 1000 }));
      const until = Math.max(0, ...lastFired.map((l) => l.cooldownUntil));
      return { ...r, lastFired, cooldownUntil: until > t ? until : null };
    });
    return c.json({ rules, lastPings: repo.lastPings(me(c).id, 10) });
  });

  // ---- channels ----
  app.get('/channels', (c) => c.json({ channels: repo.listUserChannels(me(c).id) }));

  app.post('/channels', async (c) => {
    const u = me(c);
    const login = String((await body(c)).login ?? '').trim().toLowerCase();
    if (!LOGIN_RE.test(login)) throw bad('login', 'Ungültiger Channel-Name.');
    let found;
    try { found = (await twitch.getUsersByLogin([login]))[0]; } catch { throw new ApiError(502, 'twitch_unavailable', 'Twitch ist gerade nicht erreichbar.'); }
    if (!found) throw new ApiError(404, 'channel_unknown', 'Diesen Channel gibt es auf Twitch nicht.');
    const ch = { id: found.id, login: found.login, displayName: found.displayName };
    if (repo.listUserChannels(u.id).some((x) => x.id === ch.id)) return c.json({ channel: ch });
    if (repo.countUserChannels(u.id) >= config.limits.MAX_CHANNELS_PER_USER) throw new ApiError(409, 'limit_user_channels', `Du kannst höchstens ${config.limits.MAX_CHANNELS_PER_USER} Channels beobachten.`);
    if (!repo.isChannelDesired(ch.id) && repo.countDesiredChannels() >= config.limits.MAX_CHANNELS_TOTAL) throw new ApiError(409, 'limit_total_channels', 'Der Dienst beobachtet bereits die maximale Zahl an Channels.');
    repo.tx(() => { repo.upsertChannel(ch, now()); repo.addUserChannel(u.id, ch.id); });
    changed();
    return c.json({ channel: ch }, 201);
  });

  app.delete('/channels/:id', (c) => {
    const u = me(c);
    const id = c.req.param('id');
    if (!repo.listUserChannels(u.id).some((x) => x.id === id)) throw notFound('Channel');
    repo.removeUserChannel(u.id, id);
    changed();
    return c.json({ ok: true });
  });

  // ---- rules ----
  function parseRule(b: Record<string, any>, u: UserRow, id: string, enabledDefault: boolean): RuleInput {
    const L = config.limits;
    const int = (v: unknown, field: string, min: number, max: number, msg: string): number => {
      if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw bad(field, msg);
      return v;
    };
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (name.length < 1 || name.length > 60) throw bad('name', 'Der Name muss 1 bis 60 Zeichen lang sein.');

    const m = b.matcher ?? {};
    if (!MODES.includes(m.mode)) throw bad('matcher.mode', 'Ungültiger Suchmodus.');
    if (typeof m.pattern !== 'string' || m.pattern.length < 1) throw bad('matcher.pattern', 'Das Suchmuster darf nicht leer sein.');
    if (m.pattern.length > L.REGEX_MAX_LEN) throw bad('matcher.pattern', `Das Suchmuster darf höchstens ${L.REGEX_MAX_LEN} Zeichen lang sein.`);
    if (m.mode === 'regex') {
      const r = deps.validateRegex(m.pattern);
      if (!r.ok) throw bad('matcher.pattern', `Ungültiger regulärer Ausdruck: ${r.error}`);
    }

    const s = b.sender ?? {};
    if (!Array.isArray(s.badges ?? []) || !(s.badges ?? []).every((x: Badge) => BADGES.includes(x))) throw bad('sender.badges', 'Ungültige Badges.');
    if (!Array.isArray(s.logins ?? [])) throw bad('sender.logins', 'Ungültige Logins.');
    const badges: Badge[] = s.badges ?? [];
    const logins: string[] = (s.logins ?? []).map((x: unknown) => String(x).trim().toLowerCase());
    if (logins.length > 50 || !logins.every((x) => /^[a-z0-9_]{1,25}$/.test(x))) throw bad('sender.logins', 'Ungültige Logins (höchstens 50).');

    const bu = b.burst ?? {};
    const countBy = bu.countBy ?? 'users';
    if (countBy !== 'users' && countBy !== 'messages') throw bad('burst.countBy', 'Ungültige Zählweise.');

    const cooldownSec = int(b.cooldownSec ?? 300, 'cooldownSec', L.MIN_COOLDOWN_SEC, 86_400 * 7, `Der Cooldown muss mindestens ${L.MIN_COOLDOWN_SEC} Sekunden betragen.`);

    const idList = (v: unknown, field: string, owned: Set<string>, msg: string): string[] => {
      if (!Array.isArray(v) || !v.every((x) => typeof x === 'string' && owned.has(x))) throw bad(field, msg);
      return [...new Set(v as string[])];
    };
    const channelIds = idList(b.channelIds ?? [], 'channelIds', new Set(repo.listUserChannels(u.id).map((x) => x.id)), 'Unbekannter Channel in der Auswahl.');
    const targetIds = idList(b.targetIds ?? [], 'targetIds', new Set(repo.listTargets(u.id).map((x) => x.id)), 'Unbekanntes Ziel in der Auswahl.');

    return {
      id, ownerId: u.id, name, enabled: typeof b.enabled === 'boolean' ? b.enabled : enabledDefault,
      matcher: { mode: m.mode, pattern: m.pattern, caseSensitive: m.caseSensitive === true },
      sender: { badges, logins, exclude: s.exclude === true },
      burst: { threshold: int(bu.threshold ?? 1, 'burst.threshold', 1, 100, 'Die Schwelle muss zwischen 1 und 100 liegen.'), windowSec: int(bu.windowSec ?? 60, 'burst.windowSec', 5, 3600, 'Das Fenster muss zwischen 5 und 3600 Sekunden liegen.'), countBy },
      cooldownSec, channelIds, targetIds,
    };
  }

  app.get('/rules', (c) => c.json({ rules: repo.listRules(me(c).id) }));

  app.post('/rules/validate-regex', async (c) => {
    const p = (await body(c)).pattern;
    if (typeof p !== 'string') throw bad('pattern', 'Muster fehlt.');
    if (p.length > config.limits.REGEX_MAX_LEN) return c.json({ ok: false, error: `Höchstens ${config.limits.REGEX_MAX_LEN} Zeichen.` });
    return c.json(deps.validateRegex(p));
  });

  app.post('/rules', async (c) => {
    const u = me(c);
    const input = parseRule(await body(c), u, randomId(), true);
    const rule: Rule | undefined = repo.createRuleWithinLimit(input, now(), config.limits.MAX_RULES_PER_USER);
    if (!rule) throw new ApiError(409, 'limit_rules', `Du kannst höchstens ${config.limits.MAX_RULES_PER_USER} Regeln anlegen.`);
    changed(!rule.enabled);
    return c.json({ rule }, 201);
  });

  app.put('/rules/:id', async (c) => {
    const u = me(c);
    const old = repo.getRule(c.req.param('id'));
    if (!old || old.ownerId !== u.id) throw notFound('Regel');
    const rule = repo.saveRule(parseRule(await body(c), u, old.id, old.enabled), now());
    changed(!rule.enabled);
    return c.json({ rule });
  });

  app.post('/rules/:id/test', async (c) => {
    const rule = repo.getRule(c.req.param('id'));
    if (!rule || rule.ownerId !== me(c).id) throw notFound('Regel');
    const targets = rule.targetIds.map((id) => repo.getTarget(id)).filter((t): t is Target => !!t && t.ownerId === rule.ownerId);
    if (!targets.length) throw new ApiError(400, 'no_targets', 'Für diese Regel ist kein Ziel ausgewählt.');

    const firedAt = now();
    checkTestQuota(rule.ownerId, targets, firedAt);

    const channels = new Map(repo.listUserChannels(rule.ownerId).map((channel) => [channel.id, channel]));
    const channel = rule.channelIds.map((id) => channels.get(id)).find((candidate) => candidate !== undefined);
    const channelLogin = channel?.login ?? 'kein-channel';
    const sampleText = rule.matcher.mode === 'regex' ? `Muster: /${rule.matcher.pattern}/` : rule.matcher.pattern;
    const sample: ChatMessage = {
      channel: channelLogin, channelId: channel?.id ?? '', userId: 'test', login: 'test', displayName: 'Test',
      text: sampleText, badges: [], sentAt: firedAt, receivedAt: firedAt,
    };
    const hit: Hit = { ruleId: rule.id, ruleName: rule.name, ownerId: rule.ownerId, channelId: sample.channelId, channel: channelLogin, count: rule.burst.threshold, sample, firedAt };
    const results = await Promise.all(targets.map(async (target) => {
      const result = await deps.deliverer.sendRuleTest(target, hit).catch(() => ({ ok: false, error: 'Zustellung fehlgeschlagen.' }));
      return { targetId: target.id, kind: target.kind, ok: result.ok, ...(result.error ? { error: result.error } : {}) };
    }));
    return c.json({ results });
  });

  app.delete('/rules/:id', (c) => {
    if (!repo.deleteRule(c.req.param('id'), me(c).id)) throw notFound('Regel');
    changed(true);
    return c.json({ ok: true });
  });

  // ---- preview ----
  app.get('/preview', (c) => {
    const login = (c.req.query('channel') ?? '').toLowerCase();
    if (!repo.listUserChannels(me(c).id).some((x) => x.login === login)) throw new ApiError(404, 'channel_unknown', 'Dieser Channel gehört nicht zu deinen Channels.');
    const messages = reader.recent(login).map((m) => ({ sentAt: m.sentAt, userId: m.userId, login: m.login, displayName: m.displayName, text: m.text, badges: m.badges }));
    return c.json({ channel: login, messages });
  });

  // ---- targets ----
  // Never expose tokens; Discord webhook URLs are secrets themselves, so only a hint is returned.
  const targetDto = (t: Target) => ({
    id: t.id, kind: t.kind, name: t.name, failCount: t.failCount,
    status: t.kind === 'discord_dm' && !discordAvailable ? 'unavailable' : t.kind === 'discord_dm' && !repo.getDiscordLink(t.ownerId) ? 'unlinked' : t.status,
    failureHint: t.kind === 'discord_dm' && !discordAvailable ? 'Discord-Direktnachrichten sind nicht eingerichtet.' : t.kind === 'discord_dm' && !repo.getDiscordLink(t.ownerId) ? 'Discord nicht verbunden. Verbinde dein Konto erneut.' : t.lastError ?? null,
    url: t.kind === 'discord' ? `${new URL(t.url).origin}/api/webhooks/…` : t.url,
  });
  const topic = () => Array.from({ length: 24 }, () => B32[randomInt(32)]).join('');

  async function checkUrl(kind: TargetKind, url: string) {
    const err = await deps.checkTargetUrl(kind, url);
    if (err) throw bad('url', err);
  }
  const parseName = (v: unknown): string => {
    const name = typeof v === 'string' ? v.trim() : '';
    if (name.length < 1 || name.length > 60) throw bad('name', 'Der Name muss 1 bis 60 Zeichen lang sein.');
    return name;
  };

  app.get('/targets', (c) => c.json({ targets: repo.listTargets(me(c).id).map(targetDto) }));

  app.post('/targets', async (c) => {
    const u = me(c);
    const b = await body(c);
    if (b.kind !== 'discord' && b.kind !== 'discord_dm' && b.kind !== 'ntfy') throw bad('kind', 'Ungültige Zielart.');
    if (b.kind === 'discord_dm') {
      requireDiscord();
      if (!repo.getDiscordLink(u.id)) throw new ApiError(409, 'discord_not_linked', 'Verbinde zuerst dein Discord-Konto.');
    }
    const name = parseName(b.name);
    let url = typeof b.url === 'string' ? b.url.trim() : '';
    if (b.kind === 'discord_dm') url = '';
    else if (!url && b.kind === 'ntfy') url = `${config.ntfyBaseUrl}/tp-${topic()}`;
    else if (!url) throw bad('url', 'Die URL fehlt.');
    else await checkUrl(b.kind, url);
    const t = { id: randomId(), ownerId: u.id, kind: b.kind as TargetKind, name, url, token: null };
    if (!repo.createTargetWithinLimit(t, MAX_TARGETS_PER_USER)) throw new ApiError(409, 'limit_targets', `Du kannst höchstens ${MAX_TARGETS_PER_USER} Ziele anlegen.`);
    return c.json({ target: targetDto({ ...t, failCount: 0, status: 'ok' }) }, 201);
  });

  app.put('/targets/:id', async (c) => {
    const old = repo.getTarget(c.req.param('id'));
    if (!old || old.ownerId !== me(c).id) throw notFound('Ziel');
    const b = await body(c);
    const name = parseName(b.name ?? old.name);
    const url = old.kind === 'discord_dm' ? '' : typeof b.url === 'string' && b.url.trim() ? b.url.trim() : old.url;
    if (old.kind !== 'discord_dm' && url !== old.url) await checkUrl(old.kind, url);
    repo.saveTarget({ id: old.id, ownerId: old.ownerId, kind: old.kind, name, url, token: null });
    return c.json({ target: targetDto(repo.getTarget(old.id)!) });
  });

  app.delete('/targets/:id', (c) => {
    if (!repo.deleteTarget(c.req.param('id'), me(c).id)) throw notFound('Ziel');
    changed();
    return c.json({ ok: true });
  });

  app.post('/targets/:id/test', async (c) => {
    const t = repo.getTarget(c.req.param('id'));
    if (!t || t.ownerId !== me(c).id) throw notFound('Ziel');
    checkTestQuota(t.ownerId, [t], now());
    const r: { ok: boolean; error?: string; errorCode?: number } = await deliverer.sendTest(t).catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : 'Fehler' }));
    repo.recordDeliveryResult(t.id, r.ok, r.error, r.errorCode === 50007 || r.errorCode === 50278);
    return c.json(r);
  });

  // ---- invites ----
  app.get('/invites', (c) => {
    const t = now();
    const invites = repo.listInvites(me(c).id).map((i) => ({
      id: i.id, createdAt: i.createdAt, expiresAt: i.expiresAt, usedAt: i.usedAt,
      usedBy: i.usedBy ? repo.getUser(i.usedBy)?.login ?? null : null,
      status: i.usedBy ? 'used' : i.revoked ? 'revoked' : i.expiresAt <= t ? 'expired' : 'open',
    }));
    return c.json({ invites });
  });

  app.post('/invites', (c) => {
    const u = me(c);
    const t = now();
    if (repo.countOpenInvites(u.id, t) >= config.limits.MAX_OPEN_INVITES) throw new ApiError(409, 'limit_invites', `Du kannst höchstens ${config.limits.MAX_OPEN_INVITES} offene Einladungen haben.`);
    const code = randomBytes(18).toString('base64url');
    const id = randomId();
    const expiresAt = t + config.limits.INVITE_TTL_DAYS * DAY;
    repo.createInvite({ id, codeHash: sha256(code), createdBy: u.id, now: t, expiresAt });
    return c.json({ id, code, link: `${config.publicUrl}/invite/${code}`, expiresAt }, 201);
  });

  app.delete('/invites/:id', (c) => {
    if (!repo.revokeInvite(c.req.param('id'), me(c).id)) throw notFound('Einladung');
    return c.json({ ok: true });
  });

  // ---- admin ----
  app.get('/admin/users', (c) => {
    admin(c);
    return c.json({ users: repo.listUsers().map((x) => ({ id: x.id, login: x.login, displayName: x.displayName, isAdmin: x.isAdmin, locked: x.locked, invitedBy: x.invitedBy, createdAt: x.createdAt, ruleCount: x.ruleCount, channelCount: x.channelCount })) });
  });

  for (const action of ['lock', 'unlock'] as const) {
    app.post(`/admin/users/:id/${action}`, (c) => {
      admin(c);
      const id = c.req.param('id');
      const target = repo.getUser(id);
      if (!target) throw notFound('Konto');
      if (action === 'lock') {
        if (target.id === me(c).id || target.isAdmin) throw new ApiError(400, 'cannot_lock_admin', 'Admin-Konten können nicht gesperrt werden.');
        repo.lockUser(id);
        changed(true);
        return c.json({ ok: true });
      }
      if (!repo.unlockUserWithinChannelLimit(id, config.limits.MAX_CHANNELS_TOTAL)) {
        throw new ApiError(409, 'limit_total_channels', 'Der Dienst beobachtet bereits die maximale Zahl an Channels.');
      }
      changed();
      return c.json({ ok: true });
    });
  }

  return app;
}
