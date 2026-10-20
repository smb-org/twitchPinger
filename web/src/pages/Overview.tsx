import { useEffect, useRef, useState } from 'preact/hooks';
import { api, meStore } from '../api.ts';
import type { Channel, OverviewRule, Ping, TargetDto } from '../api.ts';
import { Link } from '../router.tsx';
import { RuleTestButton } from '../rule-test.tsx';
import { Dot, LoadError, PageHead, Placeholder, ago, hhmm, resting, toast, useLoad, useTitle } from '../ui.tsx';

interface Data { rules: OverviewRule[]; lastPings: Ping[] }
const GLOW_MS = 10_000;
const lastTs = (r: OverviewRule) => Math.max(0, ...r.lastFired.map((l) => l.ts));

function status(r: OverviewRule): { kind: 'ok' | 'off' | 'warn'; text: string } {
  if (!r.enabled) return { kind: 'off', text: 'pausiert' };
  if (r.targetIds.length === 0) return { kind: 'warn', text: 'kein Ziel – meldet nichts' };
  if (r.channelIds.length === 0) return { kind: 'warn', text: 'kein Channel' };
  return { kind: 'ok', text: 'aktiv' };
}

export function Overview() {
  useTitle('Übersicht');
  const me = meStore.get()!;
  const [glow, setGlow] = useState<Set<string>>(new Set());
  const seen = useRef<Map<string, number> | null>(null);
  const { data, error, loading, reload } = useLoad(() => api<Data>('GET', '/overview'), [], 15_000);

  // Glut: a rule fired within the last 10 s, or fired since the previous poll.
  useEffect(() => {
    if (!data) return;
    const prev = seen.current;
    const next = new Map<string, number>();
    const hot = new Set<string>();
    for (const r of data.rules) {
      const ts = lastTs(r);
      next.set(r.id, ts);
      const fresh = prev ? ts > (prev.get(r.id) ?? 0) : Date.now() - ts < GLOW_MS;
      if (ts && fresh) hot.add(r.id);
    }
    seen.current = next;
    if (!hot.size) return;
    setGlow(hot);
    const t = setTimeout(() => setGlow(new Set()), 1400);
    return () => clearTimeout(t);
  }, [data]);

  const chData = useLoad(() => api<{ channels: Channel[] }>('GET', '/channels'), []).data;
  const targetData = useLoad(() => api<{ targets: TargetDto[] }>('GET', '/targets'), []).data;
  const logins = new Map((chData?.channels ?? []).map((c) => [c.id, c.login]));
  useEffect(() => { if (error && !data) toast(error.message, 'error', { label: 'Wiederholen', run: reload }); }, [error]);

  const rules = data?.rules;
  const atLimit = !!rules && rules.length >= me.limits.MAX_RULES_PER_USER;
  const chanNames = (r: OverviewRule) => r.channelIds.map((id) => logins.get(id) ?? '…').join(', ') || '–';

  return (
    <div class="page">
      <PageHead title="Übersicht">
        {atLimit && <span class="muted note">Limit erreicht: höchstens {me.limits.MAX_RULES_PER_USER} Regeln.</span>}
        {atLimit ? <button class="btn" disabled>Neue Regel</button> : <Link href="/rules/new" class="btn">Neue Regel</Link>}
      </PageHead>
      <div class="overview">
        <section aria-label="Regeln">
          {!rules && !error && <Placeholder rows={4} />}
          {!rules && error && <LoadError error={error} retry={reload} />}
          {rules && rules.length === 0 && (
            <div class="empty">
              <p>Noch keine Regel. Mit der Marbles-Vorlage starten.</p>
              <Link href="/rules/new?vorlage=marbles" class="btn">Marbles-Vorlage nutzen</Link>
            </div>
          )}
          {rules && rules.length > 0 && (
            <table class="rules">
              <thead>
                <tr><th>Name</th><th class="hide-sm">Channels</th><th>Status</th><th>Zuletzt ausgelöst</th><th class="hide-sm">Cooldown</th><th>Aktion</th></tr>
              </thead>
              <tbody>
                {rules.map((r) => {
                  const s = status(r);
                  const ts = lastTs(r);
                  return (
                    <tr key={r.id} class={glow.has(r.id) ? 'glut' : undefined}>
                      <td>
                        <Link href={`/rules/${encodeURIComponent(r.id)}`} class="rule-name">{r.name}</Link>
                        <span class="sub mono">{chanNames(r)}</span>
                      </td>
                      <td class="mono hide-sm">{chanNames(r)}</td>
                      <td><Dot kind={s.kind} /> {s.text}</td>
                      <td class="mono">{ts ? ago(ts) : 'nie'}</td>
                      <td class="mono hide-sm">{resting(r.lastFired) || '–'}</td>
                      <td class="test-action"><RuleTestButton id={r.id} targets={targetData?.targets} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
        <aside class="pings" aria-label="Letzte Pings">
          <h2>Letzte Pings</h2>
          <div class="pings-body">
            {!data && loading && <p class="muted">Lade…</p>}
            {data && data.lastPings.length === 0 && <p class="muted">Noch nichts ausgelöst.</p>}
            {data?.lastPings.map((p) => (
              <div class="ping" key={p.hitId}>
                <div class="mono">{hhmm(p.firedAt)}</div>
                <div class="mono small">{p.ruleName}{p.channel ? ` · ${p.channel}` : ''}</div>
                <div class="mono small">
                  {p.results.length === 0 ? <span class="muted">{p.hasTargets ? 'wird gesendet…' : 'kein Ziel'}</span> : p.results.map((x) => (
                    <span key={x.targetId} class={x.ok ? 'okc' : 'errc'}>{x.targetName ?? 'Ziel'} {x.ok ? '✓' : '✗ fehlerhaft'}{' '}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
