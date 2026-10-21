import type { ChatMessage, Hit, Rule } from '../types.ts';
import { compileMatcher, matchesSender } from './matcher.ts';
import { cooldownMs, createBurstState, step } from './burst.ts';
import type { BurstState } from './burst.ts';

export interface EngineDeps {
  now: () => number;
  onHit: (hit: Omit<Hit, 'channelDisplayName' | 'channelAvatar'>) => void;
  log?: (line: string) => void;
  getLastFired: (ruleId: string, channelId: string) => number | null;
  setLastFired: (ruleId: string, channelId: string, ts: number) => void;
}

interface Compiled {
  rule: Rule;
  match: ReturnType<typeof compileMatcher>;
  states: Map<string, BurstState>;
  windows: Map<string, Array<{ userId: string; t: number }>>;
  tallies: Map<string, Tally>;
  ownerMatches: Map<string, number>;
  /** Persisted last-fired seeds cooldown only for rules unseen before (restart); edits ignore it. */
  seedFromDb: boolean;
}

interface Tally { since: number; mentions: number; chatters: Set<string> }

const CHATTER_LIMIT = 10_000;

function addChatter(chatters: Set<string>, userId: string): void {
  // ponytail: cap live chatter IDs at the 10,000-entry ceiling.
  if (chatters.size < CHATTER_LIMIT || chatters.has(userId)) chatters.add(userId);
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
            next.set(rule.id, { rule, match: compileMatcher(rule.matcher), states: new Map(), windows: new Map(), tallies: new Map(), ownerMatches: new Map(), seedFromDb: !old });
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
        if (!c.match(msg.text).matched) continue;
        const now = deps.now();
        if (msg.userId === rule.ownerId) c.ownerMatches.set(msg.channelId, now);
        if (!matchesSender(rule.sender, msg)) continue;
        let st = c.states.get(msg.channelId);
        if (!st) {
          const last = c.seedFromDb ? deps.getLastFired(rule.id, msg.channelId) : null;
          st = createBurstState(last === null ? 0 : last + cooldownMs(rule.cooldownSec));
          c.states.set(msg.channelId, st);
        }
        let window = c.windows.get(msg.channelId) ?? [];
        if (now >= st.cooldownUntil) {
          const cutoff = now - rule.burst.windowSec * 1000;
          window = window.filter((h) => h.t > cutoff);
          window.push({ userId: msg.userId, t: now });
          c.windows.set(msg.channelId, window);
        }
        const tally = c.tallies.get(msg.channelId);
        if (tally) {
          tally.mentions++;
          addChatter(tally.chatters, msg.userId);
        }
        const r = step(st, rule.burst, rule.cooldownSec, msg, now);
        if (!r.fired) continue;
        const firedAt = now;
        const chatters = new Set<string>();
        for (const h of window) addChatter(chatters, h.userId);
        c.tallies.set(msg.channelId, { since: firedAt, mentions: window.length, chatters });
        c.windows.set(msg.channelId, []);
        deps.setLastFired(rule.id, msg.channelId, firedAt);
        const ownerMatchAt = c.ownerMatches.get(msg.channelId);
        if (rule.skipIfSelf && ownerMatchAt !== undefined && ownerMatchAt > now - rule.burst.windowSec * 1000 && ownerMatchAt <= now) {
          deps.log?.(`rule ${rule.id} fired in ${msg.channel}, skipped: owner already joined`);
          continue;
        }
        deps.onHit({ ruleId: rule.id, ruleName: rule.name, ownerId: rule.ownerId, channelId: msg.channelId, channel: msg.channel, count: r.count, burst: rule.burst, cooldownSec: rule.cooldownSec, sample: msg, firedAt });
      }
      const micros = (performance.now() - t0) * 1000;
      messages++;
      totalMicros += micros;
      if (micros > maxMicros) maxMicros = micros;
    },

    stats(): { messages: number; avgMatchMicros: number; maxMatchMicros: number } {
      return { messages, avgMatchMicros: messages ? totalMicros / messages : 0, maxMatchMicros: maxMicros };
    },

    live(ruleId: string): { channelId: string; inWindow: number; cooling: boolean; tally: { since: number; mentions: number; chatters: number } | null }[] {
      const c = compiled.get(ruleId);
      if (!c) return [];
      const now = deps.now();
      return [...c.states].map(([channelId, state]) => {
        const cooling = now < state.cooldownUntil;
        const cutoff = now - c.rule.burst.windowSec * 1000;
        const hits = cooling ? [] : state.hits.filter((h) => h.t > cutoff);
        const inWindow = c.rule.burst.countBy === 'users' ? new Set(hits.map((h) => h.key)).size : hits.length;
        const tally = c.tallies.get(channelId);
        return { channelId, inWindow, cooling, tally: tally ? { since: tally.since, mentions: tally.mentions, chatters: tally.chatters.size } : null };
      });
    },
  };
}
