import type { DatabaseSync } from 'node:sqlite';
import type { ChatMessage, Hit, ReaderHealth, Target, TargetKind } from '../types.ts';
import type { Repo } from '../db/repo.ts';
import type { Twitch } from './twitch.ts';
import type { DiscordOAuth } from './discord.ts';

/** The subset of the config the API reads. loadConfig() returns a superset. */
export interface ApiConfig {
  publicUrl: string;
  sessionSecret: string;
  adminTwitchUserId: string;
  ntfyBaseUrl: string;
  discordAvailable: boolean;
  /** Local dev/tests over plain http: cookies without Secure. */
  insecureCookies: boolean;
  limits: {
    MAX_ACCOUNTS: number; MAX_CHANNELS_TOTAL: number; MAX_CHANNELS_PER_USER: number; MAX_RULES_PER_USER: number;
    MAX_OPEN_INVITES: number; INVITE_TTL_DAYS: number; MIN_COOLDOWN_SEC: number; REGEX_MAX_LEN: number;
  };
}

export interface ReaderPort {
  health(): ReaderHealth;
  recent(login: string): ChatMessage[];
}

export type RegexResult = { ok: true } | { ok: false; error: string };

export interface DelivererPort {
  /** Sends a test notification to the target (looked up by the deliverer or passed in full). */
  sendTest(target: { id: string; ownerId: string; kind: TargetKind; url: string; token: string | null; name: string }): Promise<{ ok: boolean; error?: string; errorCode?: number }>;
  /** Sends a synthetic rule hit directly through normal formatting and delivery, without recording delivery state. */
  sendRuleTest(target: Target, hit: Hit): Promise<{ ok: boolean; error?: string; errorCode?: number }>;
}

export interface ApiDeps {
  config: ApiConfig;
  db: DatabaseSync;
  repo: Repo;
  twitch: Twitch;
  discord: DiscordOAuth;
  reader: ReaderPort;
  deliverer: DelivererPort;
  validateRegex(pattern: string): RegexResult;
  /** Returns an error message (German, user-facing) or null if the URL is acceptable. */
  checkTargetUrl(kind: TargetKind, url: string): string | null | Promise<string | null>;
  /** Called after every mutation that affects channels, rules or users. */
  onConfigChanged(immediate?: boolean): void;
  live?(ruleId: string): { channelId: string; inWindow: number; cooling: boolean; tally: { since: number; mentions: number; chatters: number } | null }[];
  /** Clock in ms, injectable for tests. */
  now?(): number;
}
