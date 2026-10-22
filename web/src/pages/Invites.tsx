import { useEffect, useState } from 'preact/hooks';
import { api, errText, meStore } from '../api.ts';
import type { InvitesDto, Me } from '../api.ts';
import { ConfirmButton, LoadError, PageHead, Placeholder, copy, toast, useLoad, useTitle } from '../ui.tsx';

export function Invites() {
  useTitle('Einladungen');
  const l = useLoad(() => api<InvitesDto>('GET', '/invites'), []);
  const [refreshedData, setRefreshedData] = useState<InvitesDto | null>(null);
  const data = refreshedData ?? l.data;
  const [busy, setBusy] = useState(false);

  async function refreshMe() {
    meStore.set(await api<Me>('GET', '/me'));
  }

  useEffect(() => {
    refreshMe().catch((e) => toast(errText(e), 'error'));
  }, []);

  async function reset() {
    setBusy(true);
    try {
      const result = await api<{ link: string }>('POST', '/invites/reset');
      setRefreshedData({ ...(data!), link: result.link });
      toast('Neuer Link erzeugt');
      const meRefresh = refreshMe().catch((e) => toast(errText(e), 'error'));
      try {
        setRefreshedData(await api<InvitesDto>('GET', '/invites'));
      } catch (e) {
        toast(errText(e), 'error');
      }
      await meRefresh;
    } catch (e) {
      toast(errText(e), 'error');
    } finally { setBusy(false); }
  }

  return (
    <div class="page">
      <PageHead title="Einladungen">
        <ConfirmButton label="Neuen Link erzeugen" onConfirm={reset} disabled={busy || !data} />
      </PageHead>
      <div class="slot slim invite-link-slot">
        {data ? (
          <>
            <div class="inline-row invite-link-row">
              <code class="mono grow url" title={data.link}>{data.link}</code>
              <button class="btn ghost" onClick={() => copy(data.link)}>Kopieren</button>
            </div>
            <p class="muted invite-capacity">{data.max === null ? 'unbegrenzt' : data.used >= data.max ? '' : `noch ${Math.max(0, data.max - data.used)} von ${data.max} Plätzen frei`}</p>
            <p class={data.max !== null && data.used >= data.max ? 'muted invite-full' : 'invite-full invite-full-empty'}>
              {data.max !== null && data.used >= data.max ? 'Alle Plätze vergeben' : ''}
            </p>
          </>
        ) : l.error ? (
          <LoadError error={l.error} retry={l.reload} />
        ) : (
          <Placeholder rows={1} />
        )}
      </div>
      <h2>Geworben</h2>
      <div class="invitees-body">
        {!l.data && !l.error && <Placeholder rows={3} />}
        {data?.invitees.length === 0 && <p class="muted invite-empty">Noch niemand über deinen Link dabei.</p>}
        <ul class="list invitees-list">
          {data?.invitees.map((invitee) => (
            <li class="row invitee" key={invitee.login}>
              <span class="mono invitee-login">@{invitee.login}</span>
              <time class="mono muted invitee-date" dateTime={new Date(invitee.createdAt).toISOString()}>
                {new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' }).format(new Date(invitee.createdAt))}
              </time>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
