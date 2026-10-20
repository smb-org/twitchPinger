import { ChatClient } from '@twurple/chat';
import type { Badge, ChatMessage, ReaderHealth } from '../types.ts';

/** Raw message shape consumed from the chat client (subset of twurple's ChatMessage). */
export interface RawChatMessage {
  date: Date;
  channelId: string | null;
  userInfo: { userId: string; userName: string; displayName: string; isBroadcaster: boolean; isMod: boolean; isVip: boolean; isSubscriber: boolean };
}

/** Minimal chat client surface the reader needs. */
export interface ChatClientLike {
  connect(): void;
  quit(): void;
  join(channel: string): Promise<void>;
  part(channel: string): void;
  readonly currentChannels: string[];
  onMessage(cb: (channel: string, user: string, text: string, msg: RawChatMessage) => void): unknown;
  onAuthenticationSuccess(cb: () => void): unknown;
  onDisconnect(cb: (manually: boolean, reason?: Error) => void): unknown;
}

export interface Reader {
  start(): Promise<void>;
  stop(): Promise<void>;
  setChannels(logins: string[]): Promise<void>;
  health(): ReaderHealth;
  recent(login: string): ChatMessage[];
}

export interface ReaderOpts {
  clientFactory?: () => ChatClientLike;
  now?: () => number;
  onMessage: (msg: ChatMessage) => void;
  onHealth?: (h: ReaderHealth) => void;
  bufferSize?: number;
  joinTimeoutMs?: number;
}

// The reader owns membership and joins the latest desired set after each registration.
const defaultFactory = (): ChatClientLike => new ChatClient({ channels: [], rejoinChannelsOnReconnect: false }) as unknown as ChatClientLike;
// Twurple may queue joins for an 11s rate-limit window and gives dispatched joins 10s to reply.
const JOIN_TIMEOUT_MS = 30_000;

export function createReader(opts: ReaderOpts): Reader {
  const factory = opts.clientFactory ?? defaultFactory;
  const now = opts.now ?? Date.now;
  const cap = opts.bufferSize ?? 500;
  let desired = new Set<string>();
  const buffers = new Map<string, ChatMessage[]>();
  const joined = new Set<string>();
  let client: ChatClientLike | null = null;
  let connected = false;
  let connectionRevision = 0;
  let abortJoin: (() => void) | null = null;
  let since = now();
  let lastMessageAt: number | null = null;
  let lastEmitted = '';
  let reconcileRevision = 0;
  let reconciledRevision = 0;
  let reconciliation: Promise<void> | null = null;

  const joinedCount = () => (connected ? [...joined].filter((c) => desired.has(c)).length : 0);
  const health = (): ReaderHealth => ({ connected, since, joined: joinedCount(), desired: desired.size, lastMessageAt });
  // Emit only when connected/joined/desired changed (never per message).
  const emit = () => {
    const h = health();
    const key = `${h.connected}|${h.joined}|${h.desired}`;
    if (key === lastEmitted) return;
    lastEmitted = key;
    opts.onHealth?.(h);
  };

  async function finishReconciliation(): Promise<void> {
    if (!client || !connected) return;
    if (reconciliation) {
      await reconciliation;
      if (client && connected && reconcileRevision !== reconciledRevision) await finishReconciliation();
      return;
    }
    let completed = -1;
    const task = (async () => {
      while (client && connected && completed !== reconcileRevision) {
        completed = reconcileRevision;
        const c = client as ChatClientLike;
        const have = new Set([...joined, ...c.currentChannels.map((ch) => ch.replace(/^#/, '').toLowerCase())]);
        for (const ch of have) {
          if (!desired.has(ch)) { c.part(ch); joined.delete(ch); }
        }
        for (const ch of new Set(desired)) {
          if (!desired.has(ch) || joined.has(ch)) continue;
          const revision = connectionRevision;
          let timeout: ReturnType<typeof setTimeout> | undefined;
          let abort!: () => void;
          const disconnected = new Promise<null>((resolve) => { abort = () => resolve(null); });
          abortJoin = abort;
          const join = Promise.resolve().then(() => c.join(ch)).then(() => 'joined' as const, () => 'failed' as const);
          const bounded = new Promise<'timeout'>((resolve) => { timeout = setTimeout(() => resolve('timeout'), opts.joinTimeoutMs ?? JOIN_TIMEOUT_MS); });
          const result = await Promise.race([join, bounded, disconnected]);
          if (timeout) clearTimeout(timeout);
          if (abortJoin === abort) abortJoin = null;
          if (result === null || revision !== connectionRevision || c !== client || !connected) break;
          if (result === 'joined') {
            if (desired.has(ch)) joined.add(ch);
            else c.part(ch);
          }
        }
      }
      reconciledRevision = completed;
      emit();
    })();
    reconciliation = task;
    try { await task; }
    finally { if (reconciliation === task) reconciliation = null; }
    if (client && connected && reconcileRevision !== reconciledRevision) await finishReconciliation();
  }

  async function reconcile(): Promise<void> {
    if (!client || !connected) return emit();
    reconcileRevision++;
    await finishReconciliation();
  }

  function handle(channel: string, _user: string, text: string, m: RawChatMessage): void {
    const login = channel.replace(/^#/, '').toLowerCase();
    if (!desired.has(login)) return;
    const u = m.userInfo;
    if (!u.userId) return;
    const badges: Badge[] = [];
    if (u.isBroadcaster) badges.push('broadcaster');
    if (u.isMod) badges.push('moderator');
    if (u.isVip) badges.push('vip');
    if (u.isSubscriber) badges.push('subscriber');
    const msg: ChatMessage = {
      channel: login, channelId: m.channelId ?? '', userId: u.userId, login: u.userName,
      displayName: u.displayName, text, badges, sentAt: m.date.getTime(), receivedAt: now(),
    };
    lastMessageAt = msg.receivedAt;
    let buf = buffers.get(login);
    if (!buf) buffers.set(login, (buf = []));
    buf.push(msg);
    if (buf.length > cap) buf.shift();
    opts.onMessage(msg);
  }

  return {
    async start() {
      if (client) return;
      const c = (client = factory());
      c.onMessage(handle);
      c.onAuthenticationSuccess(() => {
        if (!connected) since = now();
        connectionRevision++;
        connected = true;
        void reconcile();
      });
      c.onDisconnect(() => {
        if (connected) { connected = false; since = now(); }
        connectionRevision++;
        joined.clear();
        abortJoin?.();
        abortJoin = null;
        emit();
      });
      c.connect();
    },
    async stop() {
      const c = client;
      client = null;
      connectionRevision++;
      joined.clear();
      abortJoin?.();
      abortJoin = null;
      c?.quit();
      if (connected) { connected = false; since = now(); }
      lastEmitted = '';
      opts.onHealth?.(health());
    },
    async setChannels(logins) {
      desired = new Set(logins.map((l) => l.trim().toLowerCase().replace(/^#/, '')).filter(Boolean));
      for (const login of buffers.keys()) if (!desired.has(login)) buffers.delete(login);
      await reconcile();
    },
    health,
    recent: (login) => [...(buffers.get(login.toLowerCase()) ?? [])],
  };
}
