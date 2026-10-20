import { useLocation } from '../router.tsx';
import { useTitle } from '../ui.tsx';

const ERRORS: Record<string, string> = {
  no_invite: 'Kein Konto gefunden. Der Zugang ist nur mit Einladungslink möglich.',
  invite_invalid: 'Diese Einladung ist ungültig. Frag nach einem neuen Link.',
  invite_used: 'Diese Einladung wurde schon benutzt – frag nach einem neuen Link.',
  invite_expired: 'Diese Einladung ist abgelaufen – frag nach einem neuen Link.',
  locked: 'Dein Konto ist gesperrt.',
  accounts_full: 'Das Kontenlimit ist erreicht. Im Moment können keine neuen Konten angelegt werden.',
  oauth_failed: 'Die Anmeldung bei Twitch wurde abgebrochen oder ist fehlgeschlagen. Versuch es noch einmal.',
};

function Frame({ title, lead, href, error }: { title: string; lead: string; href: string; error?: string }) {
  useTitle(title);
  return (
    <main class="solo" id="main">
      <p class="wordmark">twitchPinger</p>
      <h1>{title}</h1>
      <p class="lead">{lead}</p>
      <p class="err solo-err" role="alert">{error}</p>
      <a class="btn" href={href}>Mit Twitch anmelden</a>
    </main>
  );
}

export function Login() {
  const q = new URLSearchParams(useLocation().search).get('error');
  return (
    <Frame
      title="Anmelden"
      lead="Du bekommst eine Meldung aufs Handy oder in Discord, sobald in deinen Twitch-Chats etwas losgeht. Der Zugang ist nur mit Einladung möglich; wer schon ein Konto hat, meldet sich einfach an."
      href="/api/auth/login"
      error={q ? ERRORS[q] ?? ERRORS.oauth_failed : undefined}
    />
  );
}

export function InvitePage({ code }: { code: string }) {
  return (
    <Frame
      title="Du bist eingeladen"
      lead="twitchPinger beobachtet Twitch-Chats und meldet dir per Handy oder Discord, wenn deine Regeln greifen, zum Beispiel wenn bei den Marbles ein Rennen offen ist. Melde dich mit Twitch an, um die Einladung einzulösen. Wir lesen nur, wem du folgst, und speichern kein Twitch-Token."
      href={`/api/auth/login?invite=${encodeURIComponent(code)}`}
    />
  );
}
