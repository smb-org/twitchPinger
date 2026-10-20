import { useState } from 'preact/hooks';
import { api, ApiError, errText, meStore } from './api.ts';
import type { Channel } from './api.ts';
import { toast, useLoad, val } from './ui.tsx';

export function useChannels() {
  const l = useLoad(() => api<{ channels: Channel[] }>('GET', '/channels'), []);
  const [fresh, setFresh] = useState<string[]>([]);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const channels = l.data?.channels;

  async function add(raw: string): Promise<boolean> {
    const login = raw.trim().toLowerCase().replace(/^.*twitch\.tv\//, '').replace(/^[#@]/, '');
    if (!login) { setFormErr('Bitte einen Channel-Namen eingeben.'); return false; }
    setBusy(true);
    setFormErr(null);
    try {
      const r = await api<{ channel: Channel }>('POST', '/channels', { login });
      setFresh((f) => [...f, r.channel.id]);
      await l.reload();
      return true;
    } catch (e) {
      setFormErr(e instanceof ApiError && e.field === 'login' ? e.message : errText(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function remove(c: Channel) {
    try {
      await api('DELETE', `/channels/${encodeURIComponent(c.id)}`);
      toast(`${c.login} entfernt`);
      await l.reload();
    } catch (e) {
      toast(errText(e), 'error');
    }
  }
  return { ...l, channels, fresh, formErr, setFormErr, busy, add, remove };
}
export type ChannelsApi = ReturnType<typeof useChannels>;

export function AddChannelForm({ c }: { c: ChannelsApi }) {
  const [v, setV] = useState('');
  const me = meStore.get()!;
  const n = c.channels?.length ?? 0;
  const full = n >= me.limits.MAX_CHANNELS_PER_USER;
  return (
    <form class="inline-form" onSubmit={async (e) => { e.preventDefault(); if (await c.add(v)) setV(''); }}>
      <div class="inline-row">
        <label class="grow">
          <span class="lbl">Twitch-Channel</span>
          <input class="mono" value={v} onInput={(e) => { setV(val(e)); c.setFormErr(null); }} placeholder="z. B. marblemania" autocomplete="off" spellcheck={false} aria-describedby="ch-err" />
        </label>
        <button class="btn" disabled={c.busy || full}>{c.busy ? 'Prüfe…' : 'Hinzufügen'}</button>
      </div>
      <p id="ch-err" class="err" aria-live="polite">{c.formErr ?? (full ? `Limit erreicht: höchstens ${me.limits.MAX_CHANNELS_PER_USER} Channels pro Person.` : '')}</p>
    </form>
  );
}

export function Suggestions({ c, big }: { c: ChannelsApi; big?: boolean }) {
  const me = meStore.get()!;
  const have = new Set((c.channels ?? []).map((x) => x.id));
  const list = me.followSuggestions.filter((s) => !have.has(s.id));
  return (
    <div class={`suggest${big ? ' big' : ''}`}>
      {list.length === 0 && <p class="muted">{me.followSuggestions.length ? 'Alle gefolgten Channels sind schon dabei.' : 'Keine gefolgten Channels gefunden.'}</p>}
      <ul class="list">
        {list.map((s) => (
          <li class="row" key={s.id}>
            <span class="mono grow">{s.login}</span>
            <button class="btn ghost" disabled={c.busy} onClick={() => c.add(s.login)} aria-label={`${s.login} hinzufügen`}>Hinzufügen</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

