import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBatch, formatSingle, toDiscord, toNtfy } from './format.ts';
import { hit } from './fixtures.ts';

test('single', () => {
  const f = formatSingle(hit());
  assert.equal(f.url, 'https://twitch.tv/chan');
  assert.match(f.text, /Bob: !play/);
});

test('batch lists further hits without samples', () => {
  const f = formatBatch([hit(), hit({ ruleName: 'B', channel: 'x', count: 3 }), hit({ ruleName: 'C', channel: 'y', count: 2 })]);
  assert.match(f.text, /\+2 weitere:/);
  assert.match(f.text, /B · x · 3/);
  assert.equal(f.text.match(/!play/g)?.length, 1);
  assert.equal(f.url, 'https://twitch.tv/chan');
});

test('discord escapes mentions without silently truncating', () => {
  const d = toDiscord({ title: 't', text: '@everyone @here hi', url: 'u' });
  assert.ok(!d.content.includes('@everyone') && !d.content.includes('@here'));
  assert.deepEqual(d.allowed_mentions, { parse: [] });
  assert.ok(toDiscord({ title: 't', text: 'x'.repeat(5000), url: 'u' }).content.length > 2000);
});

test('ntfy headers are ASCII-safe', () => {
  const n = toNtfy({ title: 'Zähler ü', text: 'b', url: 'https://twitch.tv/c' }, 'high');
  for (const v of Object.values(n.headers)) assert.match(v, /^[\x20-\x7e]*$/);
  assert.match(n.headers.Title!, /^=\?UTF-8\?B\?/);
  assert.equal(n.headers.Priority, 'high');
  assert.equal(toNtfy({ title: 'plain', text: 'b', url: 'u' }).headers.Title, 'plain');
});
