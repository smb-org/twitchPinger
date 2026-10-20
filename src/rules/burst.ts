import type { Burst } from '../types.ts';
import { LIMITS_DEFAULTS } from '../types.ts';

/**
 * Per-(rule,channel) sliding-window state. Pure; the caller supplies the clock (ms).
 * step(): record one matching message. Fires on the hit that reaches the threshold,
 * then clears the window and ignores hits until the cooldown ends.
 */
export interface BurstState {
  hits: Array<{ key: string; t: number }>;
  cooldownUntil: number;
}

export function createBurstState(cooldownUntil = 0): BurstState {
  return { hits: [], cooldownUntil };
}

export function cooldownMs(cooldownSec: number): number {
  return Math.max(cooldownSec, LIMITS_DEFAULTS.MIN_COOLDOWN_SEC) * 1000;
}

/** `count` is the number of hits (users or messages) in the window after this one (0 during cooldown). */
export function step(
  state: BurstState,
  burst: Burst,
  cooldownSec: number,
  hit: { userId: string },
  now: number,
): { fired: boolean; count: number } {
  if (now < state.cooldownUntil) return { fired: false, count: 0 };
  const cutoff = now - burst.windowSec * 1000;
  const users = burst.countBy === 'users';
  let hits = state.hits.filter((h) => h.t > cutoff);
  if (users) hits = hits.filter((h) => h.key !== hit.userId);
  hits.push({ key: hit.userId, t: now });
  const count = hits.length;
  if (count >= burst.threshold) {
    state.hits = [];
    state.cooldownUntil = now + cooldownMs(cooldownSec);
    return { fired: true, count };
  }
  state.hits = hits;
  return { fired: false, count };
}
