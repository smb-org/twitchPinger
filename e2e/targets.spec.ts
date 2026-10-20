import { expect, test } from '@playwright/test';
import { APP, loginAs } from './helpers.ts';

test('ntfy target accepts a custom server URL without shifting the form', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await loginAs(ctx, '8001', 'target_user');
  const page = await ctx.newPage();
  await page.goto('/targets');

  const url = page.getByLabel('Server-URL');
  const row = page.locator('form.inline-form .inline-row').first();
  const before = await row.boundingBox();
  await page.getByRole('button', { name: 'Discord', exact: true }).click();
  await expect(page.getByLabel('Webhook-URL')).toBeVisible();
  const after = await row.boundingBox();
  expect(after?.y).toBeCloseTo(before!.y, 0);
  expect(after?.height).toBe(before!.height);

  await page.getByRole('button', { name: 'Handy (ntfy)' }).click();
  await url.fill('https://ntfy.example.test/custom-topic');
  await page.getByRole('button', { name: 'Neues Handy-Ziel' }).click();
  await expect(page.locator('.help ol code')).toHaveText('custom-topic');
  const response = await ctx.request.get('/api/targets');
  expect((await response.json()).targets[0].url).toBe('https://ntfy.example.test/custom-topic');
  await ctx.close();
});

test('Discord DM can be linked and added during onboarding step 2', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await loginAs(ctx, '8002', 'discord_user');
  const page = await ctx.newPage();
  await page.goto('/onboarding');
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(page.getByRole('button', { name: 'Discord-Direktnachricht' })).toBeVisible();
  await page.getByRole('button', { name: 'Discord-Direktnachricht' }).click();
  await page.getByRole('link', { name: 'Mit Discord verbinden' }).click();
  await expect(page.locator('.discord-linked')).toContainText('e2e_discord');
  await page.getByRole('button', { name: 'Ziel anlegen' }).click();
  await expect(page.locator('.row.target').filter({ hasText: 'Discord-Direktnachricht' })).toBeVisible();
  const response = await ctx.request.get('/api/targets');
  const targets = (await response.json()).targets;
  expect(targets).toHaveLength(1);
  expect(targets[0]).toMatchObject({ kind: 'discord_dm', name: 'Discord-DM', url: '' });
  await ctx.request.delete('/api/discord/link', { headers: { Origin: APP } });
  await page.reload();
  const dmRow = page.locator('.row.target').filter({ hasText: 'Discord-Direktnachricht' });
  await expect(dmRow.locator('.tstat')).toContainText('nicht verbunden');
  await expect(dmRow.locator('.tstat-hint')).toContainText('Discord nicht verbunden.');
  await ctx.close();
});

test('Discord target query does not expose the feature when /me says it is unavailable', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await loginAs(ctx, '8003', 'discord_hidden');
  const page = await ctx.newPage();
  await page.route('**/api/me', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.discordDm = { available: false, username: null };
    await route.fulfill({ response, json: body });
  });
  await page.goto('/targets?target=discord_dm');
  await expect(page.getByRole('button', { name: 'Discord-Direktnachricht' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Mit Discord verbinden' })).toHaveCount(0);
  await ctx.close();
});
