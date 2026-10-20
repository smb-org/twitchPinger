import { useState } from 'preact/hooks';
import { api, ApiError, errText, meStore } from '../api.ts';
import type { InviteDto } from '../api.ts';
import { ConfirmButton, LoadError, PageHead, Placeholder, copy, inFuture, toast, useLoad, useTitle } from '../ui.tsx';

const STATUS = { open: 'offen', used: 'benutzt', expired: 'abgelaufen', revoked: 'widerrufen' } as const;

export function Invites() {
  useTitle('Einladungen');
  const me = meStore.get()!;
  const l = useLoad(() => api<{ invites: InviteDto[] }>('GET', '/invites'), []);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const invites = l.data?.invites;
  const open = invites?.filter((i) => i.status === 'open').length ?? 0;
  const left = Math.max(0, me.limits.MAX_OPEN_INVITES - open);

  async function create() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ id: string; link: string }>('POST', '/invites');
      setLinks((x) => ({ ...x, [r.id]: r.link }));
      setFresh(r.link);
      await l.reload();
    } catch (e) {
      setErr(errText(e));
      if (e instanceof ApiError && e.code !== 'limit_invites') toast(errText(e), 'error');
    } finally { setBusy(false); }
  }
  async function revoke(i: InviteDto) {
    try {
      await api('DELETE', `/invites/${encodeURIComponent(i.id)}`);
      toast('Einladung widerrufen');
      await l.reload();
    } catch (e) { toast(errText(e), 'error'); }
  }
  return (
    <div class="page">
      <PageHead title="Einladungen">
        <button class="btn" onClick={create} disabled={busy || left === 0 || !invites}>
          {busy ? 'Erzeuge…' : `Einladung erzeugen (noch ${left} von ${me.limits.MAX_OPEN_INVITES})`}
        </button>
      </PageHead>
      <div class="slot slim">
        {fresh ? (
          <div class="inline-row">
            <code class="mono grow url">{fresh}</code>
            <button class="btn ghost" onClick={() => copy(fresh)}>Kopieren</button>
          </div>
        ) : (
          <p class="muted">Der volle Link ist nur direkt nach dem Erzeugen sichtbar. Kopiere ihn sofort.</p>
        )}
        <p class="err" aria-live="polite">{err ?? (invites && left === 0 ? 'Limit erreicht: widerrufe eine offene Einladung, um eine neue zu erzeugen.' : '')}</p>
      </div>
      {!invites && !l.error && <Placeholder rows={3} />}
      {!invites && l.error && <LoadError error={l.error} retry={l.reload} />}
      {invites?.length === 0 && <p class="muted">Noch keine Einladungen.</p>}
      <ul class="list">
        {invites?.map((i) => (
          <li class="row invite" key={i.id}>
            <span class="mono">…/invite/{i.id.slice(0, 6)}…</span>
            <span class="copycell">{links[i.id] ? <button class="btn ghost" onClick={() => copy(links[i.id]!)}>Kopieren</button> : <span class="muted">–</span>}</span>
            <span class="mono">{i.status === 'open' ? `läuft ab ${inFuture(i.expiresAt)}` : ''}</span>
            <span class="grow">{i.status === 'used' ? <>benutzt von <span class="mono">@{i.usedBy ?? '?'}</span></> : STATUS[i.status]}</span>
            {i.status === 'open' ? <ConfirmButton label="Widerrufen" onConfirm={() => revoke(i)} /> : <span class="confirm" />}
          </li>
        ))}
      </ul>
    </div>
  );
}
