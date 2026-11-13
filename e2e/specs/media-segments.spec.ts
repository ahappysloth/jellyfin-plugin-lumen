import { devices, expect, test, type Page } from '@playwright/test';
import { MEDIA_SEGMENTS, STOCK_SELECTORS } from '../../client/src/compat/registry';
import { ADMIN, api, loadState } from '../support/api';
import { CANNOT_PLAY, cannotPlay } from '../support/browsers';
import { login } from '../support/login';
import { accountButton, accountMenu } from '../support/nav';
import { forgetPlayback } from '../support/playback';
import { expectPresentButHidden } from '../support/stock';

// Lumen's Skip button and next-episode card, from the server's media segments. Jellyfin has no API to add segments (a
// segment provider plugin makes them), so the tests answer GET /MediaSegments/{itemId} themselves: the fixture episodes
// are 15 s long, and each test lays out the segments it needs in them. Credits "to the end" end at 16 s: jellyfin-web
// builds its own up-next card only for a segment that ends at or after the runtime it has for the episode (a hair
// over 15 s), and the tests that say Lumen's card stands in for it need it built.
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
  /** The segments of the episode that plays (the first, unless `episode` says otherwise). */
  segments: Segments;
  /** Which episode has them and plays: its place in the show. */
  episode?: number;
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
  /** Lumen's request fails for the episode after the one that plays, which then falls back to jellyfin-web's prompts. */
  failNext?: boolean;
  /** The server converts the video instead of sending the file as it is (in Chromium: HLS, which seeks in place). */
  transcode?: boolean;
  tv?: boolean;
}

