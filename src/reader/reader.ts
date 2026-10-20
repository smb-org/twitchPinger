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
  onConnect(cb: () => void): unknown;
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
  clientFactory?: (channels: string[]) => ChatClientLike;
  now?: () => number;
  onMessage: (msg: ChatMessage) => void;
  onHealth?: (h: ReaderHealth) => void;
  bufferSize?: number;
}

// Anonymous (no authProvider): read-only, twurple rejoins its channel list on reconnect.
const defaultFactory = (channels: string[]): ChatClientLike => new ChatClient({ channels }) as unknown as ChatClientLike;

export function createReader(opts: ReaderOpts): Reader {
  const factory = opts.clientFactory ?? defaultFactory;
  const now = opts.now ?? Date.now;
  const cap = opts.bufferSize ?? 500;
  let desired = new Set<string>();
  const buffers = new Map<string, ChatMessage[]>();
  let client: ChatClientLike | null = null;
  let connected = false;
  let since = now();
  let lastMessageAt: number | null = null;
  let lastEmitted = '';

  const joinedCount = () => (client && connected ? client.currentChannels.filter((c) => desired.has(c.replace(/^#/, '').toLowerCase())).length : 0);
  const health = (): ReaderHealth => ({ connected, since, joined: joinedCount(), desired: desired.size, lastMessageAt });
  // Emit only when connected/joined/desired changed (never per message).
  const emit = () => {
    const h = health();
    const key = `${h.connected}|${h.joined}|${h.desired}`;
    if (key === lastEmitted) return;
    lastEmitted = key;
    opts.onHealth?.(h);
  };

  async function reconcile(): Promise<void> {
    if (!client || !connected) return emit();
    const have = new Set(client.currentChannels.map((c) => c.replace(/^#/, '').toLowerCase()));
    for (const c of have) if (!desired.has(c)) client.part(c);
    for (const c of desired) {
      if (have.has(c)) continue;
      try { await client.join(c); } catch { /* counted as not joined */ }
    }
    emit();
  }

  function handle(channel: string, _user: string, text: string, m: RawChatMessage): void {
    const u = m.userInfo;
    if (!u.userId) return;
    const login = channel.replace(/^#/, '').toLowerCase();
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
      const c = (client = factory([...desired]));
      c.onMessage(handle);
      c.onConnect(() => { connected = true; since = now(); void reconcile(); });
      c.onDisconnect(() => { connected = false; since = now(); emit(); });
      c.connect();
    },
    async stop() {
      const c = client;
      client = null;
      c?.quit();
      if (connected) { connected = false; since = now(); }
      lastEmitted = '';
      opts.onHealth?.(health());
    },
    async setChannels(logins) {
      desired = new Set(logins.map((l) => l.trim().toLowerCase().replace(/^#/, '')).filter(Boolean));
      await reconcile();
    },
    health,
    recent: (login) => [...(buffers.get(login.toLowerCase()) ?? [])],
  };
}
