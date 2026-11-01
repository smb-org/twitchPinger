import { expect, test } from '@playwright/test';
import { loginAs, nextTwitchUser } from './helpers.ts';

test('Liste aktualisieren: OAuth round trip returns to /channels with the new follow', async ({ page, context, request }) => {
  // Existing user (own id, so the first-admin login in invite.spec stays untouched) with an empty follow snapshot.
  await nextTwitchUser(request, '3901', 'refresher');
  await loginAs(context, '3901', 'refresher');
  await page.goto('/channels');
  await expect(page.getByText('Keine gefolgten Channels gefunden.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'newfollow hinzufügen' })).toHaveCount(0);
  await request.post('http://localhost:12175/mock/add-follow', { data: { id: '2999', login: 'newfollow' } });
  await page.getByRole('link', { name: 'Liste aktualisieren' }).click();
  await expect(page).toHaveURL(/\/channels$/);
  await expect(page.getByRole('button', { name: 'newfollow hinzufügen' })).toBeVisible();
});
