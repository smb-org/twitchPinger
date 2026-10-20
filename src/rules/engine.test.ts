import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from './engine.ts';
import { msg, rule } from './fixtures.ts';
import type { Hit } from '../types.ts';

function setup(last: number | null = null) {
  const hits: Hit[] = [];
  const stored: number[] = [];
  let t = 1_000_000;
  const e = createEngine({
    now: () => t,
    onHit: (h) => hits.push(h),
    getLastFired: () => last,
    setLastFired: (_r, _c, ts) => stored.push(ts),
  });
  return { e, hits, stored, tick: (ms: number) => (t += ms) };
}
const one = { threshold: 1, windowSec: 60, countBy: 'users' as const };

test('fires once, persists last-fired, builds hit', () => {
  const { e, hits, stored } = setup();
  e.setRules([rule({ burst: one })]);
  const m = msg('!play x');
  e.ingest(m);
  e.ingest(msg('!play y', { userId: 'u2' }));
  assert.equal(hits.length, 1);
  assert.deepEqual(stored, [1_000_000]);
  assert.deepEqual(hits[0], { ruleId: 'r1', ruleName: 'Play', ownerId: 'o1', channelId: 'c1', channel: 'sbx_tv', count: 1, sample: m, firedAt: 1_000_000 });
  assert.equal(e.stats().messages, 2);
});

test('persisted cooldown seeds state', () => {
  const { e, hits, tick } = setup(1_000_000 - 10_000);
  e.setRules([rule({ burst: one })]);
  e.ingest(msg('!play'));
  assert.equal(hits.length, 0);
  tick(300_000);
  e.ingest(msg('!play'));
  assert.equal(hits.length, 1);
});

test('rule edit resets window and cooldown; unchanged keeps state', () => {
  const { e, hits } = setup();
  const r = rule({ burst: one });
  e.setRules([r]);
  e.ingest(msg('!play'));
  e.setRules([{ ...r }]);
  e.ingest(msg('!play'));
  assert.equal(hits.length, 1); // still cooling down
  e.setRules([{ ...r, updatedAt: 2 }]);
  e.ingest(msg('!play'));
  assert.equal(hits.length, 2);
  assert.equal(e.live('r1')[0]?.tally?.mentions, 1);
  e.setRules([{ ...r, updatedAt: 3 }]);
  assert.deepEqual(e.live('r1'), []); // edited rule dropped burst and tally state
  e.ingest(msg('!play'));
  assert.equal(hits.length, 3);
  e.setRules([]);
  e.setRules([{ ...r, updatedAt: 3 }]);
  e.ingest(msg('!play')); // dropped state, re-added
  assert.equal(hits.length, 4);
});

test('disabled rule and other channels are ignored', () => {
  const { e, hits } = setup();
  e.setRules([rule({ burst: one, enabled: false }), rule({ id: 'r2', burst: one })]);
  e.ingest(msg('!play', { channelId: 'other' }));
  assert.equal(hits.length, 0);
  e.ingest(msg('!play'));
  assert.deepEqual(hits.map((h) => h.ruleId), ['r2']);
});

test('rule with uncompilable matcher is skipped and logged, others still fire', () => {
  const logs: string[] = [];
  const hits: Hit[] = [];
  const e = createEngine({ now: () => 1_000_000, onHit: (h) => hits.push(h), getLastFired: () => null, setLastFired: () => {}, log: (l) => logs.push(l) });
  assert.doesNotThrow(() => e.setRules([
    rule({ id: 'bad', matcher: { mode: 'regex', pattern: '(', caseSensitive: false }, burst: one }),
    rule({ id: 'good', burst: one }),
  ]));
  e.ingest(msg('!play'));
  assert.deepEqual(hits.map((h) => h.ruleId), ['good']);
  assert.match(logs.join(), /bad/);
});

test('cooldown and burst window are per channel', () => {
  const { e, hits, tick } = setup();
  e.setRules([rule({ channelIds: ['c1', 'c2'] })]);
  for (let i = 0; i < 10; i++) e.ingest(msg('!play', { userId: `u${i}` }));
  assert.equal(hits.length, 1);
  tick(30_000);
  for (let i = 0; i < 10; i++) e.ingest(msg('!play', { channelId: 'c2', channel: 'other', userId: `u${i}` }));
  assert.deepEqual(hits.map((h) => h.channelId), ['c1', 'c2']);
});

test('live tally counts firing-window mentions and later mentions through cooldown, then resets on fire', () => {
  const { e, hits, tick } = setup();
  e.setRules([rule({ burst: { threshold: 2, windowSec: 60, countBy: 'users' }, cooldownSec: 60 })]);
  e.ingest(msg('!play', { userId: 'u1' }));
  e.ingest(msg('!play again', { userId: 'u1' }));
  e.ingest(msg('!play', { userId: 'u2' }));
  assert.equal(hits.length, 1);
  assert.deepEqual(e.live('r1'), [{ channelId: 'c1', inWindow: 0, cooling: true, tally: { since: 1_000_000, mentions: 3, chatters: 2 } }]);

  e.ingest(msg('!play', { userId: 'u2' }));
  e.ingest(msg('!play', { userId: 'u3' }));
  assert.deepEqual(e.live('r1')[0]?.tally, { since: 1_000_000, mentions: 5, chatters: 3 });

  tick(300_000);
  e.ingest(msg('!play', { userId: 'u4' }));
  e.ingest(msg('!play', { userId: 'u5' }));
  assert.equal(hits.length, 2);
  assert.deepEqual(e.live('r1'), [{ channelId: 'c1', inWindow: 0, cooling: true, tally: { since: 1_300_000, mentions: 2, chatters: 2 } }]);
});

test('live reports partial burst progress without changing firing behavior', () => {
  const { e, hits } = setup();
  e.setRules([rule({ burst: { threshold: 3, windowSec: 60, countBy: 'users' }, cooldownSec: 60 })]);
  e.ingest(msg('!play', { userId: 'u1' }));
  assert.deepEqual(e.live('r1'), [{ channelId: 'c1', inWindow: 1, cooling: false, tally: null }]);
  e.live('r1');
  e.ingest(msg('!play', { userId: 'u1' }));
  assert.equal(e.live('r1')[0]?.inWindow, 1);
  e.ingest(msg('!play', { userId: 'u2' }));
  assert.equal(e.live('r1')[0]?.inWindow, 2);
  assert.equal(hits.length, 0);
  e.live('r1');
  e.ingest(msg('!play', { userId: 'u3' }));
  assert.equal(hits.length, 1);
  assert.deepEqual(e.live('r1')[0], { channelId: 'c1', inWindow: 0, cooling: true, tally: { since: 1_000_000, mentions: 4, chatters: 3 } });
});

test('live progress counts messages when countBy is messages', () => {
  const { e, hits } = setup();
  e.setRules([rule({ burst: { threshold: 3, windowSec: 60, countBy: 'messages' } })]);
  e.ingest(msg('!play', { userId: 'u1' }));
  e.ingest(msg('!play', { userId: 'u1' }));
  assert.equal(e.live('r1')[0]?.inWindow, 2);
  e.ingest(msg('!play', { userId: 'u2' }));
  assert.equal(hits.length, 1);
  assert.equal(e.live('r1')[0]?.tally?.mentions, 3);
});
