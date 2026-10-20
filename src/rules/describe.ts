import type { ChatMessage, Rule } from '../types.ts';
import { compileMatcher, matchesSender } from './matcher.ts';
import { cooldownMs, createBurstState, step } from './burst.ts';

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
  if (b.threshold <= 1) head = `Meldet jede Nachricht, ${cond(false)}`;
  else if (b.countBy === 'users') head = `Meldet, wenn ${b.threshold} verschiedene Chatter innerhalb von ${b.windowSec} s eine Nachricht schreiben, ${cond(false)}`;
  else head = `Meldet, wenn ${b.threshold} Nachrichten, ${cond(true)}, innerhalb von ${b.windowSec} s geschrieben werden`;
  const who = [...s.badges.map((x) => BADGE_DE[x]), ...s.logins];
  const sender = who.length ? (s.exclude ? `, außer von ${list(who)}` : `, nur von ${list(who)}`) : '';
  const ch = channelLabels.length ? `, in ${list(channelLabels)}` : '';
  return `${head}${sender}${ch}, danach ${duration(cooldownMs(rule.cooldownSec) / 1000)} Ruhe.`;
}

/** Replay messages (oldest first) through matcher, sender filter and burst, using sentAt as clock. */
export function simulateThreshold(rule: Rule, messages: ChatMessage[]): { hits: number; chatters: number; fires: number } {
  const match = compileMatcher(rule.matcher);
  const states = new Map<string, ReturnType<typeof createBurstState>>();
  const users = new Set<string>();
  let hits = 0;
  let fires = 0;
  for (const msg of messages) {
    if (!matchesSender(rule.sender, msg) || !match(msg.text).matched) continue;
    hits++;
    users.add(msg.userId);
    let st = states.get(msg.channelId);
    if (!st) states.set(msg.channelId, (st = createBurstState()));
    if (step(st, rule.burst, rule.cooldownSec, msg, msg.sentAt).fired) fires++;
  }
  return { hits, chatters: users.size, fires };
}
