import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from './db.ts';
import { createRepo } from './repo.ts';
import { vacuumInto } from './backup.ts';

function setup() {
  const db = openDb(':memory:');
  const repo = createRepo(db);
  for (const id of ['u1', 'u2']) repo.createUser({ id, login: id, displayName: id, isAdmin: false, invitedBy: null, now: 1 });
  for (const [id, login] of [['c1', 'one'], ['c2', 'two'], ['c3', 'three']]) repo.upsertChannel({ id, login, displayName: login }, 1);
  return { db, repo };
}
const ruleOf = (id: string, ownerId: string, channelIds: string[] = [], targetIds: string[] = []) => ({
  id, ownerId, name: id, enabled: true, matcher: { mode: 'contains' as const, pattern: 'x', caseSensitive: false },
  sender: { badges: [], logins: [], exclude: false }, burst: { threshold: 1, windowSec: 60, countBy: 'users' as const }, cooldownSec: 60, channelIds, targetIds,
});

test('migrations set user_version and are idempotent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mn-'));
  openDb(join(dir, 'a.db')).close();
  const db = openDb(join(dir, 'a.db'));
  assert.equal((db.prepare('PRAGMA user_version').get() as any).user_version, 1);
});

test('desiredChannelLogins excludes locked users and unsubscribed channels', () => {
  const { repo } = setup();
  repo.addUserChannel('u1', 'c1');
  repo.addUserChannel('u2', 'c1');
  repo.addUserChannel('u2', 'c2');
  assert.deepEqual(repo.desiredChannelLogins(), ['one', 'two']);
  repo.lockUser('u2');
  assert.deepEqual(repo.desiredChannelLogins(), ['one']);
  repo.removeUserChannel('u1', 'c1');
  assert.deepEqual(repo.desiredChannelLogins(), []);
});

test('listEnabledRules skips disabled rules and locked owners; lock disables rules', () => {
  const { repo } = setup();
  repo.saveRule(ruleOf('r1', 'u1'), 5);
  repo.saveRule({ ...ruleOf('r2', 'u1'), enabled: false }, 5);
  repo.saveRule(ruleOf('r3', 'u2'), 5);
  assert.deepEqual(repo.listEnabledRules().map((r) => r.id).sort(), ['r1', 'r3']);
  repo.lockUser('u2');
  assert.deepEqual(repo.listEnabledRules().map((r) => r.id), ['r1']);
  assert.equal(repo.getRule('r3')!.enabled, false);
  assert.equal(repo.listEnabledRules()[0].updatedAt, 5);
});

test('target is failing after 3 consecutive failures, success resets', () => {
  const { repo } = setup();
  repo.saveTarget({ id: 't1', ownerId: 'u1', kind: 'ntfy', name: 'n', url: 'https://x/y', token: null });
  repo.recordDeliveryResult('t1', false);
  repo.recordDeliveryResult('t1', false);
  assert.equal(repo.getTarget('t1')!.status, 'ok');
  repo.recordDeliveryResult('t1', true);
  repo.recordDeliveryResult('t1', false);
  repo.recordDeliveryResult('t1', false);
  assert.equal(repo.getTarget('t1')!.status, 'ok');
  repo.recordDeliveryResult('t1', false);
  assert.equal(repo.getTarget('t1')!.status, 'failing');
  assert.equal(repo.getTarget('t1')!.failCount, 3);
  repo.recordDeliveryResult('t1', true);
  assert.deepEqual([repo.getTarget('t1')!.status, repo.getTarget('t1')!.failCount], ['ok', 0]);
});

test('lastFired, saveRule resets it, lastPings and purge', () => {
  const { repo } = setup();
  repo.saveRule(ruleOf('r1', 'u1', ['c1']), 5);
  repo.saveTarget({ id: 't1', ownerId: 'u1', kind: 'ntfy', name: 'phone', url: 'https://x/y', token: null });
  repo.setLastFired('r1', 'c1', 100);
  repo.setLastFired('r1', 'c1', 200);
  assert.equal(repo.getLastFired('r1', 'c1'), 200);
  assert.equal(repo.getLastFired('r1', 'c2'), null);
  repo.saveRule(ruleOf('r1', 'u1', ['c1']), 6);
  assert.equal(repo.getLastFired('r1', 'c1'), null);

  const now = 100 * 86_400_000;
  const old = repo.recordHit({ ruleId: 'r1', channelId: 'c1', count: 2, firedAt: now - 40 * 86_400_000, sentTs: null });
  const fresh = repo.recordHit({ ruleId: 'r1', channelId: 'c1', count: 5, firedAt: now - 1000, sentTs: now - 1500 });
  repo.appendHitResult(fresh, 't1', true, now);
  const pings = repo.lastPings('u1', 10);
  assert.equal(pings.length, 2);
  assert.equal(pings[0].hitId, fresh);
  assert.equal(pings[0].channel, 'one');
  assert.deepEqual(pings[0].results, [{ targetId: 't1', ok: true, ts: now, targetName: 'phone' }]);
  assert.equal(repo.lastPings('u2').length, 0);
  assert.equal(repo.purgeOldHits(30, now), 1);
  assert.deepEqual(repo.lastPings('u1').map((p) => p.hitId), [fresh]);
  assert.notEqual(old, fresh);
});

test('removeUserChannel strips the channel from own rules and drops orphans', () => {
  const { repo } = setup();
  repo.addUserChannel('u1', 'c1');
  repo.addUserChannel('u1', 'c2');
  repo.saveRule(ruleOf('r1', 'u1', ['c1', 'c2']), 1);
  repo.removeUserChannel('u1', 'c1');
  assert.deepEqual(repo.getRule('r1')!.channelIds, ['c2']);
  assert.equal(repo.getChannel('c1'), undefined);
});

test('deleteTarget removes it from rules; counts', () => {
  const { repo } = setup();
  repo.saveTarget({ id: 't1', ownerId: 'u1', kind: 'discord', name: 'd', url: 'https://discord.com/api/webhooks/1/x', token: null });
  repo.saveRule(ruleOf('r1', 'u1', [], ['t1']), 1);
  assert.equal(repo.countTargets('u1'), 1);
  assert.equal(repo.countRules('u1'), 1);
  assert.ok(repo.deleteTarget('t1', 'u1'));
  assert.deepEqual(repo.getRule('r1')!.targetIds, []);
});

test('vacuumInto writes a dated file and rotates', () => {
  const { db } = setup();
  const dir = join(mkdtempSync(join(tmpdir(), 'mn-')), 'bk');
  let last = '';
  for (let d = 1; d <= 10; d++) last = vacuumInto(db, dir, 7, new Date(Date.UTC(2026, 9, d)));
  assert.ok(existsSync(last));
  assert.match(last, /marble-20261010\.db$/);
  const files = readdirSync(dir).sort();
  assert.equal(files.length, 7);
  assert.equal(files[0], 'marble-20261004.db');
  assert.doesNotThrow(() => openDb(last).close());
});

test('failed batch counts once per delivery; per-hit results append separately', () => {
  const { repo } = setup();
  repo.saveTarget({ id: 't1', ownerId: 'u1', kind: 'ntfy', name: 'n', url: 'https://x/y', token: null });
  repo.recordDeliveryResult('t1', false);
  assert.deepEqual([repo.getTarget('t1')!.status, repo.getTarget('t1')!.failCount], ['ok', 1]);
});
