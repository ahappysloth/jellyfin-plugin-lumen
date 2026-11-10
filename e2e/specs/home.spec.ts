import { expect, test } from '@playwright/test';
import { ADMIN, api, loadState } from '../support/api';
import { login } from '../support/login';
import { expectPresentButHidden } from '../support/stock';

test('Lumen replaces the home screen with a hero and rows', { tag: '@smoke' }, async ({ page }) => {
  await login(page, ADMIN);

  await expect(page.locator('#lmn-root .lmn-home')).toBeVisible();
  await expect(page.locator('#lmn-root .lmn-hero')).toBeVisible();
  // toBeVisible() passes for off-screen elements; the hero must be on screen, not pushed below the stock layout.
  await expect(page.locator('#lmn-root .lmn-hero__slide.is-current .lmn-button--primary')).toBeInViewport();
  await expect(page.getByRole('region', { name: 'Recently Added in Movies' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Recently Added in Shows' })).toBeVisible();
  await expectPresentButHidden(page.locator('#reactRoot .skinBody'));
});

test('a cold load with a remembered sign-in still shows the Lumen home', { tag: '@smoke' }, async ({ page }) => {
  await login(page, ADMIN);
  await expect(page.locator('#lmn-root .lmn-home')).toBeVisible();

  await page.reload();

  await expect(page.locator('#lmn-root .lmn-home')).toBeVisible();
});

test.afterEach(async () => {
  const { admin, items } = loadState();
  await api(`/UserItems/${items['Lumen Beta']}/UserData`, {
    method: 'POST',
    token: admin.token,
    query: { userId: admin.userId },
    body: { PlaybackPositionTicks: 0 },
  });
});

test('a partially watched movie appears in Continue Watching', async ({ page }) => {
  const { admin, items } = loadState();
  await api(`/UserItems/${items['Lumen Beta']}/UserData`, {
    method: 'POST',
    token: admin.token,
    query: { userId: admin.userId },
    body: { PlaybackPositionTicks: 50_000_000, LastPlayedDate: new Date().toISOString() },
  });

  await login(page, ADMIN);

  const card = page.getByRole('region', { name: 'Continue Watching' }).getByRole('link', { name: 'Lumen Beta', exact: true });
  await expect(card).toBeVisible();
  // Named by its visible title alone (axe label-content-name-mismatch), the rest read as its description.
  await expect(card).not.toHaveAttribute('aria-label');
  await expect(card).toHaveAccessibleDescription(/\b\d+% watched$/);
  await expect(card.getByRole('progressbar')).toHaveCount(0);
});

test('every card on home is a link named by its visible title, not an aria-label', async ({ page }) => {
  await login(page, ADMIN);
  const cards = page.locator('#lmn-root a.lmn-card');
  await expect(cards.first()).toBeVisible();

  await expect(page.locator('#lmn-root .lmn-card[aria-label]')).toHaveCount(0);
  for (const card of await cards.all()) {
    // An episode's caption is part of its name ("Lumen Show S1:E2 · Pilot").
    const shown = await card.locator('.lmn-card__title, .lmn-card__meta:not([aria-hidden])').allInnerTexts();
    await expect(card).toHaveAccessibleName(shown.join(' ').replace(/\s+/g, ' ').trim());
    await expect(card).toHaveAttribute('href', /#\/(details|list)\?/);
  }
});
