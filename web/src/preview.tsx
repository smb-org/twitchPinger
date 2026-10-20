import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { ChatMessage } from '../../src/types.ts';
import { compileMatcher, matchesSender } from '../../src/rules/matcher.ts';
import type { Ranges } from '../../src/rules/matcher.ts';
import { simulateThreshold } from '../../src/rules/describe.ts';
import { api, errText } from './api.ts';
import type { Channel, PreviewMsg, Rule } from './api.ts';
import { hhmmss } from './ui.tsx';

export function usePreview(login: string) {
  const [s, setS] = useState<{ messages: PreviewMsg[] | null; error: string | null; loading: boolean }>({ messages: null, error: null, loading: !!login });
  const cur = useRef(login);
  cur.current = login;
  const run = useCallback(async () => {
    if (!login) return;
    setS((p) => ({ ...p, loading: true }));
    try {
      const r = await api<{ messages: PreviewMsg[] }>('GET', `/preview?channel=${encodeURIComponent(login)}`);
      if (cur.current === login) setS({ messages: [...r.messages].sort((a, b) => a.sentAt - b.sentAt), error: null, loading: false });
    } catch (e) {
      if (cur.current === login) setS((p) => ({ ...p, error: errText(e), loading: false }));
    }
  }, [login]);
  useEffect(() => {
    setS({ messages: null, error: null, loading: !!login });
    run();
    const t = setInterval(() => { if (!document.hidden) run(); }, 15_000);
    return () => clearInterval(t);
  }, [login]);
  return { ...s, refresh: run };
}
export type PreviewState = ReturnType<typeof usePreview>;

export interface Analysis { ranges: (Ranges | null)[]; hits: number; chatters: number; fires: number | null; invalid: boolean }

/** Runs the same matcher / sender filter / burst code as the server over the preview messages. */
export function analyse(rule: Rule, login: string, msgs: PreviewMsg[] | null, simulate: boolean): Analysis {
  const none: Analysis = { ranges: [], hits: 0, chatters: 0, fires: null, invalid: false };
  if (!msgs || !rule.matcher.pattern) return { ...none, ranges: (msgs ?? []).map(() => null) };
  try {
    const m = compileMatcher(rule.matcher);
    const chat: ChatMessage[] = msgs.map((x) => ({ channel: login, channelId: login, userId: x.userId, login: x.login, displayName: x.displayName, text: x.text, badges: x.badges, sentAt: x.sentAt, receivedAt: x.sentAt }));
    const ranges = chat.map((c) => { if (!matchesSender(rule.sender, c)) return null; const r = m(c.text); return r.matched ? r.ranges : null; });
    const sim = simulate ? simulateThreshold(rule, chat) : null;
    return { ranges, hits: sim?.hits ?? ranges.filter(Boolean).length, chatters: sim?.chatters ?? new Set(chat.filter((_, i) => ranges[i]).map((c) => c.userId)).size, fires: sim?.fires ?? null, invalid: false };
  } catch {
    return { ...none, ranges: msgs.map(() => null), invalid: true };
  }
}

function Highlight({ text, ranges }: { text: string; ranges: Ranges | null }) {
  if (!ranges?.length) return <>{text}</>;
  const out = [];
  let at = 0;
  for (const [a, b] of [...ranges].sort((x, y) => x[0] - y[0])) {
    if (b <= at) continue;
    const s = Math.max(a, at);
    if (s > at) out.push(text.slice(at, s));
    out.push(<u class="hit-t" key={s}>{text.slice(s, b)}</u>);
    at = b;
  }
  out.push(text.slice(at));
  return <>{out}</>;
}

export function PreviewPanel({ channels, login, setLogin, pv, an, hasPattern }: { channels: Channel[]; login: string; setLogin: (l: string) => void; pv: PreviewState; an: Analysis; hasPattern: boolean }) {
  const list = useRef<HTMLDivElement>(null);
  const scrolled = useRef('');
  // Like a chat: follow new messages unless the user scrolled up to read.
  const atBottom = useRef(true);
  const msgs = pv.messages;
  useEffect(() => {
    if (!msgs || !list.current) return;
    if (scrolled.current !== login || atBottom.current) list.current.scrollTop = list.current.scrollHeight;
    scrolled.current = login;
  }, [msgs, login]);
  const onScroll = (e: Event) => { const el = e.currentTarget as HTMLElement; atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; };

  let body;
  if (channels.length === 0) body = <p class="empty-text">Noch keine Channels. Füge unter „Channels“ einen hinzu, um eine Vorschau zu sehen.</p>;
  else if (!login) body = <p class="empty-text">Wähle einen Channel für die Vorschau.</p>;
  else if (pv.error && !msgs) body = <p class="empty-text">{pv.error}</p>;
  else if (!msgs) body = <p class="empty-text">Lade Nachrichten…</p>;
  else if (msgs.length === 0) body = <p class="empty-text">Channel gerade beigetreten, noch keine Nachrichten.</p>;
  else body = msgs.map((m, i) => (
    <div key={`${m.sentAt}-${m.userId}-${i}`} class={`msg${an.ranges[i] ? ' hit' : ''}`}>
      <span class="mono t">{hhmmss(m.sentAt)}</span>
      <span class="mono"><b>{m.login}</b>: <Highlight text={m.text} ranges={an.ranges[i] ?? null} /></span>
    </div>
  ));

  const counter = !msgs ? '' : an.invalid ? 'Ausdruck ungültig' : `${an.hits} Treffer · ${an.chatters} Chatter${an.fires === null ? '' : ` · Schwelle wäre ${an.fires}× erreicht worden`}`;
  const note = msgs && msgs.length > 0 && hasPattern && !an.invalid && an.hits === 0 ? 'Keine Treffer in den letzten 500 Nachrichten' : pv.error && msgs ? `Aktualisieren fehlgeschlagen: ${pv.error}` : '';

  return (
    <>
      <div class="panel-head">
        <div class="pv-top">
          <h2>Live-Vorschau</h2>
          <select aria-label="Channel für die Vorschau" class="mono" value={login} onChange={(e) => setLogin((e.target as HTMLSelectElement).value)}>
            {!login && <option value="">–</option>}
            {channels.map((c) => <option key={c.id} value={c.login}>{c.login}</option>)}
          </select>
          <button type="button" class="btn ghost" onClick={pv.refresh} disabled={!login || pv.loading}>{pv.loading ? 'Lade…' : 'Aktualisieren'}</button>
        </div>
        <p class="pv-count mono" role="status" aria-live="polite">{counter}</p>
        <p class="pv-note muted">{note}</p>
      </div>
      <div class="pv-list" ref={list} onScroll={onScroll} tabIndex={0} aria-label="Chatnachrichten">{body}</div>
      <div class="panel-foot small muted">Zeigt die letzten 500 Nachrichten · aktualisiert sich alle 15 s</div>
    </>
  );
}
