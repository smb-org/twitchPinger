import type { Hit } from '../types.ts';
import { cooldownMs } from '../rules/burst.ts';

export interface Formatted { title: string; text: string; url: string }

const url = (h: Hit) => `https://twitch.tv/${h.channel}`;
const escapeMentions = (s: string) => s.replace(/@(?=everyone|here)/gi, '@\u200b');

function summary(hit: Hit): string {
  const amount = hit.burst.countBy === 'users' ? 'Chatter' : 'Nachrichten';
  const window = hit.burst.windowSec < 120
    ? `${hit.burst.windowSec} s`
    : `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(hit.burst.windowSec / 60)} min`;
  return `${hit.count} ${amount} in ${window}`;
}

export function formatSingle(hit: Hit, isTest = false): Formatted {
  const marker = isTest ? '[Test] ' : '';
  return {
    title: `${marker}${hit.channel}: ${hit.ruleName}`,
    text: `${isTest ? '[Test]\n' : ''}${summary(hit)}\nRegel: ${hit.ruleName}`,
    url: url(hit),
  };
}

export function formatBatch(hits: Hit[]): Formatted {
  const [first, ...rest] = hits as [Hit, ...Hit[]];
  return {
    title: `${first.channel}: ${first.ruleName}`,
    text: [first, ...rest].map((hit, index) => `${summary(hit)}\nRegel: ${hit.ruleName}${index ? `\nChannel: ${hit.channel}` : ''}`).join('\n\n'),
    url: url(first),
  };
}

export function toDiscord(f: Formatted): { content: string; allowed_mentions: { parse: never[] } } {
  const content = `**${f.title}**\n${f.text}\n${f.url}`.replace(/@(?=everyone|here)/gi, '@\u200b');
  return { content, allowed_mentions: { parse: [] } };
}

export function toDiscordEmbeds(hits: Hit[], isTest = false) {
  return {
    content: '',
    embeds: hits.map((hit) => {
      const twitchUrl = url(hit);
      const avatar = hit.channelAvatar;
      const cooldownUntil = Math.floor((hit.firedAt + cooldownMs(hit.cooldownSec)) / 1000);
      return {
        author: {
          name: escapeMentions(hit.channelDisplayName), url: twitchUrl,
          ...(avatar ? { icon_url: avatar } : {}),
        },
        title: `${isTest ? '[Test] ' : ''}${escapeMentions(hit.ruleName)}`,
        url: twitchUrl,
        description: `${summary(hit)} – Schwelle erreicht`,
        color: isTest ? 0x6B7280 : 0xF2A93B,
        ...(avatar ? { thumbnail: { url: avatar } } : {}),
        fields: [
          { name: 'Channel', value: `[twitch.tv/${escapeMentions(hit.channel)}](${twitchUrl})`, inline: true },
          { name: 'Cooldown', value: `ruht bis <t:${cooldownUntil}:t>`, inline: true },
        ],
        footer: { text: isTest ? 'twitchPinger · Test' : 'twitchPinger' },
        timestamp: new Date(hit.firedAt).toISOString(),
      };
    }),
    allowed_mentions: { parse: [] as never[] },
  };
}

/** Discord's 6000-character embed total covers text fields, not URLs or timestamps. */
export function discordEmbedsTextLength(payload: ReturnType<typeof toDiscordEmbeds>): number {
  return payload.embeds.reduce((sum, embed) => sum + embed.author.name.length + embed.title.length + embed.description.length
    + embed.fields.reduce((fieldSum, field) => fieldSum + field.name.length + field.value.length, 0) + embed.footer.text.length, 0);
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
