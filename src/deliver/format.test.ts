import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBatch, formatSingle, toDiscordEmbeds, toNtfy } from './format.ts';
import { hit } from './fixtures.ts';

test('ntfy uses the count summary and omits the sample message', () => {
  const f = formatSingle(hit({ count: 8, burst: { threshold: 8, windowSec: 60, countBy: 'users' } }));
  assert.equal(f.title, 'chan: Play');
  assert.equal(f.text, '8 Chatter in 60 s\nRegel: Play');
  assert.equal(f.url, 'https://twitch.tv/chan');
  assert.ok(!f.text.includes('!play'));
});

test('rule test keeps its title and body markers without rendering the sample', () => {
  const f = formatSingle(hit(), true);
  assert.equal(f.title, '[Test] chan: Play');
  assert.equal(f.text, '[Test]\n5 Chatter in 60 s\nRegel: Play');
  assert.ok(!f.text.includes('!play'));
});

test('summary uses messages and minutes for longer windows', () => {
  assert.equal(formatSingle(hit({ count: 8, burst: { threshold: 8, windowSec: 120, countBy: 'messages' } })).text, '8 Nachrichten in 2 min\nRegel: Play');
  assert.equal(formatSingle(hit({ count: 3, burst: { threshold: 3, windowSec: 300, countBy: 'users' } })).text, '3 Chatter in 5 min\nRegel: Play');
});

test('batch ntfy notification lists summaries without sample messages', () => {
  const f = formatBatch([hit(), hit({ ruleName: 'B', channel: 'x', count: 3 }), hit({ ruleName: 'C', channel: 'y', count: 2 })]);
  assert.equal(f.title, 'chan: Play');
  assert.equal(f.text, '5 Chatter in 60 s\nRegel: Play\n\n3 Chatter in 60 s\nRegel: B\nChannel: x\n\n2 Chatter in 60 s\nRegel: C\nChannel: y');
  assert.ok(!f.text.includes('!play'));
  assert.equal(f.url, 'https://twitch.tv/chan');
});

test('Discord embed has channel identity, rule summary, cooldown, and delivery metadata', () => {
  const d = toDiscordEmbeds([hit({
    count: 8, firedAt: 1_000_000, channelDisplayName: 'Stream Name', channelAvatar: 'https://img.example/avatar.png',
    burst: { threshold: 8, windowSec: 60, countBy: 'users' }, cooldownSec: 45,
  })], false);
  assert.deepEqual(d, {
    content: '',
    embeds: [{
      author: { name: 'Stream Name', url: 'https://twitch.tv/chan', icon_url: 'https://img.example/avatar.png' },
      title: 'Play', url: 'https://twitch.tv/chan', description: '8 Chatter in 60 s – Schwelle erreicht', color: 0xF2A93B,
      thumbnail: { url: 'https://img.example/avatar.png' },
      fields: [
        { name: 'Channel', value: '[twitch.tv/chan](https://twitch.tv/chan)', inline: true },
        { name: 'Cooldown', value: 'ruht bis <t:1045:t>', inline: true },
      ],
      footer: { text: 'twitchPinger' }, timestamp: '1970-01-01T00:16:40.000Z',
    }],
    allowed_mentions: { parse: [] },
  });
  assert.ok(!JSON.stringify(d).includes('!play'));
});

test('Discord test embeds use test markers and the neutral test color', () => {
  const embed = toDiscordEmbeds([hit()], true).embeds[0]!;
  assert.equal(embed.title, '[Test] Play');
  assert.equal(embed.color, 0x6B7280);
  assert.equal(embed.footer.text, 'twitchPinger · Test');
});

test('Discord embeds escape mentions in all user-controlled text and omit missing avatars', () => {
  const d = toDiscordEmbeds([hit({ ruleName: '@everyone @here', channelDisplayName: 'Channel @here' })], false);
  const embed = d.embeds[0]!;
  assert.equal(embed.author.name, 'Channel @\u200bhere');
  assert.equal(embed.title, '@\u200beveryone @\u200bhere');
  assert.equal(embed.author.icon_url, undefined);
  assert.equal(embed.thumbnail, undefined);
  assert.ok(!JSON.stringify(d).includes('@everyone'));
  assert.ok(!JSON.stringify(d).includes('@here'));
  assert.deepEqual(d.allowed_mentions, { parse: [] });
});

test('ntfy title and body preserve ASCII-safe headers and priority', () => {
  const n = toNtfy(formatSingle(hit({ ruleName: 'Zähler' })), 'high');
  for (const v of Object.values(n.headers)) assert.match(v, /^[\x20-\x7e]*$/);
  assert.match(n.headers.Title!, /^=\?UTF-8\?B\?/);
  assert.equal(n.headers.Priority, 'high');
  assert.equal(n.body, '5 Chatter in 60 s\nRegel: Zähler');
  assert.equal(toNtfy(formatSingle(hit())).headers.Title, 'chan: Play');
});
