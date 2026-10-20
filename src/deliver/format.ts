import type { Hit } from '../types.ts';

export interface Formatted { title: string; text: string; url: string }

const head = (h: Hit) => `${h.sample.displayName}: ${h.sample.text}`;
const url = (h: Hit) => `https://twitch.tv/${h.channel}`;

export function formatSingle(hit: Hit): Formatted {
  return {
    title: `${hit.channel}: ${hit.ruleName}`,
    text: `Regel: ${hit.ruleName}\nChannel: ${hit.channel}\nTreffer: ${hit.count}\n${head(hit)}`,
    url: url(hit),
  };
}

export function formatBatch(hits: Hit[]): Formatted {
  const [first, ...rest] = hits as [Hit, ...Hit[]];
  const f = formatSingle(first);
  if (!rest.length) return f;
  const lines = rest.map((h) => `${h.ruleName} · ${h.channel} · ${h.count}`);
  return { title: `${f.title} (+${rest.length})`, text: `${f.text}\n+${rest.length} weitere: ${lines.join('\n')}`, url: f.url };
}

export function toDiscord(f: Formatted): { content: string; allowed_mentions: { parse: never[] } } {
  let content = `**${f.title}**\n${f.text}\n${f.url}`.replace(/@(?=everyone|here)/gi, '@​');
  if (content.length > 2000) content = `${content.slice(0, 1999)}…`;
  return { content, allowed_mentions: { parse: [] } };
}

// ntfy decodes RFC 2047 encoded-word headers; Node rejects non-Latin-1 header values.
const hdr = (s: string) => {
  const v = s.replace(/[\r\n]+/g, ' ');
  return /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, 'utf8').toString('base64')}?=`;
};

export function toNtfy(f: Formatted, priority?: string): { headers: Record<string, string>; body: string } {
  const headers: Record<string, string> = { Title: hdr(f.title), Click: f.url, Tags: 'marble' };
  if (priority) headers.Priority = priority;
  return { headers, body: f.text };
}
