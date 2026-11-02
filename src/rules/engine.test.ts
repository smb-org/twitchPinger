import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from './engine.ts';
import { msg, rule } from './fixtures.ts';
import type { Hit } from '../types.ts';

function setup(last: number | null = null) {
  const hits: Omit<Hit, 'channelDisplayName' | 'channelAvatar'>[] = [];
  const stored: number[] = [];
  const logs: string[] = [];
  let t = 1_000_000;
  const e = createEngine({
    now: () => t,
    onHit: (h) => hits.push(h),
    log: (line) => logs.push(line),
    getLastFired: () => last,
    setLastFired: (_r, _c, ts) => stored.push(ts),
  });
  return { e, hits, stored, logs, tick: (ms: number) => (t += ms) };
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
  assert.deepEqual(hits[0], { ruleId: 'r1', ruleName: 'Play', ownerId: 'o1', channelId: 'c1', channel: 'sbx_tv', count: 1, burst: one, cooldownSec: 300, sample: m, firedAt: 1_000_000 });
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
  const hits: Omit<Hit, 'channelDisplayName' | 'channelAvatar'>[] = [];
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
  assert.deepEqual(e.live('r1'), [{ channelId: 'c1', inWindow: 0, threshold: 2, cooling: true, tally: { since: 1_000_000, mentions: 3, chatters: 2 } }]);

  e.ingest(msg('!play', { userId: 'u2' }));
  e.ingest(msg('!play', { userId: 'u3' }));
  assert.deepEqual(e.live('r1')[0]?.tally, { since: 1_000_000, mentions: 5, chatters: 3 });

  tick(300_000);
  e.ingest(msg('!play', { userId: 'u4' }));
  e.ingest(msg('!play', { userId: 'u5' }));
  assert.equal(hits.length, 2);
  assert.deepEqual(e.live('r1'), [{ channelId: 'c1', inWindow: 0, threshold: 2, cooling: true, tally: { since: 1_300_000, mentions: 2, chatters: 2 } }]);
});

test('live reports partial burst progress without changing firing behavior', () => {
  const { e, hits } = setup();
  e.setRules([rule({ burst: { threshold: 3, windowSec: 60, countBy: 'users' }, cooldownSec: 60 })]);
  e.ingest(msg('!play', { userId: 'u1' }));
  assert.deepEqual(e.live('r1'), [{ channelId: 'c1', inWindow: 1, threshold: 3, cooling: false, tally: null }]);
  e.live('r1');
  e.ingest(msg('!play', { userId: 'u1' }));
  assert.equal(e.live('r1')[0]?.inWindow, 1);
  e.ingest(msg('!play', { userId: 'u2' }));
  assert.equal(e.live('r1')[0]?.inWindow, 2);
  assert.equal(hits.length, 0);
  e.live('r1');
  e.ingest(msg('!play', { userId: 'u3' }));
  assert.equal(hits.length, 1);
  assert.deepEqual(e.live('r1')[0], { channelId: 'c1', inWindow: 0, threshold: 3, cooling: true, tally: { since: 1_000_000, mentions: 4, chatters: 3 } });
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

test('active chatters set the effective threshold for each burst step', () => {
  let { e, hits } = setup();
  const percentRule = rule({ burst: { threshold: 3, minPercent: 10, windowSec: 60, countBy: 'users' } });
  e.setRules([percentRule]);
  for (let i = 0; i < 8; i++) e.ingest(msg('chat', { userId: `u${i}` }));
  for (let i = 0; i < 3; i++) e.ingest(msg('!play', { userId: `u${i}` }));
  assert.equal(hits.length, 1);

  ({ e, hits } = setup());
  e.setRules([rule({ id: 'r2', updatedAt: 2, burst: { threshold: 3, minPercent: 10, windowSec: 60, countBy: 'users' } })]);
  for (let i = 0; i < 60; i++) e.ingest(msg('chat', { userId: `v${i}` }));
  for (let i = 0; i < 5; i++) e.ingest(msg('!play', { userId: `v${i}` }));
  assert.equal(hits.length, 0);
  e.ingest(msg('!play', { userId: 'v5' }));
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.count, 6);

  ({ e, hits } = setup());
  e.setRules([rule({ id: 'r3', burst: { threshold: 3, minPercent: 10, windowSec: 60, countBy: 'users' } })]);
  for (let i = 0; i < 300; i++) e.ingest(msg('chat', { userId: `w${i}` }));
  for (let i = 0; i < 29; i++) e.ingest(msg('!play', { userId: `w${i}` }));
  assert.equal(hits.length, 0);
  e.ingest(msg('!play', { userId: 'w29' }));
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.count, 30);
});

