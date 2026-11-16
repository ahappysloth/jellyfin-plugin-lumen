import { expect, test, type Page } from '@playwright/test';
import { ADMIN, loadState } from '../support/api';
import { CANNOT_PLAY, cannotPlay } from '../support/browsers';
import { login } from '../support/login';
import { forgetPlayback } from '../support/playback';

// The player's address names what plays: the title's details URL with /video added (client/src/views/player/playerUrl.ts),
// so a reload, or the URL opened again, brings the player back where it was.

test.skip(cannotPlay, CANNOT_PLAY);
test.afterEach(async ({ page }) => forgetPlayback(page, [loadState().items['Lumen Alpha']!]));

const playerUrl = (id: string) => new RegExp(`#/details/video\\?id=${id}(&|$)`);
const detailsUrl = (id: string) => new RegExp(`#/details\\?id=${id}(&|$)`);
const video = (page: Page) => page.locator('video.htmlvideoplayer');
const position = (page: Page) => video(page).evaluate((v: HTMLVideoElement) => v.currentTime);
const controls = (page: Page) => page.locator('#lmn-root .lmn-osd:not(.is-loading)');
const backButton = (page: Page) => page.locator('#lmn-root .lmn-player__back');

/** Plays Lumen Alpha from its page, opened from home, and waits until it's `seconds` in. */
async function playAlpha(page: Page, seconds = 5): Promise<string> {
  const id = loadState().items['Lumen Alpha']!;
  await login(page, ADMIN);
  await page.goto('/web/#/home');
  await expect(page.locator('#lmn-root .lmn-home')).toBeVisible();
  await page.evaluate((item) => (location.hash = `#/details?id=${item}`), id);
  await page.locator('#lmn-root').getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page).toHaveURL(playerUrl(id));
  await expect.poll(() => position(page), { timeout: 20_000 }).toBeGreaterThan(seconds);
  return id;
}

test('a reload in the player brings it back where it was, and Back goes to its page, then on back', { tag: '@smoke' }, async ({ page }) => {
  const id = await playAlpha(page);
  // jellyfin-web added the player's entry after the details page; Lumen named it in place, adding none.
  const length = await page.evaluate(() => history.length);
  const before = await position(page);

  await page.reload();

  await expect(page).toHaveURL(playerUrl(id));
  await expect(controls(page)).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => video(page).evaluate((v: HTMLVideoElement) => !v.paused)).toBe(true);
  // Where it was as the page went (read at most a quarter of a second before), not from the start.
  const after = await position(page);
  expect(after).toBeGreaterThan(before - 1);
  expect(after).toBeLessThan(before + 5);
  expect(await page.evaluate(() => history.length)).toBe(length + 1); // its page, then the player again

  await backButton(page).click();
  await expect(page).toHaveURL(detailsUrl(id));
  await expect(page.locator('#lmn-root .lmn-details--movie')).toBeVisible();
  await expect(video(page)).toHaveCount(0);
  // Then on to where the user was before that page, past the entry of it Play was pressed on (the same page again).
  await page.locator('#lmn-root').getByRole('button', { name: 'Back' }).click();
  await expect(page).toHaveURL(/#\/home$/);
  await expect(page.locator('#lmn-root .lmn-home')).toBeVisible();
});

