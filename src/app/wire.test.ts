import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../db/db.ts';
import { createRepo } from '../db/repo.ts';
import { loadConfig } from '../api/config.ts';
import { createTwitch } from '../api/twitch.ts';
import type { TwitchUser } from '../api/twitch.ts';
import { hashSessionId } from '../api/session.ts';
import { msg, rule } from '../rules/fixtures.ts';
import { createService } from './wire.ts';
import type { Timers } from './wire.ts';

function setup(env: Record<string, string> = {}, users: { id: string; login: string }[] = [], extra: Record<string, unknown> = {}, status = 200) {
  const config = loadConfig({
    NODE_ENV: 'test', READER: 'fake', PUBLIC_URL: 'https://m.example', SESSION_SECRET: 'x'.repeat(32), DATA_DIR: mkdtempSync(join(tmpdir(), 'wire-')),
    NTFY_BASE_URL: 'https://ntfy.example', NTFY_APP_TOKEN: 'tk_app', ADMIN_NTFY_URL: 'https://ntfy.example/admin', ...env,
  });
  const db = openDb(':memory:');
  const repo = createRepo(db);
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms: number) => { t += ms; } };
  const posts: { url: string; headers: Record<string, string>; body: string }[] = [];
  const logs: string[] = [];
  const loginBatchSizes: number[] = [];
  const post = async (url: string, init: any) => { posts.push({ url, headers: init.headers, body: init.body }); return { status, body: '' }; };
  const timers: Timers & { fns: (() => void)[] } = { fns: [], set(fn) { this.fns.push(fn); return fn; }, clear(h) { this.fns = this.fns.filter((f) => f !== h); }, every: () => null };
  const fetch = (async (input: any) => {
    const url = new URL(String(input));
    const j = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
    if (url.pathname === '/oauth2/token') return j({ access_token: 'a', expires_in: 3600 });
    const logins = url.searchParams.getAll('login');
    const ids = url.searchParams.getAll('id');
    if (logins.length) loginBatchSizes.push(logins.length);
    return j({ data: users.filter((u) => logins.length ? logins.includes(u.login) : ids.length ? ids.includes(u.id) : true).map((u) => ({ id: u.id, login: u.login, display_name: u.login, profile_image_url: `https://img.example/${u.login}.png` })) });
  }) as typeof globalThis.fetch;
  const twitch = createTwitch({ clientId: 'c', clientSecret: 's', authBase: 'https://auth.test', helixBase: 'https://helix.test', fetch });
  const svc = createService({ config, db, repo, twitch, now: clock.now, timers, post: post as never, alertPost: post as never, r2: { enabled: false, uploadAndPrune: async () => {} }, log: (line) => logs.push(line), ...extra });
  repo.createUser({ id: 'o1', login: 'owner', displayName: 'Owner', isAdmin: false, invitedBy: null, now: 1 });
  return { svc, repo, clock, posts, timers, config, twitch, logs, loginBatchSizes };
}

function seed(s: ReturnType<typeof setup>, targetUrl = 'https://ntfy.example/topic') {
  s.repo.upsertChannel({ id: 'c1', login: 'sbx_tv', displayName: 'SBX TV', avatarUrl: 'https://img.example/sbx_tv.png' }, 1);
  s.repo.addUserChannel('o1', 'c1');
  s.repo.saveTarget({ id: 't1', ownerId: 'o1', kind: 'ntfy', name: 'phone', url: targetUrl, token: null });
  s.repo.saveRule(rule({ burst: { threshold: 1, windowSec: 60, countBy: 'users' }, targetIds: ['t1'] }), 1);
}

