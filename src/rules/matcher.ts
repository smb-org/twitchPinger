import { RE2JS } from 're2js';
import type { ChatMessage, Matcher, SenderFilter } from '../types.ts';
import { LIMITS_DEFAULTS } from '../types.ts';

export type Ranges = Array<[number, number]>;
export interface MatchResult { matched: boolean; ranges: Ranges }

const NO_MATCH: MatchResult = { matched: false, ranges: [] };
const WORD_BEFORE = /[\p{L}\p{N}_]$/u;
const WORD_AFTER = /^[\p{L}\p{N}_]/u;
export const WORD_REGEX_PREFIX = '(^|[^\\pL\\pN_])(';
export const WORD_REGEX_SUFFIX = ')($|[^\\pL\\pN_])';
const lower = (s: string): string => s.toLocaleLowerCase('de');

function wordRegexBody(pattern: string): string | null {
  if (!pattern.startsWith(WORD_REGEX_PREFIX) || !pattern.endsWith(WORD_REGEX_SUFFIX)) return null;
  const body = pattern.slice(WORD_REGEX_PREFIX.length, -WORD_REGEX_SUFFIX.length);
  let depth = 1;
  let inClass = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch === '\\') { i++; continue; }
    if (inClass) {
      if (ch === ']') inClass = false;
      continue;
    }
    if (ch === '[') inClass = true;
    else if (ch === '(') depth++;
    else if (ch === ')' && --depth < 1) return null;
  }
  return depth === 1 && !inClass ? body : null;
}

/** Lowercased text plus, per lowered UTF-16 unit, the original [start,end) it came from. */
function fold(text: string): { low: string; starts: number[] | null; ends: number[] | null } {
  const low = lower(text);
  // ponytail: equal length is taken as 1:1 alignment; a length-neutral shift (e.g. one char growing, another shrinking) is not handled.
  if (low.length === text.length) return { low, starts: null, ends: null };
  const starts: number[] = [];
  const ends: number[] = [];
  let out = '';
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    const l = lower(ch);
    out += l;
    for (let k = 0; k < l.length; k++) { starts.push(i); ends.push(i + ch.length); }
    i += ch.length;
  }
  return { low: out, starts, ends };
}

function stringMatcher(m: Matcher): (text: string) => MatchResult {
  const pat = m.caseSensitive ? m.pattern : lower(m.pattern);
  if (pat === '') return () => NO_MATCH;
  const { mode } = m;
  return (text) => {
    const f = m.caseSensitive ? { low: text, starts: null, ends: null } : fold(text);
    const { low, starts, ends } = f;
    const orig = (a: number, b: number): [number, number] => (starts ? [starts[a]!, ends![b - 1]!] : [a, b]);
    const ranges: Ranges = [];
    if (mode === 'prefix') {
      let i = 0;
      while (i < low.length && /\s/.test(low[i]!)) i++;
      if (low.startsWith(pat, i)) ranges.push(orig(i, i + pat.length));
    } else {
      for (let i = low.indexOf(pat); i !== -1; ) {
        const end = i + pat.length;
        if (mode === 'word') {
          const [os, oe] = orig(i, end);
          if (WORD_BEFORE.test(text.slice(Math.max(0, os - 2), os)) || WORD_AFTER.test(text.slice(oe, oe + 2))) {
            i = low.indexOf(pat, i + 1);
            continue;
          }
        }
        ranges.push(orig(i, end));
        i = low.indexOf(pat, end);
      }
    }
    return ranges.length ? { matched: true, ranges } : NO_MATCH;
  };
}

/** Compile a matcher once; the returned function is reusable. Regex mode uses RE2 (linear time). */
export function compileMatcher(m: Matcher): (text: string) => MatchResult {
  if (m.mode !== 'regex') return stringMatcher(m);
  let body = wordRegexBody(m.pattern);
  let re;
  try {
    re = RE2JS.compile(body ?? m.pattern, m.caseSensitive ? 0 : RE2JS.CASE_INSENSITIVE);
  } catch (e) {
    if (body === null) throw e;
    body = null;
    re = RE2JS.compile(m.pattern, m.caseSensitive ? 0 : RE2JS.CASE_INSENSITIVE);
  }
  return (text) => {
    const mt = re.matcher(text);
    const ranges: Ranges = [];
    let matched = false;
    let searchFrom = 0;
    while (mt.find(searchFrom)) {
      const start = mt.start();
      const end = mt.end();
      if (body !== null && (WORD_BEFORE.test(text.slice(Math.max(0, start - 2), start)) || WORD_AFTER.test(text.slice(end, end + 2)))) {
        searchFrom = start + 1;
        continue;
      }
      matched = true;
      if (end > start) ranges.push([start, end]);
      if (end === start && start === text.length) break;
      searchFrom = end > start ? end : start + 1;
    }
    return matched ? { matched, ranges } : NO_MATCH;
  };
}

export function validateRegex(pattern: string): { ok: true } | { ok: false; error: string } {
  if (pattern === '') return { ok: false, error: 'Ungültiger Ausdruck: leer' };
  if (pattern.length > LIMITS_DEFAULTS.REGEX_MAX_LEN) {
    return { ok: false, error: `Ungültiger Ausdruck: länger als ${LIMITS_DEFAULTS.REGEX_MAX_LEN} Zeichen` };
  }
  try {
    RE2JS.compile(pattern);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Ungültiger Ausdruck: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Empty badges and logins = everyone; otherwise "selected" by badge or login, `exclude` inverts. */
export function matchesSender(f: SenderFilter, msg: ChatMessage): boolean {
  if (f.badges.length === 0 && f.logins.length === 0) return true;
  const login = msg.login.toLowerCase();
  const selected = f.badges.some((b) => msg.badges.includes(b)) || f.logins.some((l) => l.toLowerCase() === login);
  return f.exclude ? !selected : selected;
}