test('skipIfSelf suppresses a fire when the owner matched inside the burst window', () => {
  const { e, hits, stored, logs, tick } = setup();
  const burst = { threshold: 2, windowSec: 60, countBy: 'users' as const };
  e.setRules([rule({ skipIfSelf: true, burst, cooldownSec: 60 })]);
  e.ingest(msg('!play', { userId: 'o1' }));
  tick(10_000);
  e.ingest(msg('!play', { userId: 'u2' }));

  assert.equal(hits.length, 0);
  assert.deepEqual(stored, [1_010_000]);
  assert.deepEqual(logs, ['rule r1 fired in sbx_tv, skipped: owner already joined']);
  assert.deepEqual(e.live('r1'), [{ channelId: 'c1', inWindow: 0, threshold: 2, cooling: true, tally: { since: 1_010_000, mentions: 2, chatters: 2 } }]);
});

test('skipIfSelf delivers when the owner match is outside the burst window', () => {
  const { e, hits, tick } = setup();
  e.setRules([rule({ skipIfSelf: true, burst: { threshold: 2, windowSec: 60, countBy: 'users' } })]);
  e.ingest(msg('!play', { userId: 'o1' }));
  tick(60_001);
  e.ingest(msg('!play', { userId: 'u2' }));
  e.ingest(msg('!play', { userId: 'u3' }));
  assert.equal(hits.length, 1);
});

test('skipIfSelf is off by default and owner matches still deliver', () => {
  const { e, hits } = setup();
  e.setRules([rule({ burst: one })]);
  e.ingest(msg('!play', { userId: 'o1' }));
  assert.equal(hits.length, 1);
});

test('owner matches are remembered even when the sender filter excludes the owner', () => {
  const { e, hits, stored } = setup();
  e.setRules([rule({
    skipIfSelf: true,
    burst: one,
    sender: { badges: [], logins: ['allowed'], exclude: false },
  })]);
  e.ingest(msg('!play', { userId: 'o1', login: 'owner' }));
  e.ingest(msg('!play', { userId: 'u2', login: 'allowed' }));
  assert.equal(hits.length, 0);
  assert.deepEqual(stored, [1_000_000]);
});

test('cooldown starts after a suppressed fire', () => {
  const { e, hits, stored, tick } = setup();
  e.setRules([rule({ skipIfSelf: true, burst: one })]);
  e.ingest(msg('!play', { userId: 'o1' }));
  assert.equal(hits.length, 0);
  assert.equal(e.live('r1')[0]?.cooling, true);

  tick(60_001);
  e.ingest(msg('!play', { userId: 'u2' }));
  assert.equal(hits.length, 0);
  tick(239_999);
  e.ingest(msg('!play', { userId: 'u3' }));
  assert.equal(hits.length, 1);
  assert.deepEqual(stored, [1_000_000, 1_300_000]);
});

test('owner join timestamp is isolated by channel', () => {
  const { e, hits } = setup();
  e.setRules([rule({ skipIfSelf: true, burst: one, channelIds: ['c1', 'c2'] })]);
  e.ingest(msg('!play', { userId: 'o1', channelId: 'c1' }));
  e.ingest(msg('!play', { userId: 'u2', channelId: 'c2', channel: 'other' }));
  assert.deepEqual(hits.map((h) => h.channelId), ['c2']);
});

test('skipReplies skips replies to the owner and counts replies to another user', () => {
  const { e, hits } = setup();
  e.setRules([rule({ skipReplies: true, burst: one })]);
  e.ingest(msg('!play reply', { userId: 'viewer', replyToUserId: 'o1' }));
  assert.equal(hits.length, 0);
  e.ingest(msg('!play reply', { userId: 'viewer2', replyToUserId: 'someone-else' }));
  assert.equal(hits.length, 1);
});

test('skipReplies skips owner mentions for 4:59 and counts them after 5:01', () => {
  const { e, hits, tick } = setup();
  e.setRules([rule({ skipReplies: true, burst: one })]);
  e.ingest(msg('hello', { userId: 'o1', login: 'esembe' }));
  tick(299_000);
  e.ingest(msg('!play @ESEMBE hi', { userId: 'viewer' }));
  assert.equal(hits.length, 0);
  tick(2_000);
  e.ingest(msg('!play @esembe hi', { userId: 'viewer2' }));
  assert.equal(hits.length, 1);
});

