import { createHash, createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

export interface SignInput {
  method: string; host: string; path: string; query?: Record<string, string>;
  /** Extra headers to sign (lowercase names); host, x-amz-date and x-amz-content-sha256 are added. */
  headers?: Record<string, string>;
  payload: string | Uint8Array; accessKeyId: string; secretAccessKey: string; region: string; service: string; date: Date;
}

const sha256hex = (d: string | Uint8Array): string => createHash('sha256').update(d).digest('hex');
const hmac = (k: string | Buffer, d: string): Buffer => createHmac('sha256', k).update(d).digest();
const enc = (s: string): string => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

/** AWS Signature V4 for S3-style requests (path encoded once). Returns the headers to send. */
export function signV4(i: SignInput): Record<string, string> {
  const amzDate = i.date.toISOString().replace(/[-:]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256hex(i.payload);
  const headers: Record<string, string> = { ...i.headers, host: i.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const names = Object.keys(headers).sort();
  const canonHeaders = names.map((n) => `${n}:${headers[n].trim().replace(/\s+/g, ' ')}\n`).join('');
  const signedHeaders = names.join(';');
  const canonQuery = Object.entries(i.query ?? {}).map(([k, v]) => [enc(k), enc(v)]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('&');
  const canonPath = i.path.split('/').map(enc).join('/');
  const canonical = [i.method, canonPath, canonQuery, canonHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${day}/${i.region}/${i.service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac('AWS4' + i.secretAccessKey, day), i.region), i.service), 'aws4_request');
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${i.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return headers;
}

export interface R2Config { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string }

/** Cloudflare R2 (S3 API): upload a file and keep the newest `keep` objects with the prefix. */
export function createR2(cfg: R2Config, fetchFn: typeof fetch = fetch, now: () => number = Date.now) {
  const enabled = Boolean(cfg.accountId && cfg.accessKeyId && cfg.secretAccessKey && cfg.bucket);
  const host = `${cfg.accountId}.r2.cloudflarestorage.com`;

  async function call(method: string, key: string, query: Record<string, string>, payload: Uint8Array | string = ''): Promise<Response> {
    const path = `/${cfg.bucket}${key ? '/' + key : ''}`;
    const headers = signV4({ method, host, path, query, payload, accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, region: 'auto', service: 's3', date: new Date(now()) });
    delete headers.host;
    const qs = new URLSearchParams(query).toString();
    const body = method !== 'PUT' ? undefined : typeof payload === 'string' ? payload : new Uint8Array(payload).buffer;
    const res = await fetchFn(`https://${host}${path.split('/').map(enc).join('/')}${qs ? '?' + qs : ''}`, { method, headers, body });
    if (!res.ok) throw new Error(`r2 ${method} ${key || '/'} failed: ${res.status}`);
    return res;
  }

  return {
    enabled,
    /** Uploads the file under its basename, then prunes `prefix*` objects beyond the newest `keep`. */
    async uploadAndPrune(file: string, prefix = 'marble-', keep = 14): Promise<void> {
      if (!enabled) return;
      await call('PUT', basename(file), {}, await readFile(file));
      const xml = await (await call('GET', '', { 'list-type': '2', prefix })).text();
      const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]).sort().reverse();
      for (const k of keys.slice(keep)) await call('DELETE', k, {});
    },
  };
}
