import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { ReaderHealth } from '../../src/types.ts';
import { api, meStore } from './api.ts';
import type { Health, Me } from './api.ts';
import { Link, navigate, useLocation } from './router.tsx';
import { store } from './store.ts';
import { Toasts, hhmm } from './ui.tsx';

export const health = store<{ state: 'loading' | 'ok' | 'err'; h?: ReaderHealth }>({ state: 'loading' });

async function poll() {
  try {
    const r = await api<Health>('GET', '/health');
    health.set({ state: 'ok', h: r.reader });
  } catch {
    health.set({ state: 'err' });
  }
}

const sec = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 120 ? `${s} s` : `${Math.floor(s / 60)} min`; };

function StatusStrip({ me, version, versionText }: { me: Me | null; version: string; versionText: string }) {
  const hs = health.use();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    poll();
    const a = setInterval(poll, 15_000);
    const b = setInterval(() => setNow(Date.now()), 5_000);
    return () => { clearInterval(a); clearInterval(b); };
  }, []);

  let kind: 'ok' | 'warn' | 'error' = 'warn';
  let text = 'verbinde…';
  const h = hs.h;
  if (hs.state === 'err') { kind = 'error'; text = 'Dienst nicht erreichbar – Meldungen pausiert'; }
  else if (h?.connected) {
    kind = 'ok';
    const ch = h.joined < h.desired ? `${h.joined} von ${h.desired} Channels beigetreten` : `${h.joined} Channels`;
    text = `Leser verbunden · ${ch}${h.lastMessageAt ? ` · letzte Nachricht vor ${sec(now - h.lastMessageAt)}` : ''}`;
  } else if (h) {
    if (h.since && now - h.since > 30_000) { kind = 'error'; text = `Leser getrennt seit ${hhmm(h.since)} – Meldungen pausiert`; }
    else text = 'verbinde neu…';
  }
  const word = kind === 'ok' ? 'Status: ' : kind === 'warn' ? 'Warnung: ' : 'Störung: ';

  async function logout() {
    await api('POST', '/auth/logout').catch(() => {});
    meStore.set(null);
    navigate('/login');
  }
  return (
    <div class="strip">
      <div class={`strip-state ${kind}`} role="status" aria-live="polite">
        <span class="dot" aria-hidden="true" />
        <span class="strip-text"><span class="sr">{word}</span>{text}</span>
      </div>
      <div class="strip-user">
        <span class="app-version mobile-version" title={version}>{versionText}</span>
        {me && <span class="mono hide-sm">@{me.user.login}</span>}
        {me?.isAdmin && <Link href="/admin" class="strip-btn">Admin</Link>}
        {me && <button class="strip-btn" onClick={logout}>Abmelden</button>}
      </div>
    </div>
  );
}

const NAV = [
  ['/', 'Übersicht'],
  ['/channels', 'Channels'],
  ['/targets', 'Ziele'],
  ['/invites', 'Einladungen'],
] as const;

export function Shell({ children }: { children: ComponentChildren }) {
  const { path } = useLocation();
  const me = meStore.use();
  const version = me?.version ?? 'dev';
  const versionText = /^[\da-f]{40}$/i.test(version) ? version.slice(0, 7) : version;
  useEffect(() => { document.getElementById('main')?.focus({ preventScroll: true }); }, [path]);
  const active = (to: string) => (to === '/' ? path === '/' || path.startsWith('/rules') : path.startsWith(to));
  return (
    <div class="app">
      <a class="skip" href="#main">Zum Inhalt</a>
      <StatusStrip me={me} version={version} versionText={versionText} />
      <nav class="nav" aria-label="Hauptnavigation">
        <div class="nav-brand">
          <Link href="/" class="wordmark">twitchPinger</Link>
          <span class="app-version nav-version" title={version}>{versionText}</span>
        </div>
        {NAV.map(([to, label]) => <Link key={to} href={to} aria-current={active(to) ? 'page' : undefined}>{label}</Link>)}
      </nav>
      <main id="main" tabIndex={-1}>{children}</main>
      <Toasts />
    </div>
  );
}
