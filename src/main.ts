import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { loadConfig } from './api/config.ts';
import { createTwitch } from './api/twitch.ts';
import { openDb } from './db/db.ts';
import { createRepo } from './db/repo.ts';
import { createService } from './app/wire.ts';
import { createServer } from './app/server.ts';

const config = loadConfig(process.env);
mkdirSync(config.dataDir, { recursive: true });
const db = openDb(join(config.dataDir, 'marble.db'));
const repo = createRepo(db);
const twitch = createTwitch({ clientId: config.clientId, clientSecret: config.clientSecret, authBase: config.authBase, helixBase: config.helixBase });
const svc = createService({ config, db, repo, twitch });
const app = createServer(svc, repo, { env: process.env });

await svc.start();
const server = serve({ fetch: app.fetch, port: config.port }, (i) => console.log(`listening on :${i.port} (reader=${config.reader})`));

let stopping = false;
async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  setTimeout(() => process.exit(1), 10_000).unref();
  server.close();
  await svc.stop().catch((e) => console.error('stop failed', e));
  db.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));
process.on('uncaughtException', (e) => { console.error('uncaughtException', e); process.exit(1); });
