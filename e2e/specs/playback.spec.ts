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
