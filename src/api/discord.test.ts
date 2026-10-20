import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDiscord } from './discord.ts';

test('Discord OAuth uses identify and applications.commands with a user install', () => {
  const d = createDiscord({ clientId: 'client', clientSecret: 'secret', botToken: 'bot' });
  const url = new URL(d.authorizeUrl('state-value', 'https://app.example/api/discord/callback'));
  assert.equal(url.origin, 'https://discord.com');
  assert.equal(url.pathname, '/oauth2/authorize');
  assert.equal(url.searchParams.get('scope'), 'identify applications.commands');
  assert.equal(url.searchParams.get('integration_type'), '1');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://app.example/api/discord/callback');
  assert.equal(url.searchParams.get('state'), 'state-value');
});

test('Discord OAuth exchanges the code and reads only the linked user identity', async () => {
  const calls: { url: string; method: string; body: string; authorization: string }[] = [];
  const d = createDiscord({
    clientId: 'client', clientSecret: 'secret', baseUrl: 'https://discord.test',
    fetch: (async (input: any, init: any) => {
      const url = String(input);
      calls.push({ url, method: init.method, body: String(init.body ?? ''), authorization: String(init.headers?.Authorization ?? '') });
      if (url.endsWith('/oauth2/token')) return new Response(JSON.stringify({ access_token: 'access-only' }), { status: 200 });
      if (url.endsWith('/users/@me')) return new Response(JSON.stringify({ id: '1234', username: 'user_name' }), { status: 200 });
      return new Response('{}', { status: 404 });
    }) as typeof fetch,
  });

  const token = await d.exchangeCode('code-1', 'https://app.example/api/discord/callback');
  assert.equal(token, 'access-only');
  assert.deepEqual(await d.getUserByToken(token), { id: '1234', username: 'user_name' });
  assert.equal(calls[0]!.method, 'POST');
  const body = new URLSearchParams(calls[0]!.body);
  assert.equal(body.get('client_id'), 'client');
  assert.equal(body.get('client_secret'), 'secret');
  assert.equal(body.get('grant_type'), 'authorization_code');
  assert.equal(body.get('code'), 'code-1');
  assert.equal(body.get('redirect_uri'), 'https://app.example/api/discord/callback');
  assert.equal(calls[1]!.authorization, 'Bearer access-only');
});
