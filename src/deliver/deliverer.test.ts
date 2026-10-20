import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDeliverer } from './deliverer.ts';
import type { DeliveryResult } from './deliverer.ts';
import { hit } from './fixtures.ts';
import type { Target } from '../types.ts';

const target = (o: Partial<Target> = {}): Target => ({ id: 't1', ownerId: 'u', kind: 'ntfy', name: 'n', url: 'https://ntfy.example.org/mn-x', token: null, failCount: 0, status: 'ok', ...o });

function setup(statuses: (number | Error | { status: number; retryAfter?: string })[] = [], options: { getTarget?: (id: string) => Target | undefined; sleep?: (ms: number) => Promise<void>; discordLink?: { discordUserId: string; channelId: string | null } | undefined; discordStatuses?: { status: number; body?: string; retryAfter?: string }[]; discordAvailable?: boolean } = {}) {
  let t = 0;
  const timers: { fn: () => void; at: number; id: number }[] = [];
  let nid = 0;
  const posts: { url: string; headers: Record<string, string>; body: string }[] = [];
  const discordPosts: { url: string; headers: Record<string, string>; body: string }[] = [];
  const cachedChannels: { userId: string; channelId: string }[] = [];
  const results: DeliveryResult[] = [];
  const waits: number[] = [];
  const d = createDeliverer({
    now: () => t,
    setTimer: (fn, ms) => { const x = { fn, at: t + ms, id: ++nid }; timers.push(x); return x.id; },
    clearTimer: (h) => { const i = timers.findIndex((x) => x.id === h); if (i >= 0) timers.splice(i, 1); },
    sleep: async (ms) => { waits.push(ms); await options.sleep?.(ms); },
    getTarget: options.getTarget,
    discordBotToken: 'bot-secret',
    discordAvailable: options.discordAvailable,
    getDiscordLink: () => options.discordLink,
    cacheDiscordChannel: (userId, channelId) => { cachedChannels.push({ userId, channelId }); if (options.discordLink) options.discordLink.channelId = channelId; },
    discordPost: async (url, init) => {
      discordPosts.push({ url, headers: init.headers, body: init.body });
      const r = options.discordStatuses?.shift() ?? { status: 200, body: url.endsWith('/users/@me/channels') ? '{"id":"dm-1"}' : '{}' };
      return { status: r.status, body: r.body ?? '', ...(r.retryAfter ? { retryAfter: r.retryAfter } : {}) };
    },
    post: async (url, init) => {
      posts.push({ url, headers: init.headers, body: init.body });
      const s = statuses.shift() ?? 200;
      if (s instanceof Error) throw s;
      return typeof s === 'number' ? { status: s, body: '' } : { status: s.status, body: '', ...(s.retryAfter ? { retryAfter: s.retryAfter } : {}) };
    },
    onResult: (r) => results.push(r),
  });
  const advance = (ms: number) => {
    t += ms;
    for (const x of timers.filter((x) => x.at <= t).sort((a, b) => a.at - b.at)) { timers.splice(timers.indexOf(x), 1); x.fn(); }
  };
  return { d, posts, discordPosts, cachedChannels, results, waits, advance };
}

test('window semantics', async () => {
  const { d, posts, advance } = setup();
  const settle = () => new Promise((r) => setImmediate(r));
  d.deliver(hit(), [target()]);
  await settle();
  assert.equal(posts.length, 1);
  d.deliver(hit({ ruleName: 'B' }), [target()]);
  d.deliver(hit({ ruleName: 'C' }), [target()]);
  await settle();
  assert.equal(posts.length, 1);
  advance(10_000);
  await settle();
  assert.equal(posts.length, 2);
  assert.match(posts[1]!.body, /\+1 weitere/);
  // new window open: hit is collected
  d.deliver(hit({ ruleName: 'D' }), [target()]);
  await settle();
  assert.equal(posts.length, 2);
  advance(10_000); // sends D, opens another window
  await settle();
  assert.equal(posts.length, 3);
  advance(10_000); // empty -> closes
  advance(1);
  d.deliver(hit(), [target()]);
  await settle();
  assert.equal(posts.length, 4);
});

