import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDeliverer } from './deliverer.ts';
import type { DeliveryResult } from './deliverer.ts';
import { hit } from './fixtures.ts';
import type { Target } from '../types.ts';

const target = (o: Partial<Target> = {}): Target => ({ id: 't1', ownerId: 'u', kind: 'ntfy', name: 'n', url: 'https://ntfy.example.org/mn-x', token: null, failCount: 0, status: 'ok', ...o });

function setup(statuses: (number | Error)[] = []) {
  let t = 0;
  const timers: { fn: () => void; at: number; id: number }[] = [];
  let nid = 0;
  const posts: { url: string; headers: Record<string, string>; body: string }[] = [];
  const results: DeliveryResult[] = [];
  const d = createDeliverer({
    now: () => t,
    setTimer: (fn, ms) => { const x = { fn, at: t + ms, id: ++nid }; timers.push(x); return x.id; },
    clearTimer: (h) => { const i = timers.findIndex((x) => x.id === h); if (i >= 0) timers.splice(i, 1); },
    post: async (url, init) => {
      posts.push({ url, headers: init.headers, body: init.body });
      const s = statuses.shift() ?? 200;
      if (s instanceof Error) throw s;
      return { status: s, body: '' };
    },
    onResult: (r) => results.push(r),
  });
  const advance = (ms: number) => {
    t += ms;
    for (const x of timers.filter((x) => x.at <= t).sort((a, b) => a.at - b.at)) { timers.splice(timers.indexOf(x), 1); x.fn(); }
  };
  return { d, posts, results, advance };
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
