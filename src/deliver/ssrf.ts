import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import type { TargetKind } from '../types.ts';

function v4ToInt(ip: string): number {
  const p = ip.split('.').map(Number);
  return ((p[0]! << 24) | (p[1]! << 16) | (p[2]! << 8) | p[3]!) >>> 0;
}

// [base, prefix length]
const V4_BLOCKED: [string, number][] = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];

function isPublicV4(ip: string): boolean {
  const n = v4ToInt(ip);
  return !V4_BLOCKED.some(([base, len]) => {
    const mask = (0xffffffff << (32 - len)) >>> 0;
    return (n & mask) === (v4ToInt(base) & mask);
  });
}

/** Parses an IPv6 literal into 8 16-bit groups (embedded dotted IPv4 supported). */
function parseV6(ip: string): number[] {
  let s = ip.split('%')[0]!;
  const dot = s.lastIndexOf('.');
  if (dot !== -1) {
    const colon = s.lastIndexOf(':');
    const n = v4ToInt(s.slice(colon + 1));
    s = `${s.slice(0, colon + 1)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const fill = s.includes('::') ? new Array(8 - h.length - t.length).fill('0') : [];
  return [...h, ...fill, ...t].map((g) => parseInt(g, 16));
}

function isPublicV6(ip: string): boolean {
  const g = parseV6(ip);
  const embedded = () => `${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`;
  const zeros = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (zeros(8) || (zeros(7) && g[7] === 1)) return false; // :: and ::1
  if (zeros(6)) return false; // ::/96 IPv4-compatible
  if (zeros(5) && g[5] === 0xffff) return isPublicV4(embedded()); // ::ffff:0:0/96
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPublicV4(embedded()); // 64:ff9b::/96
  if (g[0] === 0x100 && g[1] === 0 && g[2] === 0 && g[3]! <= 1) return false; // 100::/64 and 100:0:0:1::/64
  if (g[0] === 0x2001 && (g[1]! < 0x200 || g[1] === 0xdb8)) return false; // 2001::/23, docs
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return false; // 64:ff9b:1::/48
  if (g[0] === 0x2002) return false; // 6to4
  if ((g[0]! & 0xffc0) === 0xfec0) return false; // fec0::/10 site-local
  if ((g[0]! & 0xfe00) === 0xfc00) return false; // fc00::/7
  if ((g[0]! & 0xffc0) === 0xfe80) return false; // fe80::/10
  if ((g[0]! & 0xff00) === 0xff00) return false; // ff00::/8
  if ((g[0]! & 0xe000) !== 0x2000) return false; // IPv6 global-unicast allocation space is currently 2000::/3
  if (g[0] === 0x3fff && (g[1]! & 0xf000) === 0) return false; // 3fff::/20 documentation
  return true;
}

export function isPublicAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return isPublicV4(ip);
  if (v === 6) return isPublicV6(ip);
  return false;
}

export function checkTargetUrl(kind: TargetKind, url: string): { ok: true } | { ok: false; error: string } {
  let u: URL;
  try { u = new URL(url); } catch { return { ok: false, error: 'Ungültige URL.' }; }
  if (u.protocol !== 'https:') return { ok: false, error: 'Nur https-URLs sind erlaubt.' };
  if (u.username || u.password) return { ok: false, error: 'Zugangsdaten in der URL sind nicht erlaubt.' };
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (isIP(host) && !isPublicAddress(host)) return { ok: false, error: 'Diese Adresse ist nicht öffentlich erreichbar.' };
  if (kind === 'discord') {
    const okHost = ['discord.com', 'discordapp.com'].some((d) => host === d || host.endsWith(`.${d}`));
    if (!okHost) return { ok: false, error: 'Discord-Webhooks müssen auf discord.com oder discordapp.com zeigen.' };
    if (!u.pathname.startsWith('/api/webhooks/')) return { ok: false, error: 'Der Pfad muss mit /api/webhooks/ beginnen.' };
  }
  return { ok: true };
}

export interface PostInit { headers: Record<string, string>; body: string; timeoutMs: number }
export type PostResult = { status: number; body: string; retryAfter?: string };
const MAX_BODY = 64 * 1024;

function err(code: string, msg: string): Error {
  return Object.assign(new Error(msg), { code });
}

function request(url: string, init: PostInit, lookup: unknown, mod: typeof https | typeof http): Promise<PostResult> {
  return new Promise((resolve, reject) => {
    let req: http.ClientRequest | undefined;
    let settled = false;
    const timer = setTimeout(() => {
      const e = err('TIMEOUT', 'Zeitüberschreitung');
      finishReject(e);
      req?.destroy(e);
    }, init.timeoutMs);
    const finishReject = (e: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e);
    };
    const finishResolve = (r: PostResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    try {
      req = mod.request(url, {
        method: 'POST',
        headers: { ...init.headers, 'Content-Length': Buffer.byteLength(init.body) },
        lookup,
      } as https.RequestOptions, (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          if (size >= MAX_BODY) return;
          chunks.push(c.subarray(0, MAX_BODY - size));
          size += c.length;
        });
        res.on('end', () => {
          const retryAfter = res.headers['retry-after'];
          finishResolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), ...(retryAfter ? { retryAfter: Array.isArray(retryAfter) ? retryAfter[0] : retryAfter } : {}) });
        });
        res.on('error', finishReject);
        res.on('aborted', () => finishReject(err('RESPONSE_ABORTED', 'Antwort wurde abgebrochen')));
      });
      req.on('error', finishReject);
      req.end(init.body);
    } catch (e) {
      finishReject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

/** POST over https; resolves DNS itself and refuses any non-public address. Never follows redirects. */
export function safePost(url: string, init: PostInit, deps: { lookup?: typeof dns.lookup } = {}): Promise<PostResult> {
  const doLookup = deps.lookup ?? dns.lookup;
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return Promise.reject(err('SSRF_BLOCKED', 'Nur https erlaubt'));
    host = u.hostname.replace(/^\[|\]$/g, '');
  } catch { return Promise.reject(err('SSRF_BLOCKED', 'Ungültige URL')); }
  if (isIP(host) && !isPublicAddress(host)) return Promise.reject(err('SSRF_BLOCKED', 'Adresse nicht öffentlich'));
  const lookup = (hostname: string, opts: dns.LookupOptions, cb: (...a: unknown[]) => void) => {
    (doLookup as (h: string, o: dns.LookupOptions, cb: (e: Error | null, a: dns.LookupAddress[]) => void) => void)(
      hostname, { all: true }, (e, addrs) => {
        if (e) return cb(e);
        if (!addrs.length || addrs.some((a) => !isPublicAddress(a.address))) {
          return cb(err('SSRF_BLOCKED', 'Adresse nicht öffentlich'));
        }
        if (opts.all) return cb(null, addrs);
        cb(null, addrs[0]!.address, addrs[0]!.family);
      });
  };
  return request(url, init, lookup, https);
}

/** POST for operator-configured URLs (http allowed, private addresses allowed). Never use for user input. */
export function trustedPost(url: string, init: PostInit, deps: { lookup?: typeof dns.lookup } = {}): Promise<PostResult> {
  return request(url, init, deps.lookup, url.startsWith('http:') ? http : https);
}
