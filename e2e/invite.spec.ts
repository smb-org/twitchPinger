import { expect, test } from '@playwright/test';
import { nextTwitchUser } from './helpers.ts';

test('login explains that new accounts require an invitation', async ({ page }) => {
  await page.goto('/login?error=no_invite');
  await expect(page.getByRole('alert')).toHaveText('Kein Konto gefunden. Der Zugang ist nur mit Einladungslink möglich.');
});

test('invite flow: admin creates, new user redeems, reuse fails', async ({ browser, request }) => {
  const admin = await browser.newContext();
  const ap = await admin.newPage();
  await nextTwitchUser(request, '1000', 'sbadmin');
  await ap.goto('/login');
  await ap.getByRole('link', { name: 'Mit Twitch anmelden' }).click();
  await expect(ap).toHaveURL(/\/onboarding$/); // first admin login creates the account
  await ap.goto('/invites');
  await ap.getByRole('button', { name: /Einladung erzeugen/ }).click();
  const link = (await ap.locator('code.url').textContent())!.trim();
  expect(link).toMatch(/\/invite\/.+/);

  const u1 = await browser.newContext();
  const p1 = await u1.newPage();
  await nextTwitchUser(request, '3001', 'invitee_one');
  await p1.goto(link);
  await p1.getByRole('link', { name: 'Mit Twitch anmelden' }).click();
  await expect(p1).toHaveURL(/\/onboarding$/);

  const u2 = await browser.newContext();
  const p2 = await u2.newPage();
  await nextTwitchUser(request, '3002', 'invitee_two');
  await p2.goto(link);
  await p2.getByRole('link', { name: 'Mit Twitch anmelden' }).click();
  await expect(p2).toHaveURL(/\/login\?error=invite_used$/);
  await expect(p2.getByText('Diese Einladung wurde schon benutzt')).toBeVisible();

  // Revoked invites are rejected as well.
  await ap.reload();
  await ap.getByRole('button', { name: /Einladung erzeugen/ }).click();
  const link2 = (await ap.locator('code.url').textContent())!.trim();
  const revoke = ap.getByRole('button', { name: 'Widerrufen' });
  await revoke.click();
  await ap.getByRole('button', { name: 'Wirklich?' }).click();
  await expect(ap.getByText('Einladung widerrufen')).toBeVisible();

  const u3 = await browser.newContext();
  const p3 = await u3.newPage();
  await nextTwitchUser(request, '3003', 'invitee_three');
  await p3.goto(link2);
  await p3.getByRole('link', { name: 'Mit Twitch anmelden' }).click();
  await expect(p3).toHaveURL(/\/login\?error=invite_invalid$/);
  await expect(p3.getByText('Diese Einladung ist ungültig')).toBeVisible();
  await Promise.all([admin.close(), u1.close(), u2.close(), u3.close()]);
});
