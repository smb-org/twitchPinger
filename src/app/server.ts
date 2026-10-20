import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import { serveStatic } from '@hono/node-server/serve-static';
import type { ChatMessage } from '../types.ts';
import { SESSION_COOKIE, SESSION_TTL_MS, hashSessionId, newSessionId } from '../api/session.ts';
import type { Service } from './wire.ts';
import type { Repo } from '../db/repo.ts';

const CSP = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'";
const WEB_DIR = fileURLToPath(new URL('../../dist/web', import.meta.url));

/** E2E-only helpers; mounted solely for NODE_ENV=test and READER=fake. */
function testRoutes(svc: Service, repo: Repo, now: () => number): Hono {
  const t = new Hono();
  t.post('/chat', async (c) => {
    const msgs = await c.req.json<ChatMessage[]>();
    for (const m of msgs) svc.fakeReader!.push(m);
    return c.json({ ok: true, pushed: msgs.length });
  });
  t.post('/login-as', async (c) => {
    const b = await c.req.json<{ userId: string; login: string; isAdmin?: boolean }>();
    if (!repo.getUser(b.userId)) repo.createUser({ id: b.userId, login: b.login, displayName: b.login, isAdmin: !!b.isAdmin, invitedBy: null, now: now() });
    const sid = newSessionId();
    repo.insertSession(hashSessionId(sid), b.userId, now(), now() + SESSION_TTL_MS, []);
    setCookie(c, SESSION_COOKIE, sid, { httpOnly: true, secure: false, sameSite: 'Lax', path: '/', maxAge: SESSION_TTL_MS / 1000 });
    svc.onConfigChanged();
    return c.json({ ok: true });
  });
  return t;
}

export function createServer(svc: Service, repo: Repo, opts: { env: Record<string, string | undefined>; webDir?: string; now?: () => number }): Hono {
  const webDir = opts.webDir ?? WEB_DIR;
  const root = new Hono();

  root.use('*', async (c, next) => {
    await next();
    c.res.headers.set('Content-Security-Policy', CSP);
    c.res.headers.set('X-Content-Type-Options', 'nosniff');
    c.res.headers.set('Referrer-Policy', 'same-origin');
  });

  if (opts.env.NODE_ENV === 'test' && svc.fakeReader) root.route('/api/test', testRoutes(svc, repo, opts.now ?? Date.now));
  root.route('/', svc.api);

  root.use('*', serveStatic({ root: relative(process.cwd(), webDir) || '.' }));
  root.get('*', (c) => {
    if (c.req.path.startsWith('/api/')) return c.json({ error: { code: 'not_found', message: 'Nicht gefunden.' } }, 404);
    try { return c.html(readFileSync(`${webDir}/index.html`, 'utf8')); } catch { return c.text('Web-App nicht gebaut.', 503); }
  });
  return root;
}