test("a title's player URL opened in a new tab plays it; Back goes to its page, and from there home", async ({ page }) => {
  const id = loadState().items['Lumen Alpha']!;
  await login(page, ADMIN);
  const fresh = await page.context().newPage();
  await fresh.goto(`/web/#/details/video?id=${id}`);

  await expect(fresh).toHaveURL(playerUrl(id));
  await expect(controls(fresh)).toBeVisible({ timeout: 20_000 });
  await expect(fresh.locator('#lmn-root .lmn-player__title')).toHaveText('Lumen Alpha');
  await expect.poll(() => position(fresh)).toBeGreaterThan(0.5);

  await backButton(fresh).click();
  await expect(fresh).toHaveURL(detailsUrl(id));
  await expect(fresh.locator('#lmn-root .lmn-details--movie')).toBeVisible();
  await fresh.locator('#lmn-root').getByRole('button', { name: 'Back' }).click();
  await expect(fresh).toHaveURL(/#\/home$/);
  await fresh.close();
});

test("a player URL for a title that isn't there goes home with a toast, never a blank page", { tag: '@smoke' }, async ({ page }) => {
  await login(page, ADMIN);
  await page.goto('/web/#/details/video?id=0123456789abcdef0123456789abcdef');
  await expect(page).toHaveURL(/#\/home$/);
  await expect(page.locator('#lmn-root .lmn-home')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText("Couldn't play that title");
});

test("a reload where the browser won't start the video without a click: the player waits, paused where it was, with Play", async ({ page }) => {
  // A browser's autoplay rule, after a reload: no video with sound until the user has clicked in the page.
  await page.addInitScript(() => {
    const w = window as unknown as { __clicked?: boolean };
    addEventListener('pointerdown', () => (w.__clicked = true), true);
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      return w.__clicked ? play.call(this) : Promise.reject(new DOMException('No click yet', 'NotAllowedError'));
    };
    // jellyfin-web's <video autoplay>: the browser holds that back too.
    Object.defineProperty(HTMLMediaElement.prototype, 'autoplay', { get: () => false, set: () => undefined });
    new MutationObserver((records) => {
      for (const record of records)
        record.addedNodes.forEach((node) => {
          if (node instanceof Element) node.querySelectorAll('video').forEach((v) => v.removeAttribute('autoplay'));
        });
    }).observe(document, { childList: true, subtree: true });
  });
  const id = await playAlpha(page);
  const before = await position(page);

  await page.reload();

  await expect(page).toHaveURL(playerUrl(id));
  const play = page.locator('#lmn-root .lmn-player__controls').getByRole('button', { name: 'Play' });
  await expect(play).toBeVisible({ timeout: 20_000 });
  expect(await video(page).evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  expect(await position(page)).toBeGreaterThan(before - 1);

  await play.click();
  await expect.poll(() => position(page)).toBeGreaterThan(before + 0.5);
  await backButton(page).click();
  await expect(page).toHaveURL(detailsUrl(id));
});

test('subtitles sit above the controls while they show, and go back down as they hide', async ({ page }) => {
  const { admin, items } = loadState();
  await login(page, ADMIN);
  // jellyfin-web's own subtitle element, which it uses by default everywhere but Chromium (there: the browser's cues,
  // which the page can't measure; the unit tests cover how far those move).
  await page.evaluate((userId) => {
    localStorage.setItem(`${userId}-localplayersubtitleappearance3`, JSON.stringify({ subtitleStyling: 'Custom' }));
  }, admin.userId);
  try {
    await page.goto(`/web/#/details?id=${items['Lumen Alpha']}`);
    await page.locator('#lmn-root').getByRole('button', { name: 'Play', exact: true }).click();
    await expect(controls(page)).toBeVisible({ timeout: 20_000 });
    const tracks = page.locator('#lmn-root').getByRole('button', { name: /Audio & Subtitles/ });
    await tracks.click();
    await page.getByRole('dialog', { name: 'Audio & Subtitles' }).getByRole('radio', { name: /^English/ }).last().click();
    await tracks.click();
    const text = page.locator('.videoSubtitlesInner');
    await expect(text).toHaveText(/\S/);
    const foot = () => text.evaluate((el) => el.getBoundingClientRect().bottom);
    const barTop = () => page.locator('#lmn-root .lmn-player__times').evaluate((el) => el.getBoundingClientRect().top);

    await page.mouse.move(640, 300);
    await expect(page.locator('#lmn-root .lmn-osd')).not.toHaveClass(/is-idle/);
    await expect.poll(async () => (await foot()) <= (await barTop()), { timeout: 3000 }).toBe(true);
    const up = await foot();

    // No input: the controls hide, and the subtitles go down to where the user put them.
    await expect(page.locator('#lmn-root .lmn-osd')).toHaveClass(/is-idle/, { timeout: 8000 });
    await expect.poll(foot).toBeGreaterThan(up + 10);
  } finally {
    await page.evaluate((userId) => localStorage.removeItem(`${userId}-localplayersubtitleappearance3`), admin.userId);
  }
});

const LONG_AUDIO = 'English - Dolby TrueHD Atmos 7.1 - Commentary by the director and cast, with the producers and the effects team - Default';
const LONG_SUBTITLE = 'English (Commentary transcript, with every sign and song in the picture translated as it appears) - SUBRIP - External';

for (const [name, size, tv] of [
  ['desktop', { width: 1280, height: 720 }, false],
  ['phone', { width: 390, height: 844 }, false],
  ['TV layout', { width: 1920, height: 1080 }, true],
] as const) {
  test(`Audio & Subtitles fits its longest track, ending a name too long for the screen in an ellipsis: ${name}`, async ({ page }) => {
    await page.setViewportSize(size);
    if (tv) await page.addInitScript(() => localStorage.setItem('layout', 'tv'));
    // Track names as long as real files' carry.
    await page.route('**/Items/*/PlaybackInfo*', async (route) => {
      const response = await route.fetch();
      const info = await response.json();
      for (const source of info.MediaSources ?? [])
        for (const stream of source.MediaStreams ?? []) {
          if (stream.Type === 'Audio') stream.DisplayTitle = LONG_AUDIO;
          if (stream.Type === 'Subtitle' && stream.Language === 'eng') stream.DisplayTitle = LONG_SUBTITLE;
        }
      await route.fulfill({ response, json: info });
    });
    const { items } = loadState();
    await login(page, ADMIN);
    await page.goto(`/web/#/details?id=${items['Lumen Alpha']}`);
    await page.locator('#lmn-root').getByRole('button', { name: 'Play', exact: true }).click();
    await expect(controls(page)).toBeVisible({ timeout: 20_000 });
    await page.locator('#lmn-root').getByRole('button', { name: /Audio & Subtitles/ }).click();

    const panel = page.getByRole('dialog', { name: 'Audio & Subtitles' });
    const subtitle = panel.getByRole('radio', { name: /Commentary transcript/ });
    await expect(subtitle).toBeVisible();
    const box = (await panel.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(size.width);
    // Never sideways scrolling.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);
    if (name !== 'phone') expect(box.width).toBeGreaterThan(440); // grew past the other panels' width

    // One line each, cut with an ellipsis; the whole name stays the option's name and its title.
    const label = subtitle.locator('.lmn-panel__option-label');
    expect(await label.evaluate((el) => [el.scrollWidth > el.clientWidth, getComputedStyle(el).textOverflow])).toEqual([
      true,
      'ellipsis',
    ]);
    const detail = panel.getByRole('radio', { name: /Dolby TrueHD/ }).locator('.lmn-panel__option-detail');
    expect(await detail.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await expect(subtitle).toHaveAccessibleName(/translated as it appears\)/);
    await expect(subtitle).toHaveAttribute('title', /translated as it appears\)/);
  });
}
