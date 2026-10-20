import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkTargetUrl, isPublicAddress, safePost } from './ssrf.ts';

test('isPublicAddress blocked', () => {
  for (const ip of ['0.1.2.3', '10.1.1.1', '100.64.0.1', '100.127.255.255', '127.0.0.1', '169.254.1.1', '172.16.0.1', '172.31.255.255',
    '192.0.0.1', '192.0.2.5', '192.88.99.1', '192.168.1.1', '198.18.0.1', '198.19.255.255', '198.51.100.7', '203.0.113.9',
    '224.0.0.1', '239.1.1.1', '240.0.0.1', '255.255.255.255', '::', '::1', '::ffff:10.0.0.1', '::ffff:7f00:1', '64:ff9b::10.0.0.1',
    '100::1', '2001::1', '2001:1ff::1', '2001:db8::1', 'fc00::1', 'fd12::1', 'fe80::1', 'febf::1', 'ff02::1', '::127.0.0.1', '::7f00:1', '2002:7f00:1::1', 'fec0::1', 'feff::1', '64:ff9b:1::1', 'not-an-ip']) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
});

test('isPublicAddress allowed', () => {
  for (const ip of ['1.1.1.1', '8.8.8.8', '172.32.0.1', '100.128.0.1', '198.20.0.1', '2606:4700::1111', '::ffff:1.1.1.1', '64:ff9b::1.1.1.1', '2001:200::1']) {
    assert.equal(isPublicAddress(ip), true, ip);
  }
});

test('checkTargetUrl', () => {
  const ok = (k: 'discord' | 'ntfy', u: string) => checkTargetUrl(k, u).ok;
  assert.equal(ok('discord', 'http://discord.com/api/webhooks/1/x'), false);
  assert.equal(ok('discord', 'https://discord.com.evil.tld/api/webhooks/1/x'), false);
  assert.equal(ok('discord', 'https://evildiscord.com/api/webhooks/1/x'), false);
  assert.equal(ok('discord', 'https://ptb.discord.com/api/webhooks/1/x'), true);
  assert.equal(ok('discord', 'https://discordapp.com/api/webhooks/1/x'), true);
  assert.equal(ok('discord', 'https://discord.com/other'), false);
  assert.equal(ok('discord', 'https://u:p@discord.com/api/webhooks/1/x'), false);
  assert.equal(ok('ntfy', 'https://ntfy.example.org/mn-abc'), true);
  assert.equal(ok('ntfy', 'https://127.0.0.1/x'), false);
  assert.equal(ok('ntfy', 'https://[::1]/x'), false);
  assert.equal(ok('ntfy', 'https://1.1.1.1/x'), true);
  assert.equal(ok('ntfy', 'nonsense'), false);
});

const init = { headers: {}, body: '{}', timeoutMs: 1000 };
const stub = (addrs: string[]) => ((_h: string, _o: unknown, cb: (e: null, a: { address: string; family: number }[]) => void) =>
  cb(null, addrs.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })))) as never;

test('safePost blocks private and mixed DNS answers', async () => {
  for (const addrs of [['10.0.0.5'], ['1.1.1.1', '127.0.0.1'], ['::1']]) {
    await assert.rejects(safePost('https://example.org/x', init, { lookup: stub(addrs) }), { code: 'SSRF_BLOCKED' });
  }
  await assert.rejects(safePost('https://127.0.0.1/x', init), { code: 'SSRF_BLOCKED' });
  await assert.rejects(safePost('http://example.org/x', init), { code: 'SSRF_BLOCKED' });
});
