import type { Badge, Limits, MatchMode, Rule } from './api.ts';
import { validateRegex, WORD_REGEX_PREFIX, WORD_REGEX_SUFFIX } from '../../src/rules/matcher.ts';
import { LIMITS_DEFAULTS } from '../../src/types.ts';

export type BlockKind = 'text' | 'or' | 'wb' | 'digits' | 'any' | 'raw';
export interface Block { id: number; kind: BlockKind; text?: string }

/** Escape RE2 metacharacters so user text is always literal. */
export const esc = (s: string) => s.replace(/[\\.+*?()|[\]{}^$]/g, '\\$&');
export const fragment = (b: Block): string =>
  b.kind === 'text' ? esc(b.text ?? '') : b.kind === 'or' ? '|' : b.kind === 'wb' ? '\\b' : b.kind === 'digits' ? '\\d+' : b.kind === 'any' ? '.*' : (b.text ?? '');
export const blocksToPattern = (bs: Block[]) => bs.map(fragment).join('');
export const blockLabel = (b: Block): string =>
  b.kind === 'text' ? `„${b.text}“` : b.kind === 'or' ? 'oder' : b.kind === 'wb' ? 'Wortgrenze' : b.kind === 'digits' ? 'Ziffern' : b.kind === 'any' ? 'beliebig' : (b.text ?? '');

export interface Form {
  name: string; enabled: boolean;
  mode: MatchMode; pattern: string; blocks: Block[] | null; caseSensitive: boolean;
  badges: Badge[]; logins: string[]; exclude: boolean;
  threshold: string; windowSec: string; countBy: 'users' | 'messages';
  cdVal: string; cdUnit: 's' | 'min';
  skipIfSelf: boolean;
  channelIds: string[]; targetIds: string[];
}

export const emptyForm = (): Form => ({
  name: '', enabled: true, mode: 'contains', pattern: '', blocks: null, caseSensitive: false,
  badges: [], logins: [], exclude: false, threshold: '1', windowSec: '60', countBy: 'users',
  cdVal: '5', cdUnit: 'min', skipIfSelf: false, channelIds: [], targetIds: [],
});

/** Marbles template: prefix "!play", 5 chatters / 60 s, cooldown 5 min. */
export const MARBLES = {
  name: 'Marbles offen',
  matcher: { mode: 'prefix' as MatchMode, pattern: '!play', caseSensitive: false },
  sender: { badges: [] as Badge[], logins: [] as string[], exclude: false },
  burst: { threshold: 5, windowSec: 60, countBy: 'users' as const },
  cooldownSec: 300,
};
export function applyMarbles(f: Form): Form {
  return { ...f, name: f.name.trim() ? f.name : MARBLES.name, mode: 'prefix', pattern: '!play', blocks: null, caseSensitive: false, badges: [], logins: [], exclude: false, threshold: '5', windowSec: '60', countBy: 'users', cdVal: '5', cdUnit: 'min' };
}

export function fromRule(r: Rule): Form {
  const min = r.cooldownSec % 60 === 0;
  return {
    name: r.name, enabled: r.enabled, mode: r.matcher.mode, pattern: r.matcher.pattern, blocks: null, caseSensitive: r.matcher.caseSensitive,
    badges: r.sender.badges, logins: r.sender.logins, exclude: r.sender.exclude,
    threshold: String(r.burst.threshold), windowSec: String(r.burst.windowSec), countBy: r.burst.countBy,
    cdVal: String(min ? r.cooldownSec / 60 : r.cooldownSec), cdUnit: min ? 'min' : 's',
    skipIfSelf: r.skipIfSelf,
    channelIds: r.channelIds, targetIds: r.targetIds,
  };
}

const num = (s: string) => (s.trim() === '' ? NaN : Number(s));
export const cooldownOf = (f: Form) => num(f.cdVal) * (f.cdUnit === 'min' ? 60 : 1);

/** Rule body as the API expects it; numbers fall back to safe values when the form is invalid. */
export function toBody(f: Form) {
  const t = num(f.threshold);
  const w = num(f.windowSec);
  const c = cooldownOf(f);
  return {
    name: f.name.trim(), enabled: f.enabled,
    matcher: { mode: f.mode, pattern: f.pattern, caseSensitive: f.caseSensitive },
    sender: { badges: f.badges, logins: f.logins, exclude: f.exclude },
    burst: { threshold: Number.isFinite(t) ? t : 1, windowSec: Number.isFinite(w) ? w : 60, countBy: f.countBy },
    cooldownSec: Number.isFinite(c) ? Math.round(c) : 300,
    skipIfSelf: f.skipIfSelf,
    channelIds: f.channelIds, targetIds: f.targetIds,
  };
}
export const toRule = (f: Form): Rule => ({ id: '', ownerId: '', updatedAt: 0, ...toBody(f) });

/** Field-keyed validation messages (same keys the API uses). */
export function validate(f: Form, L: Limits): Record<string, string> {
  const e: Record<string, string> = {};
  if (!f.name.trim()) e.name = 'Bitte einen Namen eingeben.';
  if (!f.pattern) e['matcher.pattern'] = f.mode === 'regex' ? 'Der Ausdruck darf nicht leer sein.' : 'Das Suchmuster darf nicht leer sein.';
  else if (f.pattern.length > L.REGEX_MAX_LEN) e['matcher.pattern'] = `Höchstens ${L.REGEX_MAX_LEN} Zeichen.`;
  else if (f.mode === 'regex') { const r = validateRegex(f.pattern); if (!r.ok) e['matcher.pattern'] = r.error; }
  const t = num(f.threshold);
  const w = num(f.windowSec);
  if (!Number.isInteger(t) || t < 1 || t > 100) e.burst = 'Die Schwelle muss zwischen 1 und 100 liegen.';
  else if (!Number.isInteger(w) || w < 5 || w > 3600) e.burst = 'Das Fenster muss zwischen 5 und 3600 Sekunden liegen.';
  const c = cooldownOf(f);
  if (!Number.isFinite(c) || c < L.MIN_COOLDOWN_SEC) e.cooldownSec = `Der Cooldown muss mindestens ${L.MIN_COOLDOWN_SEC} Sekunden betragen.`;
  else if (c > 86_400 * 7) e.cooldownSec = 'Der Cooldown darf höchstens 7 Tage betragen.';
  return e;
}

/** Human-readable expression for the non-regex modes. */
export function readable(f: Form): string {
  if (!f.pattern) return '';
  const p = esc(f.pattern);
  return f.mode === 'word' ? `${WORD_REGEX_PREFIX}${p}${WORD_REGEX_SUFFIX}` : f.mode === 'prefix' ? `^${p}` : f.mode === 'regex' ? f.pattern : p;
}

export function wordRegexConversion(pattern: string, maxLen = LIMITS_DEFAULTS.REGEX_MAX_LEN): { pattern: string | null; hint?: string } {
  const converted = `${WORD_REGEX_PREFIX}${esc(pattern)}${WORD_REGEX_SUFFIX}`;
  if (converted.length <= maxLen) return { pattern: converted };
  const reserved = converted.length - esc(pattern).length;
  return {
    pattern: null,
    hint: `Für die Wortgrenzen sind ${reserved} Zeichen reserviert; die Umwandlung wäre ${converted.length}/${maxLen} Zeichen lang. Kürze das Suchmuster vor dem Wechsel in den Ausdrucksmodus.`,
  };
}
