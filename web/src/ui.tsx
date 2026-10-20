import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { ApiError } from './api.ts';
import { store } from './store.ts';

// ---- time ----
const pad = (n: number) => String(n).padStart(2, '0');
export const hhmm = (ts: number) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const hhmmss = (ts: number) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
export function ago(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 30) return 'gerade eben';
  if (s < 3600) return `vor ${Math.max(1, Math.floor(s / 60))} min`;
  if (s < 86400) return `vor ${Math.floor(s / 3600)} Std`;
  const d = Math.floor(s / 86400);
  return `vor ${d} ${d === 1 ? 'Tag' : 'Tagen'}`;
}
export function inFuture(ts: number, now = Date.now()): string {
  const s = Math.round((ts - now) / 1000);
  if (s < 3600) return 'in weniger als 1 Std';
  if (s < 86400) return `in ${Math.floor(s / 3600)} Std`;
  const d = Math.floor(s / 86400);
  return `in ${d} ${d === 1 ? 'Tag' : 'Tagen'}`;
}

// ---- toasts ----
interface T { id: number; text: string; kind: 'ok' | 'error'; action?: { label: string; run: () => void } }
const toasts = store<T[]>([]);
let seq = 0;
const dismiss = (id: number) => toasts.set(toasts.get().filter((t) => t.id !== id));
export function toast(text: string, kind: T['kind'] = 'ok', action?: T['action']) {
  const id = ++seq;
  toasts.set([...toasts.get(), { id, text, kind, action }].slice(-3));
  setTimeout(() => dismiss(id), action ? 9000 : 4500);
}
export function Toasts() {
  const list = toasts.use();
  return (
    <div class="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} class={`toast ${t.kind}`}>
          <span>{t.kind === 'error' && <b>Fehler: </b>}{t.text}</span>
          {t.action && <button class="btn ghost sm" onClick={() => { dismiss(t.id); t.action!.run(); }}>{t.action.label}</button>}
        </div>
      ))}
    </div>
  );
}

export async function copy(text: string, msg = 'Link kopiert') {
  try {
    await navigator.clipboard.writeText(text);
    toast(msg);
  } catch {
    toast('Kopieren nicht möglich – bitte von Hand markieren.', 'error');
  }
}

// ---- data loading ----
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = [], every = 0) {
  const [s, setS] = useState<{ data?: T; error?: ApiError; loading: boolean }>({ loading: true });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const seqRef = useRef(0);
  const load = useCallback(async () => {
    const n = ++seqRef.current;
    try {
      const data = await fnRef.current();
      if (n === seqRef.current) setS({ data, loading: false });
      return data;
    } catch (e) {
      if (n === seqRef.current) setS((p) => ({ data: p.data, error: e as ApiError, loading: false }));
    }
  }, []);
  useEffect(() => {
    setS((p) => ({ data: p.data, loading: true }));
    load();
    if (!every) return;
    const t = setInterval(load, every);
    return () => clearInterval(t);
  }, deps);
  return { ...s, reload: load };
}

export function useTitle(t: string) {
  useEffect(() => { document.title = `${t} · twitchPinger`; }, [t]);
}

export const val = (e: Event) => (e.target as HTMLInputElement).value;

// ---- small components ----
export function Err({ text }: { text?: string | null }) {
  return <p class="err" aria-live="polite">{text}</p>;
}

export function Dot({ kind }: { kind: 'ok' | 'off' | 'warn' | 'error' }) {
  return <span class={`dot ${kind}`} aria-hidden="true" />;
}

export function PageHead({ title, children }: { title: string; children?: ComponentChildren }) {
  return (
    <header class="page-head">
      <h1>{title}</h1>
      <div class="actions">{children}</div>
    </header>
  );
}

export function Placeholder({ rows = 3 }: { rows?: number }) {
  return <ul class="list" aria-hidden="true">{Array.from({ length: rows }, (_, i) => <li key={i} class="row ph" />)}</ul>;
}

export function LoadError({ error, retry }: { error: ApiError; retry: () => void }) {
  return (
    <div class="empty">
      <p>{error.message}</p>
      <button class="btn ghost" onClick={retry}>Wiederholen</button>
    </div>
  );
}

/** Two-step button: first click arms it, second runs. Same cell width in both states. */
export function ConfirmButton({ label, confirm = 'Wirklich?', onConfirm, disabled }: { label: string; confirm?: string; onConfirm: () => void; disabled?: boolean }) {
  const [arm, setArm] = useState(false);
  useEffect(() => {
    if (!arm) return;
    const t = setTimeout(() => setArm(false), 4000);
    return () => clearTimeout(t);
  }, [arm]);
  return (
    <button
      class={`btn ghost confirm${arm ? ' danger' : ''}`}
      disabled={disabled}
      onBlur={() => setArm(false)}
      onClick={() => { if (arm) { setArm(false); onConfirm(); } else setArm(true); }}
    >
      {arm ? confirm : label}
    </button>
  );
}

export function Field({ label, error, hint, children }: { label: string; error?: string | null; hint?: string; children: ComponentChildren }) {
  return (
    <label class="field">
      <span class="lbl">{label}{hint && <span class="hint"> · {hint}</span>}</span>
      {children}
      <Err text={error} />
    </label>
  );
}
