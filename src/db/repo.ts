import type { DatabaseSync } from 'node:sqlite';
import type { Rule, Target, TargetKind } from '../types.ts';

export interface UserRow { id: string; login: string; displayName: string; isAdmin: boolean; locked: boolean; invitedBy: string | null; createdAt: number }
export interface DiscordLinkRow { userId: string; discordUserId: string; username: string; channelId: string | null }
export interface SessionRow { userId: string; expiresAt: number; follows: FollowSuggestion[] }
export interface FollowSuggestion { id: string; login: string; displayName: string }
export interface InviteRow { id: string; codeHash: string; createdBy: string; createdAt: number; expiresAt: number; usedBy: string | null; usedAt: number | null; revoked: boolean }
export interface ChannelRow { id: string; login: string; displayName: string; avatarUrl: string | null }
export interface DeliveryResult { targetId: string; ok: boolean; ts: number }
export interface Ping { hitId: number; firedAt: number; ruleId: string; ruleName: string; channelId: string; channel: string | null; count: number; sentTs: number | null; hasTargets: boolean; results: (DeliveryResult & { targetName: string | null })[] }
export type RuleInput = Omit<Rule, 'updatedAt'>;

type Row = Record<string, any>;

const bool = (v: unknown): boolean => v === 1;
const user = (r: Row): UserRow => ({ id: r.id, login: r.login, displayName: r.display_name, isAdmin: bool(r.is_admin), locked: bool(r.locked), invitedBy: r.invited_by, createdAt: r.created_at });
const invite = (r: Row): InviteRow => ({ id: r.id, codeHash: r.code_hash, createdBy: r.created_by, createdAt: r.created_at, expiresAt: r.expires_at, usedBy: r.used_by, usedAt: r.used_at, revoked: bool(r.revoked) });
const channel = (r: Row): ChannelRow => ({ id: r.id, login: r.login, displayName: r.display_name, avatarUrl: r.avatar_url ?? null });
const rule = (r: Row): Rule => ({
  id: r.id, ownerId: r.owner_id, name: r.name, enabled: bool(r.enabled),
  matcher: JSON.parse(r.matcher_json), sender: JSON.parse(r.sender_json), burst: JSON.parse(r.burst_json),
  cooldownSec: r.cooldown_sec, channelIds: JSON.parse(r.channel_ids_json), targetIds: JSON.parse(r.target_ids_json), updatedAt: r.updated_at,
});
const target = (r: Row): Target => ({ id: r.id, ownerId: r.owner_id, kind: r.kind as TargetKind, name: r.name, url: r.url, token: r.token, failCount: r.fail_count, status: r.status, lastError: r.last_error ?? null });