test('hit is recorded, delivered with injected ntfy token, result stored', async () => {
  const s = setup();
  seed(s);
  s.svc.onConfigChanged();
  s.timers.fns.shift()!(); // debounce fires
  s.svc.fakeReader!.push(msg('!play now'));
  await s.svc.deliverer.flushAll();
  assert.equal(s.posts.length, 1);
  assert.equal(s.posts[0].headers.Authorization, 'Bearer tk_app');
  const ping = s.repo.lastPings('o1')[0];
  assert.equal(ping.ruleId, 'r1');
  assert.deepEqual(ping.results.map((r) => [r.targetId, r.ok]), [['t1', true]]);
});

test('engine hits use stored channel display name and avatar in Discord embeds', async () => {
  const s = setup();
  s.repo.upsertChannel({ id: 'c1', login: 'sbx_tv', displayName: 'SBX TV', avatarUrl: 'https://img.example/sbx_tv.png' }, 1);
  s.repo.addUserChannel('o1', 'c1');
  s.repo.saveTarget({ id: 'discord', ownerId: 'o1', kind: 'discord', name: 'Discord', url: 'https://discord.com/api/webhooks/1/token', token: null });
  s.repo.saveRule(rule({ burst: { threshold: 1, windowSec: 60, countBy: 'users' }, targetIds: ['discord'] }), 1);
  s.svc.onConfigChanged();
  s.timers.fns.shift()!();
  s.svc.fakeReader!.push(msg('!play now'));
  await s.svc.deliverer.flushAll();
  const payload = JSON.parse(s.posts[0]!.body);
  assert.equal(payload.embeds[0].author.name, 'SBX TV');
  assert.equal(payload.embeds[0].author.icon_url, 'https://img.example/sbx_tv.png');
});

test('foreign ntfy URL does not get the app token; foreign-owned target is skipped', async () => {
  const s = setup();
  seed(s, 'https://other.example/topic');
  s.repo.createUser({ id: 'o2', login: 'o2', displayName: 'o2', isAdmin: false, invitedBy: null, now: 1 });
  s.repo.saveTarget({ id: 't2', ownerId: 'o2', kind: 'ntfy', name: 'x', url: 'https://ntfy.example/x', token: null });
  s.repo.saveRule(rule({ burst: { threshold: 1, windowSec: 60, countBy: 'users' }, targetIds: ['t1', 't2'] }), 2);
  s.svc.onConfigChanged();
  s.timers.fns.shift()!();
  s.svc.fakeReader!.push(msg('!play'));
  await s.svc.deliverer.flushAll();
  assert.equal(s.posts.length, 1);
  assert.equal(s.posts[0].headers.Authorization, undefined);
});

test('onConfigChanged is debounced and updates reader channels and engine rules', () => {
  const s = setup();
  seed(s);
  s.svc.onConfigChanged();
  s.svc.onConfigChanged();
  assert.equal(s.timers.fns.length, 1);
  assert.equal(s.svc.reader.health().desired, 0);
  s.timers.fns.shift()!();
  assert.equal(s.svc.reader.health().desired, 1);
  s.svc.fakeReader!.push(msg('!play'));
  assert.equal(s.svc.engine.stats().messages, 1);
});

test('a lock immediately removes cached rules and desired channels', async () => {
  const s = setup();
  seed(s);
  s.repo.createUser({ id: 'admin', login: 'admin', displayName: 'Admin', isAdmin: true, invitedBy: null, now: 1 });
  s.repo.insertSession(hashSessionId('admin-session'), 'admin', s.clock.now(), s.clock.now() + 60_000, []);
  s.svc.onConfigChanged();
  assert.equal(s.timers.fns.length, 1);

  const response = await s.svc.api.request('/api/admin/users/o1/lock', {
    method: 'POST', headers: { Origin: s.config.publicUrl, Cookie: 'mn_session=admin-session' },
  });
  assert.equal(response.status, 200);
  assert.equal(s.timers.fns.length, 0);
  assert.equal(s.svc.reader.health().desired, 0);
  s.svc.fakeReader!.push(msg('!play'));
  await s.svc.deliverer.flushAll();
  assert.equal(s.repo.lastPings('o1').length, 0);
  assert.equal(s.posts.length, 0);
});

