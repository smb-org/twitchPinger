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

test('word-mode conversion stays compact and asks for shorter input when its reserved space exceeds the limit', () => {
  const compact = wordRegexConversion('x'.repeat(165));
  assert.ok(compact.pattern);
  assert.ok(compact.pattern.length <= 200);
  assert.deepEqual(validateRegex(compact.pattern), { ok: true });

  const tooLong = wordRegexConversion('x'.repeat(190));
  assert.equal(tooLong.pattern, null);
  assert.match(tooLong.hint ?? '', /Wortgrenzen.*reserviert.*200/);
});
