import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

/** VACUUM INTO dir/marble-YYYYMMDD.db (overwrites same-day file), keeps the newest `keep`. */
export function vacuumInto(db: DatabaseSync, dir: string, keep = 7, now = new Date()): string {
  mkdirSync(dir, { recursive: true });
  const stamp = now.toISOString().slice(0, 10).replaceAll('-', '');
  const path = join(dir, `marble-${stamp}.db`);
  rmSync(path, { force: true });
  db.prepare('VACUUM INTO ?').run(path);
  const old = readdirSync(dir).filter((f) => /^marble-\d{8}\.db$/.test(f)).sort().reverse().slice(keep);
  for (const f of old) rmSync(join(dir, f), { force: true });
  return path;
}
