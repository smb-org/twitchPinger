import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeRule, simulateThreshold } from './describe.ts';
import { msg, rule } from './fixtures.ts';

test('describeRule: default users burst', () => {
  assert.equal(
    describeRule(rule(), ['sbx_tv', 'marblemania']),
    'Meldet, wenn mindestens 5 verschiedene Chatter innerhalb von 60 s eine Nachricht schreiben, die mit „!play“ beginnt, in sbx_tv und marblemania, danach 5 min Ruhe.',
  );
});

test('describeRule: threshold 1, modes, cooldown', () => {
  const r = rule({ burst: { threshold: 1, windowSec: 60, countBy: 'users' }, matcher: { mode: 'word', pattern: 'x', caseSensitive: false }, cooldownSec: 45 });
  assert.equal(describeRule(r, ['a']), 'Meldet, wenn mindestens 1 Chatter innerhalb von 60 s eine Nachricht schreibt, die „x“ als ganzes Wort enthält, in a, danach 45 s Ruhe.');
  assert.match(describeRule(rule({ cooldownSec: 1 }), []), /danach 30 s Ruhe\.$/);
  assert.match(describeRule(rule({ matcher: { mode: 'regex', pattern: 'a+', caseSensitive: false } }), []), /auf den Ausdruck „a\+“ passt/);
  assert.match(describeRule(rule({ matcher: { mode: 'contains', pattern: 'a', caseSensitive: false } }), []), /„a“ enthält/);
});

test('describeRule mentions the active chatter share when configured', () => {
  const r = rule({ burst: { threshold: 3, minPercent: 10, windowSec: 60, countBy: 'users' } });
  assert.match(describeRule(r, []), /mindestens 3 verschiedene Chatter \(in vollen Chats mehr: 10 % der in den letzten 10 Min aktiven Chatter\) innerhalb von 60 s/);
});

test('message thresholds describe a minimum share without claiming a share of chatters', () => {
  const r = rule({ burst: { threshold: 3, minPercent: 10, windowSec: 60, countBy: 'messages' } });
  assert.equal(describeRule(r, []), 'Meldet, wenn mindestens 3 Nachrichten (in vollen Chats mehr: so viele wie 10 % der in den letzten 10 Min aktiven Chatter), die mit „!play“ beginnen, innerhalb von 60 s geschrieben werden, danach 5 min Ruhe.');
});

test('threshold of one uses singular chatter wording and still says at least', () => {
  const r = rule({ burst: { threshold: 1, windowSec: 60, countBy: 'users' } });
  assert.match(describeRule(r, []), /mindestens 1 Chatter innerhalb von 60 s/);
});

test('describeRule: messages and sender', () => {
  const r = rule({ burst: { threshold: 3, windowSec: 120, countBy: 'messages' }, sender: { badges: ['moderator', 'vip'], logins: [], exclude: false } });
  assert.equal(describeRule(r, ['c']), 'Meldet, wenn mindestens 3 Nachrichten, die mit „!play“ beginnen, innerhalb von 120 s geschrieben werden, nur von Mods und VIPs, in c, danach 5 min Ruhe.');
  const e = rule({ sender: { badges: [], logins: ['bot'], exclude: true } });
  assert.match(describeRule(e, []), /, außer von bot, danach/);
  assert.match(describeRule(rule({ skipIfSelf: true }), []), /wenn du im Zeitfenster selbst ausgelöst hast/);
  assert.match(describeRule(rule({ skipReplies: true }), []), /Antworten an dich werden ignoriert/);
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

test('simulateThreshold learns owner login from replay and skips direct replies and recent mentions', () => {
  const r = rule({ skipReplies: true, burst: { threshold: 1, windowSec: 60, countBy: 'messages' } });
  const ms = [
    msg('hello', { userId: 'o1', login: 'esembe', sentAt: 1_000 }),
    msg('!play @ESEMBE hi', { userId: 'u2', sentAt: 2_000 }),
    msg('!play reply', { userId: 'u3', replyToUserId: 'o1', sentAt: 3_000 }),
    msg('!play hello', { userId: 'u4', sentAt: 4_000 }),
  ];
  assert.deepEqual(simulateThreshold(r, ms), { hits: 1, chatters: 1, fires: 1 });
});

test('simulateThreshold skips a direct reply to the owner', () => {
  const r = rule({ skipReplies: true });
  const ms = [
    msg('hello', { userId: 'o1', login: 'esembe', sentAt: 1_000 }),
    msg('!play reply', { userId: 'u2', replyToUserId: 'o1', sentAt: 2_000 }),
  ];
  assert.deepEqual(simulateThreshold(r, ms), { hits: 0, chatters: 0, fires: 0 });
});

test('simulateThreshold scales from active non-command chatters before matching', () => {
  const base = 10_000;
  const active = Array.from({ length: 60 }, (_, i) => msg('hello', { userId: `active${i}`, sentAt: base + i }));
  const commands = Array.from({ length: 6 }, (_, i) => msg('!play', { userId: `active${i}`, sentAt: base + 100 + i }));
  const r = rule({ burst: { threshold: 3, minPercent: 10, windowSec: 60, countBy: 'users' } });
  assert.deepEqual(simulateThreshold(r, [...active, ...commands.slice(0, 3)]), { hits: 3, chatters: 3, fires: 0 });
  assert.deepEqual(simulateThreshold(r, [...active, ...commands]), { hits: 6, chatters: 6, fires: 1 });
});

test('describeRule names the activity window and replay respects it', () => {
  const r = (activeWindowMin?: 5 | 30) => rule({ burst: { threshold: 3, minPercent: 10, windowSec: 60, countBy: 'users', ...(activeWindowMin ? { activeWindowMin } : {}) } });
  assert.match(describeRule(r(), []), /10 % der in den letzten 10 Min aktiven Chatter\)/);
  assert.match(describeRule(r(30), []), /10 % der in den letzten 30 Min aktiven Chatter\)/);
  const m = rule({ burst: { threshold: 3, minPercent: 10, windowSec: 60, countBy: 'messages', activeWindowMin: 5 } });
  assert.match(describeRule(m, []), /so viele wie 10 % der in den letzten 5 Min aktiven Chatter\)/);
  const base = 10_000;
  const old = Array.from({ length: 60 }, (_, i) => msg('hello', { userId: `a${i}`, sentAt: base + i }));
  const cmds = Array.from({ length: 3 }, (_, i) => msg('!play', { userId: `n${i}`, sentAt: base + 20 * 60_000 + i }));
  assert.equal(simulateThreshold(r(5), [...old, ...cmds]).fires, 1);
  assert.equal(simulateThreshold(r(30), [...old, ...cmds]).fires, 0);
});
