import { devices, expect, test, type Page } from '@playwright/test';
import { ADMIN, api, loadState } from '../support/api';
import { login, signIn } from '../support/login';
import { forgetPlayback } from '../support/playback';

// A phone, by touch: real taps in Chromium and WebKit, and (through Chromium's CDP) real touch drags. Firefox has no
// touch emulation. WebKit gets Safari's desktop user agent: an iPhone's gets HLS, which Playwright's WebKit can't play
// (support/browsers.ts cannotPlay); with touch on, both engines still match (hover: none), as a phone does.
test.skip(({ browserName }) => browserName === 'firefox', 'no touch emulation');
test.use({
  isMobile: true,
  hasTouch: true,
  userAgent: async ({ browserName }, use) =>
    use(devices[browserName === 'webkit' ? 'Desktop Safari' : 'Desktop Chrome'].userAgent),
});
const dragsOnly = 'touch drags go through Chromium (CDP)';

// Each test plays Lumen Alpha: off the admin's History and Continue watching again afterwards.
test.afterEach(async ({ page }) => forgetPlayback(page, [loadState().items['Lumen Alpha']!]));

/** `ownSession`: signs in as a new device, for a test that changes its Jellyfin session (support/login.ts). */
async function play(page: Page, { ownSession = false } = {}): Promise<void> {
  const { items } = loadState();
  await (ownSession ? signIn : login)(page, ADMIN);
  await page.goto(`/web/#/details?id=${items['Lumen Alpha']}`);
  await page.locator('#lmn-root').getByRole('button', { name: 'Play' }).first().click();
  const video = page.locator('video.htmlvideoplayer');
  const time = () => video.evaluate((v: HTMLVideoElement) => v.currentTime);
  // Playwright's WebKit now and then leaves the clock at the start (0.1 s) with the video playing and buffered to the
  // end, before any input; a seek gets it going. Only there, and said in the report: elsewhere a stall is a failure.
  await expect.poll(time, { timeout: 8000 }).toBeGreaterThan(0.3).catch(async (error: unknown) => {
    if (page.context().browser()?.browserType().name() !== 'webkit') throw error;
    test.info().annotations.push({ type: 'workaround', description: 'WebKit stalled at the start: seeked to 0.2 s' });
    await video.evaluate((v: HTMLVideoElement) => void (v.currentTime = 0.2));
    await expect.poll(time).toBeGreaterThan(0.3);
  });
}

const paused = (page: Page) => page.locator('video.htmlvideoplayer').evaluate((v: HTMLVideoElement) => v.paused);

/** The controls, brought up by a tap once they've gone (they're up for a few seconds as playback starts). */
async function showControls(page: Page): Promise<void> {
  const osd = page.locator('.lmn-osd');
  await expect(osd).toHaveClass(/is-idle/, { timeout: 6000 });
  const size = page.viewportSize()!;
  await page.touchscreen.tap(size.width / 2, size.height / 2);
  await expect(osd).not.toHaveClass(/is-idle/);
}

