import { useEffect } from 'preact/hooks';
import { api, errText, meStore } from '../api.ts';
import type { AdminChannel, AdminUser } from '../api.ts';
import { InviteChain } from '../invite-chain.tsx';
import { navigate } from '../router.tsx';
import { ConfirmButton, Dot, LoadError, PageHead, Placeholder, toast, useLoad, useTitle } from '../ui.tsx';

export function Admin() {
  useTitle('Admin');
  const me = meStore.get()!;
  useEffect(() => { if (!me.isAdmin) navigate('/', true); }, []);
  const l = useLoad(() => api<{ users: AdminUser[] }>('GET', '/admin/users'), [], 0);
  const ch = useLoad(() => api<{ channels: AdminChannel[]; limit: number }>('GET', '/admin/channels'), [], 0);
  const users = l.data?.users;
  const channels = ch.data?.channels;

  async function act(u: AdminUser, action: 'lock' | 'unlock') {
    try {
      await api('POST', `/admin/users/${encodeURIComponent(u.id)}/${action}`);
      toast(action === 'lock' ? `${u.login} gesperrt` : `${u.login} entsperrt`);
      await Promise.all([l.reload(), ch.reload()]);
    } catch (e) { toast(errText(e), 'error'); }
  }
  return (
    <div class="page">
      <PageHead title="Admin">
        <span class="mono muted">{users ? `${users.length} von ${me.limits.MAX_ACCOUNTS} Konten` : ''}</span>
      </PageHead>
      <section class="admin-channels" aria-labelledby="admin-channels-title">
        <header class="admin-section-head">
          <h2 id="admin-channels-title">Channels im Dienst</h2>
          <span class="mono muted">{channels ? `${channels.length} / ${ch.data!.limit}` : `… / ${me.limits.MAX_CHANNELS_TOTAL}`}</span>
        </header>
        <div class="admin-channel-body">
          {!channels && !ch.error && <Placeholder rows={4} />}
          {!channels && ch.error && <LoadError error={ch.error} retry={ch.reload} />}
          {channels?.length === 0 && <p class="empty-text">Keine Channels im Dienst.</p>}
          {!!channels?.length && (
            <table class="admin-channels-table">
              <thead><tr><th>Channel</th><th>Status</th><th>Nutzer</th><th>Regeln</th></tr></thead>
              <tbody>{channels.map((channel) => (
                <tr key={channel.id}>
                  <td>
                    <span class="admin-channel-login">
                      {channel.avatarUrl ? <img class="admin-avatar" src={channel.avatarUrl} loading="lazy" alt="" /> : <span class="admin-avatar" aria-hidden="true" />}
                      <a href={`https://twitch.tv/${channel.login}`} target="_blank" rel="noopener">{channel.login}</a>
                    </span>
                  </td>
                  <td><span class="admin-channel-state"><Dot kind={channel.joined ? 'ok' : 'off'} />{channel.joined ? 'verbunden' : 'wartet'}</span></td>
                  <td class="mono">{channel.users}</td>
                  <td class="mono">{channel.rules}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </section>
      <InviteChain users={users} error={Boolean(l.error)} />
      <div class="admin-user-slot">
        {!users && !l.error && <div class="admin-user-placeholder"><Placeholder rows={4} /></div>}
        {!users && l.error && <LoadError error={l.error} retry={l.reload} />}
        <ul class="list">
          {users?.map((u) => (
            <li class="row admin" key={u.id}>
              <span class="mono grow">{u.login}{u.isAdmin ? ' · Admin' : ''}</span>
              <span class="mono muted">{u.ruleCount} Regeln · {u.channelCount} Channels</span>
              <span class="tstat"><Dot kind={u.locked ? 'error' : 'ok'} /> {u.locked ? 'gesperrt' : 'aktiv'}</span>
              {u.locked
                ? <button class="btn ghost confirm" onClick={() => act(u, 'unlock')}>Entsperren</button>
                : u.isAdmin ? <span class="confirm" /> : <ConfirmButton label="Sperren" onConfirm={() => act(u, 'lock')} />}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
