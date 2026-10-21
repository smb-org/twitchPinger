import type { ChatMessage, Rule } from '../types.ts';

export function msg(text: string, o: Partial<ChatMessage> = {}): ChatMessage {
  return { channel: 'sbx_tv', channelId: 'c1', userId: 'u1', login: 'u1', displayName: 'U1', text, badges: [], sentAt: 0, receivedAt: 0, ...o };
}

export function rule(o: Partial<Rule> = {}): Rule {
  return {
    id: 'r1', ownerId: 'o1', name: 'Play', enabled: true,
    matcher: { mode: 'prefix', pattern: '!play', caseSensitive: false },
    sender: { badges: [], logins: [], exclude: false },
    burst: { threshold: 5, windowSec: 60, countBy: 'users' },
    cooldownSec: 300, skipIfSelf: false, channelIds: ['c1'], targetIds: [], updatedAt: 1, ...o,
  };
}
