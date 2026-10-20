import { useEffect, useRef, useState } from 'preact/hooks';
import type { MatchMode } from './api.ts';
import { blockLabel, blocksToPattern, readable, wordRegexConversion } from './form.ts';
import type { Block, BlockKind, Form } from './form.ts';
import { val } from './ui.tsx';

const MODES: [MatchMode, string][] = [['contains', 'enthält'], ['word', 'ganzes Wort'], ['prefix', 'beginnt mit'], ['regex', 'Ausdruck']];
const ADD: [BlockKind, string][] = [['or', 'oder'], ['wb', 'Wortgrenze'], ['digits', 'Ziffern'], ['any', 'beliebig']];
let nextId = 1;

export function MatcherBuilder({ f, set, error }: { f: Form; set: (p: Partial<Form>) => void; error?: string }) {
  const [txt, setTxt] = useState('');
  const [focusId, setFocusId] = useState<number | null>(null);
  const [say, setSay] = useState('');
  const [modeHint, setModeHint] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const shown: Block[] = f.blocks ?? (f.pattern ? [{ id: 0, kind: 'raw', text: f.pattern }] : []);

  useEffect(() => {
    if (focusId === null) return;
    box.current?.querySelector<HTMLElement>(`[data-bid="${focusId}"]`)?.focus();
    setFocusId(null);
  }, [focusId]);

  const put = (bs: Block[]) => set({ blocks: bs, pattern: blocksToPattern(bs) });
  const add = (b: Omit<Block, 'id'>) => { const nb = { ...b, id: nextId++ }; put([...shown, nb]); setFocusId(nb.id); };
  const addText = () => { if (txt) { add({ kind: 'text', text: txt }); setTxt(''); } };

  function key(e: KeyboardEvent, i: number) {
    const n = shown.length;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      const rest = shown.filter((_, k) => k !== i);
      put(rest);
      const nb = rest[Math.min(i, rest.length - 1)];
      setSay('Baustein entfernt');
      if (nb) setFocusId(nb.id);
    } else if ((e.key === 'ArrowLeft' && i > 0) || (e.key === 'ArrowRight' && i < n - 1)) {
      e.preventDefault();
      const j = e.key === 'ArrowLeft' ? i - 1 : i + 1;
      const bs = [...shown];
      [bs[i], bs[j]] = [bs[j]!, bs[i]!];
      put(bs);
      setFocusId(shown[i]!.id);
      setSay(`Baustein ${blockLabel(shown[i]!)} an Position ${j + 1} von ${n}`);
    }
  }
  function pickMode(m: MatchMode) {
    if (m === f.mode) return;
    setModeHint('');
    if (m === 'regex' && f.mode === 'word') {
      const conversion = wordRegexConversion(f.pattern);
      if (!conversion.pattern) { setModeHint(conversion.hint ?? ''); return; }
      set({ mode: m, pattern: conversion.pattern, blocks: null });
      return;
    }
    set(m === 'regex' ? { mode: m, pattern: readable(f), blocks: null } : { mode: m, blocks: null });
  }

  return (
    <fieldset class="builder">
      <legend class="lbl">Bedingung</legend>
      <div class="seg" role="group" aria-label="Suchmodus">
        {MODES.map(([m, l]) => <button type="button" key={m} aria-pressed={f.mode === m} onClick={() => pickMode(m)}>{l}</button>)}
      </div>

      {f.mode !== 'regex' ? (
        <label class="field">
          <span class="lbl">Text</span>
          <input class="mono" value={f.pattern} onInput={(e) => { setModeHint(''); set({ pattern: val(e), blocks: null }); }} placeholder="z. B. !play" autocomplete="off" spellcheck={false} />
        </label>
      ) : (
        <>
          <div class="lbl" id="bl">Bausteine</div>
          <div class="chips" ref={box} role="group" aria-labelledby="bl" aria-describedby="bhelp">
            {shown.length === 0 && <span class="muted">Noch keine Bausteine.</span>}
            {shown.map((b, i) => (
              <button type="button" class="chip mono" key={b.id} data-bid={b.id} onKeyDown={(e) => key(e, i)}>{blockLabel(b)}</button>
            ))}
          </div>
          <p id="bhelp" class="small muted">Entf löscht den Baustein, Pfeil links/rechts verschiebt ihn.</p>
          <span class="sr" role="status">{say}</span>
          <div class="inline-row">
            <input class="mono grow" aria-label="Text für Baustein" value={txt} onInput={(e) => setTxt(val(e))} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addText(); } }} placeholder="Text (wird wörtlich gesucht)" autocomplete="off" spellcheck={false} />
            <button type="button" class="btn ghost" disabled={!txt} onClick={addText}>+ Text</button>
          </div>
          <div class="chips add">
            {ADD.map(([k, l]) => <button type="button" class="chip" key={k} onClick={() => add({ kind: k })}>+ {l}</button>)}
          </div>
        </>
      )}

      <label class="field">
        <span class="lbl">{f.mode === 'regex' ? 'Ausdruck (frei bearbeitbar)' : 'Ausdruck (lesbar)'}</span>
        {f.mode === 'regex'
          ? <input class="mono" value={f.pattern} onInput={(e) => set({ pattern: val(e), blocks: null })} autocomplete="off" spellcheck={false} aria-describedby="rx-err" />
          : <output class="mono expr">{readable(f) || '–'}</output>}
      </label>
      {modeHint && <p class="small muted" role="status">{modeHint}</p>}
      <p id="rx-err" class="err" aria-live="polite">{error}</p>

      <label class="switch">
        <input type="checkbox" checked={!f.caseSensitive} onChange={(e) => set({ caseSensitive: !(e.target as HTMLInputElement).checked })} />
        <span>Groß-/Kleinschreibung egal</span>
      </label>
    </fieldset>
  );
}
