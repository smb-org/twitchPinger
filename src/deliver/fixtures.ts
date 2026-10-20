import type { Hit } from '../types.ts';

export const hit = (o: Partial<Hit> = {}): Hit => ({
  ruleId: 'r', ruleName: 'Play', ownerId: 'u', channelId: 'c', channel: 'chan', count: 5, firedAt: 0,
  sample: { channel: 'chan', channelId: 'c', userId: '1', login: 'bob', displayName: 'Bob', text: '!play', badges: [], sentAt: 0, receivedAt: 0 },
  ...o,
});
