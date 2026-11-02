import { expect, test } from '@playwright/test';
import { apiPost, chat, desiredChannels, loginAs } from './helpers.ts';

// 30 lines over ~40 s: 6 distinct "!play" users, one user spamming "!play" 5x, the rest noise.
const NOW = Date.now();
const lines = Array.from({ length: 30 }, (_, i) => {
  const t = NOW - 45_000 + Math.round((i * 40_000) / 29);
  if (i % 4 === 2 && i < 26) return chat('marblemania', '2002', `10${(i - 2) / 4}`, '!play', t); // i=2,6,..,22 -> 6 users
  if (i % 4 === 3 && i < 23) return chat('marblemania', '2002', '200', '!play', t); // i=3,7,..,19 -> 5 spam lines
  return chat('marblemania', '2002', `30${i}`, i % 5 === 0 ? 'ich will nicht !play heute' : `kappa ${i}`, t);
});
const hits = lines.filter((l) => l.text === '!play');
const chatters = new Set(hits.map((l) => l.userId)).size;

test('rule builder preview, no layout shift, save', async ({ browser }) => {
  expect(hits.length).toBe(11);
  expect(chatters).toBe(7);
  const ctx = await browser.newContext();
  await loginAs(ctx, '4001', 'builder_user');
  const page = await ctx.newPage();

  await page.goto('/channels');
  await page.getByLabel('Twitch-Channel').fill('marblemania');
  await page.getByRole('button', { name: 'Hinzufügen' }).first().click();
  await expect(page.locator('li.row', { hasText: 'marblemania' })).toBeVisible();
  await expect.poll(() => desiredChannels(ctx)).toBeGreaterThan(0); // debounce applied

  expect((await apiPost(ctx, '/api/test/chat', lines)).ok()).toBe(true);

  await page.goto('/rules/new?vorlage=marbles');
  await page.getByLabel('Channel für die Vorschau').selectOption('marblemania');
  const activityLine = page.locator('.activity-line', { hasText: '@marblemania:' });
  await expect(activityLine).toHaveText(/@marblemania: gerade \d+ aktiv → Schwelle 5/);
  await expect(page.getByLabel('Zeitraum der aktiven Chatter')).toHaveValue('10');
  const editorTop = async () => ({
    panel: (await page.locator('.panel.prev').boundingBox())!.y,
    save: (await page.getByRole('button', { name: 'Speichern' }).boundingBox())!.y,
  });
  const activityLayout = await editorTop();
  const previousActivity = await activityLine.textContent();
  expect((await apiPost(ctx, '/api/test/chat', [chat('marblemania', '2002', '9999', 'hello from another chatter', Date.now())])).ok()).toBe(true);
  await expect(activityLine).not.toHaveText(previousActivity!, { timeout: 17_000 });
  expect(await editorTop()).toEqual(activityLayout);
  const count = page.locator('.pv-count');
  await expect(count).toHaveText(`${hits.length} Treffer · ${chatters} Chatter · Schwelle wäre 1× erreicht worden`);

  const hitLine = page.locator('.msg.hit').first();
  await expect(hitLine.locator('u.hit-t')).toHaveText('!play');
  await expect(page.locator('.msg.hit')).toHaveCount(hits.length);
  const noise = page.locator('.msg', { hasText: 'ich will nicht !play heute' }).first();
  await expect(noise.locator('u')).toHaveCount(0);

  const top = async () => ({
    panel: (await page.locator('.panel.prev').boundingBox())!.y,
    save: (await page.getByRole('button', { name: 'Speichern' }).boundingBox())!.y,
  });
  const before = await top();

  await page.getByRole('button', { name: 'ganzes Wort' }).click();
  await page.getByLabel('Text', { exact: true }).fill('zzzzqq');
  await expect(page.locator('.pv-note')).toHaveText('Keine Treffer in den letzten 500 Nachrichten');
  await expect(count).toHaveText(/^0 Treffer/);
  expect(await top()).toEqual(before);

  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Gespeichert, Fenster zurückgesetzt')).toBeVisible();
  await expect(page).toHaveURL(/\/rules\/.+/);
  const skipReplies = page.getByLabel('Antworten an mich ignorieren');
  await skipReplies.check();
  const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/rules\/[^/]+$/.test(new URL(r.url()).pathname));
  await page.getByRole('button', { name: 'Speichern' }).click();
  expect((await saved).ok()).toBe(true);
  await page.reload();
  await expect(page.getByLabel('Antworten an mich ignorieren')).toBeChecked();
});

test('long whole-word patterns stay in word mode and explain reserved regex space', async ({ browser }) => {
  const ctx = await browser.newContext();
  await loginAs(ctx, '4002', 'builder_long_pattern');
  const page = await ctx.newPage();

  await page.goto('/rules/new');
  await page.getByRole('button', { name: 'ganzes Wort' }).click();
  await page.getByLabel('Text', { exact: true }).fill('x'.repeat(190));
  await page.getByRole('button', { name: 'Ausdruck' }).click();

  await expect(page.getByRole('button', { name: 'ganzes Wort' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.builder p[role="status"]')).toContainText('Wortgrenzen');
});

test('activity window select drives the live line without layout shift', async ({ browser }) => {
  const ctx = await browser.newContext();
  await loginAs(ctx, '4003', 'builder_window');
  const page = await ctx.newPage();
  await page.goto('/channels');
  await page.getByLabel('Twitch-Channel').fill('marblemania');
  await page.getByRole('button', { name: 'Hinzufügen' }).first().click();
  await expect(page.locator('li.row', { hasText: 'marblemania' })).toBeVisible();
  await page.route('**/api/channels/activity', async (route) => {
    const r = await route.fetch();
    const j = await r.json();
    await route.fulfill({ response: r, json: { channels: j.channels.map((c: { channelId: string }) => ({ ...c, active: { '5': 10, '10': 20, '30': 60 } })) } });
  });
  await page.goto('/rules/new?vorlage=marbles');
  await page.getByLabel('Prozent der aktiven Chatter').fill('10');
  const line = page.locator('.activity-line', { hasText: '@marblemania:' });
  const sel = page.getByLabel('Zeitraum der aktiven Chatter');
  await expect(line).toHaveText('@marblemania: gerade 20 aktiv → Schwelle 5');
  const save = async () => (await page.getByRole('button', { name: 'Speichern' }).boundingBox())!.y;
  const y = await save();
  await sel.selectOption('30');
  await expect(line).toHaveText('@marblemania: gerade 60 aktiv → Schwelle 6');
  await sel.selectOption('5');
  await expect(line).toHaveText('@marblemania: gerade 10 aktiv → Schwelle 5');
  expect(await save()).toBe(y);
});