export function createRepo(db: DatabaseSync) {
  const all = (sql: string, ...p: any[]): Row[] => db.prepare(sql).all(...p) as Row[];
  const get = (sql: string, ...p: any[]): Row | undefined => db.prepare(sql).get(...p) as Row | undefined;
  const run = (sql: string, ...p: any[]) => db.prepare(sql).run(...p);
  const n = (sql: string, ...p: any[]): number => (get(sql, ...p) as { n: number }).n;
  const tx = <T>(fn: () => T): T => {
    db.exec('BEGIN');
    try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
  };
  const writeRule = (r: RuleInput, now: number): Rule => {
    run(`INSERT INTO rules (id, owner_id, name, enabled, matcher_json, sender_json, burst_json, cooldown_sec, channel_ids_json, target_ids_json, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, enabled = excluded.enabled, matcher_json = excluded.matcher_json,
      sender_json = excluded.sender_json, burst_json = excluded.burst_json, cooldown_sec = excluded.cooldown_sec,
      channel_ids_json = excluded.channel_ids_json, target_ids_json = excluded.target_ids_json, updated_at = excluded.updated_at`,
      r.id, r.ownerId, r.name, r.enabled ? 1 : 0, JSON.stringify(r.matcher), JSON.stringify(r.sender), JSON.stringify(r.burst), r.cooldownSec,
      JSON.stringify(r.channelIds), JSON.stringify(r.targetIds), now);
    run('DELETE FROM last_fired WHERE rule_id = ?', r.id);
    return { ...r, updatedAt: now };
  };
  const writeTarget = (t: Pick<Target, 'id' | 'ownerId' | 'kind' | 'name' | 'url' | 'token'>) => {
    run(`INSERT INTO targets (id, owner_id, kind, name, url, token) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      name = excluded.name, url = excluded.url, token = excluded.token, fail_count = CASE WHEN url = excluded.url THEN fail_count ELSE 0 END,
      status = CASE WHEN url = excluded.url THEN status ELSE 'ok' END,
      last_error = CASE WHEN url = excluded.url THEN last_error ELSE NULL END`, t.id, t.ownerId, t.kind, t.name, t.url, t.token);
  };

  const repo = {
    tx,

    // users
    getUser: (id: string) => { const r = get('SELECT * FROM users WHERE id = ?', id); return r && user(r); },
    createUser(u: { id: string; login: string; displayName: string; isAdmin: boolean; invitedBy: string | null; now: number }) {
      run('INSERT INTO users (id, login, display_name, is_admin, invited_by, created_at) VALUES (?,?,?,?,?,?)', u.id, u.login, u.displayName, u.isAdmin ? 1 : 0, u.invitedBy, u.now);
    },
    updateUserNames: (id: string, login: string, displayName: string) => { run('UPDATE users SET login = ?, display_name = ? WHERE id = ?', login, displayName, id); },
    getDiscordLink(userId: string): DiscordLinkRow | undefined {
      const r = get('SELECT * FROM discord_links WHERE user_id = ?', userId);
      return r && { userId: r.user_id, discordUserId: r.discord_user_id, username: r.username, channelId: r.channel_id };
    },
    linkDiscordUser(userId: string, discordUserId: string, username: string, now = Date.now()) {
      run(`INSERT INTO discord_links (user_id, discord_user_id, username, linked_at) VALUES (?,?,?,?)
        ON CONFLICT(user_id) DO UPDATE SET discord_user_id = excluded.discord_user_id, username = excluded.username,
        channel_id = CASE WHEN discord_links.discord_user_id = excluded.discord_user_id THEN discord_links.channel_id ELSE NULL END,
        linked_at = excluded.linked_at`, userId, discordUserId, username, now);
    },
    cacheDiscordChannel(userId: string, channelId: string) {
      run('UPDATE discord_links SET channel_id = ? WHERE user_id = ?', channelId, userId);
    },
    unlinkDiscordUser: (userId: string) => Number(run('DELETE FROM discord_links WHERE user_id = ?', userId).changes) > 0,
    countUsers: () => n('SELECT COUNT(*) n FROM users'),
    listUsers() {
      return all(`SELECT u.*, (SELECT COUNT(*) FROM rules WHERE owner_id = u.id) rule_count,
        (SELECT COUNT(*) FROM user_channels WHERE user_id = u.id) channel_count FROM users u ORDER BY u.created_at`)
        .map((r) => ({ ...user(r), ruleCount: r.rule_count as number, channelCount: r.channel_count as number }));
    },
    /** Lock: drop sessions, revoke open invites, disable rules. Nothing else is deleted; invitees stay. */
    lockUser(id: string) {
      tx(() => {
        run('UPDATE users SET locked = 1 WHERE id = ?', id);
        run('DELETE FROM sessions WHERE user_id = ?', id);
        run('UPDATE invites SET revoked = 1 WHERE created_by = ? AND used_by IS NULL', id);
        run('UPDATE rules SET enabled = 0 WHERE owner_id = ?', id);
      });
    },
    unlockUser: (id: string) => { run('UPDATE users SET locked = 0 WHERE id = ?', id); },
    unlockUserWithinChannelLimit(id: string, limit: number): boolean {
      return tx(() => {
        const count = n(`SELECT COUNT(DISTINCT uc.channel_id) n FROM user_channels uc
          JOIN users u ON u.id = uc.user_id WHERE u.locked = 0 OR u.id = ?`, id);
        if (count > limit) return false;
        run('UPDATE users SET locked = 0 WHERE id = ?', id);
        return true;
      });
    },

    // sessions
    insertSession: (idHash: string, userId: string, now: number, expiresAt: number, follows: FollowSuggestion[]) => {
      run('INSERT INTO sessions (id_hash, user_id, created_at, expires_at, follows_json) VALUES (?,?,?,?,?)', idHash, userId, now, expiresAt, JSON.stringify(follows));
    },
    getSession(idHash: string, now: number): SessionRow | undefined {
      const r = get('SELECT * FROM sessions WHERE id_hash = ? AND expires_at > ?', idHash, now);
      return r && { userId: r.user_id, expiresAt: r.expires_at, follows: JSON.parse(r.follows_json) };
    },
    deleteSession: (idHash: string) => { run('DELETE FROM sessions WHERE id_hash = ?', idHash); },
    purgeExpiredSessions: (now: number) => { run('DELETE FROM sessions WHERE expires_at <= ?', now); },

    // invites
    createInvite: (i: { id: string; codeHash: string; createdBy: string; now: number; expiresAt: number }) => {
      run('INSERT INTO invites (id, code_hash, created_by, created_at, expires_at) VALUES (?,?,?,?,?)', i.id, i.codeHash, i.createdBy, i.now, i.expiresAt);
    },
    getInviteByHash: (h: string) => { const r = get('SELECT * FROM invites WHERE code_hash = ?', h); return r && invite(r); },
    listInvites: (userId: string) => all('SELECT * FROM invites WHERE created_by = ? ORDER BY created_at DESC', userId).map(invite),
    countOpenInvites: (userId: string, now: number) =>
      n('SELECT COUNT(*) n FROM invites WHERE created_by = ? AND used_by IS NULL AND revoked = 0 AND expires_at > ?', userId, now),
    /** Returns true if an unused invite of this user was revoked. */
    revokeInvite: (id: string, userId: string) => Number(run('UPDATE invites SET revoked = 1 WHERE id = ? AND created_by = ? AND used_by IS NULL', id, userId).changes) > 0,
    markInviteUsed: (id: string, userId: string, now: number) => { run('UPDATE invites SET used_by = ?, used_at = ? WHERE id = ?', userId, now, id); },

    // channels
    upsertChannel: (c: Omit<ChannelRow, 'avatarUrl'> & { avatarUrl?: string | null }, now: number) => {
      run(`INSERT INTO channels (id, login, display_name, added_at, avatar_url) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
        login = excluded.login, display_name = excluded.display_name, avatar_url = COALESCE(excluded.avatar_url, channels.avatar_url)`, c.id, c.login, c.displayName, now, c.avatarUrl ?? null);
    },
    updateChannelLogin: (id: string, login: string, displayName: string) => { run('UPDATE channels SET login = ?, display_name = ? WHERE id = ?', login, displayName, id); },
    updateChannelAvatar: (id: string, avatarUrl: string) => { run('UPDATE channels SET avatar_url = ? WHERE id = ?', avatarUrl, id); },
    addUserChannel: (userId: string, channelId: string) => { run('INSERT OR IGNORE INTO user_channels (user_id, channel_id) VALUES (?,?)', userId, channelId); },
    /** Unsubscribes, drops the channel from the user's rules and deletes the channel if nobody follows it anymore. */
    removeUserChannel(userId: string, channelId: string) {
      tx(() => {
        run('DELETE FROM user_channels WHERE user_id = ? AND channel_id = ?', userId, channelId);
        for (const r of all('SELECT id, channel_ids_json FROM rules WHERE owner_id = ?', userId)) {
          const ids: string[] = JSON.parse(r.channel_ids_json);
          if (ids.includes(channelId)) run('UPDATE rules SET channel_ids_json = ? WHERE id = ?', JSON.stringify(ids.filter((x) => x !== channelId)), r.id);
        }
        run('DELETE FROM last_fired WHERE channel_id = ? AND rule_id IN (SELECT id FROM rules WHERE owner_id = ?)', channelId, userId);
        if (n('SELECT COUNT(*) n FROM user_channels WHERE channel_id = ?', channelId) === 0) run('DELETE FROM channels WHERE id = ?', channelId);
      });
    },
    getChannel: (id: string) => { const r = get('SELECT * FROM channels WHERE id = ?', id); return r && channel(r); },
    listAllChannels: () => all('SELECT * FROM channels ORDER BY login').map(channel),
    listUserChannels: (userId: string) => all('SELECT c.* FROM channels c JOIN user_channels uc ON uc.channel_id = c.id WHERE uc.user_id = ? ORDER BY c.login', userId).map(channel),
    countUserChannels: (userId: string) => n('SELECT COUNT(*) n FROM user_channels WHERE user_id = ?', userId),
    desiredChannels: (): ChannelRow[] => all(`SELECT DISTINCT c.* FROM channels c JOIN user_channels uc ON uc.channel_id = c.id
      JOIN users u ON u.id = uc.user_id WHERE u.locked = 0 ORDER BY c.login`).map(channel),
    desiredChannelLogins(): string[] { return repo.desiredChannels().map((c) => c.login); },
    countDesiredChannels: () => repo.desiredChannels().length,
    isChannelDesired: (id: string) => n(`SELECT COUNT(*) n FROM user_channels uc JOIN users u ON u.id = uc.user_id WHERE uc.channel_id = ? AND u.locked = 0`, id) > 0,

    // rules
    listRules: (ownerId: string) => all('SELECT * FROM rules WHERE owner_id = ? ORDER BY name', ownerId).map(rule),
    getRule: (id: string) => { const r = get('SELECT * FROM rules WHERE id = ?', id); return r && rule(r); },
    countRules: (ownerId: string) => n('SELECT COUNT(*) n FROM rules WHERE owner_id = ?', ownerId),
    listEnabledRules: () => all('SELECT r.* FROM rules r JOIN users u ON u.id = r.owner_id WHERE r.enabled = 1 AND u.locked = 0').map(rule),
    /** Insert or replace; a changed rule resets its cooldown state. */
    saveRule(r: RuleInput, now: number): Rule {
      return tx(() => writeRule(r, now));
    },
    createRuleWithinLimit(r: RuleInput, now: number, limit: number): Rule | undefined {
      return tx(() => {
        if (n('SELECT COUNT(*) n FROM rules WHERE owner_id = ?', r.ownerId) >= limit) return undefined;
        return writeRule(r, now);
      });
    },
    deleteRule: (id: string, ownerId: string) => Number(run('DELETE FROM rules WHERE id = ? AND owner_id = ?', id, ownerId).changes) > 0,

    // targets
    listTargets: (ownerId: string) => all('SELECT * FROM targets WHERE owner_id = ? ORDER BY name', ownerId).map(target),
    getTarget: (id: string) => { const r = get('SELECT * FROM targets WHERE id = ?', id); return r && target(r); },
    countTargets: (ownerId: string) => n('SELECT COUNT(*) n FROM targets WHERE owner_id = ?', ownerId),
    saveTarget(t: Pick<Target, 'id' | 'ownerId' | 'kind' | 'name' | 'url' | 'token'>) {
      writeTarget(t);
    },
    createTargetWithinLimit(t: Pick<Target, 'id' | 'ownerId' | 'kind' | 'name' | 'url' | 'token'>, limit: number): boolean {
      return tx(() => {
        if (n('SELECT COUNT(*) n FROM targets WHERE owner_id = ?', t.ownerId) >= limit) return false;
        writeTarget(t);
        return true;
      });
    },
    /** Deletes the target and removes it from the owner's rules. */
    deleteTarget(id: string, ownerId: string): boolean {
      return tx(() => {
        if (Number(run('DELETE FROM targets WHERE id = ? AND owner_id = ?', id, ownerId).changes) === 0) return false;
        for (const r of all('SELECT id, target_ids_json FROM rules WHERE owner_id = ?', ownerId)) {
          const ids: string[] = JSON.parse(r.target_ids_json);
          if (ids.includes(id)) run('UPDATE rules SET target_ids_json = ? WHERE id = ?', JSON.stringify(ids.filter((x) => x !== id)), r.id);
        }
        return true;
      });
    },

    // cooldown state
    getLastFired: (ruleId: string, channelId: string): number | null => (get('SELECT ts FROM last_fired WHERE rule_id = ? AND channel_id = ?', ruleId, channelId) as Row | undefined)?.ts ?? null,
    setLastFired: (ruleId: string, channelId: string, ts: number) => {
      run('INSERT INTO last_fired (rule_id, channel_id, ts) VALUES (?,?,?) ON CONFLICT(rule_id, channel_id) DO UPDATE SET ts = excluded.ts', ruleId, channelId, ts);
    },
    listLastFired: (ruleId: string) => all('SELECT channel_id, ts FROM last_fired WHERE rule_id = ?', ruleId).map((r) => ({ channelId: r.channel_id as string, ts: r.ts as number })),

    // hit log
    recordHit: (h: { ruleId: string; channelId: string; count: number; firedAt: number; sentTs: number | null }): number =>
      Number(run('INSERT INTO hit_log (rule_id, channel_id, count, fired_at, sent_ts) VALUES (?,?,?,?,?)', h.ruleId, h.channelId, h.count, h.firedAt, h.sentTs).lastInsertRowid),
    /** Once per delivery: 3 consecutive failures mark the target 'failing'; one success resets. */
    recordDeliveryResult(targetId: string, ok: boolean, error?: string, immediateFail = false) {
      if (ok) run(`UPDATE targets SET fail_count = 0, status = 'ok', last_error = NULL WHERE id = ?`, targetId);
      else run(`UPDATE targets SET fail_count = fail_count + 1, last_error = ?, status = CASE WHEN ? OR fail_count + 1 >= 3 THEN 'failing' ELSE status END WHERE id = ?`, error ?? null, immediateFail ? 1 : 0, targetId);
    },
    /** Appends one target's result to a hit's results. */
    appendHitResult(hitId: number, targetId: string, ok: boolean, ts = Date.now()) {
      tx(() => {
        const r = get('SELECT results_json FROM hit_log WHERE id = ?', hitId);
        if (!r) return;
        const list: DeliveryResult[] = JSON.parse(r.results_json);
        list.push({ targetId, ok, ts });
        run('UPDATE hit_log SET results_json = ? WHERE id = ?', JSON.stringify(list), hitId);
      });
    },
    lastPings(userId: string, limit = 10): Ping[] {
      return all(`SELECT h.*, r.name rule_name, r.target_ids_json, c.login channel_login FROM hit_log h JOIN rules r ON r.id = h.rule_id
        LEFT JOIN channels c ON c.id = h.channel_id WHERE r.owner_id = ? ORDER BY h.fired_at DESC, h.id DESC LIMIT ?`, userId, limit)
        .map((r) => ({
          hitId: r.id, firedAt: r.fired_at, ruleId: r.rule_id, ruleName: r.rule_name, channelId: r.channel_id, channel: r.channel_login,
          count: r.count, sentTs: r.sent_ts, hasTargets: (JSON.parse(r.target_ids_json) as string[]).length > 0,
          results: (JSON.parse(r.results_json) as DeliveryResult[]).map((x) => ({ ...x, targetName: (get('SELECT name FROM targets WHERE id = ?', x.targetId) as Row | undefined)?.name ?? null })),
        }));
    },
    purgeOldHits: (days = 30, now = Date.now()): number => Number(run('DELETE FROM hit_log WHERE fired_at < ?', now - days * 86_400_000).changes),
  };
  return repo;
}

export type Repo = ReturnType<typeof createRepo>;