async function tapOn(page: Page, locator: ReturnType<Page['locator']>): Promise<void> {
  const box = (await locator.boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

async function openQuality(page: Page) {
  await showControls(page);
  // On a phone the pill shows its icon only; its name is still there.
  await tapOn(page, page.getByRole('button', { name: /^Quality/ }));
  const panel = page.getByRole('dialog', { name: 'Quality' });
  await expect(panel).toBeVisible();
  return panel;
}

/** A finger pressed at (x, y), moved by dy, and lifted: the browser scrolls whatever is under it. */
async function drag(page: Page, x: number, y: number, dy: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 10; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + (dy * i) / 10 }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

for (const [way, viewport, short] of [
  // `short`: a smaller phone, or one with Safari's toolbars, where the Quality panel has to scroll.
  ['portrait', { width: 390, height: 844 }, { width: 375, height: 560 }],
  ['landscape', { width: 844, height: 390 }, { width: 844, height: 300 }],
] as const) {
  test.describe(`a phone in ${way}`, () => {
    test.use({ viewport });

    test('a tap on the picture shows the controls and the next hides them, without pausing', async ({ page }) => {
      await play(page);
      const osd = page.locator('.lmn-osd');
      await expect(osd).toHaveClass(/is-idle/, { timeout: 6000 });

      await page.touchscreen.tap(viewport.width / 2, viewport.height / 2);
      await expect(osd).not.toHaveClass(/is-idle/);
      // Apart (past DOUBLE_TAP_MS, 300 ms), so not a double tap (which skips at the sides).
      await page.waitForTimeout(400);
      // The middle of the picture, where the bottom bar's shading lies in landscape: still the picture's.
      await page.touchscreen.tap(viewport.width / 2, viewport.height / 2);
      // At once: well before the controls would go by themselves (3 s).
      await expect(osd).toHaveClass(/is-idle/, { timeout: 1000 });
      expect(await paused(page)).toBe(false);
    });

    test('a double tap at either side skips 10 s, and says so', async ({ page }) => {
      await play(page);
      const video = page.locator('video.htmlvideoplayer');
      const time = () => video.evaluate((v: HTMLVideoElement) => v.currentTime);
      await video.evaluate((v: HTMLVideoElement) => {
        v.pause();
        v.currentTime = 2;
      });
      await expect.poll(time).toBeCloseTo(2, 0);
      const skipped = page.locator('.lmn-player-skipped');
      const y = viewport.height / 2;

      await page.touchscreen.tap(viewport.width * 0.85, y);
      await page.touchscreen.tap(viewport.width * 0.85, y);
      await expect(skipped).toHaveText('+10 s');
      await expect.poll(time).toBeCloseTo(12, 0);
      await expect(skipped).toHaveCount(0);

      await page.touchscreen.tap(viewport.width * 0.15, y);
      await page.touchscreen.tap(viewport.width * 0.15, y);
      await expect(skipped).toHaveText('−10 s');
      await expect.poll(time).toBeCloseTo(2, 0);
    });

    test('a tap that brings the hidden controls back presses nothing under the finger', async ({ page }) => {
      await play(page);
      const osd = page.locator('.lmn-osd');
      for (const name of ['Back', 'Pause', /^Quality/]) {
        await expect(osd).toHaveClass(/is-idle/, { timeout: 6000 });
        await tapOn(page, page.locator('#lmn-root').getByRole('button', { name, exact: true }));
        await expect(osd).not.toHaveClass(/is-idle/);
        await page.waitForTimeout(400); // proving nothing's pressed: time for a click that would have come late
        await expect(page.locator('video.htmlvideoplayer')).toBeVisible(); // still in the player
        expect(await paused(page)).toBe(false);
        await expect(page.getByRole('dialog', { name: 'Quality' })).toHaveCount(0);
      }
    });

    test('a panel picks on a tap inside, and a tap outside closes it and does nothing else', async ({ page }) => {
      await play(page);
      const panel = await openQuality(page);
      // It stays clear of the bottom of the screen and lies over the bottom bar.
      const area = (await panel.boundingBox())!;
      expect(area.y + area.height).toBeLessThanOrEqual(viewport.height);

      const last = panel.getByRole('button', { name: '2x' });
      await last.evaluate((b) => b.scrollIntoView({ block: 'nearest' }));
      await tapOn(page, last);
      await expect(last).toHaveAttribute('aria-pressed', 'true');
      await expect(panel).toBeVisible();
      await expect.poll(() => page.locator('video.htmlvideoplayer').evaluate((v: HTMLVideoElement) => v.playbackRate)).toBe(2);

      // A tap on the picture beside it (landscape) or below it (portrait).
      if (area.x > 40) await page.touchscreen.tap(20, viewport.height / 2);
      else await page.touchscreen.tap(viewport.width / 2, area.y + area.height + 20);
      await expect(panel).toHaveCount(0);
      expect(await paused(page)).toBe(false);
    });

    test('an open panel scrolls under a finger without closing, and its last entry can be tapped', async ({ page, browserName }) => {
      test.skip(browserName !== 'chromium', dragsOnly);
      await page.setViewportSize(short);
      await play(page);
      const panel = await openQuality(page);
      const area = (await panel.boundingBox())!;
      expect(area.y + area.height).toBeLessThanOrEqual(short.height);
      const room = await panel.evaluate((p) => p.scrollHeight - p.clientHeight);
      expect(room).toBeGreaterThan(40); // a real scroll

      // A drag from its lower part, where the bottom bar is, scrolls it.
      await drag(page, area.x + area.width / 2, area.y + area.height - 24, -200);
      await expect(panel).toBeVisible();
      expect(await panel.evaluate((p) => p.scrollTop)).toBe(room);

      const last = panel.getByRole('button', { name: '2x' });
      await tapOn(page, last);
      await expect(last).toHaveAttribute('aria-pressed', 'true');
      await expect(panel).toBeVisible();

      // A drag that starts on the picture beside or below it doesn't close it either.
      if (area.x > 40) await drag(page, 20, short.height / 2, -60);
      else await drag(page, short.width / 2, area.y + area.height + 8, -60);
      await expect(panel).toBeVisible();
    });
  });
}

test.describe('a short phone in landscape, watching together', () => {
  test.use({ viewport: { width: 667, height: 375 } });
  test.afterEach(async () => {
    await api('/SyncPlay/Leave', { method: 'POST', token: loadState().admin.token }).catch(() => undefined);
  });

  // The title block is as tall as its fonts and text make it: another system's fonts, or a long episode name over two
  // lines, push the group's line down. Here, a serif and an added line.
  const taller = `.lmn-player__titles { font-family: Georgia, serif; line-height: 1.5; }
    .lmn-player__subtitle::after { display: block; content: 'and a long episode name that runs over a line'; }`;
  for (const [what, style] of [
    ['', null],
    [', under a taller title block', taller],
  ] as const) {
    test(`Playback info sits below the group's line under the title, and above the time and the seek bar${what}`, async ({
      page,
    }) => {
      // Its own session: the group it makes is left through the API's (afterEach), not the shared one's.
      await play(page, { ownSession: true });
      if (style) await page.addStyleTag({ content: style });
      await showControls(page);
      await tapOn(page, page.getByRole('button', { name: 'Settings' }));
      await tapOn(page, page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: /Watch together/ }));
      await tapOn(page, page.getByRole('menuitem', { name: 'New group' }));
      const group = page.locator('.lmn-player__syncplay');
      await expect(group).toBeVisible();

      await showControls(page);
      await tapOn(page, page.getByRole('button', { name: 'Settings' }));
      await tapOn(page, page.getByRole('button', { name: 'Playback info' }));
      const info = page.getByRole('complementary', { name: 'Playback info' });
      const card = (await info.boundingBox())!;
      const line = (await group.boundingBox())!;
      expect(card.y).toBeGreaterThanOrEqual(line.y + line.height);
      expect(card.y + card.height).toBeLessThanOrEqual((await page.locator('.lmn-player__times').boundingBox())!.y);
      // Short of room, it scrolls rather than run over them, and its close button stays in reach.
      if (style) expect(await info.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
      await expect(info.getByRole('button', { name: 'Hide playback info' })).toBeInViewport();
    });
  }
});
