import { DatabaseSync } from 'node:sqlite';

// Each entry migrates from user_version i to i+1.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY, login TEXT NOT NULL, display_name TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0, locked INTEGER NOT NULL DEFAULT 0,
    invited_by TEXT, created_at INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    id_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, follows_json TEXT NOT NULL DEFAULT '[]'
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE TABLE invites (
    id TEXT PRIMARY KEY, code_hash TEXT NOT NULL UNIQUE,
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
    used_by TEXT, used_at INTEGER, revoked INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE channels (
    id TEXT PRIMARY KEY, login TEXT NOT NULL, display_name TEXT NOT NULL, added_at INTEGER NOT NULL
  );
  CREATE TABLE user_channels (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, channel_id)
  );
  CREATE TABLE rules (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
    matcher_json TEXT NOT NULL, sender_json TEXT NOT NULL, burst_json TEXT NOT NULL,
    cooldown_sec INTEGER NOT NULL, channel_ids_json TEXT NOT NULL, target_ids_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX rules_owner ON rules(owner_id);
  CREATE TABLE targets (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, name TEXT NOT NULL, url TEXT NOT NULL, token TEXT,
    fail_count INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'ok'
  );
  CREATE INDEX targets_owner ON targets(owner_id);
  CREATE TABLE last_fired (
    rule_id TEXT NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    ts INTEGER NOT NULL, PRIMARY KEY (rule_id, channel_id)
  );
  -- No chat text and no third-party user ids here, by design.
  CREATE TABLE hit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, rule_id TEXT NOT NULL, channel_id TEXT NOT NULL,
    count INTEGER NOT NULL, fired_at INTEGER NOT NULL, sent_ts INTEGER,
    results_json TEXT NOT NULL DEFAULT '[]'
  );
  CREATE INDEX hit_log_rule ON hit_log(rule_id, fired_at);
  `,
];

export function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let v = row.user_version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  return db;
}
