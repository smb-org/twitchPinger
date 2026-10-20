import type { APIRequestContext, BrowserContext } from '@playwright/test';

export const APP = 'http://localhost:12174';
const JSON_H = { Origin: APP, 'Content-Type': 'application/json' };

export async function loginAs(ctx: BrowserContext, userId: string, login: string, isAdmin = false) {
  const r = await ctx.request.post('/api/test/login-as', { data: { userId, login, isAdmin } });
  if (!r.ok()) throw new Error(`login-as failed: ${r.status()}`);
}

export async function nextTwitchUser(request: APIRequestContext, id: string, login: string) {
  await request.post('http://localhost:12175/mock/next-user', { data: { id, login } });
}

export const apiPost = (ctx: BrowserContext, path: string, data: unknown) => ctx.request.post(path, { data, headers: JSON_H });

/** Wait until the server applied the debounced config (desired channel count). */
export async function desiredChannels(ctx: BrowserContext): Promise<number> {
  return (await (await ctx.request.get('/api/health')).json()).reader.desired;
}

export function chat(channel: string, channelId: string, userId: string, text: string, sentAt: number) {
  return { channel, channelId, userId, login: `u${userId}`, displayName: `u${userId}`, text, badges: [], sentAt, receivedAt: sentAt };
}