/** Signs in with the segments, settings and layout in place. */
async function setUp(page: Page, setup: Setup): Promise<void> {
  const { admin } = loadState();
  const ticks = (seconds: number): number => Math.round(seconds * 10_000_000);
  await page.route(/\/MediaSegments\/[0-9a-f-]+/i, async (route) => {
    const url = new URL(route.request().url());
    const playing = episodes[setup.episode ?? 0]!.Id;
    const first = url.pathname.toLowerCase().includes(playing);
    const lumens = !url.searchParams.has('includeSegmentTypes');
    if (lumens && (setup.failLumen || (setup.failNext && !first))) return route.fulfill({ status: 500 });
    const wanted = url.searchParams.getAll('includeSegmentTypes');
    const Items = (first ? setup.segments : [])
      .filter(([type]) => wanted.length === 0 || wanted.includes(type))
      .map(([Type, start, end], i) => ({
        Id: `0000000000000000000000000000000${i}`,
        ItemId: playing,
        Type,
        StartTicks: ticks(start),
        EndTicks: ticks(end),
      }));
    await route.fulfill({ json: { Items, TotalRecordCount: Items.length, StartIndex: 0 } });
  });
  if (setup.stock || setup.transcode) {
    await page.route(/\/Items\/[0-9a-f-]+\/PlaybackInfo/i, async (route) => {
      // The fixtures are small enough to play as they are at any quality: the request has to rule that out.
      const asked = route.request().postDataJSON() as Record<string, unknown>;
      const response = await route.fetch(
        setup.transcode ? { postData: JSON.stringify({ ...asked, EnableDirectPlay: false, EnableDirectStream: false }) } : {},
      );
      const info = (await response.json()) as { MediaSources?: Record<string, unknown>[] };
      if (setup.stock) for (const source of info.MediaSources ?? []) source[MEDIA_SEGMENTS.hasSegments] = true;
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

/** Plays an episode (the first) from its page. */
async function play(page: Page, episode = 0): Promise<void> {
  await page.goto(`/web/#/details?id=${episodes[episode]!.Id}`);
  await page.locator('#lmn-root').getByRole('button', { name: 'Play' }).first().click();
  await expect(page).toHaveURL(/#\/video/);
  await expect(nowPlaying(page)).toContainText(`S${Math.floor(episode / 3) + 1}:E${(episode % 3) + 1}`);
}

/** jellyfin-web's own up-next card, in its box: built and shown as far as jellyfin-web knows, or put away again. */
const stockCard = (page: Page) => page.locator(STOCK_SELECTORS.upNext.selector);

/** What the server has for the admin on an episode. */
async function userData(episode: number): Promise<{ Played: boolean; PlaybackPositionTicks: number }> {
  const { admin } = loadState();
  const item = await api<{ UserData: { Played: boolean; PlaybackPositionTicks: number } }>(`/Items/${episodes[episode]!.Id}`, {
    token: admin.token,
    query: { userId: admin.userId },
  });
  return item.UserData;
}

test('Skip Intro shows through the intro, with the controls hidden too, and skips to its end', { tag: '@smoke' }, async ({
  page,
}) => {
  // A recap that the user has set to ask, too short to be worth a button by the time the test looks; then the intro.
  await setUp(page, { segments: [['Recap', 0.5, 4], ['Intro', 4, 13]], actions: { Recap: 'AskToSkip' }, stock: true });
  await play(page);

  const skip = page.getByRole('button', { name: 'Skip Intro' });
  await expect(skip).toBeVisible();
  // Lumen draws the prompts now: jellyfin-web's own, which it has made and shown for the same segment, is unseen.
  await expect(page.locator('html')).toHaveClass(/\blmn-segments\b/);
  const stockSkip = page.locator(`${STOCK_SELECTORS.skipIntro.selector} button`);
  await expect(stockSkip).toHaveCount(1);
  await expect(stockSkip).not.toHaveClass(/\bhide\b/);
  await expectPresentButHidden(page.locator(STOCK_SELECTORS.skipIntro.selector));
  await expectPresentButHidden(stockSkip);
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

  /**
   * A finger down at (x, y), held, and lifted: what a real tap is. Playwright's `touchscreen.tap` lifts at once, before
   * the page has redrawn anything the press changed (here: the controls coming back). Through Chromium's CDP.
   */
  async function heldTap(page: Page, x: number, y: number, ms: number): Promise<void> {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await page.waitForTimeout(ms);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  }
  const heldOnly = 'a held touch goes through Chromium (CDP)';

  for (const ms of [60, 200]) {
    test(`a finger held ${ms} ms on Skip Intro presses it, with the controls hidden: it doesn't move from under the finger`, async ({
      page,
      browserName,
    }) => {
      test.skip(browserName !== 'chromium', heldOnly);
      await setUp(page, { segments: [['Intro', 5, 14.5]], stock: true });
      await play(page);
      const skip = page.getByRole('button', { name: 'Skip Intro' });
      await expect(skip).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('.lmn-osd')).toHaveClass(/is-idle/);
      const box = (await skip.boundingBox())!;

      await heldTap(page, box.x + box.width / 2, box.y + box.height / 2, ms);

      await expect.poll(() => time(page)).toBeGreaterThanOrEqual(13.5);
      await expect(skip).toBeHidden();
    });
  }

  test('a held finger on Play now starts the next episode, with the controls hidden', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', heldOnly);
    await setUp(page, { segments: [['Outro', 5, 16]], stock: true });
    await play(page);
    const playNow = page.getByRole('region', { name: 'Next episode' }).getByRole('button', { name: 'Play now' });
    await expect(playNow).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.lmn-osd')).toHaveClass(/is-idle/);
    const box = (await playNow.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(393);

    await heldTap(page, box.x + box.width / 2, box.y + box.height / 2, 120);

    await expect(nowPlaying(page)).toContainText('S1:E2');
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

test('TV layout: Skip Intro leaves the focus on the seek bar while the controls are up, and takes it once they go', async ({
  page,
}) => {
  await setUp(page, { segments: [['Intro', 4, 14]], stock: true, tv: true });
  await play(page);
  // The remote is on the seek bar, and in use: a key (one that does nothing) keeps the controls up as the intro starts.
  const seekBar = page.locator('#lmn-root').getByRole('slider', { name: 'Seek' });
  await seekBar.focus();
  const skip = page.getByRole('button', { name: 'Skip Intro' });
  await expect(async () => {
    await page.keyboard.press('Shift');
    await expect(skip).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 10_000 });

  await expect(page.locator('.lmn-osd')).not.toHaveClass(/is-idle/);
  await expect(seekBar).toBeFocused();

  // Left alone, the controls go, and the button takes the remote.
  await expect(page.locator('.lmn-osd')).toHaveClass(/is-idle/, { timeout: 6000 });
  await expect(skip).toBeFocused();
});

test('TV layout: Skip Intro leaves the focus in an open Watch together menu', async ({ page }) => {
  await setUp(page, { segments: [['Intro', 4, 14.5]], stock: true, tv: true });
  await play(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: /Watch together/ }).click();
  const menu = page.getByRole('menu', { name: 'Watch together' });
  await expect(menu).toBeVisible();

  const skip = page.getByRole('button', { name: 'Skip Intro' });
  await expect(skip).toBeVisible({ timeout: 10_000 });
  // The controls go while the menu stays: the button still doesn't take the remote from it.
  await expect(page.locator('.lmn-osd')).toHaveClass(/is-idle/, { timeout: 6000 });
  await expect(skip).toBeVisible();
  await expect(skip).not.toBeFocused();
  expect(await menu.evaluate((el) => el.contains(document.activeElement))).toBe(true);
});

for (const transcode of [false, true]) {
  for (const stock of [false, true]) {
    const who = stock ? "jellyfin-web's own segment manager skipping too" : 'Lumen making the skip';
    const how = transcode ? ', on a stream the server converts' : '';
    test(`an intro set to "Skip" is skipped once, with a notice and an Undo (${who}${how})`, async ({ page }) => {
      await setUp(page, { segments: [['Intro', 3, 11]], actions: { Intro: 'Skip' }, stock, transcode });
      await play(page);
      if (transcode) await expect.poll(() => video(page).evaluate((v: HTMLVideoElement) => v.currentSrc)).toMatch(/^blob:/);
      // Seeks from the intro on (a converted stream may make one of its own as it starts).
      await page.evaluate(() => {
        const w = window as unknown as { seeks: number };
        w.seeks = 0;
        document.addEventListener('seeking', (e) => void ((e.target as HTMLVideoElement).currentTime >= 3 && w.seeks++), true);
      });
      const seeks = () => page.evaluate(() => (window as unknown as { seeks: number }).seeks);

      const notice = page.getByRole('status').filter({ hasText: 'Skipped intro' });
      await expect(notice).toBeVisible({ timeout: 15_000 });
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
}

test.describe('the next-episode card', () => {
  const card = (page: Page) => page.getByRole('region', { name: 'Next episode' });

  test('comes up as the credits start; Play now starts the next episode', async ({ page }) => {
    await setUp(page, { segments: [['Outro', 5, 16]], stock: true });
    await play(page);
    // "Skip Credits" never shows, not for a frame after Play now either.
    await page.evaluate(() => {
      const w = window as unknown as { skipCredits: boolean };
      w.skipCredits = false;
      const look = (): void => {
        if ([...document.querySelectorAll('#lmn-root button')].some((b) => b.textContent?.includes('Skip Credits'))) w.skipCredits = true;
      };
      new MutationObserver(look).observe(document.body, { childList: true, subtree: true, characterData: true });
    });

    await expect(card(page)).toBeVisible({ timeout: 10_000 });
    await expect(card(page)).toContainText(`S1 · E2 · ${episodes[1]!.Name}`);
    await expect(card(page)).toContainText(/Playing in \d+/);
    await expect(card(page).locator('img')).toBeVisible();
    // In place of Skip Credits, and of jellyfin-web's own card: which jellyfin-web has built and shown (never two).
    await expect(page.getByRole('button', { name: 'Skip Credits' })).toBeHidden();
    await expect(stockCard(page)).toHaveClass(/\bupNextDialog\b/);
    await expect(stockCard(page)).not.toHaveClass(/\bhide\b/);
    await expect(stockCard(page).locator('button')).toHaveCount(2);
    await expectPresentButHidden(stockCard(page));
    expect(await time(page)).toBeLessThan(10);

    await card(page).getByRole('button', { name: 'Play now' }).click();

    await expect(nowPlaying(page)).toContainText('S1:E2');
    await expect(card(page)).toBeHidden();
    expect(await page.evaluate(() => (window as unknown as { skipCredits: boolean }).skipCredits)).toBe(false);
    // jellyfin-web has put its own card away, as it does when it can see it.
    await expect(stockCard(page)).toHaveClass(/\bhide\b/);
  });

  test("a next episode that falls back to jellyfin-web's prompts finds its card put away, and nothing unseen in the way", async ({
    page,
  }) => {
    await setUp(page, { segments: [['Outro', 5, 16]], stock: true, failNext: true });
    await play(page);
    await expect(card(page)).toBeVisible({ timeout: 10_000 });
    await expect(stockCard(page)).toHaveClass(/\bupNextDialog\b/);
    await expect(stockCard(page)).not.toHaveClass(/\bhide\b/);

    await card(page).getByRole('button', { name: 'Play now' }).click();

    // The second episode: Lumen has no segments for it, and draws and hides nothing.
    await expect(nowPlaying(page)).toContainText('S1:E2');
    await expect(page.locator('html')).not.toHaveClass(/\blmn-segments\b/);
    // jellyfin-web's card from the first episode went as that one ended: its video page isn't left taking it for open,
    // with an unseen box over Lumen's controls.
    await expect(stockCard(page)).toHaveClass(/\bhide\b/);
    await expect(stockCard(page)).toBeHidden();
    await page.mouse.move(640, 360);
    await page.locator('#lmn-root').getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page).not.toHaveURL(/#\/video/);
  });

  test('counts down from 10 and starts the next episode in place of the credits', async ({ page }) => {
    await setUp(page, { segments: [['Outro', 2, 16]], stock: true });
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
    await setUp(page, { segments: [['Outro', 4, 16]], stock: true });
    await play(page);
    await expect(card(page)).toBeVisible({ timeout: 10_000 });

    await card(page).getByRole('button', { name: 'Watch credits' }).click();

    await expect(card(page)).toBeHidden();
    await expect.poll(() => time(page), { timeout: 10_000 }).toBeGreaterThan(8);
    await expect(card(page)).toBeHidden();
    await expect(page.getByRole('button', { name: 'Skip Credits' })).toBeHidden();
    await expect(nowPlaying(page)).toContainText('S1:E1');
  });

  test("has no countdown with next-episode autoplay off; Play now plays the queue's next episode", async ({ page }) => {
    // jellyfin-web queues the episodes that follow all the same (12.4): the card is for the next one in its queue.
    await setUp(page, { segments: [['Outro', 4, 16]], stock: true, autoplay: false });
    await play(page);

    await expect(card(page)).toBeVisible({ timeout: 10_000 });
    await expect(card(page)).toContainText(`S1 · E2 · ${episodes[1]!.Name}`);
    await expect(card(page)).toContainText('Next episode');
    await expect(card(page)).not.toContainText('Playing in');
    // And it stays that way: nothing starts by itself.
    await expect.poll(() => time(page), { timeout: 10_000 }).toBeGreaterThan(9);
    await expect(card(page)).not.toContainText('Playing in');
    await expect(nowPlaying(page)).toContainText('S1:E1');

    await card(page).getByRole('button', { name: 'Play now' }).click();

    await expect(nowPlaying(page)).toContainText('S1:E2');
  });

  test("isn't offered for the last episode in the queue: its credits get Skip Credits", async ({ page }) => {
    const last = episodes.length - 1;
    await setUp(page, { segments: [['Outro', 3, 16]], episode: last, stock: true });
    await play(page, last);

    await expect(page.getByRole('button', { name: 'Skip Credits' })).toBeVisible({ timeout: 10_000 });
    await expect(card(page)).toHaveCount(0);
    await forgetPlayback(page, [episodes[last]!.Id]);
  });

  test.describe('left before Jellyfin would count the episode as watched', () => {
    // Jellyfin counts an episode as watched when it stops past 90% of it, and anything under 5 minutes long as soon as
    // it stops at all: with that off, the 15 s fixtures follow the same rule as a real episode.
    const setMinResume = async (seconds: number): Promise<void> => {
      const { admin } = loadState();
      const config = await api<Record<string, unknown>>('/System/Configuration', { token: admin.token });
      await api('/System/Configuration', { method: 'POST', token: admin.token, body: { ...config, MinResumeDurationSeconds: seconds } });
    };
    test.beforeAll(() => setMinResume(0));
    // Jellyfin's default (not what was there before: a failed test starts a new worker, which would read the 0).
    test.afterAll(() => setMinResume(300));

    test('the countdown leaves it watched, with no resume point', async ({ page }) => {
      await setUp(page, { segments: [['Outro', 2, 16]], stock: true });
      const stoppedAt = page
        .waitForRequest((r) => r.url().includes('/Sessions/Playing/Stopped') && r.postDataJSON()?.ItemId === episodes[0]!.Id)
        .then((r) => (r.postDataJSON() as { PositionTicks: number }).PositionTicks / 10_000_000);
      await play(page);

      await expect(nowPlaying(page)).toContainText('S1:E2', { timeout: 25_000 });

      // It stopped where Jellyfin by itself wouldn't count it (under 90% of 15 s).
      expect(await stoppedAt).toBeLessThan(13.5);
      await expect.poll(() => userData(0)).toMatchObject({ Played: true, PlaybackPositionTicks: 0 });
    });

    test('Play now leaves it watched, with no resume point', async ({ page }) => {
      await setUp(page, { segments: [['Outro', 5, 16]], stock: true });
      await play(page);
      await expect(card(page)).toBeVisible({ timeout: 10_000 });

      await card(page).getByRole('button', { name: 'Play now' }).click();

      await expect(nowPlaying(page)).toContainText('S1:E2');
      await expect.poll(() => userData(0)).toMatchObject({ Played: true, PlaybackPositionTicks: 0 });
    });

    test('Watch credits, then leaving the player, leaves it to Jellyfin: not watched', async ({ page }) => {
      await setUp(page, { segments: [['Outro', 4, 16]], stock: true });
      await play(page);
      await expect(card(page)).toBeVisible({ timeout: 10_000 });
      await card(page).getByRole('button', { name: 'Watch credits' }).click();
      await expect.poll(() => time(page)).toBeGreaterThan(7);

      const stopped = page.waitForResponse((r) => r.url().includes('/Sessions/Playing/Stopped'));
      await page.goto('/web/#/home');
      await stopped;

      await expect.poll(async () => (await userData(0)).PlaybackPositionTicks).toBeGreaterThan(0);
      expect((await userData(0)).Played).toBe(false);
    });
  });

  test('TV layout: Play now takes the D-pad focus, and the arrows reach Watch credits', async ({ page }) => {
    await setUp(page, { segments: [['Outro', 4, 16]], stock: true, tv: true });
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

test.describe('watching together', () => {
  // A group of one is a group: what Lumen does by itself there, it would do to everyone in it. (The account menu's
  // Watch together: phones have it on the profile page.)
  test.setTimeout(120_000);

  /** Starts a group, plays the first episode in it, and runs `check`; then leaves the group again. */
  async function inGroup(page: Page, check: () => Promise<void>): Promise<void> {
    await accountButton(page).click();
    await accountMenu(page).getByRole('menuitem', { name: /^Watch together/ }).click();
    await page.getByRole('menuitem', { name: 'New group' }).click();
    await expect(accountButton(page)).toHaveAccessibleName("Account: In admin's group", { timeout: 15_000 });
    try {
      await page.goto(`/web/#/details?id=${episodes[0]!.Id}`);
      await page.locator('#lmn-root').getByRole('button', { name: 'Play' }).first().click();
      await expect(page).toHaveURL(/#\/video/, { timeout: 20_000 });
      await expect(page.locator('.lmn-player__syncplay')).toBeVisible({ timeout: 15_000 });
      await check();
    } finally {
      // From the browser's own session: the group is its, not the tests' API sign-in's.
      await page
        .evaluate(() => {
          const client = (window as unknown as { ApiClient: { ajax: (r: object) => Promise<unknown>; getUrl: (p: string) => string } }).ApiClient;
          return client.ajax({ type: 'POST', url: client.getUrl('SyncPlay/Leave') }).then(() => undefined);
        })
        .catch(() => undefined);
    }
  }

  test('the card has no countdown, and the next episode never starts by itself', async ({ page }) => {
    await setUp(page, { segments: [['Outro', 2, 16]] });
    await inGroup(page, async () => {
      const card = page.getByRole('region', { name: 'Next episode' });
      await expect(card).toBeVisible({ timeout: 15_000 });
      await expect(card).toContainText('Next episode');
      await expect(card).not.toContainText('Playing in');
      await expect(card.getByRole('button')).toHaveText(['Play now', 'Watch credits']);
      // Past where a countdown from the credits' start would have moved the whole group on.
      await expect.poll(() => time(page), { timeout: 30_000 }).toBeGreaterThan(13.5);
      await expect(nowPlaying(page)).toContainText('S1:E1');
      await expect(card).not.toContainText('Playing in');
    });
  });

  test('a segment set to "Skip" isn\'t skipped for the group: it gets the Skip button, for a member to press', async ({ page }) => {
    await setUp(page, { segments: [['Intro', 3, 10]], actions: { Intro: 'Skip' } });
    await inGroup(page, async () => {
      const skip = page.getByRole('button', { name: 'Skip Intro' });
      await expect(skip).toBeVisible({ timeout: 15_000 });
      // The intro plays on: no seek of Lumen's own, and so nothing to undo.
      await expect.poll(() => time(page), { timeout: 15_000 }).toBeGreaterThan(5.5);
      expect(await time(page)).toBeLessThan(10);
      await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0);

      await skip.click();

      await expect.poll(() => time(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(10);
    });
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
