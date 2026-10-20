import type { Badge, MatchMode, Rule, ReaderHealth, TargetKind } from '../../src/types.ts';
import { navigate, isPublicPath } from './router.tsx';
import { store } from './store.ts';

export class ApiError extends Error {
  status: number;
  code: string;
  field?: string;
  constructor(status: number, code: string, message: string, field?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch('/api' + path, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network', 'Der Dienst ist nicht erreichbar.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error;
    if (!e && res.status >= 500) throw new ApiError(0, 'network', 'Der Dienst ist nicht erreichbar.');
    if (res.status === 401 && !isPublicPath(location.pathname)) {
      meStore.set(null);
      navigate('/login', true);
    }
    throw new ApiError(res.status, e?.code ?? `http_${res.status}`, e?.message ?? `Fehler (${res.status}).`, e?.field);
  }
  return data as T;
}
export const errText = (e: unknown) => (e instanceof ApiError ? e.message : 'Unbekannter Fehler.');

export interface Limits { MAX_ACCOUNTS: number; MAX_CHANNELS_TOTAL: number; MAX_CHANNELS_PER_USER: number; MAX_RULES_PER_USER: number; MAX_OPEN_INVITES: number; INVITE_TTL_DAYS: number; MIN_COOLDOWN_SEC: number; REGEX_MAX_LEN: number }
export interface Channel { id: string; login: string; displayName: string }
export interface Me {
  user: { id: string; login: string; displayName: string };
  isAdmin: boolean;
  limits: Limits;
  counts: { channels: number; rules: number; targets: number; openInvites: number };
  onboarding: { hasChannel: boolean; hasTarget: boolean; hasRule: boolean };
  discordDm: { available: boolean; username: string | null };
  followSuggestions: Channel[];
}
export const meStore = store<Me | null>(null);
export const MAX_TARGETS = 10; // server constant, not part of /me limits

export interface Health { ok: boolean; reader: ReaderHealth }
export interface Fired { channelId: string; channel: string | null; ts: number; cooldownUntil: number }
export type OverviewRule = Rule & { lastFired: Fired[]; cooldownUntil: number | null };
export interface Ping { hitId: number; firedAt: number; ruleId: string; ruleName: string; channelId: string; channel: string | null; count: number; sentTs: number | null; hasTargets: boolean; results: { targetId: string; ok: boolean; ts: number; targetName: string | null }[] }
export interface TargetDto { id: string; kind: TargetKind; name: string; url: string; failCount: number; status: 'ok' | 'failing' | 'unlinked' | 'unavailable'; failureHint: string | null }
export interface InviteDto { id: string; createdAt: number; expiresAt: number; usedAt: number | null; usedBy: string | null; status: 'open' | 'used' | 'revoked' | 'expired' }
export interface AdminUser { id: string; login: string; displayName: string; isAdmin: boolean; locked: boolean; invitedBy: string | null; createdAt: number; ruleCount: number; channelCount: number }
export interface PreviewMsg { sentAt: number; userId: string; login: string; displayName: string; text: string; badges: Badge[] }
export type { Rule, MatchMode, Badge };
