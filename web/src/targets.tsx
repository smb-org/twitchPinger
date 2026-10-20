import { useState } from 'preact/hooks';
import { api, ApiError, errText, MAX_TARGETS } from './api.ts';
import type { TargetDto } from './api.ts';
import { copy, useLoad, val } from './ui.tsx';

export const useTargets = () => useLoad(() => api<{ targets: TargetDto[] }>('GET', '/targets'), []);

export const topicOf = (url: string) => url.split('/').pop() ?? url;

export function NtfyHelp({ url }: { url: string }) {
  return (
    <div class="help">
      <p><b>Neues Handy-Ziel angelegt.</b> So bekommst du die Pings:</p>
      <ol>
        <li>ntfy-App auf dem Handy installieren (iOS und Android).</li>
        <li>Darin das Topic abonnieren: <code class="mono">{topicOf(url)}</code></li>
        <li>Unten „Testen“ drücken und aufs Handy schauen.</li>
      </ol>
      <div class="inline-row">
        <code class="mono grow url">{url}</code>
        <button class="btn ghost" onClick={() => copy(url, 'Topic-URL kopiert')}>Kopieren</button>
      </div>
    </div>
  );
}

/** Fixed-area test button: idle / running / delivered? / error. */
export function TestCell({ id }: { id: string }) {
  const [st, setSt] = useState<'idle' | 'run' | 'ok' | 'err'>('idle');
  const [msg, setMsg] = useState('');
  async function run() {
    setSt('run');
    try {
      const r = await api<{ ok: boolean; error?: string }>('POST', `/targets/${encodeURIComponent(id)}/test`);
      setSt(r.ok ? 'ok' : 'err');
      setMsg(r.error ?? '');
    } catch (e) {
      setSt('err');
      setMsg(errText(e));
    }
  }
  return (
    <span class="testcell">
      <button class="btn ghost" onClick={run} disabled={st === 'run'}>{st === 'run' ? 'läuft…' : 'Testen'}</button>
      <span class={`tstate ${st}`} role="status" title={msg || undefined}>
        {st === 'ok' && 'angekommen?'}
        {st === 'err' && `Fehler${msg ? `: ${msg}` : ''}`}
      </span>
    </span>
  );
}

type Err = { field?: string; text: string } | null;

/** Add form. `onCreated` gets the new target; the ntfy topic is generated server-side. */
export function TargetForm({ count, onCreated }: { count: number; onCreated: (t: TargetDto) => void }) {
  const [kind, setKind] = useState<'ntfy' | 'discord'>('ntfy');
  const [name, setName] = useState('Handy');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Err>(null);
  const full = count >= MAX_TARGETS;

  async function submit(e: Event) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ target: TargetDto }>('POST', '/targets', { kind, name, ...(kind === 'discord' ? { url } : {}) });
      setUrl('');
      onCreated(r.target);
    } catch (x) {
      setErr({ field: x instanceof ApiError ? x.field : undefined, text: errText(x) });
    } finally {
      setBusy(false);
    }
  }
  const pick = (k: 'ntfy' | 'discord') => { setKind(k); setName(k === 'ntfy' ? 'Handy' : 'Discord'); setErr(null); };
  return (
    <form class="inline-form" onSubmit={submit}>
      <div class="seg" role="group" aria-label="Zielart">
        <button type="button" aria-pressed={kind === 'ntfy'} onClick={() => pick('ntfy')}>Handy (ntfy)</button>
        <button type="button" aria-pressed={kind === 'discord'} onClick={() => pick('discord')}>Discord</button>
      </div>
      <div class="inline-row">
        <label>
          <span class="lbl">Name</span>
          <input value={name} onInput={(e) => setName(val(e))} maxLength={60} />
        </label>
        {kind === 'discord' && (
          <label class="grow">
            <span class="lbl">Webhook-URL</span>
            <input class="mono" value={url} onInput={(e) => { setUrl(val(e)); setErr(null); }} placeholder="https://discord.com/api/webhooks/…" autocomplete="off" spellcheck={false} />
          </label>
        )}
        <button class="btn" disabled={busy || full || !name.trim() || (kind === 'discord' && !url.trim())}>
          {busy ? 'Lege an…' : kind === 'ntfy' ? 'Neues Handy-Ziel' : 'Ziel anlegen'}
        </button>
      </div>
      <p class="err" aria-live="polite">{err?.text ?? (full ? `Limit erreicht: höchstens ${MAX_TARGETS} Ziele.` : '')}</p>
      <p class="hint-line muted">
        {kind === 'ntfy'
          ? 'Auf dem iPhone gibt es hier kein Web Push – nutze die ntfy-App (empfohlen, auch auf Android).'
          : 'Discord: Server-Einstellungen → Integrationen → Webhooks → URL kopieren.'}
      </p>
    </form>
  );
}
