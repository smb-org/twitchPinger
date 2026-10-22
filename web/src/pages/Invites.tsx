import { useState } from 'preact/hooks';
import { api, errText } from '../api.ts';
import type { InvitesDto } from '../api.ts';
import { ConfirmButton, LoadError, PageHead, Placeholder, copy, toast, useLoad, useTitle } from '../ui.tsx';

export function Invites() {
  useTitle('Einladungen');
  const l = useLoad(() => api<InvitesDto>('GET', '/invites'), []);
  const [busy, setBusy] = useState(false);

  async function reset() {
    setBusy(true);
    try {
      await api<{ link: string }>('POST', '/invites/reset');
      toast('Neuer Link erzeugt');
      await l.reload();
    } catch (e) {
      toast(errText(e), 'error');
    } finally { setBusy(false); }
  }

  return (
    <div class="page">
      <PageHead title="Einladungen">
        <ConfirmButton label="Neuen Link erzeugen" onConfirm={reset} disabled={busy || !l.data} />
      </PageHead>
      <div class="slot slim invite-link-slot">
        {l.data ? (
          <>
            <div class="inline-row invite-link-row">
              <code class="mono grow url" title={l.data.link}>{l.data.link}</code>
              <button class="btn ghost" onClick={() => copy(l.data!.link)}>Kopieren</button>
            </div>
            <p class="muted invite-capacity">{l.data.max === null ? 'unbegrenzt' : `noch ${Math.max(0, l.data.max - l.data.used)} von ${l.data.max} Plätzen frei`}</p>
            <p class={l.data.max !== null && l.data.used >= l.data.max ? 'muted invite-full' : 'invite-full invite-full-empty'}>
              {l.data.max !== null && l.data.used >= l.data.max ? 'Alle Plätze vergeben' : ''}
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
        {l.data?.invitees.length === 0 && <p class="muted invite-empty">Noch niemand über deinen Link dabei.</p>}
        <ul class="list invitees-list">
          {l.data?.invitees.map((invitee) => (
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
