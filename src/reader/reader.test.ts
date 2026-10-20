import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReader } from './reader.ts';
import type { ChatClientLike, RawChatMessage } from './reader.ts';
import type { ReaderHealth } from '../types.ts';

function fakeClient() {
  const c = {
    channels: [] as string[], joins: [] as string[], parts: [] as string[], failJoin: new Set<string>(),
    msg: null as any, conn: null as any, disc: null as any,
    connect() {}, quit() {},
    async join(ch: string) { c.joins.push(ch); if (c.failJoin.has(ch)) throw new Error('nope'); c.channels.push(ch); },
    part(ch: string) { c.parts.push(ch); c.channels = c.channels.filter((x) => x !== ch); },
    get currentChannels() { return c.channels; },
    onMessage(cb: any) { c.msg = cb; }, onConnect(cb: any) { c.conn = cb; }, onDisconnect(cb: any) { c.disc = cb; },
  };
  return c;
}

const raw = (o: Partial<RawChatMessage['userInfo']> = {}): RawChatMessage => ({
  date: new Date(1000), channelId: '99',
  userInfo: { userId: '7', userName: 'bob', displayName: 'Bob', isBroadcaster: false, isMod: true, isVip: false, isSubscriber: true, ...o },
});

function setup(bufferSize?: number) {
  const c = fakeClient();
  const msgs: any[] = [];
  const healths: ReaderHealth[] = [];
  let t = 5000;
  const r = createReader({ clientFactory: () => c as unknown as ChatClientLike, now: () => t++, onMessage: (m) => msgs.push(m), onHealth: (h) => healths.push(h), bufferSize });
  return { c, r, msgs, healths };
}

test('maps messages', async () => {
  const { c, r, msgs } = setup();
  await r.start();
  c.msg('#Chan', 'bob', 'hi', raw());
  assert.deepEqual(msgs[0], { channel: 'chan', channelId: '99', userId: '7', login: 'bob', displayName: 'Bob', text: 'hi', badges: ['moderator', 'subscriber'], sentAt: 1000, receivedAt: msgs[0].receivedAt });
  assert.ok(msgs[0].receivedAt >= 5000);
  c.msg('#chan', 'x', 'no id', raw({ userId: '' }));
  assert.equal(msgs.length, 1);
});

test('ring buffer caps, oldest first, copy', async () => {
  const { c, r } = setup(3);
  await r.start();
  for (const t of ['1', '2', '3', '4']) c.msg('#chan', 'bob', t, raw());
  assert.deepEqual(r.recent('chan').map((m) => m.text), ['2', '3', '4']);
  r.recent('chan').pop();
  assert.equal(r.recent('chan').length, 3);
  assert.deepEqual(r.recent('none'), []);
});

test('setChannels diffs, dedupes, lowercases; join failure counted', async () => {
  const { c, r } = setup();
  await r.start();
  c.conn();
  c.failJoin.add('bad');
  await r.setChannels(['A', 'a', 'b', 'bad']);
  assert.deepEqual(c.joins.sort(), ['a', 'b', 'bad']);
  assert.deepEqual([r.health().joined, r.health().desired], [2, 3]);
  await r.setChannels(['b']);
  assert.deepEqual(c.parts, ['a']);
  assert.deepEqual([r.health().joined, r.health().desired], [1, 1]);
});

test('health transitions and reconcile after reconnect', async () => {
  const { c, r, healths } = setup();
  await r.start();
  await r.setChannels(['a']);
  assert.equal(c.joins.length, 0); // not connected yet
  c.conn();
  await new Promise((res) => setImmediate(res));
  assert.deepEqual(c.joins, ['a']);
  assert.equal(r.health().connected, true);
  c.disc(false);
  assert.equal(r.health().connected, false);
  c.channels = []; // connection lost its channels
  c.conn();
  await new Promise((res) => setImmediate(res));
  assert.deepEqual(c.joins, ['a', 'a']);
  assert.deepEqual(healths.map((h) => [h.connected, h.joined]), [[false, 0], [true, 1], [false, 0], [true, 1]]);
});