test('retry once on 5xx and network error, not on 4xx', async () => {
  let s = setup([500, 200]);
  s.d.deliver(hit(), [target()]);
  await s.d.flushAll();
  assert.equal(s.posts.length, 2);
  assert.equal(s.results.length, 1);
  assert.equal(s.results[0]!.ok, true);

  s = setup([500, 502]);
  s.d.deliver(hit(), [target()]);
  await s.d.flushAll();
  assert.equal(s.posts.length, 2);
  assert.equal(s.results[0]!.ok, false);

  s = setup([new Error('boom'), 200]);
  s.d.deliver(hit(), [target()]);
  await s.d.flushAll();
  assert.equal(s.posts.length, 2);

  s = setup([404]);
  s.d.deliver(hit(), [target()]);
  await s.d.flushAll();
  assert.equal(s.posts.length, 1);
  assert.equal(s.results[0]!.status, 404);
});

test('retries 429 once when Retry-After is within the five-minute limit', async () => {
  let s = setup([{ status: 429, retryAfter: '7' }, 200]);
  s.d.deliver(hit(), [target()]);
  await s.d.flushAll();
  assert.deepEqual(s.waits, [7000]);
  assert.equal(s.posts.length, 2);
  assert.equal(s.results[0]!.ok, true);

  s = setup([{ status: 429, retryAfter: '600' }, 200]);
  s.d.deliver(hit(), [target()]);
  await s.d.flushAll();
  assert.deepEqual(s.waits, []);
  assert.equal(s.posts.length, 1);
  assert.equal(s.results[0]!.ok, false);
  assert.equal(s.results[0]!.status, 429);
  assert.match(s.results[0]!.error ?? '', /Retry-After.*five-minute/i);

  s = setup([{ status: 429, retryAfter: '120' }, 200]);
  s.d.deliver(hit(), [target()]);
  await s.d.flushAll();
  assert.deepEqual(s.waits, [120_000]);

  s = setup([{ status: 429, retryAfter: new Date(5000).toUTCString() }, 200]);
  s.d.deliver(hit(), [target()]);
  await s.d.flushAll();
  assert.deepEqual(s.waits, [5000]);
});

test('Discord DM does not retry early when Retry-After exceeds the five-minute limit', async () => {
  const s = setup([], { discordLink: { discordUserId: 'discord-user', channelId: 'dm-1' }, discordStatuses: [
    { status: 429, body: '{"retry_after":600,"global":false}' }, { status: 200, body: '{}' },
  ] });
  const t = target({ id: 'dm-target', ownerId: 'user-1', kind: 'discord_dm', url: '' });
  s.d.deliver(hit(), [t]);
  await s.d.flushAll();
  assert.deepEqual(s.waits, []);
  assert.equal(s.discordPosts.length, 1);
  assert.equal(s.results[0]!.ok, false);
  assert.equal(s.results[0]!.status, 429);
  assert.match(s.results[0]!.error ?? '', /Retry-After.*five-minute/i);
});

test('retry re-resolves destination and drops a deleted or rotated target', async () => {
  const t = target();
  const rotated = target({ url: 'https://ntfy.example.org/rotated' });
  let current: Target | undefined = t;
  let s = setup([{ status: 429, retryAfter: '2' }], {
    getTarget: () => current,
    sleep: async () => { current = rotated; },
  });
  s.d.deliver(hit(), [t]);
  await s.d.flushAll();
  assert.deepEqual(s.posts.map((p) => p.url), [t.url]);
  assert.equal(s.results[0]!.ok, false);

  let lookup = 0;
  s = setup([500], {
    getTarget: () => (++lookup === 1 ? t : undefined),
  });
  s.d.deliver(hit(), [t]);
  await s.d.flushAll();
  assert.deepEqual(s.posts.map((p) => p.url), [t.url]);
  assert.equal(s.results[0]!.ok, false);
});