test('skipReplies mention matching requires a whole login word', () => {
  const { e, hits } = setup();
  e.setRules([rule({ skipReplies: true, burst: one })]);
  e.ingest(msg('hello', { userId: 'o1', login: 'esembe' }));
  e.ingest(msg('!play esembeFan', { userId: 'viewer' }));
  assert.equal(hits.length, 1);
});

test('owner activity and learned login survive rule edits and are shared by rules', () => {
  const { e, hits } = setup();
  const first = rule({ skipReplies: true, burst: one });
  const second = rule({ id: 'r2', skipReplies: true, burst: one });
  e.setRules([first, second]);
  e.ingest(msg('hello', { userId: 'o1', login: 'oldlogin' }));
  e.ingest(msg('hello again', { userId: 'o1', login: 'newlogin' }));
  e.setRules([{ ...first, updatedAt: 2 }, { ...second, updatedAt: 2 }]);
  e.ingest(msg('!play @newlogin hi', { userId: 'viewer', login: 'viewer' }));
  assert.equal(hits.length, 0);
  e.ingest(msg('!play @oldlogin hi', { userId: 'viewer2', login: 'viewer2' }));
  assert.equal(hits.length, 2);
});

test('skipIfSelf does not remember an owner reply skipped by skipReplies', () => {
  const { e, hits } = setup();
  e.setRules([rule({ skipIfSelf: true, skipReplies: true, burst: one, cooldownSec: 60 })]);
  e.ingest(msg('!play owner reply', { userId: 'o1', login: 'esembe', replyToUserId: 'o1' }));
  e.ingest(msg('!play viewer', { userId: 'u2' }));
  assert.equal(hits.length, 1);
});

test('skipReplies uses Unicode word boundaries', () => {
  for (const text of ['!play üesembe', '!play esembeÄ', '!play esembe猫']) {
    const { e, hits } = setup();
    e.setRules([rule({ skipReplies: true, burst: one })]);
    e.ingest(msg('hello', { userId: 'o1', login: 'esembe' }));
    e.ingest(msg(text, { userId: 'viewer' }));
    assert.equal(hits.length, 1, text);
  }
  const { e, hits } = setup();
  e.setRules([rule({ skipReplies: true, burst: one })]);
  e.ingest(msg('hello', { userId: 'o1', login: 'esembe' }));
  e.ingest(msg('!play @ESEMBE,', { userId: 'viewer' }));
  assert.equal(hits.length, 0);
});

test('skipReplies includes exactly five minutes and expires after five minutes', () => {
  const { e, hits, tick } = setup();
  e.setRules([rule({ skipReplies: true, burst: one })]);
  e.ingest(msg('hello', { userId: 'o1', login: 'esembe' }));
  tick(300_000);
  e.ingest(msg('!play @esembe', { userId: 'viewer' }));
  assert.equal(hits.length, 0);
  tick(1);
  e.ingest(msg('!play @esembe', { userId: 'viewer2' }));
  assert.equal(hits.length, 1);
});

test('skipReplies off does not skip a reply or owner mention', () => {
  const { e, hits } = setup();
  e.setRules([rule({ burst: one })]);
  e.ingest(msg('hello', { userId: 'o1', login: 'esembe' }));
  e.ingest(msg('!play @esembe hi', { userId: 'viewer', replyToUserId: 'o1' }));
  assert.equal(hits.length, 1);
});

test('the rule window picks which active count scales the threshold', () => {
  const run = (activeWindowMin?: 5 | 30) => {
    const { e, hits, tick } = setup();
    e.setRules([rule({ burst: { threshold: 3, minPercent: 10, windowSec: 60, countBy: 'users', ...(activeWindowMin ? { activeWindowMin } : {}) } })]);
    for (let i = 0; i < 60; i++) e.ingest(msg('chat', { userId: `o${i}` }));
    tick(20 * 60_000);
    for (let i = 0; i < 3; i++) e.ingest(msg('!play', { userId: `n${i}` }));
    return { hits: hits.length, live: e.live('r1')[0]!.threshold };
  };
  assert.deepEqual(run(5), { hits: 1, live: 3 });
  assert.deepEqual(run(30), { hits: 0, live: 6 });
});
