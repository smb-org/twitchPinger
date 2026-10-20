import { expect, test } from '@playwright/test';
import { apiPost, loginAs } from './helpers.ts';

test('overview rule test sends immediately, shows per-target result, and reserves its status line', async ({ browser }) => {
  const ctx = await browser.newContext();
  await loginAs(ctx, '8501', 'rule_test_user');
  const targetResponse = await apiPost(ctx, '/api/targets', { kind: 'ntfy', name: 'Phone' });
  expect(targetResponse.ok()).toBe(true);
  const { target } = await targetResponse.json();
  const ruleResponse = await apiPost(ctx, '/api/rules', {
    name: 'Marbles test', matcher: { mode: 'word', pattern: '!play' }, targetIds: [target.id], channelIds: [],
  });
  expect(ruleResponse.ok()).toBe(true);
  const { rule } = await ruleResponse.json();
  const dirtyRuleResponse = await apiPost(ctx, '/api/rules', {
    name: 'Unsaved test', matcher: { mode: 'word', pattern: '!play' }, targetIds: [target.id], channelIds: [],
  });
  expect(dirtyRuleResponse.ok()).toBe(true);
  const { rule: dirtyRule } = await dirtyRuleResponse.json();

  const page = await ctx.newPage();
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const requestStarted = new Promise<void>((resolve) => { started = resolve; });
  await page.route(`**/api/rules/${rule.id}/test`, async (route) => {
    started();
    await gate;
    await route.fulfill({ status: 200, contentType: 'application/json', json: {
      results: [{ targetId: target.id, kind: 'ntfy', ok: true }],
    } });
  });

  await page.goto('/');
  const row = page.locator('tr', { hasText: 'Marbles test' });
  const button = row.getByRole('button', { name: 'Test auslösen' });
  const hint = row.locator('.rule-test-hint');
  await expect(button).toBeVisible();
  const before = { row: await row.boundingBox(), button: await button.boundingBox(), hint: await hint.boundingBox() };

  await button.click();
  await requestStarted;
  await expect(button).toBeDisabled();
  await expect(hint).toHaveText('Testnachricht wird gesendet…');
  const running = { row: await row.boundingBox(), button: await button.boundingBox(), hint: await hint.boundingBox() };
  expect(running).toEqual(before);

  release();
  await expect(page.locator('.toast')).toContainText('● Phone: OK');
  await expect(button).toBeDisabled();
  await expect(hint).toContainText('Erneut möglich in');
  await row.getByRole('link', { name: 'Marbles test' }).click();
  const editorButton = page.getByRole('button', { name: 'Test auslösen' });
  await expect(editorButton).toBeDisabled();
  await expect(page.locator('.rule-test-hint')).toContainText('Erneut möglich in');
  await page.goto(`/rules/${dirtyRule.id}`);
  const dirtyButton = page.getByRole('button', { name: 'Test auslösen' });
  await expect(dirtyButton).toBeEnabled();
  await page.locator('.field').filter({ hasText: 'Name der Regel' }).locator('input').fill('Unsaved change');
  await expect(dirtyButton).toBeDisabled();
  await expect(page.locator('.rule-test-hint')).toHaveText('Änderungen erst speichern.');
  await ctx.close();
});

test('overview fits narrow and mid-size viewports without overflow or panel overlap', async ({ browser }) => {
  const ctx = await browser.newContext();
  await loginAs(ctx, '8502', 'rule_layout_user');
  const targetResponse = await apiPost(ctx, '/api/targets', { kind: 'ntfy', name: 'Phone' });
  expect(targetResponse.ok()).toBe(true);
  const { target } = await targetResponse.json();
  const ruleResponse = await apiPost(ctx, '/api/rules', {
    name: 'Responsive rule', matcher: { mode: 'word', pattern: '!play' }, targetIds: [target.id], channelIds: [],
  });
  expect(ruleResponse.ok()).toBe(true);

  const page = await ctx.newPage();
  await page.goto('/');
  await expect(page.locator('table.rules')).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Letzte Pings' })).toBeVisible();

  for (const width of [390, 1130]) {
    await page.setViewportSize({ width, height: 800 });
    await expect.poll(() => page.evaluate(() => {
      const doc = (globalThis as any).document;
      return doc.documentElement.scrollWidth - doc.documentElement.clientWidth;
    })).toBe(0);
    const { table, pings } = await page.evaluate(() => {
      const doc = (globalThis as any).document;
      const tableRect = doc.querySelector('table.rules').getBoundingClientRect();
      const pingsRect = doc.querySelector('.pings').getBoundingClientRect();
      return {
        table: { left: tableRect.left, right: tableRect.right, top: tableRect.top, bottom: tableRect.bottom },
        pings: { left: pingsRect.left, right: pingsRect.right, top: pingsRect.top, bottom: pingsRect.bottom },
      };
    });
    const separated = table.right <= pings.left || pings.right <= table.left || table.bottom <= pings.top || pings.bottom <= table.top;
    expect(separated, `rule table and Letzte Pings overlap at ${width}px`).toBe(true);
  }
  await ctx.close();
});
