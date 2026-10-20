import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createR2, signV4 } from './r2.ts';

// Source: AWS docs "Signature Calculations for the Authorization Header: Transferring Payload in a Single Chunk" (PUT Object example).
test('signV4 matches the AWS S3 PUT Object example', () => {
  const h = signV4({
    method: 'PUT', host: 'examplebucket.s3.amazonaws.com', path: '/test$file.text',
    headers: { date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-storage-class': 'REDUCED_REDUNDANCY' },
    payload: 'Welcome to Amazon S3.', accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    region: 'us-east-1', service: 's3', date: new Date('2013-05-24T00:00:00Z'),
  });
  assert.equal(h['x-amz-content-sha256'], '44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072');
  assert.match(h.authorization, /Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd$/);
});

test('R2 uploads then deletes all but the newest 14', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'r2-'));
  const file = join(dir, 'marble-20260120.db');
  writeFileSync(file, 'x');
  const keys = Array.from({ length: 16 }, (_, i) => `marble-202601${String(i + 1).padStart(2, '0')}.db`);
  const calls: string[] = [];
  const f = (async (url: any, init: any) => {
    calls.push(`${init.method} ${new URL(String(url)).pathname}`);
    assert.match(init.headers.authorization, /^AWS4-HMAC-SHA256 /);
    return new Response(init.method === 'GET' ? `<R>${keys.map((k) => `<Key>${k}</Key>`).join('')}</R>` : '');
  }) as typeof fetch;
  await createR2({ accountId: 'acc', accessKeyId: 'k', secretAccessKey: 's', bucket: 'b' }, f).uploadAndPrune(file);
  assert.deepEqual(calls, ['PUT /b/marble-20260120.db', 'GET /b', 'DELETE /b/marble-20260102.db', 'DELETE /b/marble-20260101.db']);
});

test('R2 is a no-op without config', async () => {
  const r2 = createR2({ accountId: '', accessKeyId: '', secretAccessKey: '', bucket: '' }, (() => { throw new Error('no'); }) as never);
  assert.equal(r2.enabled, false);
  await r2.uploadAndPrune('/nonexistent');
});
