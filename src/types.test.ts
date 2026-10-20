import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS_DEFAULTS } from './types.ts';

test('LIMITS_DEFAULTS', () => {
  assert.deepEqual(LIMITS_DEFAULTS, { MAX_ACCOUNTS: 100, MAX_CHANNELS_TOTAL: 50, MAX_CHANNELS_PER_USER: 10, MAX_RULES_PER_USER: 20, MAX_OPEN_INVITES: 5, INVITE_TTL_DAYS: 7, MIN_COOLDOWN_SEC: 30, REGEX_MAX_LEN: 200 });
});
