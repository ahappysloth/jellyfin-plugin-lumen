import { expect, test, type Page } from '@playwright/test';
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

test.describe('hero pager', () => {
  /** How far the current pill's fill has grown, 0 to 1 (its scaleX). */
  const fillScale = (page: Page) =>
    page.locator('#lmn-root .lmn-hero__dash.is-active .lmn-hero__fill').evaluate((el) => {
      const transform = getComputedStyle(el).transform;
      return transform === 'none' ? 1 : new DOMMatrix(transform).a;
    });

  test.beforeEach(async ({ page }) => {
    // Long enough that no slide changes partway through a check.
    await page.route(/\/Lumen\/ClientConfig/, async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        json: { ...(await response.json()), HeroIntervalSeconds: 30 },
      });
    });
  });

  test("fills the current slide's pill over its interval, and stops with the slideshow", async ({ page }) => {
    await login(page, ADMIN);
    const pager = page.getByRole('tablist', { name: 'Featured titles' });
    await expect(pager).toBeVisible();
    await expect(pager.getByRole('tab', { selected: true })).toHaveCount(1);

    // Bottom right of the hero, clear of the slide's buttons (beside them on a wide screen, below on a phone).
    const hero = (await page.locator('#lmn-root .lmn-hero').boundingBox())!;
    const controls = (await page.locator('#lmn-root .lmn-hero__controls').boundingBox())!;
    const actions = (await page.locator('#lmn-root .lmn-hero__slide.is-current .lmn-actions').boundingBox())!;
    expect(controls.x + controls.width).toBeGreaterThan(hero.x + hero.width * 0.85);
    expect(controls.y + controls.height).toBeGreaterThan(hero.y + hero.height * 0.75);
    const beside = controls.x >= actions.x + actions.width;
    const below = controls.y >= actions.y + actions.height;
    expect(beside || below).toBe(true);

    const first = await fillScale(page);
    await page.waitForTimeout(1500);
    const later = await fillScale(page);
    expect(later).toBeGreaterThan(first);
    expect(later).toBeLessThan(0.5);

    await page.getByRole('button', { name: 'Pause slideshow' }).click();
    await expect(page.getByRole('button', { name: 'Play slideshow' })).toBeVisible();
    const held = await fillScale(page);
    await page.waitForTimeout(1000);
    expect(await fillScale(page)).toBeCloseTo(held, 2); // within a frame or so; 1 s running would be 0.033

    // Another title starts its pill empty.
    const next = pager.getByRole('tab').nth(1); // the first title is showing
    await next.click();
    await expect(next).toHaveAttribute('aria-selected', 'true');
    expect(await fillScale(page)).toBeCloseTo(0, 2);
  });

  test('shows the current pill full, without the growing fill, for reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await login(page, ADMIN);
    await expect(page.getByRole('tablist', { name: 'Featured titles' })).toBeVisible();
    expect(await fillScale(page)).toBe(1);
  });
});
