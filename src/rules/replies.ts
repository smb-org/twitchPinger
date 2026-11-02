import { WORD_REGEX_PREFIX, WORD_REGEX_SUFFIX } from './matcher.ts';

const REPLY_LOOKBACK_MS = 5 * 60_000;

export function compileOwnerMention(login: string): RegExp {
  const escaped = login.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const prefix = WORD_REGEX_PREFIX.replaceAll('\\pL', '\\p{L}').replaceAll('\\pN', '\\p{N}');
  const suffix = WORD_REGEX_SUFFIX.replaceAll('\\pL', '\\p{L}').replaceAll('\\pN', '\\p{N}');
  return new RegExp(`${prefix}@?${escaped}${suffix}`, 'iu');
}

export function isRecentOwnerMention(text: string, pattern: RegExp | undefined, lastMessageAt: number | undefined, now: number): boolean {
  return lastMessageAt !== undefined && lastMessageAt >= now - REPLY_LOOKBACK_MS && !!pattern?.test(text);
}
