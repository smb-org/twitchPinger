import { useEffect, useState } from 'preact/hooks';
import { api, ApiError, errText } from './api.ts';
import type { TargetDto } from './api.ts';
import { toast } from './ui.tsx';

interface RuleTestResult { targetId: string; kind: 'discord' | 'discord_dm' | 'ntfy'; ok: boolean; error?: string }

const kindName = (kind: RuleTestResult['kind']) => kind === 'ntfy' ? 'ntfy' : kind === 'discord_dm' ? 'Discord-DM' : 'Discord';
const cooldowns = new Map<string, number>();
const cooldownFor = (id: string) => {
  const until = cooldowns.get(id) ?? 0;
  if (until <= Date.now()) { cooldowns.delete(id); return 0; }
  return until;
};

export function RuleTestButton({ id, targets = [], disabledReason }: { id: string; targets?: Pick<TargetDto, 'id' | 'name'>[]; disabledReason?: string }) {
  const [running, setRunning] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState(() => cooldownFor(id));
  const [clock, setClock] = useState(() => Date.now());
  const cooling = cooldownUntil > clock;

  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const timer = setInterval(() => setClock(Date.now()), 250);
    return () => clearInterval(timer);
  }, [cooldownUntil]);

  async function run() {
    const startedAt = Date.now();
    if (running || startedAt < cooldownUntil) return;
    setRunning(true);
    setClock(startedAt);
    cooldowns.set(id, startedAt + 10_000);
    setCooldownUntil(startedAt + 10_000);
    try {
      const { results } = await api<{ results: RuleTestResult[] }>('POST', `/rules/${encodeURIComponent(id)}/test`);
      const failed = results.some((result) => !result.ok);
      const lines = results.map((result) => {
        const outcome = result.ok ? 'OK' : `Fehler${result.error ? ` – ${result.error}` : ''}`;
        const name = targets.find((target) => target.id === result.targetId)?.name ?? `${kindName(result.kind)} ${result.targetId.slice(0, 6)}`;
        return `● ${name}: ${outcome}`;
      });
      toast(lines.join(' · ') || 'Keine Ziele getestet.', failed || !lines.length ? 'error' : 'ok');
    } catch (e) {
      toast(errText(e), 'error');
      if (e instanceof ApiError && e.code === 'no_targets') {
        cooldowns.delete(id);
        setCooldownUntil(0);
      } else if (e instanceof ApiError && e.status === 429) {
        const until = Date.now() + (e.retryAfterMs ?? 10_000);
        cooldowns.set(id, until);
        setCooldownUntil(until);
      }
    } finally {
      setRunning(false);
      setClock(Date.now());
    }
  }

  const hint = running ? 'Testnachricht wird gesendet…'
    : cooling ? `Erneut möglich in ${Math.ceil((cooldownUntil - clock) / 1000)} s`
      : disabledReason ?? '\u00a0';

  return (
    <div class="rule-test">
      <button type="button" class="btn ghost sm" onClick={run} disabled={running || cooling || !!disabledReason} aria-label="Test auslösen" aria-describedby={`rule-test-hint-${id}`}>Test</button>
      <span class="rule-test-hint" id={`rule-test-hint-${id}`} aria-live="polite">{hint}</span>
    </div>
  );
}
