import { useState } from 'preact/hooks';
import { api, ApiError, errText, MAX_TARGETS, meStore } from './api.ts';
import type { Me, TargetDto } from './api.ts';
import { copy, Dot, toast, useLoad, val } from './ui.tsx';

export const useTargets = () => useLoad(() => api<{ targets: TargetDto[] }>('GET', '/targets'), []);

export const topicOf = (url: string) => url.split('/').pop() ?? url;

export function TargetState({ target }: { target: TargetDto }) {
  const label = target.status === 'ok' ? 'in Ordnung'
    : target.status === 'unlinked' ? 'nicht verbunden'
    : target.status === 'unavailable' ? 'nicht eingerichtet'
    : `fehlerhaft seit ${target.failCount} Versuchen`;
  const dot = target.status === 'ok' ? 'ok' : target.status === 'unlinked' || target.status === 'unavailable' ? 'off' : 'error';
  return (
    <span class="tstat" title={target.failureHint ?? undefined}>
      <span class="tstat-main"><Dot kind={dot} /> {label}</span>
      <span class="tstat-hint">{target.failureHint ?? ''}</span>
    </span>
  );
}

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
export function TestCell({ id, onResult }: { id: string; onResult?: () => void }) {
  const [st, setSt] = useState<'idle' | 'run' | 'ok' | 'err'>('idle');
  const [msg, setMsg] = useState('');
  async function run() {
    setSt('run');
    try {
      const r = await api<{ ok: boolean; error?: string }>('POST', `/targets/${encodeURIComponent(id)}/test`);
      setSt(r.ok ? 'ok' : 'err');
      setMsg(r.error ?? '');
      onResult?.();
      if (!r.ok && r.error) toast(r.error, 'error');
    } catch (e) {
      setSt('err');
      setMsg(errText(e));
      onResult?.();
      toast(errText(e), 'error');
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
type TargetFormKind = 'ntfy' | 'discord' | 'discord_dm';

/** Add form. `onCreated` gets the new target; the ntfy topic is generated server-side. */
export function TargetForm({ count, onCreated, returnTo = '/targets', onLinkChange }: { count: number; onCreated: (t: TargetDto) => void; returnTo?: '/onboarding' | '/targets'; onLinkChange?: () => void }) {
  const me = meStore.use();
  const startWithDiscordDm = me?.discordDm.available === true && new URLSearchParams(location.search).get('target') === 'discord_dm';
  const [kind, setKind] = useState<TargetFormKind>(() => startWithDiscordDm ? 'discord_dm' : 'ntfy');
  const [name, setName] = useState(() => startWithDiscordDm ? 'Discord-DM' : 'Handy');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Err>(() => new URLSearchParams(location.search).get('error') === 'discord_oauth_failed' ? { text: 'Discord-Verbindung fehlgeschlagen. Bitte versuche es erneut.' } : null);
  const full = count >= MAX_TARGETS;

  async function submit(e: Event) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ target: TargetDto }>('POST', '/targets', { kind, name, ...(kind !== 'discord_dm' && url.trim() ? { url: url.trim() } : {}) });
      setUrl('');
      onCreated(r.target);
    } catch (x) {
      setErr({ field: x instanceof ApiError ? x.field : undefined, text: errText(x) });
    } finally {
      setBusy(false);
    }
  }
  const pick = (k: TargetFormKind) => { setKind(k); setName(k === 'ntfy' ? 'Handy' : k === 'discord_dm' ? 'Discord-DM' : 'Discord'); setUrl(''); setErr(null); };
  async function unlink() {
    try {
      await api('DELETE', '/discord/link');
      meStore.set(await api<Me>('GET', '/me'));
      onLinkChange?.();
      toast('Discord-Verknüpfung getrennt');
    } catch (e) { toast(errText(e), 'error'); }
  }
  const linkedUsername = me?.discordDm.username;
  const canCreate = kind !== 'discord_dm' || Boolean(linkedUsername);
  return (
    <form class="inline-form" onSubmit={submit}>
      <div class="seg" role="group" aria-label="Zielart">
        <button type="button" aria-pressed={kind === 'ntfy'} onClick={() => pick('ntfy')}>Handy (ntfy)</button>
        <button type="button" aria-pressed={kind === 'discord'} onClick={() => pick('discord')}>Discord</button>
        {me?.discordDm.available && <button type="button" aria-pressed={kind === 'discord_dm'} onClick={() => pick('discord_dm')}>Discord-Direktnachricht</button>}
      </div>
      <div class="inline-row">
        <label>
          <span class="lbl">Name</span>
          <input value={name} onInput={(e) => setName(val(e))} maxLength={60} />
        </label>
        {kind !== 'discord_dm' ? <>
          <label class="grow">
            <span class="lbl">{kind === 'ntfy' ? 'Server-URL' : 'Webhook-URL'}</span>
            <input class="mono" value={url} onInput={(e) => { setUrl(val(e)); setErr(null); }} placeholder={kind === 'ntfy' ? 'Optional, z. B. https://ntfy.sh/topic' : 'https://discord.com/api/webhooks/…'} autocomplete="off" spellcheck={false} required={kind === 'discord'} />
          </label>
          <button class="btn" disabled={busy || full || !name.trim() || (kind === 'discord' && !url.trim())}>
            {busy ? 'Lege an…' : kind === 'ntfy' ? 'Neues Handy-Ziel' : 'Ziel anlegen'}
          </button>
        </> : <>
          {linkedUsername ? <span class="discord-linked" role="status"><Dot kind="ok" /> Verbunden · <span class="mono">{linkedUsername}</span></span> : <a class="btn discord-connect" href={`/api/discord/link?returnTo=${encodeURIComponent(returnTo)}`}>Mit Discord verbinden</a>}
          {linkedUsername && <button type="button" class="btn ghost" onClick={unlink}>Trennen</button>}
          {canCreate && <button class="btn" disabled={busy || full || !name.trim()}>{busy ? 'Lege an…' : 'Ziel anlegen'}</button>}
        </>}
      </div>
      <p class="err" aria-live="polite">{err?.text ?? (full ? `Limit erreicht: höchstens ${MAX_TARGETS} Ziele.` : '')}</p>
      <p class="hint-line muted">
        {kind === 'discord_dm'
          ? 'Discord-DMs funktionieren, wenn der Bot dir schreiben darf. Tritt einem Server mit dem Bot bei und erlaube DMs.'
          : kind === 'ntfy'
          ? 'Auf dem iPhone gibt es hier kein Web Push – nutze die ntfy-App (empfohlen, auch auf Android).'
          : 'Discord: Server-Einstellungen → Integrationen → Webhooks → URL kopieren.'}
      </p>
    </form>
  );
}
