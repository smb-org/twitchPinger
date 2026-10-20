import { useState } from 'preact/hooks';
import { api, ApiError, errText } from '../api.ts';
import type { Rule, TargetDto } from '../api.ts';
import { AddChannelForm, Suggestions, useChannels } from '../channels.tsx';
import { describeRule } from '../../../src/rules/describe.ts';
import { navigate } from '../router.tsx';
import { NtfyHelp, TargetForm, TargetState, TestCell, useTargets } from '../targets.tsx';
import { MARBLES } from '../form.ts';
import { toast, useTitle } from '../ui.tsx';

function Step1() {
  const c = useChannels();
  return (
    <>
      <p class="lead">In welchen Chats soll mitgelesen werden? Deine gefolgten Channels sind vorgeschlagen.</p>
      <AddChannelForm c={c} />
      <div class="cols2">
        <div><h2>Gewählt</h2>
          {c.channels?.length === 0 && <p class="muted">Noch keiner gewählt.</p>}
          <ul class="list">{c.channels?.map((ch) => <li class="row" key={ch.id}><span class="mono grow">{ch.login}</span></li>)}</ul>
        </div>
        <div><h2>Gefolgt</h2><Suggestions c={c} /></div>
      </div>
    </>
  );
}

function Step2() {
  const t = useTargets();
  const [created, setCreated] = useState<TargetDto | null>(null);
  const targets = t.data?.targets ?? [];
  return (
    <>
      <p class="lead">Wohin sollen die Pings? Lege ein Ziel an und schick einen Test – schau aufs Handy.</p>
      <div class="slot">
        {created?.kind === 'ntfy' ? <NtfyHelp url={created.url} /> : <TargetForm count={targets.length} returnTo="/onboarding" onCreated={(x) => { setCreated(x); t.reload(); }} onLinkChange={t.reload} />}
      </div>
      <ul class="list">
        {targets.map((x) => (
          <li class="row target" key={x.id}>
            <span class="tname"><b>{x.name}</b> <span class="muted">{x.kind === 'ntfy' ? 'ntfy' : x.kind === 'discord_dm' ? 'Discord-Direktnachricht' : 'Discord-Webhook'}</span></span>
            <TargetState target={x} />
            <span class="grow" />
            <TestCell id={x.id} onResult={() => { void t.reload(); }} />
          </li>
        ))}
      </ul>
    </>
  );
}

function Step3({ done }: { done: () => void }) {
  const ch = useChannels();
  const tg = useTargets();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const chans = ch.channels ?? [];
  const targets = tg.data?.targets ?? [];
  const rule = { ...MARBLES, id: '', ownerId: '', enabled: true, channelIds: chans.map((c) => c.id), targetIds: targets.map((x) => x.id), updatedAt: 0 } as Rule;
  const problem = !ch.channels || !tg.data ? 'Lade…' : chans.length === 0 ? 'Ohne Channel gibt es nichts zu beobachten – geh zurück zu Schritt 1.' : targets.length === 0 ? 'Ohne Ziel meldet die Regel nichts – geh zurück zu Schritt 2.' : '';
  async function create() {
    setBusy(true);
    setErr(null);
    try {
      const { id: _i, ownerId: _o, updatedAt: _u, ...body } = rule;
      await api('POST', '/rules', body);
      done();
    } catch (e) { setErr(e instanceof ApiError ? e.message : errText(e)); } finally { setBusy(false); }
  }
  return (
    <>
      <p class="lead">Starte mit der Marbles-Vorlage. Du kannst sie später jederzeit ändern.</p>
      <p class="sentence">{describeRule(rule, chans.map((c) => c.login))}</p>
      <div class="inline-row">
        <button class="btn" disabled={busy || !!problem} onClick={create}>{busy ? 'Lege an…' : 'Regel anlegen'}</button>
        <span class="muted">{problem}</span>
      </div>
      <p class="err" aria-live="polite">{err}</p>
    </>
  );
}

export function Onboarding() {
  useTitle('Einrichtung');
  const [step, setStep] = useState(() => new URLSearchParams(location.search).get('step') === '2' ? 2 : 1);
  const finish = (ok: boolean) => { if (ok) toast('Überwachung läuft'); navigate('/'); };
  const titles = ['Channels wählen', 'Ziel anlegen', 'Regel aus Vorlage'];
  return (
    <div class="page onboarding">
      <header class="page-head steps">
        <h1>Schritt {step} von 3</h1>
        <ol class="progress" aria-hidden="true">{[1, 2, 3].map((n) => <li key={n} class={n <= step ? 'on' : ''} />)}</ol>
        <span class="muted">{titles[step - 1]}</span>
      </header>
      <div class="step-body" key={step}>
        {step === 1 && <Step1 />}
        {step === 2 && <Step2 />}
        {step === 3 && <Step3 done={() => finish(true)} />}
      </div>
      <footer class="step-foot">
        <button class="btn ghost" disabled={step === 1} onClick={() => setStep(step - 1)}>Zurück</button>
        <button class="btn ghost" onClick={() => (step < 3 ? setStep(step + 1) : finish(false))}>Überspringen</button>
        {step < 3 && <button class="btn" onClick={() => setStep(step + 1)}>Weiter</button>}
      </footer>
    </div>
  );
}
