import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeRule, simulateThreshold } from './describe.ts';
import { msg, rule } from './fixtures.ts';

test('describeRule: default users burst', () => {
  assert.equal(
    describeRule(rule(), ['sbx_tv', 'marblemania']),
    'Meldet, wenn 5 verschiedene Chatter innerhalb von 60 s eine Nachricht schreiben, die mit „!play“ beginnt, in sbx_tv und marblemania, danach 5 min Ruhe.',
  );
});

test('describeRule: threshold 1, modes, cooldown', () => {
  const r = rule({ burst: { threshold: 1, windowSec: 60, countBy: 'users' }, matcher: { mode: 'word', pattern: 'x', caseSensitive: false }, cooldownSec: 45 });
  assert.equal(describeRule(r, ['a']), 'Meldet jede Nachricht, die „x“ als ganzes Wort enthält, in a, danach 45 s Ruhe.');
  assert.match(describeRule(rule({ cooldownSec: 1 }), []), /danach 30 s Ruhe\.$/);
  assert.match(describeRule(rule({ matcher: { mode: 'regex', pattern: 'a+', caseSensitive: false } }), []), /auf den Ausdruck „a\+“ passt/);
  assert.match(describeRule(rule({ matcher: { mode: 'contains', pattern: 'a', caseSensitive: false } }), []), /„a“ enthält/);
});

test('describeRule: messages and sender', () => {
  const r = rule({ burst: { threshold: 3, windowSec: 120, countBy: 'messages' }, sender: { badges: ['moderator', 'vip'], logins: [], exclude: false } });
  assert.equal(describeRule(r, ['c']), 'Meldet, wenn 3 Nachrichten, die mit „!play“ beginnen, innerhalb von 120 s geschrieben werden, nur von Mods und VIPs, in c, danach 5 min Ruhe.');
  const e = rule({ sender: { badges: [], logins: ['bot'], exclude: true } });
  assert.match(describeRule(e, []), /, außer von bot, danach/);
  assert.match(describeRule(rule({ skipIfSelf: true }), []), /wenn du im Zeitfenster selbst ausgelöst hast/);
});

test('simulateThreshold', () => {
  const ms = [
    ...[1, 2, 3, 4, 5].map((i) => msg('!play', { userId: `u${i}`, sentAt: i * 1000 })),
    msg('hello', { userId: 'u9', sentAt: 6000 }),
    msg('!play', { userId: 'u1', sentAt: 7000 }),
  ];
  assert.deepEqual(simulateThreshold(rule(), ms), { hits: 6, chatters: 5, fires: 1 });
  assert.deepEqual(simulateThreshold(rule({ sender: { badges: ['vip'], logins: [], exclude: false } }), ms), { hits: 0, chatters: 0, fires: 0 });
});
