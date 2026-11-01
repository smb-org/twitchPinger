import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createActivityTracker } from './activity.ts';

test('counts distinct chatters in the last ten minutes and ignores command messages', () => {
  let now = 0;
  const activity = createActivityTracker(() => now);
  activity.record('c1', 'u1', 'hello');
  activity.record('c1', 'u1', 'again');
  activity.record('c1', 'u2', ' !play');
  activity.record('c1', 'u3', 'world');
  assert.equal(activity.count('c1'), 2);
  now = 600_001;
  activity.record('c1', 'u4', 'new');
  assert.equal(activity.count('c1'), 1);
});

test('caps tracked chatter IDs at the engine limit', () => {
  const activity = createActivityTracker(() => 0);
  for (let i = 0; i < 10_001; i++) activity.record('c1', `u${i}`, 'hello');
  assert.equal(activity.count('c1'), 10_000);
});
