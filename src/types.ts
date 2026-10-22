/** Chat badge roles relevant for sender filtering. */
export type Badge = 'broadcaster' | 'moderator' | 'vip' | 'subscriber';
/** A single Twitch chat message as delivered by the reader. */
export interface ChatMessage { channel: string; channelId: string; userId: string; login: string; displayName: string; text: string; badges: Badge[]; sentAt: number; receivedAt: number; }
/** How a rule pattern is matched against message text. */
export type MatchMode = 'contains' | 'word' | 'prefix' | 'regex';
/** Text matching configuration of a rule. */
export interface Matcher { mode: MatchMode; pattern: string; caseSensitive: boolean; }
/** Restricts which senders count; `exclude` inverts the filter. */
export interface SenderFilter { badges: Badge[]; logins: string[]; exclude: boolean; }
/** Fire only after `threshold` hits within `windowSec`. */
export interface Burst { threshold: number; windowSec: number; countBy: 'users' | 'messages'; }
/** A user-defined notification rule. */
export interface Rule { id: string; ownerId: string; name: string; enabled: boolean; matcher: Matcher; sender: SenderFilter; burst: Burst; cooldownSec: number; skipIfSelf: boolean; channelIds: string[]; targetIds: string[]; updatedAt: number; }
/** Delivery channel type. */
export type TargetKind = 'discord' | 'discord_dm' | 'ntfy';
/** A delivery destination owned by a user. */
export interface Target { id: string; ownerId: string; kind: TargetKind; name: string; url: string; token: string | null; failCount: number; status: 'ok' | 'failing'; lastError?: string | null; }
/** A fired rule, ready for delivery. */
export interface Hit {
  ruleId: string; ruleName: string; ownerId: string; channelId: string; channel: string;
  channelDisplayName: string; channelAvatar: string | null;
  count: number; burst: Burst; cooldownSec: number; sample: ChatMessage; firedAt: number;
}
/** Snapshot of the chat reader connection state. */
export interface ReaderHealth { connected: boolean; since: number; joined: number; desired: number; lastMessageAt: number | null; }
/** Default operational limits (overridable via env). */
export const LIMITS_DEFAULTS = { MAX_ACCOUNTS: 100, MAX_CHANNELS_TOTAL: 50, MAX_CHANNELS_PER_USER: 10, MAX_RULES_PER_USER: 20, MAX_INVITEES_PER_USER: 5, MIN_COOLDOWN_SEC: 30, REGEX_MAX_LEN: 200 } as const;
