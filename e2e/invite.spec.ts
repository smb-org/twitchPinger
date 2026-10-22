import { expect, test } from '@playwright/test';
import { nextTwitchUser } from './helpers.ts';

test('login explains that new accounts require an invitation', async ({ page }) => {
  await page.goto('/login?error=no_invite');
  await expect(page.getByRole('alert')).toHaveText('Kein Konto gefunden. Der Zugang ist nur mit Einladungslink möglich.');
});

test('personal link: admin shares, two users redeem, reset kills old link', async ({ browser, request }) => {
  const admin = await browser.newContext();
  const ap = await admin.newPage();
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

  await ap.goto('/invites');
  await expect(ap.getByText('@invitee_one')).toBeVisible();
  await expect(ap.getByText('@invitee_two')).toBeVisible();
  await ap.getByRole('button', { name: 'Neuen Link erzeugen' }).click();
  await ap.getByRole('button', { name: 'Wirklich?' }).click();
  await expect(ap.getByText('Neuer Link erzeugt')).toBeVisible();
  await expect(ap.locator('code.url')).not.toHaveText(link);

  const u3 = await browser.newContext();
  const p3 = await u3.newPage();
  await nextTwitchUser(request, '3003', 'invitee_three');
  await p3.goto(link);
  await p3.getByRole('link', { name: 'Mit Twitch anmelden' }).click();
  await expect(p3).toHaveURL(/\/login\?error=invite_invalid$/);
  await expect(p3.getByText('Diese Einladung ist ungültig')).toBeVisible();

  await ap.goto('/invites');
  await expect(ap.getByTitle(/^Werbepunkte/)).toHaveText('◆ 2');
  await Promise.all([admin.close(), u1.close(), u2.close(), u3.close()]);
});
