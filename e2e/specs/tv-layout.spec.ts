import { expect, test } from '@playwright/test';
import { ADMIN, api, loadState } from '../support/api';
import { login } from '../support/login';

/** Titles a test started: put back to never played afterwards (marking played, then unplayed, clears the date too). */
let played: string[] = [];
test.afterEach(async () => {
  const { admin } = loadState();
  for (const id of played)
    for (const method of ['POST', 'DELETE'] as const)
      await api(`/UserPlayedItems/${id}`, { method, token: admin.token, query: { userId: admin.userId } });
  played = [];
});

test('TV layout: focus starts on the hero and arrow keys move through rows', async ({ page }) => {
  // The row below the hero is otherwise whatever earlier specs left (or a library's Recently Added, which may hold a
  // single show): Continue Watching with two movies gives Right somewhere to go.
  const { admin, items } = loadState();
  played = [items['Lumen Alpha']!, items['Lumen Beta']!];
  for (const [i, id] of played.entries())
    await api(`/UserItems/${id}/UserData`, {
      method: 'POST',
      token: admin.token,
      query: { userId: admin.userId },
      body: { PlaybackPositionTicks: 50_000_000, LastPlayedDate: new Date(Date.now() - i * 60_000).toISOString() },
    });
  await page.addInitScript(() => localStorage.setItem('layout', 'tv'));
  await login(page, ADMIN);

  await expect(page.locator('#lmn-root .lmn-hero__slide.is-current .lmn-button--primary')).toBeFocused();
  await expect(page.locator('#lmn-root .lmn-hero__slide.is-current .lmn-button--primary')).toBeInViewport();

  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('region', { name: 'Continue Watching' }).locator('.lmn-card:focus')).toHaveCount(1);
  const first = await page.locator('#lmn-root .lmn-card:focus').getAttribute('data-item-id');

  await page.keyboard.press('ArrowRight');
  const card = page.locator('#lmn-root .lmn-card:focus');
  await expect(card).not.toHaveAttribute('data-item-id', first!);
  // The remote's Menu key and long-press open a card's menu on TV: no More button as a second stop per card.
  await expect(page.locator('#lmn-root .lmn-card__more').first()).toBeHidden();

  // OK opens the focused card's page.
  const id = await card.getAttribute('data-item-id');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`#/(details|list)\\?.*Id=${id}`, 'i'));
});

test('TV layout: D-pad Right moves from an episode row to its details link and back', async ({ page }) => {
  const { items } = loadState();
  await page.addInitScript(() => localStorage.setItem('layout', 'tv'));
  await login(page, ADMIN);
  await page.goto(`/web/#/details?id=${items['Lumen Show']}`);

  const series = page.locator('#lmn-root .lmn-details--series');
  // Play renders once the episodes have loaded; focus moves on to it from the Back button that stood in.
  await expect(series.locator('.lmn-details__header .lmn-button--primary')).toBeFocused();
  const row = series.locator('.lmn-episode').first();
  await expect(row).toBeVisible();
  // Start from the first episode row once focus put there stays there for a moment (nothing else takes it back
  // mid-test; nothing on the page says the page is done with focus).
  await expect(async () => {
    await row.focus();
    await page.waitForTimeout(300);
    await expect(row).toBeFocused({ timeout: 100 });
  }).toPass({ timeout: 10_000 });

  // jellyfin-web's focus manager moves right only to an element whose right edge is past the row's.
  await page.keyboard.press('ArrowRight');
  await expect(series.locator('.lmn-episodes__details').first()).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(row).toBeFocused();
});