test('queued delivery resolves the target at dispatch time and drops deleted targets', async () => {
  const t = target();
  const current = new Map([[t.id, t]]);
  const s = setup([], { getTarget: (id) => current.get(id) });
  s.d.deliver(hit(), [t]);
  await new Promise((r) => setImmediate(r));
  s.d.deliver(hit({ ruleName: 'changed' }), [t]);
  const updated = target({ url: 'https://ntfy.example.org/new-topic' });
  current.set(t.id, updated);
  s.advance(10_000);
  await s.d.flushAll();
  assert.deepEqual(s.posts.map((p) => p.url), [t.url, updated.url]);

  current.set(t.id, t);
  const second = setup([], { getTarget: (id) => current.get(id) });
  second.d.deliver(hit(), [t]);
  await new Promise((r) => setImmediate(r));
  second.d.deliver(hit({ ruleName: 'deleted' }), [updated]);
  current.delete(t.id);
  second.advance(10_000);
  await second.d.flushAll();
  assert.deepEqual(second.posts.map((p) => p.url), [t.url]);
});

test('Discord batches split before the 2000-character limit and attribute every hit', async () => {
  const s = setup();
  const t = target({ kind: 'discord', url: 'https://discord.com/api/webhooks/1/token' });
  const hits = Array.from({ length: 50 }, (_, i) => hit({ ruleName: `${String(i).padStart(2, '0')}-${'r'.repeat(50)}` }));
  for (const h of hits) s.d.deliver(h, [t]);
  s.advance(10_000);
  await s.d.flushAll();

  assert.ok(s.posts.length > 1);
  const bodies = s.posts.map((p) => JSON.parse(p.body).content as string);
  assert.ok(bodies.every((body) => body.length <= 2000));
  assert.ok(hits.every((h) => bodies.some((body) => body.includes(h.ruleName))));
  const delivered = s.results.flatMap((r) => r.hits);
  assert.equal(delivered.length, hits.length);
  assert.ok(s.results.every((r) => r.ok));
});

test('Discord DM opens and caches a user channel, then sends with no parsed mentions', async () => {
  const s = setup([], { discordLink: { discordUserId: 'discord-user', channelId: null } });
  const t = target({ id: 'dm-target', ownerId: 'user-1', kind: 'discord_dm', url: '' });
  s.d.deliver(hit(), [t]);
  await s.d.flushAll();
  assert.equal(s.discordPosts.length, 2);
  assert.equal(s.discordPosts[0]!.url, 'https://discord.com/api/v10/users/@me/channels');
  assert.deepEqual(JSON.parse(s.discordPosts[0]!.body), { recipient_id: 'discord-user' });
  assert.equal(s.discordPosts[1]!.url, 'https://discord.com/api/v10/channels/dm-1/messages');
  assert.equal(s.discordPosts[1]!.headers.Authorization, 'Bot bot-secret');
  assert.deepEqual(JSON.parse(s.discordPosts[1]!.body).allowed_mentions, { parse: [] });
  assert.deepEqual(s.cachedChannels, [{ userId: 'user-1', channelId: 'dm-1' }]);
  assert.equal(s.results[0]!.ok, true);
});

test('Discord DM maps error 50007 to the German hint and returns it for a test ping', async () => {
  const blocked = { status: 403, body: '{"code":50007,"message":"Cannot send messages to this user"}' };
  const s = setup([], { discordLink: { discordUserId: 'discord-user', channelId: 'dm-1' }, discordStatuses: [blocked] });
  const t = target({ id: 'dm-target', ownerId: 'user-1', kind: 'discord_dm', url: '' });
  const r = await s.d.sendTest(t);
  assert.deepEqual(r, { ok: false, error: 'Discord lässt den Bot dir nicht schreiben. Tritt einem Server mit dem Bot bei oder erlaube DMs.', errorCode: 50007 });

  const second = setup([], { discordLink: { discordUserId: 'discord-user', channelId: 'dm-1' }, discordStatuses: [blocked] });
  second.d.deliver(hit(), [t]);
  await second.d.flushAll();
  assert.equal(second.results[0]!.error, 'Discord lässt den Bot dir nicht schreiben. Tritt einem Server mit dem Bot bei oder erlaube DMs.');
  assert.equal(second.results[0]!.errorCode, 50007);
});

