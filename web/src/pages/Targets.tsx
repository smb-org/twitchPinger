import { useState } from 'preact/hooks';
import { api, errText } from '../api.ts';
import type { TargetDto } from '../api.ts';
import { NtfyHelp, TargetForm, TestCell, topicOf, useTargets } from '../targets.tsx';
import { ConfirmButton, Dot, LoadError, PageHead, Placeholder, toast, useTitle } from '../ui.tsx';

export function Targets() {
  useTitle('Ziele');
  const l = useTargets();
  const [created, setCreated] = useState<TargetDto | null>(null);
  const targets = l.data?.targets;

  async function del(t: TargetDto) {
    try {
      await api('DELETE', `/targets/${encodeURIComponent(t.id)}`);
      toast(`${t.name} gelöscht`);
      if (created?.id === t.id) setCreated(null);
      await l.reload();
    } catch (e) { toast(errText(e), 'error'); }
  }
  return (
    <div class="page">
      <PageHead title="Ziele" />
      <div class="slot">
        {created?.kind === 'ntfy' ? (
          <div>
            <NtfyHelp url={created.url} />
            <button class="btn ghost" onClick={() => setCreated(null)}>Weiteres Ziel anlegen</button>
          </div>
        ) : (
          <TargetForm count={targets?.length ?? 0} onCreated={(t) => { setCreated(t); l.reload(); if (t.kind === 'discord') toast('Discord-Ziel angelegt'); }} />
        )}
      </div>
      <h2>Deine Ziele</h2>
      {!targets && !l.error && <Placeholder rows={2} />}
      {!targets && l.error && <LoadError error={l.error} retry={l.reload} />}
      {targets?.length === 0 && <p class="muted">Noch kein Ziel. ntfy aufs Handy einrichten.</p>}
      <ul class="list">
        {targets?.map((t) => (
          <li class="row target" key={t.id}>
            <span class="tname"><b>{t.name}</b> <span class="muted">{t.kind === 'ntfy' ? 'ntfy' : 'Discord'}</span></span>
            <span class="mono url grow" title={t.kind === 'ntfy' ? t.url : undefined}>{t.kind === 'ntfy' ? topicOf(t.url) : t.url}</span>
            <span class="tstat"><Dot kind={t.status === 'ok' ? 'ok' : 'error'} /> {t.status === 'ok' ? 'in Ordnung' : `fehlerhaft seit ${t.failCount} Versuchen`}</span>
            <TestCell id={t.id} />
            <ConfirmButton label="Löschen" onConfirm={() => del(t)} />
          </li>
        ))}
      </ul>
    </div>
  );
}
