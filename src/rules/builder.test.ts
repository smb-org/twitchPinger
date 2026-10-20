import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileMatcher, validateRegex } from './matcher.ts';

const { readable, wordRegexConversion } = await import(new URL('../../web/src/form.ts', import.meta.url).href) as {
  readable: (f: { mode: 'word'; pattern: string }) => string;
  wordRegexConversion: (pattern: string, maxLen?: number) => { pattern: string | null; hint?: string };
};

test('word-mode regex conversion matches punctuation-aware whole-word behavior', () => {
  const pattern = '!play';
  const word = compileMatcher({ mode: 'word', pattern, caseSensitive: false });
  const regex = compileMatcher({ mode: 'regex', pattern: readable({ mode: 'word', pattern }), caseSensitive: false });
  for (const text of ['!play', 'a!play', '!playx', 'say !play!', '!!play', 'é!play', '_!play']) {
    assert.equal(regex(text).matched, word(text).matched, text);
  }
  assert.equal(regex('!play').matched, true);
  assert.equal(regex('a!play').matched, false);
  assert.equal(regex('!playx').matched, false);
});

test('word-mode regex conversion keeps exact ranges across repeated words', () => {
  const regex = compileMatcher({ mode: 'regex', pattern: readable({ mode: 'word', pattern: 'play' }), caseSensitive: false });
  assert.deepEqual(regex('play play').ranges, [[0, 4], [5, 9]]);
});

test('word mode and converted regex agree on tricky matches and boundaries', () => {
  const patterns = ['a a', '!play', 'foo.bar', 'é', '_a'];
  const texts = [
    'xa a a', 'a a a', 'a!a a', 'x!play !playx', '!!play', 'é!play', '_!play',
    'foo.bar foo.barx', 'é ée', 'x_a _a', 'a a!', 'xa a a a',
  ];
  for (const pattern of patterns) {
    const word = compileMatcher({ mode: 'word', pattern, caseSensitive: false });
    const regex = compileMatcher({ mode: 'regex', pattern: readable({ mode: 'word', pattern }), caseSensitive: false });
    for (const text of texts) assert.deepEqual(regex(text), word(text), `${JSON.stringify(pattern)} in ${JSON.stringify(text)}`);
  }
  assert.deepEqual(
    compileMatcher({ mode: 'word', pattern: 'a a', caseSensitive: false })('xa a a').ranges,
    [[3, 6]],
  );
});

test('validated regex with adjacent groups compiles without wrapper stripping', () => {
  const pattern = '(^|[^\\pL\\pN_])(play)(now)($|[^\\pL\\pN_])';
  assert.deepEqual(validateRegex(pattern), { ok: true });
  const matcher = compileMatcher({ mode: 'regex', pattern, caseSensitive: false });
  assert.equal(matcher(' playnow ').matched, true);
});

test('word-mode conversion stays compact and asks for shorter input when its reserved space exceeds the limit', () => {
  const compact = wordRegexConversion('x'.repeat(165));
  assert.ok(compact.pattern);
  assert.ok(compact.pattern.length <= 200);
  assert.deepEqual(validateRegex(compact.pattern), { ok: true });

  const tooLong = wordRegexConversion('x'.repeat(190));
  assert.equal(tooLong.pattern, null);
  assert.match(tooLong.hint ?? '', /Wortgrenzen.*reserviert.*200/);
});