test('onHit rechecks a locked owner before recording or dispatching cached hits', async () => {
  const s = setup();
  seed(s);
  s.svc.onConfigChanged();
  s.timers.fns.shift()!();
  s.repo.lockUser('o1'); // simulate a stale cached engine rule during the config propagation boundary
  s.svc.fakeReader!.push(msg('!play'));
  await s.svc.deliverer.flushAll();
  assert.equal(s.repo.lastPings('o1').length, 0);
  assert.equal(s.posts.length, 0);
});

test('dead-man: disconnect alarms once, Entwarnung once', async () => {
  const s = setup();
  seed(s);
  s.svc.onConfigChanged(); s.timers.fns.shift()!();
  s.svc.fakeReader!.setConnected(false);
  await s.svc.checkDeadMan();
  assert.equal(s.posts.length, 0);
  s.clock.advance(2 * 60_000 + 1);
  await s.svc.checkDeadMan(); await s.svc.checkDeadMan();
  assert.equal(s.posts.length, 1);
  assert.match(s.posts[0].body, /getrennt/);
  s.svc.fakeReader!.setConnected(true);
  await s.svc.checkDeadMan(); await s.svc.checkDeadMan();
  assert.equal(s.posts.length, 2);
  assert.match(s.posts[1].headers.Title ?? s.posts[1].body, /Entwarnung/);
});

test('dead-man: silence alarms once with channels, never without', async () => {
  const s = setup();
  s.clock.advance(11 * 60_000);
  await s.svc.checkDeadMan();
  assert.equal(s.posts.length, 0);
  seed(s);
  s.svc.onConfigChanged(); s.timers.fns.shift()!();
  s.clock.advance(11 * 60_000);
  await s.svc.checkDeadMan(); await s.svc.checkDeadMan();
  assert.equal(s.posts.length, 1);
  s.svc.fakeReader!.push(msg('hi', { receivedAt: s.clock.now() }));
  await s.svc.checkDeadMan(); await s.svc.checkDeadMan();
  assert.equal(s.posts.length, 2);
});

test('daily job re-resolves a renamed channel login and re-applies config', async () => {
  const s = setup({}, [{ id: 'c1', login: 'sbx_new' }]);
  seed(s);
  await s.svc.runDaily();
  assert.equal(s.repo.getChannel('c1')!.login, 'sbx_new');
  assert.equal(s.timers.fns.length, 1);
});

test('startup refreshes all channel avatars in Helix batches of 100', async () => {
  const users = Array.from({ length: 101 }, (_, i) => ({ id: `c${i}`, login: `channel_${i}` }));
  const s = setup({}, users);
  for (const user of users) s.repo.upsertChannel({ ...user, displayName: user.login }, 1);
  s.repo.updateChannelAvatar('c0', 'https://img.example/stale.png');
  await s.svc.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(s.loginBatchSizes, [100, 1]);
  assert.equal(s.repo.getChannel('c0')!.avatarUrl, 'https://img.example/channel_0.png');
  assert.equal(s.repo.getChannel('c100')!.avatarUrl, 'https://img.example/channel_100.png');
});

