import { expect, test, type Page } from '@playwright/test';
import { ADMIN, loadState } from '../support/api';
import { walkDpad } from '../support/dpad';
import { login } from '../support/login';

// TV remotes have only arrows, OK and Back: a control the arrows can't reach can't be used at all. (Chromium only, like
// TVs' browsers: see playwright.config.ts.)
// The walk presses four keys from every control on the page.
test.setTimeout(180_000);
// No sliding hero or trailer preview moving controls around under the walk.
test.use({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });

async function signInOnTv(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('layout', 'tv'));
  // No automatic slide changes: one would swap which slide's buttons are live partway through the walk. (The walk can
  // still change slides itself with Left/Right on the pager, as a remote would; it only checks the current slide's.)
  await page.route(/\/Lumen\/ClientConfig/, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), HeroIntervalSeconds: 3600 } });
  });
  await login(page, ADMIN);
  await expect(page.locator('html')).toHaveClass(/\blayout-tv\b/);
}

test('TV layout: every control on home is reachable with the D-pad', async ({ page }) => {
  await signInOnTv(page);
  const start = page.locator('#lmn-root .lmn-hero__slide.is-current .lmn-button--primary');
  await expect(start).toBeFocused();
  await expect(page.locator('#lmn-root .lmn-row').first()).toBeVisible();

  const { controls, unreachable } = await walkDpad(page, start);

  expect(controls.length).toBeGreaterThan(10);
  expect(unreachable.map((c) => c.name)).toEqual([]);
});

test("TV layout: the hero's Pause is reachable with no card below it", async ({ page }) => {
  // One card per row, at the left under the slide's buttons: nothing under the hero's controls for Up to come from, so
  // they must be reachable along the hero itself. (The walk above starts on the first slide with full rows: a card
  // below Pause hid that it wasn't.)
  await page.route(/\/Lumen\/Home\b/, async (route) => {
    const response = await route.fetch();
    const home = await response.json();
    for (const row of home.Rows) {
      row.Items = row.Items.slice(0, 1);
      if (row.Entries) row.Entries = row.Entries.slice(0, 1);
    }
    await route.fulfill({ response, json: home });
  });
  await signInOnTv(page);
  const hero = page.locator('#lmn-root .lmn-hero');
  const start = hero.locator('.lmn-hero__slide.is-current .lmn-button--primary');
  await expect(start).toBeFocused();
  await expect(page.locator('#lmn-root .lmn-row').first()).toBeVisible();

  // Along the hero as along a row: Play, More info, Pause, then the current title's pill.
  const pause = hero.getByRole('button', { name: 'Pause slideshow' });
  const pill = hero.getByRole('tab', { selected: true });
  await page.keyboard.press('ArrowRight');
  await expect(hero.getByRole('button', { name: 'More info' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(pause).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(pill).toBeFocused();
  await expect(pill).toHaveAttribute('aria-label', /^Show /);
  // The first title's pill: Left leaves the pills (no wrapping round to the last) and comes back to Pause.
  await page.keyboard.press('ArrowLeft');
  await expect(pause).toBeFocused();

  const { unreachable } = await walkDpad(page, start);
  expect(unreachable.map((c) => c.name)).toEqual([]);
});

test('TV layout: every control on a series page is reachable with the D-pad', async ({ page }) => {
  const { items } = loadState();
  await signInOnTv(page);
  await page.goto(`/web/#/details?id=${items['Lumen Show']}`);
  const series = page.locator('#lmn-root .lmn-details--series');
  const start = series.locator('.lmn-autofocus');
  await expect(series.locator('.lmn-episode')).toHaveCount(3);
  // The page moves focus to its own default once it has loaded: start once that has happened, i.e. focus stays put.
  await expect(async () => {
    await start.focus();
    await page.waitForTimeout(300);
    await expect(start).toBeFocused({ timeout: 100 });
  }).toPass({ timeout: 10_000 });

  const { controls, unreachable } = await walkDpad(page, start);

  // Including each episode row's details link, which sat over the row's right end, out of reach (#89).
  expect(controls.filter((c) => c.classes.split(' ').includes('lmn-episodes__details'))).toHaveLength(3);
  expect(unreachable.map((c) => c.name)).toEqual([]);
});

test("TV layout: the focused item of jellyfin-web's ⋯ menu shows its ring inside the sheet", async ({ page }) => {
  await signInOnTv(page);
  // A library folder: Lumen has no details page for it, so its ⋯ opens jellyfin-web's action sheet.
  await page.goto(`/web/#/details?id=${loadState().libraries.movies}`);
  await page.locator('#itemDetailPage:not(.hide) .btnMoreCommands').first().click();
  const first = page.locator('.actionSheet .actionSheetMenuItem').first();
  await expect(first).toBeFocused();
  // Drawn inside the item: one outside it would be clipped by the sheet's scroller (styles/stock-components.css).
  await expect(first).toHaveCSS('outline-style', 'solid');
  await expect(first).toHaveCSS('outline-offset', '-3px');
});
