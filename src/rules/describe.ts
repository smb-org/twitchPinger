import type { ChatMessage, Rule } from '../types.ts';
import { compileMatcher, matchesSender } from './matcher.ts';
import { cooldownMs, createBurstState, effectiveThreshold, step } from './burst.ts';
import { createActivityTracker } from './activity.ts';

const BADGE_DE = { broadcaster: 'dem Broadcaster', moderator: 'Mods', vip: 'VIPs', subscriber: 'Subs' } as const;

function list(items: string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} und ${items[items.length - 1]}`;
}

function duration(sec: number): string {
  return sec >= 60 && sec % 60 === 0 ? `${sec / 60} min` : `${sec} s`;
}

/** German one-sentence summary of a rule for the live preview. */
export function describeRule(rule: Rule, channelLabels: string[]): string {
  const { matcher: m, burst: b, sender: s } = rule;
  const pat = `„${m.pattern}“`;
  const cond = (plural: boolean): string => {
    switch (m.mode) {
      case 'contains': return `die ${pat} ${plural ? 'enthalten' : 'enthält'}`;
      case 'word': return `die ${pat} als ganzes Wort ${plural ? 'enthalten' : 'enthält'}`;
      case 'prefix': return `die mit ${pat} beginn${plural ? 'en' : 't'}`;
      case 'regex': return `die auf den Ausdruck ${pat} pass${plural ? 'en' : 't'}`;
    }
  };
  let head: string;
  if (b.countBy === 'users') {
    const count = b.threshold === 1 ? '1 Chatter' : `${b.threshold} verschiedene Chatter`;
    head = `Meldet, wenn mindestens ${count}${b.minPercent ? ` (und mindestens ${b.minPercent} % der aktiven Chatter)` : ''} innerhalb von ${b.windowSec} s eine Nachricht ${b.threshold === 1 ? 'schreibt' : 'schreiben'}, ${cond(false)}`;
  } else {
    const percent = b.minPercent ? ` (und mindestens so viele wie ${b.minPercent} % der aktiven Chatter)` : '';
    head = `Meldet, wenn mindestens ${b.threshold} Nachrichten${percent}, ${cond(true)}, innerhalb von ${b.windowSec} s geschrieben werden`;
  }
  const who = [...s.badges.map((x) => BADGE_DE[x]), ...s.logins];
  const sender = who.length ? (s.exclude ? `, außer von ${list(who)}` : `, nur von ${list(who)}`) : '';
  const ch = channelLabels.length ? `, in ${list(channelLabels)}` : '';
  const self = rule.skipIfSelf ? ', aber nicht, wenn du im Zeitfenster selbst ausgelöst hast' : '';
  return `${head}${sender}${ch}${self}, danach ${duration(cooldownMs(rule.cooldownSec) / 1000)} Ruhe.`;
}

/** Replay messages (oldest first) through matcher, sender filter and burst, using sentAt as clock. */
export function simulateThreshold(rule: Rule, messages: ChatMessage[]): { hits: number; chatters: number; fires: number } {
  const match = compileMatcher(rule.matcher);
  const states = new Map<string, ReturnType<typeof createBurstState>>();
  let replayNow = messages[0]?.sentAt ?? 0;
  const activity = createActivityTracker(() => replayNow);
  const users = new Set<string>();
  let hits = 0;
  let fires = 0;
  for (const msg of messages) {
    replayNow = msg.sentAt;
    activity.record(msg.channelId, msg.userId, msg.text);
    if (!matchesSender(rule.sender, msg) || !match(msg.text).matched) continue;
    hits++;
    users.add(msg.userId);
    let st = states.get(msg.channelId);
    if (!st) states.set(msg.channelId, (st = createBurstState()));
    if (step(st, rule.burst, rule.cooldownSec, msg, msg.sentAt, effectiveThreshold(rule.burst, activity.count(msg.channelId))).fired) fires++;
  }
  return { hits, chatters: users.size, fires };
}
