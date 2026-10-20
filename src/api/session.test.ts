import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashSessionId, newSessionId, signDiscordState, signState, verifyDiscordState, verifyState } from './session.ts';
import { openDb } from '../db/db.ts';
import { createRepo } from '../db/repo.ts';
import { loadConfig } from './config.ts';

test('session ids are random and stored hashed; expiry honoured', () => {
  const a = newSessionId(), b = newSessionId();
  assert.notEqual(a, b);
  assert.ok(a.length >= 43);
  assert.match(hashSessionId(a), /^[0-9a-f]{64}$/);
  const repo = createRepo(openDb(':memory:'));
  repo.createUser({ id: 'u', login: 'u', displayName: 'u', isAdmin: false, invitedBy: null, now: 0 });
  repo.insertSession(hashSessionId(a), 'u', 0, 1000, []);
  assert.equal(repo.getSession(hashSessionId(a), 999)?.userId, 'u');
  assert.equal(repo.getSession(a, 999), undefined); // plain id is not the key
  assert.equal(repo.getSession(hashSessionId(a), 1000), undefined);
});

test('state cookie: valid, tampered, wrong state, wrong secret, expired', () => {
  const { state, cookie } = signState('s'.repeat(32), 'INV', 1000);
  assert.deepEqual(verifyState('s'.repeat(32), cookie, state, 2000), { state, invite: 'INV' });
  const [body, sig] = cookie.split('.');
  const forged = Buffer.from(JSON.stringify({ s: state, i: 'OTHER', e: 9e12 })).toString('base64url');
  assert.equal(verifyState('s'.repeat(32), `${forged}.${sig}`, state, 2000), null);
  assert.equal(verifyState('s'.repeat(32), `${body}.${sig.slice(0, -2)}xx`, state, 2000), null);
  assert.equal(verifyState('s'.repeat(32), cookie, 'nope', 2000), null);
  assert.equal(verifyState('x'.repeat(32), cookie, state, 2000), null);
  assert.equal(verifyState('s'.repeat(32), cookie, state, 1000 + 11 * 60_000), null);
  assert.equal(verifyState('s'.repeat(32), undefined, state, 2000), null);
});

test('Discord state is signed, short-lived, and bound to the initiating session and return path', () => {
  const { state, cookie } = signDiscordState('s'.repeat(32), 'session-hash', '/onboarding', 1000);
  assert.deepEqual(verifyDiscordState('s'.repeat(32), cookie, state, 'session-hash', 2000), { state, returnTo: '/onboarding' });
  assert.equal(verifyDiscordState('s'.repeat(32), cookie, state, 'other-session', 2000), null);
  assert.equal(verifyDiscordState('s'.repeat(32), cookie, `${state}x`, 'session-hash', 2000), null);
  assert.equal(verifyDiscordState('s'.repeat(32), cookie, state, 'session-hash', 1_000 + 11 * 60_000), null);
  assert.equal(verifyDiscordState('x'.repeat(32), cookie, state, 'session-hash', 2000), null);
});

test('loadConfig: defaults in dev, required vars in production', () => {
  const c = loadConfig({ PUBLIC_URL: 'https://m.example/' });
  assert.equal(c.publicUrl, 'https://m.example');
  assert.equal(c.limits.MAX_ACCOUNTS, 100);
  assert.equal(c.authBase, 'https://id.twitch.tv');
  assert.equal(c.discordAvailable, false);
  assert.equal(loadConfig({ DISCORD_CLIENT_ID: 'id', DISCORD_CLIENT_SECRET: 'secret', DISCORD_BOT_TOKEN: 'token' }).discordAvailable, true);
  assert.equal(loadConfig({ DISCORD_CLIENT_ID: 'id', DISCORD_CLIENT_SECRET: 'secret' }).discordAvailable, false);
  assert.equal(loadConfig({ MAX_ACCOUNTS: '3' }).limits.MAX_ACCOUNTS, 3);
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /PUBLIC_URL/);
});

test('loadConfig: only the three count limits are env-configurable', () => {
  const c = loadConfig({ MAX_ACCOUNTS: '3', MAX_CHANNELS_TOTAL: '4', MAX_CHANNELS_PER_USER: '2', MIN_COOLDOWN_SEC: '1', REGEX_MAX_LEN: '9999', MAX_RULES_PER_USER: '1', MAX_OPEN_INVITES: '1', INVITE_TTL_DAYS: '1' });
  assert.deepEqual([c.limits.MAX_ACCOUNTS, c.limits.MAX_CHANNELS_TOTAL, c.limits.MAX_CHANNELS_PER_USER], [3, 4, 2]);
  assert.deepEqual([c.limits.MIN_COOLDOWN_SEC, c.limits.REGEX_MAX_LEN, c.limits.MAX_RULES_PER_USER, c.limits.MAX_OPEN_INVITES, c.limits.INVITE_TTL_DAYS], [30, 200, 20, 5, 7]);
});
