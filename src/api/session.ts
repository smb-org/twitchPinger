import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'mn_session';
export const STATE_COOKIE = 'mn_state';
export const SESSION_TTL_MS = 30 * 86_400_000;
const STATE_TTL_MS = 10 * 60_000;

export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
export const newSessionId = (): string => randomBytes(32).toString('base64url');
export const hashSessionId = sha256;
export const randomId = (): string => randomBytes(16).toString('hex');

const mac = (secret: string, data: string): string => createHmac('sha256', secret).update(data).digest('base64url');

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export interface OAuthState { state: string; invite: string | null }

/** Signed, short-lived OAuth state cookie value: base64url(json).hmac */
export function signState(secret: string, invite: string | null, now: number): { state: string; cookie: string } {
  const state = randomBytes(24).toString('base64url');
  const body = Buffer.from(JSON.stringify({ s: state, i: invite, e: now + STATE_TTL_MS })).toString('base64url');
  return { state, cookie: `${body}.${mac(secret, body)}` };
}

/** Verifies signature, expiry and that the state parameter equals the cookie's. */
export function verifyState(secret: string, cookie: string | undefined, stateParam: string | undefined, now: number): OAuthState | null {
  if (!cookie || !stateParam) return null;
  const [body, sig, extra] = cookie.split('.');
  if (!body || !sig || extra !== undefined || !safeEqual(sig, mac(secret, body))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (typeof p.s !== 'string' || p.e <= now || !safeEqual(p.s, stateParam)) return null;
    return { state: p.s, invite: typeof p.i === 'string' ? p.i : null };
  } catch {
    return null;
  }
}
