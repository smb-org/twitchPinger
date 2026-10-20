import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChatClient } from '@twurple/chat';
import { createReader } from './reader.ts';
import type { ChatClientLike, RawChatMessage } from './reader.ts';
import type { ReaderHealth } from '../types.ts';

function fakeClient() {
  const c = {
    channels: [] as string[], joins: [] as string[], parts: [] as string[], failJoin: new Set<string>(),
    msg: null as any, auth: null as any, disc: null as any,
    joinWait: new Map<string, Promise<void>>(),
    connect() {}, quit() {},
    async join(ch: string) {
      c.joins.push(ch);
      const wait = c.joinWait.get(ch);
      if (wait) await wait;
      if (c.failJoin.has(ch)) throw new Error('nope');
      if (!c.channels.includes(ch)) c.channels.push(ch);
    },
    part(ch: string) { c.parts.push(ch); c.channels = c.channels.filter((x) => x !== ch); },
    get currentChannels() { return c.channels; },
    onMessage(cb: any) { c.msg = cb; }, onAuthenticationSuccess(cb: any) { c.auth = cb; }, onDisconnect(cb: any) { c.disc = cb; },
  };
  return c;
}

const raw = (o: Partial<RawChatMessage['userInfo']> = {}): RawChatMessage => ({
  date: new Date(1000), channelId: '99',
  userInfo: { userId: '7', userName: 'bob', displayName: 'Bob', isBroadcaster: false, isMod: true, isVip: false, isSubscriber: true, ...o },
});

function setup(bufferSize?: number, joinTimeoutMs?: number) {
  const c = fakeClient();
  const msgs: any[] = [];
  const healths: ReaderHealth[] = [];
  let t = 5000;
  const r = createReader({ clientFactory: () => c as unknown as ChatClientLike, now: () => t++, onMessage: (m) => msgs.push(m), onHealth: (h) => healths.push(h), bufferSize, joinTimeoutMs });
  return { c, r, msgs, healths };
}

test('maps messages', async () => {
  const { c, r, msgs } = setup();
  await r.start();
  await r.setChannels(['chan']);
  c.msg('#Chan', 'bob', 'hi', raw());
  assert.deepEqual(msgs[0], { channel: 'chan', channelId: '99', userId: '7', login: 'bob', displayName: 'Bob', text: 'hi', badges: ['moderator', 'subscriber'], sentAt: 1000, receivedAt: msgs[0].receivedAt });
  assert.ok(msgs[0].receivedAt >= 5000);
  c.msg('#chan', 'x', 'no id', raw({ userId: '' }));
  assert.equal(msgs.length, 1);
});

test('ring buffer caps, oldest first, copy', async () => {
  const { c, r } = setup(3);
  await r.start();
  await r.setChannels(['chan']);
  for (const t of ['1', '2', '3', '4']) c.msg('#chan', 'bob', t, raw());
  assert.deepEqual(r.recent('chan').map((m) => m.text), ['2', '3', '4']);
  r.recent('chan').pop();
  assert.equal(r.recent('chan').length, 3);
  assert.deepEqual(r.recent('none'), []);
});

test('setChannels diffs, dedupes, lowercases; join failure counted', async () => {
  const { c, r } = setup();
  await r.start();
  c.auth();
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
  c.auth();
  await new Promise((res) => setImmediate(res));
  assert.deepEqual(c.joins, ['a']);
  assert.equal(r.health().connected, true);
  c.disc(false);
  assert.equal(r.health().connected, false);
  c.channels = []; // connection lost its channels
  c.auth();
  await new Promise((res) => setImmediate(res));
  assert.deepEqual(c.joins, ['a', 'a']);
  assert.deepEqual(healths.map((h) => [h.connected, h.joined]), [[false, 0], [true, 1], [false, 0], [true, 1]]);
});

test('joinedChannels reports only joined desired channels and empties on disconnect', async () => {
  const { c, r } = setup();
  await r.start();
  await r.setChannels(['a', 'b']);
  assert.deepEqual(r.joinedChannels(), []);
  c.auth();
  await new Promise((res) => setImmediate(res));
  assert.deepEqual(r.joinedChannels(), ['a', 'b']);
  await r.setChannels(['b']);
  assert.deepEqual(r.joinedChannels(), ['b']);
  c.disc(false);
  assert.deepEqual(r.joinedChannels(), []);
});

test('reconnect joins the current desired channels after subscriptions change during an outage', async () => {
  const { c, r } = setup();
  await r.start();
  await r.setChannels(['old']);
  c.auth();
  await new Promise((res) => setImmediate(res));
  c.disc(false);
  c.channels = [];
  await r.setChannels(['new']);
  c.auth();
  await new Promise((res) => setImmediate(res));
  assert.deepEqual(c.channels, ['new']);
  assert.deepEqual(c.joins, ['old', 'new']);
});

test('reader joins its desired channels after registration without a startup channel list', async () => {
  const c = fakeClient();
  const r = createReader({ clientFactory: () => c as unknown as ChatClientLike, onMessage: () => {} });
  await r.setChannels(['first']);
  await r.start();
  c.auth();
  await new Promise((res) => setImmediate(res));
  assert.deepEqual(c.joins, ['first']);
});

