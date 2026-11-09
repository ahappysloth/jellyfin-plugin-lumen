import { expect, test } from '@playwright/test';
import { ADMIN, loadState } from '../support/api';
import { login } from '../support/login';
import { expectPresentButHidden } from '../support/stock';

test("Play hands off to jellyfin-web's own player", async ({ page }) => {
  const { items } = loadState();
  await login(page, ADMIN);
  await page.goto(`/web/#/details?id=${items['Lumen Alpha']}`);

  await page.locator('#lmn-root').getByRole('button', { name: 'Play' }).click();

  await expect(page).toHaveURL(/#\/video/);
  await expect(page.locator('video').first()).toBeVisible();
});

test('Play starts in the tab it was pressed in, even with another Jellyfin tab open', async ({ page, context }) => {
  const { items } = loadState();
  await login(page, ADMIN);
  await page.goto(`/web/#/details?id=${items['Lumen Alpha']}`);
  const play = page.locator('#lmn-root').getByRole('button', { name: 'Play' });
  await expect(play).toBeVisible();

  // A newer tab of the same browser: same localStorage, so the same Jellyfin device id and server session. The server
  // sends remote commands for that session to one tab only, so playing through it could start in this other tab.
  const other = await context.newPage();
  await other.goto('/web/#/home');
  await expect(other.locator('#lmn-root')).toBeVisible();
  await page.bringToFront();
  await play.click();

  await expect(page).toHaveURL(/#\/video/);
  await expect(page.locator('video').first()).toBeVisible();
  await expect(other).not.toHaveURL(/#\/video/);
  await expect(other.locator('video')).toHaveCount(0);
});

test("jellyfin-web's volume card never shows over Lumen's player", async ({ page }) => {
  const { items } = loadState();
  await login(page, ADMIN);
  await page.goto(`/web/#/details?id=${items['Lumen Alpha']}`);
  await page.locator('#lmn-root').getByRole('button', { name: 'Play' }).click();
  await expect(page).toHaveURL(/#\/video/);
  await expect(page.locator('video.htmlvideoplayer')).toBeVisible();

  // Changing the volume through jellyfin-web (here its Up-arrow shortcut) shows its volume OSD
  // (components/playback/volumeosd.js).
  await page.locator('video.htmlvideoplayer').evaluate((v: HTMLVideoElement) => (v.volume = 0.5));
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('.volumeOsd')).toHaveCount(1);
  // jellyfin-web fades the card in over ~0.3 s and hides it itself after 3 s, so check once, while it would be up
  // (an auto-retrying toBeHidden() would just wait for that).
  await page.waitForTimeout(800);
  expect(await page.locator('.volumeOsd').isVisible()).toBe(false);
});

test("Lumen's player controls drive jellyfin-web's player, including subtitle tracks", async ({ page }) => {
  const { items } = loadState();
  await login(page, ADMIN);
  await page.goto(`/web/#/details?id=${items['Lumen Alpha']}`);
  await page.locator('#lmn-root').getByRole('button', { name: 'Play' }).click();
  await expect(page).toHaveURL(/#\/video/);

  // Lumen's controls replace jellyfin-web's (which stay in the DOM, hidden).
  await expect(page.getByRole('heading', { name: 'Lumen Alpha' })).toBeVisible();
  await expectPresentButHidden(page.locator('.videoOsdBottom'));

  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await expect.poll(() => page.locator('video').first().evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);

  // The test movie has English and Spanish sidecar subtitles (scripts/gen-test-media.sh).
  await page.getByRole('button', { name: /Audio & Subtitles/ }).click();
  await page.getByRole('menuitemradio', { name: /^Spanish/ }).click();
  await expect(page.getByRole('menuitemradio', { name: /^Spanish/ })).toHaveAttribute('aria-checked', 'true');
  // jellyfin-web renders these subtitles as the <video>'s own text track, so read its cues rather than the DOM.
  await expect
    .poll(() =>
      page
        .locator('video')
        .first()
        .evaluate((v: HTMLVideoElement) =>
          [...v.textTracks]
            .filter((t) => t.mode === 'showing')
            .flatMap((t) => [...(t.cues ?? [])].map((c) => (c as VTTCue).text))
            .some((text) => text.includes('Hola desde Lumen.')),
        ),
    )
    .toBe(true);
});
