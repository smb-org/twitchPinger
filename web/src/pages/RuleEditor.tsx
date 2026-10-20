import { useEffect, useMemo, useState } from 'preact/hooks';
import { describeRule } from '../../../src/rules/describe.ts';
import { api, ApiError, errText, meStore } from '../api.ts';
import type { Badge, Channel, OverviewRule, Rule, TargetDto } from '../api.ts';
import { MatcherBuilder } from '../builder.tsx';
import { applyMarbles, emptyForm, fromRule, toBody, toRule, validate } from '../form.ts';
import type { Form } from '../form.ts';
import { PreviewPanel, analyse, usePreview } from '../preview.tsx';
import { Link, navigate, useLocation } from '../router.tsx';
import { ConfirmButton, Err, LoadError, hhmm, toast, useLoad, useTitle, val } from '../ui.tsx';

const BADGES: [Badge, string][] = [['broadcaster', 'Broadcaster'], ['moderator', 'Mods'], ['vip', 'VIPs'], ['subscriber', 'Subs']];
const LOGIN_RE = /^[a-z0-9_]{1,25}$/;

interface Base { rules: Rule[]; channels: Channel[]; targets: TargetDto[]; overview: OverviewRule[] }

export function RuleEditor({ id }: { id: string | null }) {
  const me = meStore.get()!;
  const q = new URLSearchParams(useLocation().search);
  const base = useLoad<Base>(async () => {
    const [r, c, t, o] = await Promise.all([
      api<{ rules: Rule[] }>('GET', '/rules'),
      api<{ channels: Channel[] }>('GET', '/channels'),
      api<{ targets: TargetDto[] }>('GET', '/targets'),
      id ? api<{ rules: OverviewRule[] }>('GET', '/overview') : Promise.resolve({ rules: [] }),
    ]);
    return { rules: r.rules, channels: c.channels, targets: t.targets, overview: o.rules };
  }, [id]);

  const [form, setForm] = useState<Form | null>(null);
  const [srv, setSrv] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<'rule' | 'preview'>('rule');
  const [pvLogin, setPvLogin] = useState('');
  const [draft, setDraft] = useState('');
  const [loginErr, setLoginErr] = useState('');
  const existing = id ? base.data?.rules.find((r) => r.id === id) : undefined;
  useTitle(id ? 'Regel bearbeiten' : 'Neue Regel');

  useEffect(() => {
    const d = base.data;
    if (!d || form) return;
    if (id) { if (existing) setForm(fromRule(existing)); return; }
    const f = { ...emptyForm(), channelIds: d.channels.map((c) => c.id), targetIds: d.targets.map((t) => t.id) };
    setForm(q.get('vorlage') === 'marbles' ? applyMarbles(f) : f);
  }, [base.data]);

  const channels = base.data?.channels ?? [];
  const selLogins = channels.filter((c) => form?.channelIds.includes(c.id)).map((c) => c.login);
  useEffect(() => {
    if (!pvLogin && channels.length && form) setPvLogin(selLogins[0] ?? channels[0]!.login);
  }, [channels.length, !!form]);

  const pv = usePreview(pvLogin);
  const errs = form ? validate(form, me.limits) : {};
  const rule = form ? toRule(form) : null;
  const key = JSON.stringify(rule && [rule.matcher, rule.sender, rule.burst, rule.cooldownSec]);
  const an = useMemo(() => (rule ? analyse(rule, pvLogin, pv.messages, !errs.burst && !errs['matcher.pattern']) : null), [pv.messages, key, pvLogin]);

  if (!form || !rule || !an) {
    if (base.error) return <div class="page"><LoadError error={base.error} retry={base.reload} /></div>;
    if (id && base.data && !existing) return <div class="page"><h1>Regel nicht gefunden</h1><p><Link href="/">Zur Übersicht</Link></p></div>;
    return <div class="page"><p class="muted">Lade…</p></div>;
  }

  const upd = (p: Partial<Form>) => { setForm((f) => ({ ...f!, ...p })); setSrv({}); };
  const toggle = <K extends 'badges' | 'channelIds' | 'targetIds'>(k: K, v: Form[K][number]) => {
    const cur = form[k] as string[];
    upd({ [k]: cur.includes(v as string) ? cur.filter((x) => x !== v) : [...cur, v as string] } as Partial<Form>);
  };
  const atLimit = !id && (base.data?.rules.length ?? 0) >= me.limits.MAX_RULES_PER_USER;
  const problem = atLimit ? `Limit erreicht: höchstens ${me.limits.MAX_RULES_PER_USER} Regeln.` : Object.values(errs)[0] ?? '';
  const srvOf = (prefix: string) => Object.entries(srv).find(([k]) => k === prefix || k.startsWith(prefix + '.'))?.[1];
  const cooldownUntil = id ? base.data?.overview.find((r) => r.id === id)?.cooldownUntil : null;

  function addLogins(raw: string) {
    const add = raw.split(/[\s,;]+/).map((x) => x.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
    const bad = add.find((x) => !LOGIN_RE.test(x));
    setLoginErr(bad ? `„${bad}“ ist kein gültiger Login.` : form!.logins.length + add.length > 50 ? 'Höchstens 50 Logins.' : '');
    if (bad) return;
    upd({ logins: [...new Set([...form!.logins, ...add])] });
    setDraft('');
  }

  async function save() {
    setSaving(true);
    setSrv({});
    try {
      const body = toBody(form!);
      if (id) {
        await api('PUT', `/rules/${encodeURIComponent(id)}`, body);
        toast('Gespeichert, Fenster zurückgesetzt');
      } else {
        const r = await api<{ rule: Rule }>('POST', '/rules', body);
        toast('Gespeichert, Fenster zurückgesetzt');
        navigate(`/rules/${encodeURIComponent(r.rule.id)}`, true);
      }
    } catch (e) {
      setSrv({ [e instanceof ApiError && e.field ? e.field : '_']: errText(e) });
    } finally { setSaving(false); }
  }
  async function del() {
    try {
      await api('DELETE', `/rules/${encodeURIComponent(id!)}`);
      toast('Regel gelöscht');
      navigate('/');
    } catch (e) { toast(errText(e), 'error'); }
  }

  const hasPattern = !!form.pattern;
  const sentence = hasPattern ? describeRule(rule, selLogins) : 'Gib eine Bedingung ein, dann steht hier, was die Regel meldet.';
  const tabCount = pv.messages ? ` (${an.hits})` : '';

  return (
    <div class="editor">
      <header class="page-head">
        <h1>{id ? 'Regel bearbeiten' : 'Neue Regel'}</h1>
        <div class="actions">
          <button type="button" class="btn ghost" onClick={() => upd(applyMarbles(form))}>Marbles-Vorlage</button>
          <Link href="/" class="btn ghost">Zurück</Link>
        </div>
      </header>
      <div class="tabs" role="tablist" aria-label="Ansicht">
        <button role="tab" id="t-rule" aria-selected={tab === 'rule'} aria-controls="p-rule" onClick={() => setTab('rule')}>Regel</button>
        <button role="tab" id="t-prev" aria-selected={tab === 'preview'} aria-controls="p-prev" onClick={() => setTab('preview')}>Vorschau{tabCount}</button>
      </div>
      <div class="split" data-tab={tab}>
        <section class="panel form" id="p-rule" role="tabpanel" aria-labelledby="t-rule">
          <div class="panel-body">
            <label class="field">
              <span class="lbl">Name der Regel</span>
              <input value={form.name} maxLength={60} onInput={(e) => upd({ name: val(e) })} />
              <Err text={srvOf('name')} />
            </label>
            <label class="switch">
              <input type="checkbox" checked={form.enabled} onChange={(e) => upd({ enabled: (e.target as HTMLInputElement).checked })} />
              <span>Regel aktiv</span>
            </label>

            <MatcherBuilder f={form} set={upd} error={srvOf('matcher') ?? (hasPattern ? errs['matcher.pattern'] : undefined)} />

            <fieldset>
              <legend class="lbl">Absender</legend>
              <div class="chips">
                {BADGES.map(([b, l]) => <button type="button" class="chip" key={b} aria-pressed={form.badges.includes(b)} onClick={() => toggle('badges', b)}>{l}</button>)}
              </div>
              <div class="chips">
                {form.logins.map((l) => <button type="button" class="chip mono" key={l} onClick={() => upd({ logins: form.logins.filter((x) => x !== l) })} aria-label={`${l} entfernen`}>{l} ×</button>)}
              </div>
              <label class="field">
                <span class="lbl">Logins ergänzen</span>
                <input class="mono" value={draft} placeholder="Login, Enter zum Hinzufügen" autocomplete="off" spellcheck={false}
                  onInput={(e) => { setDraft(val(e)); setLoginErr(''); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addLogins(draft); } }}
                  onBlur={() => draft && addLogins(draft)} />
              </label>
              <label class="switch">
                <input type="checkbox" checked={form.exclude} onChange={(e) => upd({ exclude: (e.target as HTMLInputElement).checked })} />
                <span>Auswahl ausschließen (alle außer diesen)</span>
              </label>
              <Err text={loginErr || srvOf('sender')} />
            </fieldset>

            <fieldset>
              <legend class="lbl">Häufung</legend>
              <div class="inline-row wrap">
                <input class="num mono" type="number" min={1} max={100} aria-label="Anzahl" value={form.threshold} onInput={(e) => upd({ threshold: val(e) })} />
                <select aria-label="Zählweise" value={form.countBy} onChange={(e) => upd({ countBy: (e.target as HTMLSelectElement).value as Form['countBy'] })}>
                  <option value="users">verschiedene Chatter</option>
                  <option value="messages">Nachrichten</option>
                </select>
                <span>in</span>
                <input class="num mono" type="number" min={5} max={3600} aria-label="Fenster in Sekunden" value={form.windowSec} onInput={(e) => upd({ windowSec: val(e) })} />
                <span>s</span>
              </div>
              <Err text={errs.burst || srvOf('burst')} />
            </fieldset>

            <fieldset>
              <legend class="lbl">Cooldown</legend>
              <div class="inline-row wrap">
                <input class="num mono" type="number" min={0} step="any" aria-label="Cooldown" value={form.cdVal} onInput={(e) => upd({ cdVal: val(e) })} />
                <select aria-label="Einheit" value={form.cdUnit} onChange={(e) => upd({ cdUnit: (e.target as HTMLSelectElement).value as Form['cdUnit'] })}>
                  <option value="s">Sekunden</option>
                  <option value="min">Minuten</option>
                </select>
              </div>
              <Err text={errs.cooldownSec || srvOf('cooldownSec')} />
            </fieldset>

            <fieldset>
              <legend class="lbl">Channels</legend>
              {channels.length === 0 && <p class="muted">Noch keine Channels. <Link href="/channels">Channel hinzufügen</Link></p>}
              <div class="checks">
                {channels.map((c) => (
                  <label class="check" key={c.id}><input type="checkbox" checked={form.channelIds.includes(c.id)} onChange={() => toggle('channelIds', c.id)} /><span class="mono">{c.login}</span></label>
                ))}
              </div>
              <Err text={srvOf('channelIds') ?? (form.channelIds.length === 0 ? 'Hinweis: ohne Channel meldet die Regel nichts.' : '')} />
            </fieldset>

            <fieldset>
              <legend class="lbl">Ziele</legend>
              {base.data!.targets.length === 0 && <p class="muted">Noch kein Ziel. <Link href="/targets">Ziel anlegen</Link></p>}
              <div class="checks">
                {base.data!.targets.map((t) => (
                  <label class="check" key={t.id}><input type="checkbox" checked={form.targetIds.includes(t.id)} onChange={() => toggle('targetIds', t.id)} /><span>{t.name} <span class="muted">({t.kind === 'ntfy' ? 'ntfy' : 'Discord'})</span></span></label>
                ))}
              </div>
              <Err text={srvOf('targetIds') ?? (form.targetIds.length === 0 ? 'Hinweis: ohne Ziel meldet die Regel nichts.' : '')} />
            </fieldset>
          </div>
          <div class="panel-foot">
            <p class="sentence" aria-live="polite">{sentence}</p>
            <p class="err" aria-live="polite">{srv._ ?? (cooldownUntil && cooldownUntil > Date.now() ? `Regel im Cooldown: ruht bis ${hhmm(cooldownUntil)}` : '')}</p>
            <div class="inline-row wrap">
              <button class="btn" onClick={save} disabled={saving || !!problem}>{saving ? 'Speichere…' : 'Speichern'}</button>
              {id && <ConfirmButton label="Regel löschen" confirm="Wirklich löschen?" onConfirm={del} />}
              <span class="muted grow note">{problem}</span>
            </div>
          </div>
        </section>
        <section class="panel prev" id="p-prev" role="tabpanel" aria-labelledby="t-prev">
          <PreviewPanel channels={channels} login={pvLogin} setLogin={setPvLogin} pv={pv} an={an} hasPattern={hasPattern} />
        </section>
      </div>
    </div>
  );
}
