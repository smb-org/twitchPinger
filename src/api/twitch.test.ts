import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTwitch } from './twitch.ts';

test('Helix user mapping includes profile_image_url as avatarUrl', async () => {
  const fetch = (async (input: any) => {
    const url = new URL(String(input));
    const data = url.pathname.endsWith('/oauth2/token')
      ? { access_token: 'app', expires_in: 3600 }
      : { data: [{ id: 'c1', login: 'channel', display_name: 'Channel', profile_image_url: 'https://img.example/channel.png' }] };
    return new Response(JSON.stringify(data), { status: 200 });
  }) as typeof globalThis.fetch;
  const twitch = createTwitch({ clientId: 'client', clientSecret: 'secret', authBase: 'https://auth.test', helixBase: 'https://helix.test', fetch });
  assert.deepEqual(await twitch.getUsersByLogin(['channel']), [{ id: 'c1', login: 'channel', displayName: 'Channel', avatarUrl: 'https://img.example/channel.png' }]);
});
