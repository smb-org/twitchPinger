import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db/db.ts';
import { createRepo } from '../db/repo.ts';
import { LIMITS_DEFAULTS } from '../types.ts';
import type { ChatMessage, ReaderHealth } from '../types.ts';
import { createApi } from './app.ts';
import { createTwitch } from './twitch.ts';
import type { ApiConfig, ApiDeps } from './deps.ts';

const ORIGIN = 'https://m.example';
const USERS: Record<string, { id: string; login: string; display_name: string }> = {
  admin: { id: '1', login: 'boss', display_name: 'Boss' },
  alice: { id: '2', login: 'alice', display_name: 'Alice' },
  bob: { id: '3', login: 'bob', display_name: 'Bob' },
  carol: { id: '4', login: 'carol', display_name: 'Carol' },
};
const CHANNELS = ['marbles_one', 'marbles_two', 'marbles_three', 'other_chan'];

function fakeFetch(): typeof fetch {
  return (async (input: any, init?: any) => {
    const url = new URL(String(input));
    const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
    if (url.pathname === '/oauth2/token') {
      const p = new URLSearchParams(String(init.body));
      return p.get('grant_type') === 'client_credentials' ? json({ access_token: 'app', expires_in: 3600 }) : json({ access_token: `tok-${p.get('code')}` });
    }
    const auth = String(init?.headers?.Authorization ?? '');
    if (url.pathname === '/helix/users') {
      const logins = url.searchParams.getAll('login');
      if (logins.length) return json({ data: logins.filter((l) => CHANNELS.includes(l)).map((l) => ({ id: `ch-${l}`, login: l, display_name: l.toUpperCase() })) });
      const u = USERS[auth.replace('Bearer tok-', '')];
      return u ? json({ data: [u] }) : json({}, 401);
    }
    if (url.pathname === '/helix/channels/followed') return json({ data: [{ broadcaster_id: 'ch-marbles_one', broadcaster_login: 'marbles_one', broadcaster_name: 'Marbles_One' }], pagination: {} });
    return json({}, 404);
  }) as typeof fetch;
}

