import { devices, expect, test, type Page } from '@playwright/test';
import { MEDIA_SEGMENTS, STOCK_SELECTORS } from '../../client/src/compat/registry';
import { ADMIN, api, loadState } from '../support/api';
import { CANNOT_PLAY, cannotPlay } from '../support/browsers';
import { login } from '../support/login';
import { forgetPlayback } from '../support/playback';
import { expectPresentButHidden } from '../support/stock';

// Lumen's Skip button and next-episode card, from the server's media segments. Jellyfin has no API to add segments (a
// segment provider plugin makes them), so the tests answer GET /MediaSegments/{itemId} themselves: the fixture episodes
// are 15 s long, and each test lays out the segments it needs in them.
// (The touch tests below play on WebKit too: they bring a desktop user agent.)
test.skip(
  ({ browserName, isMobile, userAgent }) => cannotPlay({ browserName, isMobile }) && /iPhone/.test(userAgent ?? ''),
  CANNOT_PLAY,
);

type SegmentType = (typeof MEDIA_SEGMENTS.types)[number];
type Action = (typeof MEDIA_SEGMENTS.actions)[number];
/** [type, start, end], in seconds. */
type Segments = [SegmentType, number, number][];

interface Episode {
  Id: string;
  Name: string;
}
let episodes: Episode[] = [];
test.beforeAll(async () => {
  const { admin, items } = loadState();
  const result = await api<{ Items: Episode[] }>(`/Shows/${items['Lumen Show']}/Episodes`, {
    token: admin.token,
    query: { userId: admin.userId },
  });
  episodes = result.Items;
  expect(episodes.length).toBeGreaterThanOrEqual(6);
});
// The tests play the first two episodes: off the admin's History and Continue watching again afterwards.
test.afterEach(async ({ page }) => forgetPlayback(page, episodes.slice(0, 2).map((e) => e.Id)));

interface Setup {
  /** The first episode's segments. */
  segments: Segments;
  /**
   * jellyfin-web's own segment manager works too, as on a server that has these segments: it goes by the media source's
   * HasSegments flag, which the server only sets for segments of its own.
   */
  stock?: boolean;
  /** The user's "Media segment actions" (jellyfin-web keeps them in localStorage). */
  actions?: Partial<Record<SegmentType, Action>>;
  /** "Play next episode automatically", the user's setting on the server (on by default). */
  autoplay?: boolean;
  /** Lumen's own request for the segments fails (jellyfin-web's asks for the types it acts on). */
  failLumen?: boolean;
  tv?: boolean;
}

/** Signs in with the segments, settings and layout in place. */
async function setUp(page: Page, setup: Setup): Promise<void> {
  const { admin } = loadState();
  const ticks = (seconds: number): number => Math.round(seconds * 10_000_000);
  await page.route(/\/MediaSegments\/[0-9a-f-]+/i, async (route) => {
    const url = new URL(route.request().url());
    if (setup.failLumen && !url.searchParams.has('includeSegmentTypes')) return route.fulfill({ status: 500 });
    const first = url.pathname.toLowerCase().includes(episodes[0]!.Id);
    const wanted = url.searchParams.getAll('includeSegmentTypes');
    const Items = (first ? setup.segments : [])
      .filter(([type]) => wanted.length === 0 || wanted.includes(type))
      .map(([Type, start, end], i) => ({
        Id: `0000000000000000000000000000000${i}`,
        ItemId: episodes[0]!.Id,
        Type,
        StartTicks: ticks(start),
        EndTicks: ticks(end),
      }));
    await route.fulfill({ json: { Items, TotalRecordCount: Items.length, StartIndex: 0 } });
  });
  if (setup.stock) {
    await page.route(/\/Items\/[0-9a-f-]+\/PlaybackInfo/i, async (route) => {
      const response = await route.fetch();
      const info = (await response.json()) as { MediaSources?: Record<string, unknown>[] };
      for (const source of info.MediaSources ?? []) source[MEDIA_SEGMENTS.hasSegments] = true;
      await route.fulfill({ response, json: info });
    });
  }
  if (setup.autoplay === false) {
    await page.route(/\/Users\/(Me|[0-9a-f-]{32,36})(\?|$)/i, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const response = await route.fetch();
      const user = (await response.json()) as { Configuration?: Record<string, unknown> };
      if (user.Configuration) user.Configuration.EnableNextEpisodeAutoPlay = false;
      await route.fulfill({ response, json: user });
    });
  }
  const settings = Object.entries(setup.actions ?? {}).map(
    ([type, action]) => [`${admin.userId}-${MEDIA_SEGMENTS.settingPrefix}${type}`, action] as const,
  );
  await page.addInitScript(
    ([entries, tv]) => {
      for (const [key, value] of entries) localStorage.setItem(key, value);
      if (tv) localStorage.setItem('layout', 'tv');
    },
    [settings, !!setup.tv] as const,
  );
  await login(page, ADMIN);
}