test('actual Twurple reconnect lifecycle rejoins channels retained in currentChannels', async () => {
  const twurple = new ChatClient({ channels: [], rejoinChannelsOnReconnect: false }) as any;
  twurple.connect = () => twurple._initializeRateLimiters();
  const irc = twurple.irc;
  const joins: string[] = [];
  const realJoin = twurple.join.bind(twurple);
  twurple.join = (channel: string) => { joins.push(channel); return realJoin(channel); };
  const realIrcJoin = irc.join.bind(irc);
  irc.join = (channel: string) => {
    realIrcJoin(channel);
    setImmediate(() => twurple.emit(twurple._onJoinResult, channel, {}));
  };
  const r = createReader({ clientFactory: () => twurple, onMessage: () => {} });
  try {
    await r.start();
    await r.setChannels(['chan']);
    irc.emit(irc.onRegister);
    await r.setChannels(['chan']);
    assert.deepEqual(joins, ['chan']);
    assert.deepEqual(twurple.currentChannels, ['#chan']);

    irc.emit(irc.onDisconnect, false);
    assert.deepEqual(twurple.currentChannels, ['#chan']);
    irc.emit(irc.onRegister);
    await r.setChannels(['chan']);

    assert.deepEqual(joins, ['chan', 'chan']);
    assert.equal(r.health().joined, 1);
  } finally {
    await r.stop();
    clearTimeout(irc._pingCheckTimer);
    clearTimeout(irc._pingTimeoutTimer);
  }
});

test('Twurple queued JOIN dropped on disconnect does not block reconciliation', async () => {
  const twurple = new ChatClient({ channels: [], rejoinChannelsOnReconnect: false }) as any;
  twurple.connect = () => twurple._initializeRateLimiters();
  const irc = twurple.irc;
  const realIrcJoin = irc.join.bind(irc);
  irc.join = (channel: string) => {
    realIrcJoin(channel);
    setImmediate(() => twurple.emit(twurple._onJoinResult, channel, {}));
  };
  const r = createReader({ clientFactory: () => twurple, onMessage: () => {} });
  const channels = Array.from({ length: 21 }, (_, i) => `chan${i}`);
  try {
    await r.start();
    await r.setChannels(channels);
    irc.emit(irc.onRegister);

    const limiter = twurple._joinRateLimiter;
    const deadline = Date.now() + 1000;
    while (limiter._queue.length === 0 && Date.now() < deadline) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(limiter._queue.length, 1);

    const reconciliation = r.setChannels(channels);
    irc.emit(irc.onDisconnect, false);
    const settled = await Promise.race([reconciliation.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100))]);
    assert.equal(settled, true);
    assert.equal(limiter._queue.length, 0);
    assert.equal(r.health().connected, false);
  } finally {
    await r.stop();
    clearTimeout(irc._pingCheckTimer);
    clearTimeout(irc._pingTimeoutTimer);
  }
});

test('a disconnect settles reconciliation when Twurple leaves a queued JOIN promise pending', async () => {
  const { c, r } = setup();
  await r.start();
  c.auth();
  await new Promise((res) => setImmediate(res));
  let neverResolve!: () => void;
  const pending = new Promise<void>((resolve) => { neverResolve = resolve; });
  c.joinWait.set('queued', pending);

  const reconciliation = r.setChannels(['queued']);
  await new Promise((res) => setImmediate(res));
  c.disc(false);
  const settled = await Promise.race([reconciliation.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100))]);
  assert.equal(settled, true);
  assert.equal(r.health().connected, false);
  neverResolve();
});

test('a permanently pending JOIN times out while the connection remains established', async () => {
  const { c, r } = setup(undefined, 10);
  await r.start();
  c.auth();
  await new Promise((res) => setImmediate(res));
  c.joinWait.set('stuck', new Promise<void>(() => {}));

  await r.setChannels(['stuck']);
  assert.equal(r.health().connected, true);
  assert.equal(r.health().joined, 0);
});

test('reconciliation serializes joins and removes channels made stale while a join is pending', async () => {
  const { c, r } = setup();
  await r.start();
  c.auth();
  await new Promise((res) => setImmediate(res));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  c.joinWait.set('alpha', gate);
  const first = r.setChannels(['alpha', 'beta']);
  await new Promise((res) => setImmediate(res));
  assert.deepEqual(c.joins, ['alpha']);
  const latest = r.setChannels(['gamma']);
  release();
  await Promise.all([first, latest]);
  assert.deepEqual(c.channels, ['gamma']);
  assert.ok(c.parts.includes('alpha'));
  assert.ok(!c.channels.includes('beta'));
});

test('repeated disconnects preserve the start of the continuous outage', async () => {
  const { c, r } = setup();
  await r.start();
  c.auth();
  await new Promise((res) => setImmediate(res));
  c.disc(false);
  const outageSince = r.health().since;
  c.disc(false);
  assert.equal(r.health().since, outageSince);
  c.auth();
  assert.notEqual(r.health().since, outageSince);
});

test('removed channels lose their preview buffers and late messages are ignored', async () => {
  const { c, r, msgs } = setup();
  await r.start();
  await r.setChannels(['chan']);
  c.msg('#chan', 'bob', 'kept', raw());
  await r.setChannels([]);
  c.msg('#chan', 'bob', 'late', raw());
  assert.deepEqual(r.recent('chan'), []);
  assert.equal(msgs.length, 1);
});
