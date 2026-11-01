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

test('retain drops activity for channels that are no longer desired', () => {
  const activity = createActivityTracker(() => 0);
  activity.record('kept', 'u1', 'hello');
  activity.record('removed', 'u2', 'hello');
  activity.retain(['kept']);
  activity.record('removed', 'u3', 'hello');
  assert.equal(activity.count('kept'), 1);
  assert.equal(activity.count('removed'), 1);
});

test('record periodically sweeps expired users and releases empty channels', () => {
  let now = 0;
  const activity = createActivityTracker(() => now);
  activity.record('old', 'u1', 'hello');
  assert.equal(activity.channelCount(), 1);
  now = 600_001;
  activity.record('new', 'u2', 'hello');
  assert.equal(activity.channelCount(), 1);
  assert.equal(activity.count('new'), 1);
});