function setup(over: Partial<ApiConfig['limits']> = {}, opts: { admin?: string } = {}, overrides: Partial<ApiDeps> = {}) {
  const db = openDb(':memory:');
  const repo = createRepo(db);
  let t = 1_000_000;
  let changes = 0;
  let immediateChanges = 0;
  let readerHealth: ReaderHealth = { connected: true, since: 1, joined: 2, desired: 2, lastMessageAt: null };
  const messages: ChatMessage[] = [{ channel: 'marbles_one', channelId: 'ch-marbles_one', userId: 'x9', login: 'viewer', displayName: 'Viewer', text: '!play', badges: ['vip'], sentAt: 5, receivedAt: 6 }];
  const tests: any[] = [];
  const config: ApiConfig = {
    publicUrl: ORIGIN, sessionSecret: 's'.repeat(32), adminTwitchUserId: opts.admin ?? '1', ntfyBaseUrl: 'https://ntfy.example', insecureCookies: true,
    limits: { ...LIMITS_DEFAULTS, ...over },
  };
  const deps: ApiDeps = {
    config, db, repo,
    twitch: createTwitch({ clientId: 'cid', clientSecret: 'sec', authBase: 'https://auth.test', helixBase: 'https://auth.test/helix', fetch: fakeFetch() }),
    reader: { health: () => readerHealth, recent: (l) => (l === 'marbles_one' ? messages : []) },
    deliverer: { sendTest: async (tg) => { tests.push(tg); return { ok: true }; } },
    validateRegex: (p) => { try { new RegExp(p); return /\(\?<?[=!]/.test(p) ? { ok: false, error: 'lookaround' } : { ok: true }; } catch (e) { return { ok: false, error: String(e) }; } },
    checkTargetUrl: (_k, url) => (url.startsWith('https://') ? null : 'Nur https erlaubt.'),
    onConfigChanged: (immediate) => { changes++; if (immediate) immediateChanges++; },
    now: () => t,
    ...overrides,
  };
  const app = createApi(deps);
  const api = {
    app, repo, deps, tests, advance: (ms: number) => { t += ms; }, setReaderHealth: (h: typeof readerHealth) => { readerHealth = h; },
    get changes() { return changes; }, get immediateChanges() { return immediateChanges; },
    async req(path: string, o: { method?: string; cookie?: string; origin?: string | null; body?: unknown } = {}) {
      const headers: Record<string, string> = {};
      if (o.cookie) headers.cookie = o.cookie;
      if (o.origin !== null && (o.method ?? 'GET') !== 'GET') headers.origin = o.origin ?? ORIGIN;
      if (o.body !== undefined) headers['content-type'] = 'application/json';
      return app.request(`/api${path}`, { method: o.method ?? 'GET', headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
    },
    /** Full OAuth round trip; returns the callback response and the session cookie if any. */
    async login(who: string, invite?: string) {
      const r1 = await app.request(`/api/auth/login${invite ? `?invite=${invite}` : ''}`);
      const state = new URL(r1.headers.get('location')!).searchParams.get('state')!;
      const stateCookie = r1.headers.get('set-cookie')!.split(';')[0];
      const r2 = await app.request(`/api/auth/callback?code=${who}&state=${state}`, { headers: { cookie: stateCookie } });
      const sc = r2.headers.get('set-cookie') ?? '';
      const m = /mn_session=([^;]+)/.exec(sc);
      return { res: r2, location: r2.headers.get('location')!, cookie: m ? `mn_session=${m[1]}` : '', setCookie: sc };
    },
    async mkInvite(cookie: string) {
      const r = await api.req('/invites', { method: 'POST', cookie, body: {} });
      return (await r.json()) as { id: string; code: string; link: string };
    },
    async join(who: string, adminCookie: string) {
      const inv = await api.mkInvite(adminCookie);
      return api.login(who, inv.code);
    },
  };
  return api;
}
const j = async (r: Response) => (await r.json()) as any;

test('health needs no auth; protected routes give 401', async () => {
  const a = setup();
  const h = await j(await a.req('/health'));
  assert.equal(h.ok, true);
  assert.equal(h.reader.joined, 2);
  const r = await a.req('/me');
  assert.equal(r.status, 401);
  assert.equal((await j(r)).error.code, 'unauthorized');
});

test('health fails after the disconnected startup grace and sustained join shortfall', async () => {
  const a = setup();
  a.setReaderHealth({ connected: false, since: 1_000_000, joined: 0, desired: 1, lastMessageAt: null });
  assert.equal((await a.req('/health')).status, 200);
  a.advance(120_001);
  const down = await a.req('/health');
  assert.equal(down.status, 503);
  const downBody = await j(down);
  assert.deepEqual(Object.keys(downBody).sort(), ['ok', 'reader']);
  assert.equal(downBody.ok, false);

  a.setReaderHealth({ connected: true, since: 1_120_001, joined: 0, desired: 1, lastMessageAt: null });
  assert.equal((await a.req('/health')).status, 200);
  a.advance(60_001);
  assert.equal((await a.req('/health')).status, 503);
  a.setReaderHealth({ connected: true, since: 1_180_002, joined: 1, desired: 1, lastMessageAt: null });
  assert.equal((await a.req('/health')).status, 200);
});

test('Origin check: POST without or with foreign origin is 403', async () => {
  const a = setup();
  const { cookie } = await a.login('admin');
  assert.equal((await a.req('/invites', { method: 'POST', cookie, origin: 'https://evil.example', body: {} })).status, 403);
  assert.equal((await a.req('/invites', { method: 'POST', cookie, origin: null, body: {} })).status, 403);
  assert.equal((await a.req('/invites', { method: 'POST', cookie, body: {} })).status, 201);
});

test('callback: admin bootstrap, session cookie flags, onboarding redirect', async () => {
  const a = setup();
  const l = await a.login('admin');
  assert.equal(l.location, '/onboarding');
  assert.match(l.setCookie, /HttpOnly/i);
  assert.match(l.setCookie, /SameSite=Lax/i);
  assert.match(l.setCookie, /Path=\//);
  assert.doesNotMatch(l.setCookie, /Secure/); // insecureCookies in tests
  const me = await j(await a.req('/me', { cookie: l.cookie }));
  assert.equal(me.isAdmin, true);
  assert.equal(me.followSuggestions[0].login, 'marbles_one');
  assert.deepEqual(me.onboarding, { hasChannel: false, hasTarget: false, hasRule: false });
  // returning login goes to /
  assert.equal((await a.login('admin')).location, '/');
  // session id is stored hashed only
  const stored = (a.deps.db.prepare('SELECT id_hash FROM sessions').all() as any[]).map((r) => r.id_hash);
  assert.ok(stored.every((h) => h !== l.cookie.split('=')[1]));
});

test('Secure flag set when cookies are not insecure', async () => {
  const a = setup();
  a.deps.config.insecureCookies = false;
  const app = (await import('./app.ts')).createApi(a.deps);
  const r = await app.request('/api/auth/login');
  assert.match(r.headers.get('set-cookie')!, /Secure/);
});

test('callback: tampered state fails, and unknown users without invites get a specific rejection', async () => {
  const a = setup();
  const r1 = await a.app.request('/api/auth/login');
  const state = new URL(r1.headers.get('location')!).searchParams.get('state')!;
  const ck = r1.headers.get('set-cookie')!.split(';')[0];
  const bad = await a.app.request(`/api/auth/callback?code=admin&state=${state}x`, { headers: { cookie: ck } });
  assert.equal(bad.headers.get('location'), '/login?error=oauth_failed');
  const tampered = await a.app.request(`/api/auth/callback?code=admin&state=${state}`, { headers: { cookie: ck.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')) } });
  assert.equal(tampered.headers.get('location'), '/login?error=oauth_failed');
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(' '));
  try {
    assert.equal((await a.login('alice')).location, '/login?error=no_invite');
  } finally {
    console.warn = warn;
  }
  assert.match(warnings.join(' '), /2.*alice|alice.*2/);
  assert.equal(a.repo.getUser('2'), undefined);
});

test('callback: valid invite creates user, is single-use; used/expired/revoked rejected', async () => {
  const a = setup();
  const admin = await a.login('admin');
  const inv = await a.mkInvite(admin.cookie);
  assert.match(inv.link, new RegExp(`^${ORIGIN}/invite/`));
  const ok = await a.login('alice', inv.code);
  assert.equal(ok.location, '/onboarding');
  assert.equal(a.repo.getUser('2')!.invitedBy, '1');
  assert.equal((await a.login('bob', inv.code)).location, '/login?error=invite_used');
  // alice may log in again without an invite
  assert.equal((await a.login('alice')).location, '/');

  const exp = await a.mkInvite(admin.cookie);
  a.advance(LIMITS_DEFAULTS.INVITE_TTL_DAYS * 86_400_000 + 1);
  assert.equal((await a.login('bob', exp.code)).location, '/login?error=invite_expired');

  const rev = await a.mkInvite(admin.cookie);
  assert.equal((await a.req(`/invites/${rev.id}`, { method: 'DELETE', cookie: admin.cookie })).status, 200);
  assert.equal((await a.login('bob', rev.code)).location, '/login?error=invite_invalid');
  assert.equal((await a.login('bob', 'garbage')).location, '/login?error=invite_invalid');
});

test('callback: accounts_full and locked', async () => {
  const a = setup({ MAX_ACCOUNTS: 2 });
  const admin = await a.login('admin');
  assert.equal((await a.join('alice', admin.cookie)).location, '/onboarding');
  assert.equal((await a.join('bob', admin.cookie)).location, '/login?error=accounts_full');
  await a.req('/admin/users/2/lock', { method: 'POST', cookie: admin.cookie });
  assert.equal((await a.login('alice')).location, '/login?error=locked');
});

test('invites: open limit, plain code returned once, only hash stored', async () => {
  const a = setup({ MAX_OPEN_INVITES: 2 });
  const { cookie } = await a.login('admin');
  const i1 = await a.mkInvite(cookie);
  await a.mkInvite(cookie);
  const r = await a.req('/invites', { method: 'POST', cookie, body: {} });
  assert.equal(r.status, 409);
  assert.equal((await j(r)).error.code, 'limit_invites');
  const list = await j(await a.req('/invites', { cookie }));
  assert.equal(list.invites.length, 2);
  assert.ok(!JSON.stringify(list).includes(i1.code));
  const rows = a.deps.db.prepare('SELECT code_hash FROM invites').all() as any[];
  assert.ok(rows.every((x) => x.code_hash !== i1.code && x.code_hash.length === 64));
  // revoking frees a slot
  await a.req(`/invites/${i1.id}`, { method: 'DELETE', cookie });
  assert.equal((await a.req('/invites', { method: 'POST', cookie, body: {} })).status, 201);
});

async function member(a: ReturnType<typeof setup>) {
  const admin = await a.login('admin');
  const alice = await a.join('alice', admin.cookie);
  return { admin: admin.cookie, alice: alice.cookie };
}

test('channels: add, unknown, format, per-user and total limits, delete strips rules', async () => {
  const a = setup({ MAX_CHANNELS_PER_USER: 2, MAX_CHANNELS_TOTAL: 2 });
  const { admin, alice } = await member(a);
  const add = (cookie: string, login: string) => a.req('/channels', { method: 'POST', cookie, body: { login } });
  assert.equal((await add(alice, 'Marbles_One')).status, 201);
  assert.equal((await j(await a.req('/channels', { cookie: alice }))).channels[0].login, 'marbles_one');
  assert.equal((await add(alice, 'marbles_one')).status, 200); // idempotent
  const unknown = await add(alice, 'nobody_here');
  assert.equal(unknown.status, 404);
  assert.equal((await j(unknown)).error.code, 'channel_unknown');
  assert.equal((await add(alice, 'a b')).status, 400);
  assert.equal((await add(alice, 'marbles_two')).status, 201);
  assert.equal((await j(await add(alice, 'marbles_three'))).error.code, 'limit_user_channels');
  // admin: total limit reached (2 distinct), shared channel still ok, new one rejected
  assert.equal((await add(admin, 'marbles_one')).status, 201);
  assert.equal((await j(await add(admin, 'marbles_three'))).error.code, 'limit_total_channels');
  assert.ok(a.changes > 0);

  const ch = (await j(await a.req('/channels', { cookie: alice }))).channels[0];
  const rule = await a.req('/rules', { method: 'POST', cookie: alice, body: { name: 'r', matcher: { mode: 'contains', pattern: 'x' }, channelIds: [ch.id] } });
  assert.equal(rule.status, 201);
  assert.equal((await a.req(`/channels/${ch.id}`, { method: 'DELETE', cookie: alice })).status, 200);
  assert.deepEqual((await j(await a.req('/rules', { cookie: alice }))).rules[0].channelIds, []);
  assert.equal((await a.req(`/channels/${ch.id}`, { method: 'DELETE', cookie: alice })).status, 404);
});

test('rules: create/update/delete, validation errors, limit, ownership, updatedAt', async () => {
  const a = setup({ MAX_RULES_PER_USER: 2 });
  const { admin, alice } = await member(a);
  const ch = (await j(await a.req('/channels', { method: 'POST', cookie: alice, body: { login: 'marbles_one' } }))).channel;
  const base = { name: 'play', matcher: { mode: 'word', pattern: '!play' }, burst: { threshold: 5, windowSec: 60 }, cooldownSec: 60, channelIds: [ch.id] };
  const post = (b: unknown, cookie = alice) => a.req('/rules', { method: 'POST', cookie, body: b });
  const err = async (b: unknown) => { const r = await post(b); assert.equal(r.status, 400); return (await j(r)).error; };

  assert.equal((await err({ ...base, name: '' })).field, 'name');
  assert.equal((await err({ ...base, name: 'x'.repeat(61) })).field, 'name');
  assert.equal((await err({ ...base, matcher: { mode: 'regex', pattern: '(?=a)' } })).field, 'matcher.pattern');
  assert.equal((await err({ ...base, matcher: { mode: 'nope', pattern: 'a' } })).field, 'matcher.mode');
  assert.equal((await err({ ...base, matcher: { mode: 'contains', pattern: 'a'.repeat(201) } })).field, 'matcher.pattern');
  assert.equal((await err({ ...base, cooldownSec: 29 })).field, 'cooldownSec');
  assert.equal((await err({ ...base, burst: { threshold: 0, windowSec: 60 } })).field, 'burst.threshold');
  assert.equal((await err({ ...base, burst: { threshold: 101, windowSec: 60 } })).field, 'burst.threshold');
  assert.equal((await err({ ...base, burst: { threshold: 2, windowSec: 4 } })).field, 'burst.windowSec');
  assert.equal((await err({ ...base, burst: { threshold: 2, windowSec: 3601 } })).field, 'burst.windowSec');
  assert.equal((await err({ ...base, channelIds: ['ch-other'] })).field, 'channelIds');
  assert.equal((await err({ ...base, targetIds: ['nope'] })).field, 'targetIds');

  const created = await post(base);
  assert.equal(created.status, 201);
  const rule = (await j(created)).rule;
  assert.equal(rule.updatedAt, 1_000_000);
  assert.equal(rule.burst.countBy, 'users');
  a.advance(5000);
  const put = await a.req(`/rules/${rule.id}`, { method: 'PUT', cookie: alice, body: { ...base, name: 'renamed' } });
  assert.equal((await j(put)).rule.updatedAt, 1_005_000);
  // other user cannot touch it
  assert.equal((await a.req(`/rules/${rule.id}`, { method: 'PUT', cookie: admin, body: base })).status, 404);
  assert.equal((await a.req(`/rules/${rule.id}`, { method: 'DELETE', cookie: admin })).status, 404);

  assert.equal((await post(base)).status, 201);
  const lim = await post(base);
  assert.equal(lim.status, 409);
  assert.equal((await j(lim)).error.code, 'limit_rules');
  assert.equal((await a.req(`/rules/${rule.id}`, { method: 'DELETE', cookie: alice })).status, 200);

  const v = await j(await a.req('/rules/validate-regex', { method: 'POST', cookie: alice, body: { pattern: '(?=a)' } }));
  assert.equal(v.ok, false);
  assert.equal((await j(await a.req('/rules/validate-regex', { method: 'POST', cookie: alice, body: { pattern: 'a+' } }))).ok, true);
});

test('concurrent rule creation keeps the per-user limit atomic', async () => {
  const a = setup({ MAX_RULES_PER_USER: 1 });
  const { alice } = await member(a);
  const body = { name: 'r', matcher: { mode: 'contains', pattern: 'x' } };
  const results = await Promise.all([
    a.req('/rules', { method: 'POST', cookie: alice, body }),
    a.req('/rules', { method: 'POST', cookie: alice, body }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal(a.repo.countRules('2'), 1);
});

test('disabling a rule applies configuration immediately', async () => {
  const a = setup();
  const { alice } = await member(a);
  const create = await a.req('/rules', { method: 'POST', cookie: alice, body: { name: 'r', matcher: { mode: 'contains', pattern: 'x' } } });
  const rule = (await j(create)).rule;
  const update = await a.req(`/rules/${rule.id}`, { method: 'PUT', cookie: alice, body: { ...rule, enabled: false } });
  assert.equal(update.status, 200);
  assert.equal(a.immediateChanges, 1);
});

test('preview: only own channels', async () => {
  const a = setup();
  const { admin, alice } = await member(a);
  await a.req('/channels', { method: 'POST', cookie: alice, body: { login: 'marbles_one' } });
  const ok = await j(await a.req('/preview?channel=marbles_one', { cookie: alice }));
  assert.equal(ok.messages[0].text, '!play');
  assert.deepEqual(Object.keys(ok.messages[0]).sort(), ['badges', 'displayName', 'login', 'sentAt', 'text', 'userId']);
  assert.equal((await a.req('/preview?channel=marbles_one', { cookie: admin })).status, 404);
  assert.equal((await a.req('/preview?channel=other_chan', { cookie: alice })).status, 404);
});

test('targets: ntfy gets generated mn- topic, tokens never returned, url check, test, delete', async () => {
  const a = setup();
  const { alice, admin } = await member(a);
  const create = await a.req('/targets', { method: 'POST', cookie: alice, body: { kind: 'ntfy', name: 'phone' } });
  assert.equal(create.status, 201);
  const t = (await j(create)).target;
  assert.match(t.url, /^https:\/\/ntfy\.example\/mn-[a-z2-7]{24}$/);
  assert.equal(a.repo.getTarget(t.id)!.token, null);
  assert.ok(!('token' in t));

  a.repo.saveTarget({ id: t.id, ownerId: '2', kind: 'ntfy', name: 'phone', url: t.url, token: 'SECRET' });
  assert.ok(!JSON.stringify(await j(await a.req('/targets', { cookie: alice }))).includes('SECRET'));

  const hook = 'https://discord.com/api/webhooks/123/SECRETPART';
  const d = await a.req('/targets', { method: 'POST', cookie: alice, body: { kind: 'discord', name: 'dc', url: hook } });
  assert.equal(d.status, 201);
  assert.ok(!JSON.stringify(await j(await a.req('/targets', { cookie: alice }))).includes('SECRETPART'));
  const badUrl = await a.req('/targets', { method: 'POST', cookie: alice, body: { kind: 'discord', name: 'dc', url: 'http://x' } });
  assert.equal(badUrl.status, 400);
  assert.equal((await a.req('/targets', { method: 'POST', cookie: alice, body: { kind: 'discord', name: 'dc' } })).status, 400);

  assert.equal((await j(await a.req(`/targets/${t.id}/test`, { method: 'POST', cookie: alice, body: {} }))).ok, true);
  assert.equal(a.tests[0].id, t.id);
  assert.equal((await a.req(`/targets/${t.id}/test`, { method: 'POST', cookie: admin, body: {} })).status, 404);

  const before = a.changes;
  assert.equal((await a.req(`/targets/${t.id}`, { method: 'DELETE', cookie: alice })).status, 200);
  assert.equal(a.changes, before + 1);
});

test('concurrent target creation keeps the per-user limit atomic after URL validation', async () => {
  let validations = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const a = setup({}, {}, { checkTargetUrl: async () => { validations++; if (validations === 2) release(); await gate; return null; } });
  const { alice } = await member(a);
  for (let i = 0; i < 9; i++) a.repo.saveTarget({ id: `old-${i}`, ownerId: '2', kind: 'ntfy', name: `old-${i}`, url: `https://ntfy.example/${i}`, token: null });
  const body = { kind: 'ntfy', name: 'phone', url: 'https://ntfy.example/custom' };
  const results = await Promise.all([
    a.req('/targets', { method: 'POST', cookie: alice, body }),
    a.req('/targets', { method: 'POST', cookie: alice, body }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal(a.repo.countTargets('2'), 10);
});

test('overview: rules with cooldown info and last pings; me counts', async () => {
  const a = setup();
  const { alice } = await member(a);
  const ch = (await j(await a.req('/channels', { method: 'POST', cookie: alice, body: { login: 'marbles_one' } }))).channel;
  const rule = (await j(await a.req('/rules', { method: 'POST', cookie: alice, body: { name: 'r', matcher: { mode: 'contains', pattern: 'x' }, cooldownSec: 60, channelIds: [ch.id] } }))).rule;
  a.repo.setLastFired(rule.id, ch.id, 1_000_000);
  a.repo.recordHit({ ruleId: rule.id, channelId: ch.id, count: 3, firedAt: 1_000_000, sentTs: 999_000 });
  const o = await j(await a.req('/overview', { cookie: alice }));
  assert.equal(o.rules[0].cooldownUntil, 1_060_000);
  assert.equal(o.rules[0].lastFired[0].channel, 'marbles_one');
  assert.equal(o.lastPings.length, 1);
  a.advance(61_000);
  assert.equal((await j(await a.req('/overview', { cookie: alice }))).rules[0].cooldownUntil, null);
  const me = await j(await a.req('/me', { cookie: alice }));
  assert.deepEqual(me.onboarding, { hasChannel: true, hasTarget: false, hasRule: true });
  assert.equal(me.limits.MAX_RULES_PER_USER, 20);
});

test('admin: lock semantics, unlock, authorization, onConfigChanged', async () => {
  const a = setup();
  const { admin, alice } = await member(a);
  // alice invites bob, adds channel, rule and an open invite
  const bob = await a.join('bob', alice);
  assert.equal(bob.location, '/onboarding');
  const ch = (await j(await a.req('/channels', { method: 'POST', cookie: alice, body: { login: 'marbles_one' } }))).channel;
  await a.req('/rules', { method: 'POST', cookie: alice, body: { name: 'r', matcher: { mode: 'contains', pattern: 'x' }, channelIds: [ch.id] } });
  const open = await a.mkInvite(alice);

  assert.equal((await a.req('/admin/users', { cookie: alice })).status, 403);
  assert.equal((await a.req('/admin/users/2/lock', { method: 'POST', cookie: alice })).status, 403);
  assert.equal((await j(await a.req('/admin/users', { cookie: admin }))).users.length, 3);

  const before = a.changes;
  assert.equal((await a.req('/admin/users/2/lock', { method: 'POST', cookie: admin })).status, 200);
  assert.equal(a.changes, before + 1);
  assert.equal((await a.req('/me', { cookie: alice })).status, 401); // sessions gone
  assert.deepEqual(a.repo.desiredChannelLogins(), []);
  assert.equal(a.repo.listEnabledRules().length, 0);
  assert.equal((await a.login('carol', open.code)).location, '/login?error=invite_invalid'); // open invite revoked
  assert.ok(a.repo.getUser('3'), 'invitee stays');
  assert.equal((await a.req('/me', { cookie: bob.cookie })).status, 200);
  assert.equal(a.repo.listRules('2').length, 1, 'rules not deleted');

  assert.equal((await a.req('/admin/users/1/lock', { method: 'POST', cookie: admin })).status, 400);
  assert.equal((await a.req('/admin/users/999/lock', { method: 'POST', cookie: admin })).status, 404);
  assert.equal((await a.req('/admin/users/2/unlock', { method: 'POST', cookie: admin })).status, 200);
  assert.equal((await a.login('alice')).location, '/');
});

test('unlock preserves the global desired-channel capacity', async () => {
  const a = setup({ MAX_CHANNELS_TOTAL: 2 });
  const { admin, alice } = await member(a);
  const add = (cookie: string, login: string) => a.req('/channels', { method: 'POST', cookie, body: { login } });
  await add(alice, 'marbles_one');
  await a.req('/admin/users/2/lock', { method: 'POST', cookie: admin });
  await add(admin, 'marbles_two');
  await add(admin, 'marbles_three');

  const unlock = await a.req('/admin/users/2/unlock', { method: 'POST', cookie: admin });
  assert.equal(unlock.status, 409);
  assert.equal((await j(unlock)).error.code, 'limit_total_channels');
  assert.deepEqual(a.repo.desiredChannelLogins(), ['marbles_three', 'marbles_two']);
  assert.equal(a.repo.getUser('2')!.locked, true);
});

test('logout deletes the session', async () => {
  const a = setup();
  const { cookie } = await a.login('admin');
  assert.equal((await a.req('/auth/logout', { method: 'POST', cookie })).status, 200);
  assert.equal((await a.req('/me', { cookie })).status, 401);
});
