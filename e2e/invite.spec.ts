import { expect, test } from '@playwright/test';
import { loginAs, nextTwitchUser } from './helpers.ts';

test('login explains that new accounts require an invitation', async ({ page }) => {
  await page.goto('/login?error=no_invite');
  await expect(page.getByRole('alert')).toHaveText('Kein Konto gefunden. Der Zugang ist nur mit Einladungslink möglich.');
});

test('personal link: admin shares, two users redeem, reset kills old link', async ({ browser, request }) => {
  const admin = await browser.newContext();
  const ap = await admin.newPage();
  let failNextInviteReload = false;
  let meRequests = 0;
  await ap.route('**/api/invites', async (route) => {
    if (failNextInviteReload && route.request().method() === 'GET') {
      failNextInviteReload = false;
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'load_failed', message: 'Einladungen konnten nicht geladen werden.' } }) });
      return;
    }
    await route.continue();
  });
  await ap.route('**/api/me', async (route) => {
    if (route.request().method() === 'GET') meRequests++;
    await route.continue();
  });
  await nextTwitchUser(request, '1000', 'sbadmin');
  await ap.goto('/login');
  await ap.getByRole('link', { name: 'Mit Twitch anmelden' }).click();
  await expect(ap).toHaveURL(/\/onboarding$/); // first admin login creates the account
  await ap.goto('/invites');
  await expect(ap.locator('code.url')).toContainText('/invite/');
  const link = (await ap.locator('code.url').textContent())!.trim();
  expect(link).toMatch(/\/invite\/.+/);

  const u1 = await browser.newContext();
  const p1 = await u1.newPage();
  await nextTwitchUser(request, '3001', 'invitee_one');
  await p1.goto(link);
  await p1.getByRole('link', { name: 'Mit Twitch anmelden' }).click();
  await expect(p1).toHaveURL(/\/onboarding$/);
  await p1.goto('/invites');
  await expect(p1.getByText('noch 5 von 5 Plätzen frei')).toBeVisible();
  await expect(p1.locator('code.url')).toContainText('/invite/');
  const inviteeLink = (await p1.locator('code.url').textContent())!.trim();
  expect(inviteeLink).not.toBe(link);

  const u2 = await browser.newContext();
  const p2 = await u2.newPage();
  await nextTwitchUser(request, '3002', 'invitee_two');
  await p2.goto(link);
  await p2.getByRole('link', { name: 'Mit Twitch anmelden' }).click();
  await expect(p2).toHaveURL(/\/onboarding$/);

  const meBeforeInviteVisit = meRequests;
  await ap.getByRole('link', { name: 'Übersicht', exact: true }).click();
  await ap.getByRole('link', { name: 'Einladungen', exact: true }).click();
  await expect(ap.getByText('@invitee_one')).toBeVisible();
  await expect(ap.getByText('@invitee_two')).toBeVisible();
  await expect.poll(() => meRequests).toBe(meBeforeInviteVisit + 1);
  await expect(ap.getByTitle(/^Werbepunkte/)).toHaveText('◆ 2');
  const meBeforeReset = meRequests;
  failNextInviteReload = true;
  await ap.getByRole('button', { name: 'Neuen Link erzeugen' }).click();
  await ap.getByRole('button', { name: 'Wirklich?' }).click();
  await expect(ap.getByText('Neuer Link erzeugt')).toBeVisible();
  await expect(ap.locator('code.url')).not.toHaveText(link);
  await expect(ap.getByText('Einladungen konnten nicht geladen werden.')).toBeVisible();
  await expect.poll(() => meRequests).toBe(meBeforeReset + 1);

  const u3 = await browser.newContext();
  const p3 = await u3.newPage();
  await nextTwitchUser(request, '3003', 'invitee_three');
  await p3.goto(link);
  await p3.getByRole('link', { name: 'Mit Twitch anmelden' }).click();
  await expect(p3).toHaveURL(/\/login\?error=invite_invalid$/);
  await expect(p3.getByText('Diese Einladung ist ungültig')).toBeVisible();

  await expect(ap.getByTitle(/^Werbepunkte/)).toHaveText('◆ 2');
  await expect(ap.locator('[aria-label^="Werbepunkte"]')).toHaveText('◆ 2');
  await Promise.all([admin.close(), u1.close(), u2.close(), u3.close()]);
});

