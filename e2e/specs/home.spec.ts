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
  /** How far the current bar's fill has grown, 0 to 1 (its scaleX). */
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

  test("fills the current slide's bar over its interval, and stops with the slideshow", async ({ page, browserName }) => {
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

    // Thin bars, the current one longer; Pause to their right, and after them in Tab order too.
    const bars = await pager.locator('.lmn-hero__bar').evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect()).map((r) => ({ width: r.width, height: r.height })),
    );
    for (const bar of bars) expect(bar.height).toBeLessThanOrEqual(4);
    const current = await pager.locator('.lmn-hero__dash.is-active .lmn-hero__bar').boundingBox();
    expect(current!.width).toBeGreaterThan(Math.max(...bars.map((b) => b.width).filter((w) => w !== current!.width)));
    const pause = page.getByRole('button', { name: 'Pause slideshow' });
    const pagerBox = (await pager.boundingBox())!;
    expect((await pause.boundingBox())!.x).toBeGreaterThanOrEqual(pagerBox.x + pagerBox.width);
    await pager.getByRole('tab', { selected: true }).focus();
    // Safari's Tab stops only at text fields and lists unless the user has it highlight each item; Option+Tab stops at
    // every control. Playwright's WebKit does as the Mac it runs on does (on Linux, either key stops at buttons).
    const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
    await page.keyboard.press(tab);
    await expect(pause).toBeFocused();
    await page.keyboard.press(`Shift+${tab}`);
    await expect(pager.getByRole('tab', { selected: true })).toBeFocused();
    // Keyboard focus in the hero holds the slideshow; once focus leaves, it runs on.
    await page.evaluate(() => (document.activeElement as HTMLElement).blur());

    const first = await fillScale(page);
    await expect.poll(() => fillScale(page)).toBeGreaterThan(first);
    const later = await fillScale(page);
    expect(later).toBeGreaterThan(first);
    expect(later).toBeLessThan(0.5);

    await page.getByRole('button', { name: 'Pause slideshow' }).click();
    await expect(page.getByRole('button', { name: 'Play slideshow' })).toBeVisible();
    const held = await fillScale(page);
    // Proving it holds: long enough that a running fill would have moved (0.4 s is 0.013 of the 30 s interval).
    await page.waitForTimeout(400);
    expect(await fillScale(page)).toBeCloseTo(held, 2); // within a frame or so

    // Another title starts its bar empty.
    const next = pager.getByRole('tab').nth(1); // the first title is showing
    await next.click();
    await expect(next).toHaveAttribute('aria-selected', 'true');
    expect(await fillScale(page)).toBeCloseTo(0, 2);
  });

  test('with trailers let finish, keeps a slide up until its trailer ends, the bar filling with it', async ({ page }) => {
    // A 3 s interval, and previews from the start: the fixtures' trailers run 8 s, well past it.
    await page.route(/\/Lumen\/ClientConfig/, async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        json: { ...(await response.json()), HeroIntervalSeconds: 3, TrailerDelaySeconds: 0, HeroWaitForTrailer: true },
      });
    });
    await login(page, ADMIN);
    const current = page.locator('#lmn-root .lmn-hero__slide.is-current');
    const video = current.locator('video');
    const title = () => current.locator('h2').evaluate((h) => h.textContent || h.querySelector('img')?.alt);
    // The slideshow moves on to a title with a trailer (not every one has one), whose preview starts at once.
    await expect(video).toBeVisible({ timeout: 30_000 });
    const showing = await title();
    // Up to the trailer's whole length: the preview is on the page before it plays, so 4 s in can be more than the
    // 5 s a poll waits by default away (WebKit starts it slowest).
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 15_000 }).toBeGreaterThan(4);

    // Past the 3 s interval: still this title, its bar following the trailer rather than the clock.
    expect(await title()).toBe(showing);
    await expect(page.locator('#lmn-root .lmn-hero__fill')).toHaveClass(/\bis-trailer\b/);
    const filled = await fillScale(page);
    expect(filled).toBeGreaterThan(0.4);
    expect(filled).toBeLessThan(1);

    // A swipe that springs back takes the trailer off while the track moves: it comes back where it was (not from the
    // start), on the same title.
    const left = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
    const box = (await page.locator('#lmn-root .lmn-hero').boundingBox())!;
    const y = box.y + box.height / 3;
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    // 25 px, slowly: short of a swipe even on a phone (15 % of the width, or a flick past 30 px).
    for (let i = 1; i <= 5; i++) await page.mouse.move(box.x + box.width / 2 + i * 5, y);
    await expect(video).toHaveCount(0);
    await page.mouse.up();
    await expect(current.locator('video.is-shown')).toHaveCount(1, { timeout: 10_000 });
    expect(await video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(left - 0.5);
    expect(await title()).toBe(showing);

    // It ends, and the next title follows a beat later.
    await expect(video).toHaveCount(0, { timeout: 10_000 });
    await expect.poll(title, { timeout: 5_000 }).not.toBe(showing);
  });

  test('shows the current bar full, without the growing fill, for reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await login(page, ADMIN);
    await expect(page.getByRole('tablist', { name: 'Featured titles' })).toBeVisible();
    expect(await fillScale(page)).toBe(1);
  });
});

test('rows scroll freely: a mouse drag leaves a row where it was let go, with no snapping to a card', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'touch scrolls natively; a phone has no mouse to drag with');
  await login(page, ADMIN);
  await expect(page.locator('#lmn-root .lmn-row .lmn-card').first()).toBeVisible();
  // Nothing snaps, for touch either: no row has scroll snapping.
  const snapping = await page
    .locator('#lmn-root .lmn-row__scroller')
    .evaluateAll((els) => els.map((el) => getComputedStyle(el).scrollSnapType).filter((t) => t && t !== 'none'));
  expect(snapping).toEqual([]);

  // A row that overflows: dragged 137 px, somewhere between two cards, slowly, and held still before the release (so
  // no glide either).
  const scroller = page
    .locator('#lmn-root .lmn-row__scroller')
    .filter({ has: page.locator('.lmn-card >> nth=5') })
    .first();
  await scroller.scrollIntoViewIfNeeded();
  const box = (await scroller.boundingBox())!;
  const y = box.y + box.height / 3;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 137, y, { steps: 10 });
  await page.waitForTimeout(100);
  await page.mouse.up();
  const left = () => scroller.evaluate((el) => el.scrollLeft);
  expect(await left()).toBeCloseTo(137, 0);
  // Long enough for snapping to have settled it on a card, had there been any.
  await page.waitForTimeout(600);
  expect(await left()).toBeCloseTo(137, 0);
  // The release didn't open the card under the pointer.
  await expect(page).toHaveURL(/#\/home/);
});
