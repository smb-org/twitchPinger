import { expect, test } from '@playwright/test';
import { loginAs } from './helpers.ts';

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
