import { expect, test, type Page } from '@playwright/test';
import { ADMIN, loadState } from '../support/api';
import { login } from '../support/login';

// A phone, by touch: Chromium's mobile emulation, with real taps and (through CDP) real touch drags. Firefox has no
// mobile emulation, and the emulated iPhone can't play (support/browsers.ts cannotPlay).
test.skip(({ browserName }) => browserName !== 'chromium', 'touch drags go through Chromium (CDP)');
test.use({ isMobile: true, hasTouch: true });

async function play(page: Page): Promise<void> {
  const { items } = loadState();
  await login(page, ADMIN);
  await page.goto(`/web/#/details?id=${items['Lumen Alpha']}`);
  await page.locator('#lmn-root').getByRole('button', { name: 'Play' }).first().click();
  await expect.poll(() => page.locator('video.htmlvideoplayer').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0.3);
}

const paused = (page: Page) => page.locator('video.htmlvideoplayer').evaluate((v: HTMLVideoElement) => v.paused);

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

for (const [way, viewport] of [
  ['portrait', { width: 390, height: 844 }],
  ['landscape', { width: 844, height: 390 }],
] as const) {
  test.describe(`a phone in ${way}`, () => {
    test.use({ viewport });

    test('a tap on the picture shows the controls and the next hides them, without pausing', async ({ page }) => {
      await play(page);
      const osd = page.locator('.lmn-osd');
      await expect(osd).toHaveClass(/is-idle/, { timeout: 6000 });

      await page.touchscreen.tap(viewport.width / 2, viewport.height / 2);
      await expect(osd).not.toHaveClass(/is-idle/);
      await page.waitForTimeout(400); // apart, so not a double tap (which skips at the sides)
      // The middle of the picture, where the bottom bar's shading lies in landscape: still the picture's.
      await page.touchscreen.tap(viewport.width / 2, viewport.height / 2);
      await expect(osd).toHaveClass(/is-idle/);
      expect(await paused(page)).toBe(false);
    });

    test("an open panel scrolls under a finger without closing, and its last entry can be tapped", async ({ page }) => {
      await play(page);
      await page.touchscreen.tap(viewport.width / 2, viewport.height / 2);
      // On a phone the pill shows its icon only; its name is still there.
      const pill = page.getByRole('button', { name: /^Quality/ });
      const box = (await pill.boundingBox())!;
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      const panel = page.getByRole('dialog', { name: 'Quality' });
      await expect(panel).toBeVisible();

      // It stays clear of the bottom of the screen and lies over the bottom bar.
      const area = (await panel.boundingBox())!;
      expect(area.y + area.height).toBeLessThanOrEqual(viewport.height);
      // A drag from its lower part, where the bottom bar is, scrolls it (landscape: it's taller than the room).
      await drag(page, area.x + area.width / 2, area.y + area.height - 24, -200);
      await expect(panel).toBeVisible();
      const scroll = await panel.evaluate((p) => ({ top: p.scrollTop, max: p.scrollHeight - p.clientHeight }));
      expect(scroll.top).toBe(scroll.max);

      const last = panel.getByRole('button', { name: '2x' });
      const at = (await last.boundingBox())!;
      await page.touchscreen.tap(at.x + at.width / 2, at.y + at.height / 2);
      await expect(last).toHaveAttribute('aria-pressed', 'true');
      await expect(panel).toBeVisible();
      await expect.poll(() => page.locator('video.htmlvideoplayer').evaluate((v: HTMLVideoElement) => v.playbackRate)).toBe(2);

      // A tap on the picture beside it (landscape) or below it (portrait) closes it, and does nothing else.
      if (area.x > 40) await page.touchscreen.tap(20, viewport.height / 2);
      else await page.touchscreen.tap(viewport.width / 2, area.y + area.height + 20);
      await expect(panel).toHaveCount(0);
      expect(await paused(page)).toBe(false);
    });
  });
}
