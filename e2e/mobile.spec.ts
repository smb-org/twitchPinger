import { expect, test } from '@playwright/test';
import { loginAs } from './helpers.ts';

test.use({ viewport: { width: 390, height: 844 } });

test('mobile: bottom nav and tabs on the rule editor', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await loginAs(ctx, '7001', 'mobile_user');
  const page = await ctx.newPage();
  await page.goto('/rules/new');
  const links = page.getByRole('navigation', { name: 'Hauptnavigation' }).locator('a:not(.wordmark)');
  await expect(links).toHaveCount(4);
  for (const l of await links.all()) {
    await expect(l).toBeVisible();
    expect((await l.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  const rule = page.locator('#p-rule');
  const prev = page.locator('#p-prev');
  await expect(rule).toBeVisible();
  await expect(prev).toBeHidden();
  await page.getByRole('tab', { name: /^Vorschau/ }).click();
  await expect(prev).toBeVisible();
  await expect(rule).toBeHidden();
  await page.getByRole('tab', { name: 'Regel' }).click();
  await expect(rule).toBeVisible();
  await expect(prev).toBeHidden();
});