test('startup does not wait for avatar lookup and logs a best-effort failure', async () => {
  const s = setup();
  s.repo.upsertChannel({ id: 'c1', login: 'sbx_tv', displayName: 'SBX TV' }, 1);
  let rejectLookup!: (error: Error) => void;
  const pending = new Promise<TwitchUser[]>((_resolve, reject) => { rejectLookup = reject; });
  s.twitch.getUsersByLogin = () => pending;
  const outcome = await Promise.race([
    s.svc.start().then(() => 'started'),
    new Promise<string>((resolve) => setTimeout(() => resolve('blocked'), 50)),
  ]);
  assert.equal(outcome, 'started');
  rejectLookup(new Error('Twitch unavailable'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(s.logs.join('\n'), /channel avatar refresh failed/);
});

test('token only for same-origin ntfy URLs, not prefix-lookalike hosts', async () => {
  const s = setup();
  seed(s, 'https://ntfy.example.attacker.net/x');
  s.repo.saveTarget({ id: 't2', ownerId: 'o1', kind: 'ntfy', name: 'own', url: 'https://ntfy.example/t', token: null });
  s.repo.saveRule(rule({ burst: { threshold: 1, windowSec: 60, countBy: 'users' }, targetIds: ['t1', 't2'] }), 2);
  s.svc.onConfigChanged();
  s.timers.fns.shift()!();
  s.svc.fakeReader!.push(msg('!play'));
  await s.svc.deliverer.flushAll();
  const by = Object.fromEntries(s.posts.map((p) => [new URL(p.url).host, p.headers.Authorization]));
  assert.equal(by['ntfy.example.attacker.net'], undefined);
  assert.equal(by['ntfy.example'], 'Bearer tk_app');
  await s.svc.deliverer.sendTest({ id: 't3', ownerId: 'o1', kind: 'ntfy', name: 'x', url: 'https://ntfy.example.attacker.net/x', token: null, failCount: 0, status: 'ok' });
  assert.equal(s.posts.at(-1)!.headers.Authorization, undefined);
});

test('stored hit keeps tmi-sent-ts', async () => {
  const s = setup();
  seed(s);
  s.svc.onConfigChanged();
  s.timers.fns.shift()!();
  s.svc.fakeReader!.push(msg('!play', { sentAt: 4242 }));
  await s.svc.deliverer.flushAll();
  assert.equal(s.repo.lastPings('o1')[0].sentTs, 4242);
});

test('failed batch of several hits counts as one failure', async () => {
  const s = setup({}, [], {}, 500);
  seed(s);
  for (const id of ['c2', 'c3']) { s.repo.upsertChannel({ id, login: id, displayName: id }, 1); s.repo.addUserChannel('o1', id); }
  s.repo.saveRule(rule({ burst: { threshold: 1, windowSec: 60, countBy: 'users' }, channelIds: ['c1', 'c2', 'c3'], targetIds: ['t1'] }), 2);
  s.svc.onConfigChanged();
  s.timers.fns.shift()!();
  for (const c of ['c1', 'c2', 'c3']) s.svc.fakeReader!.push(msg('!play', { channelId: c, channel: c }));
  await s.svc.deliverer.flushAll(); // hit 1 alone, hits 2+3 as one batch
  assert.deepEqual([s.repo.getTarget('t1')!.failCount, s.repo.getTarget('t1')!.status], [2, 'ok']);
});

test('Retry-After beyond five minutes is recorded as a failed delivery', async () => {
  let attempts = 0;
  const s = setup({}, [], { post: async () => {
    attempts++;
    return { status: 429, body: '', retryAfter: '600' };
  } });
  seed(s);
  s.svc.onConfigChanged();
  s.timers.fns.shift()!();
  s.svc.fakeReader!.push(msg('!play'));
  await s.svc.deliverer.flushAll();

  assert.equal(attempts, 1);
  assert.deepEqual(s.repo.lastPings('o1')[0]!.results.map((r) => [r.targetId, r.ok]), [['t1', false]]);
  assert.equal(s.repo.getTarget('t1')!.failCount, 1);
});

test('message handler swallows engine errors', () => {
  let onMessage!: (m: never) => void;
  const logs: string[] = [];
  setup({}, [], { log: (l: string) => logs.push(l), readerFactory: (o: { onMessage: (m: never) => void }) => { onMessage = o.onMessage; return { setChannels: async () => {}, start: async () => {}, stop: async () => {}, health: () => ({}) }; } });
  assert.doesNotThrow(() => onMessage(null as never));
  assert.match(logs.join(), /ingest failed/);
});
