import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { loginAs } from './helpers.ts';

for (const path of ['/login', '/', '/rules/new', '/channels', '/targets', '/invites']) {
  test(`axe wcag2a/aa ${path}`, async ({ browser }) => {
    const ctx = await browser.newContext();
    if (path !== '/login') await loginAs(ctx, '6001', 'a11y_user');
    const page = await ctx.newPage();
    await page.goto(path);
    await expect(page.locator('h1').first()).toBeVisible();
    if (path !== '/login') await expect(page.locator('.strip-state.ok')).toBeVisible();
    await page.waitForLoadState('networkidle');
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const report = violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
    expect(report, report.join('\n')).toEqual([]);
    await ctx.close();
  });
}
