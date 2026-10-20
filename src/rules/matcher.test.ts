import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileMatcher, matchesSender, validateRegex } from './matcher.ts';
import { msg } from './fixtures.ts';
import type { Matcher } from '../types.ts';

const m = (mode: Matcher['mode'], pattern: string, caseSensitive = false) => compileMatcher({ mode, pattern, caseSensitive });

test('contains: case-insensitive with ranges', () => {
  assert.deepEqual(m('contains', 'ab')('xAB ab'), { matched: true, ranges: [[1, 3], [4, 6]] });
  assert.equal(m('contains', 'ab', true)('AB').matched, false);
  assert.equal(m('contains', 'x')('abc').matched, false);
});

test('umlauts and ß keep correct ranges', () => {
  assert.deepEqual(m('contains', 'ärger')('Viel ÄRGER'), { matched: true, ranges: [[5, 10]] });
  assert.deepEqual(m('contains', 'straße')('Die STRASSE und Straße').ranges, [[16, 22]]);
  // length-changing lowercase: İ -> i + combining dot
  const r = m('contains', 'x')('İİx');
  assert.deepEqual(r.ranges, [[2, 3]]);
  assert.deepEqual(m('contains', 'ß')('aßb').ranges, [[1, 2]]);
});

test('word boundaries', () => {
  const w = m('word', '!play');
  assert.equal(w('!play now').matched, true);
  assert.equal(w('x !play').matched, true);
  assert.equal(w('!playing').matched, false);
  assert.equal(w('a!play').matched, false);
  assert.equal(w('(!play)').matched, true);
  assert.deepEqual(w('!playing !play').ranges, [[9, 14]]);
  const b = m('word', 'brudi');
  assert.equal(b('brudi!').matched, true);
  assert.equal(b('brudiär').matched, false);
  assert.equal(b('äbrudi').matched, false);
  assert.equal(b('brudi_x').matched, false);
  assert.equal(b('brudi2').matched, false);
  assert.equal(b('LUL brudi KEKW').matched, true);
});

test('prefix trims leading whitespace', () => {
  const p = m('prefix', '!play');
  assert.deepEqual(p('  !Play me'), { matched: true, ranges: [[2, 7]] });
  assert.equal(p('x !play').matched, false);
});

test('regex via RE2', () => {
  assert.deepEqual(m('regex', 'a+')('caab a').ranges, [[1, 3], [5, 6]]);
  assert.equal(m('regex', 'A')('a').matched, true);
  assert.equal(m('regex', 'A', true)('a').matched, false);
  assert.equal(m('regex', '^$')('').matched, true);
});

test('validateRegex', () => {
  assert.deepEqual(validateRegex('a+'), { ok: true });
  for (const p of ['', 'x'.repeat(201), '(a', '(?=a)']) {
    const r = validateRegex(p);
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.error.startsWith('Ungültiger Ausdruck: '));
  }
  assert.deepEqual(validateRegex('x'.repeat(200)), { ok: true });
});

test('matchesSender', () => {
  const f = (badges: any[], logins: string[], exclude = false) => ({ badges, logins, exclude });
  assert.equal(matchesSender(f([], []), msg('x')), true);
  assert.equal(matchesSender(f(['moderator'], []), msg('x', { badges: ['moderator'] })), true);
  assert.equal(matchesSender(f(['moderator'], []), msg('x')), false);
  assert.equal(matchesSender(f([], ['Bob']), msg('x', { login: 'bob' })), true);
  assert.equal(matchesSender(f(['vip'], ['bob'], true), msg('x', { login: 'bob' })), false);
  assert.equal(matchesSender(f(['vip'], ['bob'], true), msg('x', { login: 'al' })), true);
});
