import { expect, test } from '@playwright/test';
import { apiPost, chat, desiredChannels, loginAs } from './helpers.ts';

test('overview marks a rule as fired after live chat', async ({ browser }) => {
  const ctx = await browser.newContext();
  await loginAs(ctx, '5001', 'glut_user');
  const before = await desiredChannels(ctx);
  const ch = await (await apiPost(ctx, '/api/channels', { login: 'sbx_tv' })).json();
  const id = ch.channel.id as string;
  expect((await apiPost(ctx, '/api/rules', {
    name: 'Glut', matcher: { mode: 'prefix', pattern: '!play', caseSensitive: false },
    burst: { threshold: 5, windowSec: 60, countBy: 'users' }, cooldownSec: 300, channelIds: [id], targetIds: [],
  })).ok()).toBe(true);
  await expect.poll(() => desiredChannels(ctx)).toBeGreaterThan(before); // debounce applied (channel is new)

  const page = await ctx.newPage();
  await page.goto('/');
  const row = page.locator('tr', { hasText: 'Glut' });
  await expect(row.locator('td').nth(3)).toHaveText('nie');

  const now = Date.now();
  const msgs = [1, 2, 3, 4, 5].map((n) => chat('sbx_tv', id, `50${n}`, '!play', now + n));
  expect((await apiPost(ctx, '/api/test/chat', msgs)).ok()).toBe(true);

  // Overview polls every 15 s.
  await expect(row.locator('td').nth(3)).not.toHaveText('nie', { timeout: 20_000 });
  await expect(page.getByText('Glut ·').first()).toBeVisible();
});