test('Discord DM retries 429 once using the response retry_after value', async () => {
  const s = setup([], { discordLink: { discordUserId: 'discord-user', channelId: 'dm-1' }, discordStatuses: [
    { status: 429, body: '{"retry_after":2.5,"global":false}' }, { status: 200, body: '{}' },
  ] });
  const t = target({ id: 'dm-target', ownerId: 'user-1', kind: 'discord_dm', url: '' });
  s.d.deliver(hit(), [t]);
  await s.d.flushAll();
  assert.deepEqual(s.waits, [2500]);
  assert.equal(s.discordPosts.length, 2);
  assert.equal(s.results[0]!.ok, true);
});

test('Discord DM batches split at 2000 characters and preserve every hit', async () => {
  const s = setup([], { discordLink: { discordUserId: 'discord-user', channelId: 'dm-1' } });
  const t = target({ id: 'dm-target', ownerId: 'user-1', kind: 'discord_dm', url: '' });
  const hits = Array.from({ length: 50 }, (_, i) => hit({ ruleName: `${String(i).padStart(2, '0')}-${'r'.repeat(50)}` }));
  for (const h of hits) s.d.deliver(h, [t]);
  s.advance(10_000);
  await s.d.flushAll();
  const contents = s.discordPosts.filter((p) => p.url.endsWith('/messages')).map((p) => JSON.parse(p.body).content as string);
  assert.ok(contents.length > 1);
  assert.ok(contents.every((content) => content.length <= 2000));
  assert.ok(hits.every((h) => contents.some((content) => content.includes(h.ruleName))));
  assert.equal(s.results.flatMap((r) => r.hits).length, hits.length);
});

test('Discord DM target without a linked account fails without making an API request', async () => {
  const s = setup([], { discordLink: undefined });
  const t = target({ kind: 'discord_dm', url: '' });
  const r = await s.d.sendTest(t);
  assert.equal(r.ok, false);
  assert.equal(s.discordPosts.length, 0);
});

test('Discord DM refuses delivery when OAuth config is incomplete even if the bot token is present', async () => {
  const s = setup([], { discordLink: { discordUserId: 'discord-user', channelId: 'dm-1' }, discordAvailable: false });
  const t = target({ kind: 'discord_dm', url: '' });
  const r = await s.d.sendTest(t);
  assert.deepEqual(r, { ok: false, error: 'Discord-Direktnachrichten sind nicht eingerichtet.' });
  assert.equal(s.discordPosts.length, 0);
});

test('invalid url fails fast; token header; test message', async () => {
  let s = setup();
  s.d.deliver(hit(), [target({ url: 'http://x.example/y' })]);
  await s.d.flushAll();
  assert.equal(s.posts.length, 0);
  assert.equal(s.results[0]!.ok, false);

  s = setup();
  s.d.deliver(hit(), [target({ token: 'tk_abc' })]);
  await s.d.flushAll();
  assert.equal(s.posts[0]!.headers.Authorization, 'Bearer tk_abc');

  s = setup();
  const r = await s.d.sendTest(target());
  assert.deepEqual(r, { ok: true });
  assert.match(s.posts[0]!.body, /Test von marbleNotification/);
});

test('throwing onResult is logged, not unhandled; flushAll still resolves', async () => {
  const logs: string[] = [];
  const d = createDeliverer({
    now: () => 0, setTimer: () => 1, clearTimer: () => {}, post: async () => ({ status: 200, body: '' }),
    onResult: () => { throw new Error('db down'); }, log: (l) => logs.push(l),
  });
  d.deliver(hit(), [target()]);
  await d.flushAll();
  assert.match(logs.join(), /db down/);
});