const video = (page: Page) => page.locator('video.htmlvideoplayer');
const time = (page: Page) => video(page).evaluate((v: HTMLVideoElement) => v.currentTime);
/** The player's subtitle line: "S1:E1 · Lumen Show S01E01". */
const nowPlaying = (page: Page) => page.locator('.lmn-player__subtitle');

/** Plays the first episode from its page. */
async function play(page: Page): Promise<void> {
  await page.goto(`/web/#/details?id=${episodes[0]!.Id}`);
  await page.locator('#lmn-root').getByRole('button', { name: 'Play' }).first().click();
  await expect(page).toHaveURL(/#\/video/);
  await expect(nowPlaying(page)).toContainText('S1:E1');
}

test('Skip Intro shows through the intro, with the controls hidden too, and skips to its end', { tag: '@smoke' }, async ({
  page,
}) => {
  // A recap that the user has set to ask, too short to be worth a button by the time the test looks; then the intro.
  await setUp(page, { segments: [['Recap', 0.5, 4], ['Intro', 4, 13]], actions: { Recap: 'AskToSkip' }, stock: true });
  await play(page);

  const skip = page.getByRole('button', { name: 'Skip Intro' });
  await expect(skip).toBeVisible();
  // Lumen draws the prompts now: jellyfin-web's own, for the same segment, is there but hidden.
  await expect(page.locator('html')).toHaveClass(/\blmn-segments\b/);
  await expectPresentButHidden(page.locator(STOCK_SELECTORS.skipIntro.selector));
  await expectPresentButHidden(page.locator(STOCK_SELECTORS.upNext.selector));
  // It stays as the controls go.
  await page.mouse.move(640, 360);
  await expect(page.locator('.lmn-osd')).toHaveClass(/is-idle/, { timeout: 6000 });
  await expect(skip).toBeVisible();
  expect(await time(page)).toBeLessThan(10);

  await skip.click();

  await expect.poll(() => time(page)).toBeGreaterThanOrEqual(13);
  await expect(skip).toBeHidden();
});

test.describe('on a phone, by touch', () => {
  // As in player-touch.spec.ts: real taps in Chromium and WebKit (with a desktop user agent: an iPhone's gets HLS, which
  // Playwright's WebKit can't play). Firefox has no touch emulation. An iPhone 15 on its side.
  test.skip(({ browserName }) => browserName === 'firefox', 'no touch emulation');
  test.use({
    isMobile: true,
    hasTouch: true,
    viewport: { width: 852, height: 393 },
    userAgent: async ({ browserName }, use) =>
      use(devices[browserName === 'webkit' ? 'Desktop Safari' : 'Desktop Chrome'].userAgent),
  });

  test('one tap on Skip Intro skips, with the controls hidden', async ({ page }) => {
    await setUp(page, { segments: [['Intro', 5, 14.5]], stock: true });
    await play(page);
    // The controls have gone by the time the intro starts; the button comes up without them.
    const skip = page.getByRole('button', { name: 'Skip Intro' });
    await expect(skip).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.lmn-osd')).toHaveClass(/is-idle/);
    const box = (await skip.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(852);
    expect(box.y + box.height).toBeLessThanOrEqual(393);

    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);

    await expect.poll(() => time(page)).toBeGreaterThanOrEqual(13.5);
    await expect(skip).toBeHidden();
  });
});

test('TV layout: Skip Intro takes the D-pad focus, OK presses it, and focus goes back to the controls', async ({ page }) => {
  await setUp(page, { segments: [['Intro', 3, 13]], stock: true, tv: true });
  await expect(page.locator('html')).toHaveClass(/\blayout-tv\b/);
  await play(page);

  const skip = page.getByRole('button', { name: 'Skip Intro' });
  await expect(skip).toBeFocused();
  expect(await time(page)).toBeLessThan(10);

  await page.keyboard.press('Enter');

  await expect.poll(() => time(page)).toBeGreaterThanOrEqual(13);
  await expect(skip).toBeHidden();
  // Not left on nothing: the remote's next press goes somewhere.
  await expect(page.locator('.lmn-player__top button:focus, .lmn-player__bottom button:focus')).toHaveCount(1);
});

for (const stock of [false, true]) {
  const who = stock ? "jellyfin-web's own segment manager skipping too" : 'Lumen making the skip';
  test(`an intro set to "Skip" is skipped once, with a notice and an Undo (${who})`, async ({ page }) => {
    await setUp(page, { segments: [['Intro', 3, 11]], actions: { Intro: 'Skip' }, stock });
    await play(page);
    await page.evaluate(() => {
      const w = window as unknown as { seeks: number };
      w.seeks = 0;
      document.addEventListener('seeking', () => void w.seeks++, true);
    });
    const seeks = () => page.evaluate(() => (window as unknown as { seeks: number }).seeks);

    const notice = page.getByRole('status').filter({ hasText: 'Skipped intro' });
    await expect(notice).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => time(page)).toBeGreaterThanOrEqual(11);
    // One seek: Lumen and jellyfin-web don't both make it.
    expect(await seeks()).toBe(1);
    await expect(page.getByRole('button', { name: 'Skip Intro' })).toBeHidden();

    await page.getByRole('button', { name: 'Undo' }).click();

    await expect.poll(() => time(page)).toBeLessThan(6);
    await expect(notice).toBeHidden();
    // The intro plays this time, with the button to skip it after all.
    await expect(page.getByRole('button', { name: 'Skip Intro' })).toBeVisible();
    await expect.poll(() => time(page)).toBeGreaterThan(5);
    expect(await time(page)).toBeLessThan(11);
    expect(await seeks()).toBe(2);
  });
}

