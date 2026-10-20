import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBurstState, step } from './burst.ts';
import type { Burst } from '../types.ts';

const b: Burst = { threshold: 5, windowSec: 60, countBy: 'users' };
const run = (s: ReturnType<typeof createBurstState>, u: string, t: number, burst = b, cd = 300) => step(s, burst, cd, { userId: u }, t * 1000);

test('4 distinct users do not fire, 5th fires exactly', () => {
  const s = createBurstState();
  for (let i = 1; i <= 4; i++) assert.equal(run(s, `u${i}`, i).fired, false);
  assert.deepEqual(run(s, 'u5', 5), { fired: true, count: 5 });
});

test('one user x10 does not fire in users mode', () => {
  const s = createBurstState();
  for (let i = 0; i < 10; i++) assert.equal(run(s, 'u1', i).fired, false);
});

test('sliding expiry', () => {
  const s = createBurstState();
  for (let i = 1; i <= 4; i++) run(s, `u${i}`, i);
  assert.deepEqual(run(s, 'u5', 62), { fired: false, count: 3 }); // u1,u2 expired
  assert.equal(run(s, 'u6', 62).fired, false);
  assert.equal(run(s, 'u7', 62).fired, true);
});

test('cooldown ignores hits, then restarts from empty', () => {
  const s = createBurstState();
  for (let i = 1; i <= 5; i++) run(s, `u${i}`, i);
  for (let i = 1; i <= 5; i++) assert.deepEqual(run(s, `x${i}`, 10 + i), { fired: false, count: 0 });
  // cooldown ends at 5+300
  for (let i = 1; i <= 4; i++) assert.equal(run(s, `y${i}`, 305 + i).fired, false);
  assert.equal(run(s, 'y5', 310).fired, true);
});

test('messages mode counts every message', () => {
  const s = createBurstState();
  const mb: Burst = { threshold: 3, windowSec: 60, countBy: 'messages' };
  assert.equal(run(s, 'u1', 1, mb).fired, false);
  assert.equal(run(s, 'u1', 2, mb).fired, false);
  assert.deepEqual(run(s, 'u1', 3, mb), { fired: true, count: 3 });
});

test('min cooldown clamp', () => {
  const s = createBurstState();
  const one: Burst = { threshold: 1, windowSec: 60, countBy: 'users' };
  assert.equal(run(s, 'u1', 0, one, 0).fired, true);
  assert.equal(run(s, 'u1', 29, one, 0).fired, false);
  assert.equal(run(s, 'u1', 30, one, 0).fired, true);
});
