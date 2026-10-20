import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeReader } from './fake.ts';
import type { ChatMessage } from '../types.ts';

const m = (text: string): ChatMessage => ({ channel: 'abc', channelId: '1', userId: '2', login: 'u', displayName: 'U', text, badges: [], sentAt: 1, receivedAt: 2 });

test('push feeds buffer and onMessage; connected by default', async () => {
  const got: string[] = [];
  const r = createFakeReader({ onMessage: (x) => got.push(x.text) });
  await r.setChannels(['ABC', 'abc', 'x']);
  assert.deepEqual([r.health().connected, r.health().joined, r.health().desired], [true, 2, 2]);
  assert.deepEqual(r.joinedChannels(), ['abc', 'x']);
  r.push(m('a')); r.push(m('b'));
  assert.deepEqual(got, ['a', 'b']);
  assert.deepEqual(r.recent('ABC').map((x) => x.text), ['a', 'b']);
  assert.equal(r.health().lastMessageAt, 2);
  r.setConnected(false);
  assert.equal(r.health().joined, 0);
  assert.deepEqual(r.joinedChannels(), []);
});
