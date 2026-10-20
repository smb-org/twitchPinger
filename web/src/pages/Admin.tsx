import { useEffect } from 'preact/hooks';
import { api, errText, meStore } from '../api.ts';
import type { AdminUser } from '../api.ts';
import { navigate } from '../router.tsx';
import { ConfirmButton, Dot, LoadError, PageHead, Placeholder, toast, useLoad, useTitle } from '../ui.tsx';

export function Admin() {
  useTitle('Admin');
  const me = meStore.get()!;
  useEffect(() => { if (!me.isAdmin) navigate('/', true); }, []);
  const l = useLoad(() => api<{ users: AdminUser[] }>('GET', '/admin/users'), [], 0);
  const users = l.data?.users;

  async function act(u: AdminUser, action: 'lock' | 'unlock') {
    try {
      await api('POST', `/admin/users/${encodeURIComponent(u.id)}/${action}`);
      toast(action === 'lock' ? `${u.login} gesperrt` : `${u.login} entsperrt`);
      await l.reload();
    } catch (e) { toast(errText(e), 'error'); }
  }
  return (
    <div class="page">
      <PageHead title="Admin">
        <span class="mono muted">{users ? `${users.length} von ${me.limits.MAX_ACCOUNTS} Konten` : ''}</span>
      </PageHead>
      {!users && !l.error && <Placeholder rows={4} />}
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
  );
}
