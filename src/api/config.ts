import { LIMITS_DEFAULTS } from '../types.ts';
import type { ApiConfig } from './deps.ts';

export interface Config extends ApiConfig {
  port: number;
  dataDir: string;
  clientId: string;
  clientSecret: string;
  authBase: string;
  helixBase: string;
  discordClientId: string;
  discordClientSecret: string;
  discordBotToken: string;
  /** OAuth host override for local integration tests; production defaults to Discord. */
  discordBaseUrl: string;
  adminNtfyUrl: string;
  adminNtfyToken: string;
  /** Publisher token for the own ntfy server; not stored per target. */
  ntfyAppToken: string;
  reader: 'twurple' | 'fake';
  production: boolean;
  r2: { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string };
}

const REQUIRED = ['PUBLIC_URL', 'SESSION_SECRET', 'TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET', 'ADMIN_TWITCH_USER_ID', 'NTFY_BASE_URL'] as const;

export function loadConfig(env: Record<string, string | undefined>): Config {
  const production = env.NODE_ENV === 'production';
  if (production) {
    const missing = REQUIRED.filter((k) => !env[k]);
    if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    if (env.SESSION_SECRET!.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
  }
  const num = (k: 'MAX_ACCOUNTS' | 'MAX_CHANNELS_TOTAL' | 'MAX_CHANNELS_PER_USER'): number => {
    const raw = env[k];
    if (raw === undefined || raw === '') return LIMITS_DEFAULTS[k];
    const v = Number(raw);
    if (!Number.isInteger(v) || v < 0) throw new Error(`${k} must be a non-negative integer`);
    return v;
  };
  const str = (k: string, d = ''): string => env[k] || d;
  const reader = str('READER', 'twurple');
  if (reader !== 'twurple' && reader !== 'fake') throw new Error('READER must be twurple or fake');
  return {
    port: Number(str('PORT', '12080')),
    publicUrl: str('PUBLIC_URL').replace(/\/+$/, ''),
    version: str('APP_VERSION', 'dev'),
    dataDir: str('DATA_DIR', '/data'),
    sessionSecret: str('SESSION_SECRET'),
    clientId: str('TWITCH_CLIENT_ID'),
    clientSecret: str('TWITCH_CLIENT_SECRET'),
    discordAvailable: Boolean(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET && env.DISCORD_BOT_TOKEN),
    discordClientId: str('DISCORD_CLIENT_ID'),
    discordClientSecret: str('DISCORD_CLIENT_SECRET'),
    discordBotToken: str('DISCORD_BOT_TOKEN'),
    discordBaseUrl: (production ? 'https://discord.com' : str('DISCORD_BASE_URL', 'https://discord.com')).replace(/\/+$/, ''),
    authBase: str('TWITCH_AUTH_BASE', 'https://id.twitch.tv').replace(/\/+$/, ''),
    helixBase: str('TWITCH_HELIX_BASE', 'https://api.twitch.tv/helix').replace(/\/+$/, ''),
    adminTwitchUserId: str('ADMIN_TWITCH_USER_ID'),
    adminNtfyUrl: str('ADMIN_NTFY_URL'),
    adminNtfyToken: str('ADMIN_NTFY_TOKEN'),
    ntfyBaseUrl: str('NTFY_BASE_URL').replace(/\/+$/, ''),
    ntfyAppToken: str('NTFY_APP_TOKEN', str('ADMIN_NTFY_TOKEN')),
    insecureCookies: env.INSECURE_COOKIES === '1' || env.NODE_ENV === 'test',
    reader,
    production,
    limits: {
      MAX_ACCOUNTS: num('MAX_ACCOUNTS'), MAX_CHANNELS_TOTAL: num('MAX_CHANNELS_TOTAL'), MAX_CHANNELS_PER_USER: num('MAX_CHANNELS_PER_USER'),
      // Only the three count limits are env-configurable.
      MAX_RULES_PER_USER: LIMITS_DEFAULTS.MAX_RULES_PER_USER, MAX_OPEN_INVITES: LIMITS_DEFAULTS.MAX_OPEN_INVITES, INVITE_TTL_DAYS: LIMITS_DEFAULTS.INVITE_TTL_DAYS,
      MIN_COOLDOWN_SEC: LIMITS_DEFAULTS.MIN_COOLDOWN_SEC, REGEX_MAX_LEN: LIMITS_DEFAULTS.REGEX_MAX_LEN,
    },
    r2: { accountId: str('R2_ACCOUNT_ID'), accessKeyId: str('R2_ACCESS_KEY_ID'), secretAccessKey: str('R2_SECRET_ACCESS_KEY'), bucket: str('R2_BUCKET') },
  };
}
