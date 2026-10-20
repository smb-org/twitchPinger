import type { ChatMessage, ReaderHealth } from '../types.ts';
import type { Reader } from './reader.ts';

export interface FakeReader extends Reader {
  push(msg: ChatMessage): void;
  setConnected(connected: boolean): void;
}

export function createFakeReader(opts: { onMessage: (msg: ChatMessage) => void; onHealth?: (h: ReaderHealth) => void; now?: () => number; bufferSize?: number }): FakeReader {
  const now = opts.now ?? Date.now;
  const cap = opts.bufferSize ?? 500;
  let desired = new Set<string>();
  let connected = true;
  let since = now();
  let lastMessageAt: number | null = null;
  const buffers = new Map<string, ChatMessage[]>();
  const health = (): ReaderHealth => ({ connected, since, joined: connected ? desired.size : 0, desired: desired.size, lastMessageAt });
  const emit = () => opts.onHealth?.(health());
  return {
    async start() { emit(); },
    async stop() {},
    async setChannels(logins) {
      desired = new Set(logins.map((l) => l.trim().toLowerCase()).filter(Boolean));
      emit();
    },
    health,
    recent: (login) => [...(buffers.get(login.toLowerCase()) ?? [])],
    push(msg) {
      lastMessageAt = msg.receivedAt;
      const buf = buffers.get(msg.channel) ?? [];
      buffers.set(msg.channel, buf);
      buf.push(msg);
      if (buf.length > cap) buf.shift();
      opts.onMessage(msg);
    },
    setConnected(c) {
      if (c === connected) return;
      connected = c;
      since = now();
      emit();
    },
  };
}
