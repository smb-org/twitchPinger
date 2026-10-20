import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../db/db.ts';
import { createRepo } from '../db/repo.ts';
import { loadConfig } from '../api/config.ts';
import { createTwitch } from '../api/twitch.ts';
import { createService } from './wire.ts';
import { createServer } from './server.ts';

function build(env: Record<string, string | undefined>) {
  const web = mkdtempSync(join(tmpdir(), 'web-'));
  writeFileSync(join(web, 'index.html'), '<html>spa</html>');
  const config = loadConfig({ PUBLIC_URL: 'http://m.test', SESSION_SECRET: 'x'.repeat(32), DATA_DIR: web, ...env });
  const db = openDb(':memory:');
  const repo = createRepo(db);
  const twitch = createTwitch({ clientId: '', clientSecret: '', authBase: 'http://a', helixBase: 'http://h' });
  const svc = createService({ config, db, repo, twitch, log: () => {} });
  return createServer(svc, repo, { env, webDir: web });
}

test('SPA fallback, API 404 and security headers', async () => {
  const app = build({ READER: 'fake' });
  const r = await app.request('/onboarding');
  assert.equal(await r.text(), '<html>spa</html>');
  assert.match(r.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  const h = await app.request('/api/health');
  assert.equal((await h.json() as any).ok, true);
  assert.equal((await app.request('/api/nope')).status, 401); // auth guard before routing
});

test('test routes exist only for NODE_ENV=test + READER=fake', async () => {
  const post = (app: ReturnType<typeof build>, path: string, body: unknown) =>
    app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const on = build({ NODE_ENV: 'test', READER: 'fake' });
  assert.equal((await post(on, '/api/test/chat', [])).status, 200);
  const login = await post(on, '/api/test/login-as', { userId: '9', login: 'e2e', isAdmin: true });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const me = await on.request('/api/me', { headers: { cookie } });
  assert.equal(me.status, 200);
  for (const env of [{ NODE_ENV: 'test', READER: 'twurple' }, { NODE_ENV: 'production', READER: 'fake', PUBLIC_URL: 'http://m.test', SESSION_SECRET: 'x'.repeat(32), TWITCH_CLIENT_ID: 'a', TWITCH_CLIENT_SECRET: 'b', ADMIN_TWITCH_USER_ID: '1', NTFY_BASE_URL: 'http://n' }, { READER: 'fake' }]) {
    const off = build(env);
    for (const p of ['/api/test/chat', '/api/test/login-as']) assert.notEqual((await post(off, p, [])).status, 200, `${p} ${JSON.stringify(env)}`);
  }
});
