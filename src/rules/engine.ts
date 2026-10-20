import type { ChatMessage, Hit, Rule } from '../types.ts';
import { compileMatcher, matchesSender } from './matcher.ts';
import { cooldownMs, createBurstState, step } from './burst.ts';
import type { BurstState } from './burst.ts';

export interface EngineDeps {
  now: () => number;
  onHit: (hit: Hit) => void;
  log?: (line: string) => void;
  getLastFired: (ruleId: string, channelId: string) => number | null;
  setLastFired: (ruleId: string, channelId: string, ts: number) => void;
}

interface Compiled {
  rule: Rule;
  match: ReturnType<typeof compileMatcher>;
  states: Map<string, BurstState>;
  /** Persisted last-fired seeds cooldown only for rules unseen before (restart); edits ignore it. */
  seedFromDb: boolean;
}

export function createEngine(deps: EngineDeps) {
  let compiled = new Map<string, Compiled>();
  const byChannel = new Map<string, Compiled[]>();
  let messages = 0;
  let totalMicros = 0;
  let maxMicros = 0;

  return {
    setRules(rules: Rule[]): void {
      const next = new Map<string, Compiled>();
      for (const rule of rules) {
        if (!rule.enabled) continue;
        const old = compiled.get(rule.id);
        if (old && old.rule.updatedAt === rule.updatedAt) {
          old.rule = rule;
          next.set(rule.id, old);
        } else {
          // Edited or new: fresh state, persisted last-fired ignored only when it replaces an existing rule.
          try {
            next.set(rule.id, { rule, match: compileMatcher(rule.matcher), states: new Map(), seedFromDb: !old });
          } catch (err) {
            (deps.log ?? console.error)(`rule ${rule.id} skipped, matcher does not compile: ${err}`);
          }
        }
      }
      compiled = next;
      byChannel.clear();
      for (const c of next.values()) {
        for (const ch of c.rule.channelIds) {
          const l = byChannel.get(ch);
          if (l) l.push(c); else byChannel.set(ch, [c]);
        }
      }
    },

    ingest(msg: ChatMessage): void {
      const list = byChannel.get(msg.channelId);
      if (!list) return;
      const t0 = performance.now();
      for (const c of list) {
        const { rule } = c;
        if (!matchesSender(rule.sender, msg) || !c.match(msg.text).matched) continue;
        let st = c.states.get(msg.channelId);
        if (!st) {
          const last = c.seedFromDb ? deps.getLastFired(rule.id, msg.channelId) : null;
          st = createBurstState(last === null ? 0 : last + cooldownMs(rule.cooldownSec));
          c.states.set(msg.channelId, st);
        }
        const r = step(st, rule.burst, rule.cooldownSec, msg, deps.now());
        if (!r.fired) continue;
        const firedAt = deps.now();
        deps.setLastFired(rule.id, msg.channelId, firedAt);
        deps.onHit({ ruleId: rule.id, ruleName: rule.name, ownerId: rule.ownerId, channelId: msg.channelId, channel: msg.channel, count: r.count, sample: msg, firedAt });
      }
      const micros = (performance.now() - t0) * 1000;
      messages++;
      totalMicros += micros;
      if (micros > maxMicros) maxMicros = micros;
    },

    stats(): { messages: number; avgMatchMicros: number; maxMatchMicros: number } {
      return { messages, avgMatchMicros: messages ? totalMicros / messages : 0, maxMatchMicros: maxMicros };
    },
  };
}