test.describe('the next-episode card', () => {
  const card = (page: Page) => page.getByRole('region', { name: 'Next episode' });

  test('comes up as the credits start; Play now starts the next episode', async ({ page }) => {
    await setUp(page, { segments: [['Outro', 5, 15]], stock: true });
    await play(page);

    await expect(card(page)).toBeVisible({ timeout: 10_000 });
    await expect(card(page)).toContainText(`S1 · E2 · ${episodes[1]!.Name}`);
    await expect(card(page)).toContainText(/Playing in \d+/);
    await expect(card(page).locator('img')).toBeVisible();
    // In place of Skip Credits, and of jellyfin-web's own card.
    await expect(page.getByRole('button', { name: 'Skip Credits' })).toBeHidden();
    await expectPresentButHidden(page.locator(STOCK_SELECTORS.upNext.selector));
    expect(await time(page)).toBeLessThan(10);

    await card(page).getByRole('button', { name: 'Play now' }).click();

    await expect(nowPlaying(page)).toContainText('S1:E2');
    await expect(card(page)).toBeHidden();
  });

  test('counts down from 10 and starts the next episode in place of the credits', async ({ page }) => {
    await setUp(page, { segments: [['Outro', 2, 15]] });
    // Where the first episode was when it stopped, as jellyfin-web reports it to the server.
    const stoppedAt = page
      .waitForRequest((r) => r.url().includes('/Sessions/Playing/Stopped') && r.postDataJSON()?.ItemId === episodes[0]!.Id)
      .then((r) => (r.postDataJSON() as { PositionTicks: number }).PositionTicks / 10_000_000);
    await play(page);

    await expect(card(page)).toContainText(/Playing in (10|9)$|Playing in (10|9)\D/, { timeout: 10_000 });

    await expect(nowPlaying(page)).toContainText('S1:E2', { timeout: 15_000 });
    // Before the credits were through: the episode is 15 s long.
    expect(await stoppedAt).toBeLessThan(14.5);
  });

  test('Watch credits puts it away, and the episode plays on', async ({ page }) => {
    await setUp(page, { segments: [['Outro', 4, 15]] });
    await play(page);
    await expect(card(page)).toBeVisible({ timeout: 10_000 });

    await card(page).getByRole('button', { name: 'Watch credits' }).click();

    await expect(card(page)).toBeHidden();
    await expect.poll(() => time(page), { timeout: 10_000 }).toBeGreaterThan(8);
    await expect(card(page)).toBeHidden();
    await expect(page.getByRole('button', { name: 'Skip Credits' })).toBeHidden();
    await expect(nowPlaying(page)).toContainText('S1:E1');
  });

  test('has no countdown with next-episode autoplay off, and Play now still plays the next episode', async ({ page }) => {
    await setUp(page, { segments: [['Outro', 4, 15]], autoplay: false });
    await play(page);

    await expect(card(page)).toBeVisible({ timeout: 10_000 });
    await expect(card(page)).toContainText(`S1 · E2 · ${episodes[1]!.Name}`);
    await expect(card(page)).not.toContainText('Playing in');

    await card(page).getByRole('button', { name: 'Play now' }).click();

    await expect(nowPlaying(page)).toContainText('S1:E2');
  });

  test('TV layout: Play now takes the D-pad focus, and the arrows reach Watch credits', async ({ page }) => {
    await setUp(page, { segments: [['Outro', 4, 15]], tv: true });
    await play(page);

    const playNow = card(page).getByRole('button', { name: 'Play now' });
    await expect(playNow).toBeFocused({ timeout: 10_000 });
    // As everywhere in the TV player, the first press only brings the hidden controls back; the next one moves.
    await expect(page.locator('.lmn-osd')).toHaveClass(/is-idle/);
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.lmn-osd')).not.toHaveClass(/is-idle/);
    await expect(playNow).toBeFocused();
    await page.keyboard.press('ArrowRight');
    const watch = card(page).getByRole('button', { name: 'Watch credits' });
    await expect(watch).toBeFocused();

    await page.keyboard.press('Enter');

    await expect(card(page)).toBeHidden();
    await expect(page.locator('.lmn-player__top button:focus, .lmn-player__bottom button:focus')).toHaveCount(1);
  });
});

test("falls back to jellyfin-web's own skip prompt when Lumen can't fetch the segments", async ({ page }) => {
  await setUp(page, { segments: [['Intro', 3, 13]], stock: true, failLumen: true });
  await play(page);

  // jellyfin-web's prompt, above Lumen's player and clickable; none of Lumen's.
  const stockSkip = page.locator(`${STOCK_SELECTORS.skipIntro.selector} button`);
  await expect(stockSkip).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('html')).not.toHaveClass(/\blmn-segments\b/);
  await expect(page.locator('#lmn-root').getByRole('button', { name: /^Skip / })).toHaveCount(0);

  await stockSkip.click();

  await expect.poll(() => time(page)).toBeGreaterThanOrEqual(13);
});
