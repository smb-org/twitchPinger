import './fonts.css';
import './styles.css';
import { render } from 'preact';
import { useEffect } from 'preact/hooks';
import { api, meStore } from './api.ts';
import type { Me } from './api.ts';
import { Admin } from './pages/Admin.tsx';
import { Channels } from './pages/Channels.tsx';
import { Invites } from './pages/Invites.tsx';
import { InvitePage, Login } from './pages/Login.tsx';
import { Onboarding } from './pages/Onboarding.tsx';
import { Overview } from './pages/Overview.tsx';
import { RuleEditor } from './pages/RuleEditor.tsx';
import { Targets } from './pages/Targets.tsx';
import { Link, useLocation } from './router.tsx';
import { Shell } from './shell.tsx';
import { LoadError, Toasts, useLoad, useTitle } from './ui.tsx';

function NotFound() {
  useTitle('Nicht gefunden');
  return <div class="page"><h1>Seite nicht gefunden</h1><p><Link href="/">Zur Übersicht</Link></p></div>;
}

function Authed() {
  const { path } = useLocation();
  const cur = meStore.use();
  const { error, reload } = useLoad(async () => { const m = await api<Me>('GET', '/me'); meStore.set(m); return m; }, []);
  let view;
  if (!cur) view = error ? <div class="page"><LoadError error={error} retry={reload} /></div> : <div class="page"><p class="muted">Lade…</p></div>;
  else if (path === '/') view = <Overview />;
  else if (path === '/onboarding') view = <Onboarding />;
  else if (path === '/rules/new') view = <RuleEditor key="new" id={null} />;
  else if (path.startsWith('/rules/')) view = <RuleEditor key={path} id={decodeURIComponent(path.slice(7))} />;
  else if (path === '/channels') view = <Channels />;
  else if (path === '/targets') view = <Targets />;
  else if (path === '/invites') view = <Invites />;
  else if (path === '/admin') view = <Admin />;
  else view = <NotFound />;
  return <Shell>{view}</Shell>;
}

function App() {
  const { path } = useLocation();
  useEffect(() => { document.documentElement.lang = 'de'; }, []);
  if (path === '/login') return <><Login /><Toasts /></>;
  if (path.startsWith('/invite/')) return <><InvitePage code={decodeURIComponent(path.slice(8))} /><Toasts /></>;
  return <Authed />;
}

render(<App />, document.getElementById('app')!);