test('invite chain shows an error in its fixed summary area', async ({ browser }) => {
  const ctx = await browser.newContext();
  await loginAs(ctx, '1000', 'sbadmin', true);
  await ctx.route('**/api/admin/users', (route) => route.fulfill({
    status: 500,
    contentType: 'application/json',
    body: JSON.stringify({ error: { code: 'load_failed', message: 'Konten konnten nicht geladen werden.' } }),
  }));
  const page = await ctx.newPage();
  await page.goto('/admin');
  await expect(page.getByText('Einladungskette konnte nicht geladen werden.')).toBeVisible();
  await expect(page.locator('.admin-user-slot').getByRole('button', { name: 'Wiederholen' })).toBeVisible();
  await ctx.close();
});

test('full invite capacity shows one status line', async ({ browser }) => {
  const ctx = await browser.newContext();
  await loginAs(ctx, '6002', 'full_user');
  await ctx.route('**/api/invites', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ link: 'http://localhost:12174/invite/full', used: 5, max: 5, invitees: [] }),
  }));
  const page = await ctx.newPage();
  await page.goto('/invites');
  await expect(page.locator('.invite-capacity')).toBeEmpty();
  await expect(page.locator('.invite-full')).toHaveText('Alle Plätze vergeben');
  await expect(page.getByText('noch 0 von 5 Plätzen frei')).toHaveCount(0);
  await ctx.close();
});

test('admin can inspect and filter an invite branch', async ({ browser, request }) => {
  const admin = await browser.newContext();
  await loginAs(admin, '1000', 'sbadmin', true);
  const ap = await admin.newPage();
  await ap.goto('/invites');
  const adminLink = (await ap.locator('code.url').textContent())!.trim();

  const u1 = await browser.newContext();
  const p1 = await u1.newPage();
  await nextTwitchUser(request, '4101', 'chain_one');
  await p1.goto(adminLink);
  await p1.getByRole('link', { name: 'Mit Twitch anmelden' }).click();
  await expect(p1).toHaveURL(/\/onboarding$/);
  await p1.goto('/invites');
  const u1Link = (await p1.locator('code.url').textContent())!.trim();

  const u2 = await browser.newContext();
  const p2 = await u2.newPage();
  await nextTwitchUser(request, '4102', 'chain_two');
  await p2.goto(u1Link);
  await p2.getByRole('link', { name: 'Mit Twitch anmelden' }).click();
  await expect(p2).toHaveURL(/\/onboarding$/);

  await ap.goto('/admin');
  await expect(ap.getByRole('heading', { name: 'Einladungskette' })).toBeVisible();
  await ap.getByRole('button', { name: /chain_one.*Ast/ }).click();
  const tree = ap.getByRole('list', { name: 'Einladungskette' });
  await expect(tree.getByText('@chain_one')).toBeVisible();
  await expect(tree.getByText('@chain_two')).toBeVisible();
  await expect(tree.getByText('@sbadmin')).toHaveCount(0);
  const row = tree.locator('li').filter({ hasText: '@chain_one' });
  await expect(row.getByRole('button', { name: /Äste von @chain_one/ })).toHaveAttribute('aria-expanded', 'true');
  await expect(row.locator('.invite-tree-direct')).toContainText('1');
  await expect(row.locator('.invite-tree-size')).toContainText('1');
  await expect(row.locator('.invite-tree-points')).toContainText('1');
  await ap.getByRole('button', { name: 'Alle' }).click();
  await expect(tree.getByText('@sbadmin')).toBeVisible();

  await Promise.all([admin.close(), u1.close(), u2.close()]);
});
