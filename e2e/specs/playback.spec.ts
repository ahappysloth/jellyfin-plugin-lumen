import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { ADMIN, loadState } from '../support/api';
import { CANNOT_PLAY, cannotPlay } from '../support/browsers';
import { login } from '../support/login';
import { expectPresentButHidden } from '../support/stock';

test.skip(cannotPlay, CANNOT_PLAY);

test("Play hands off to jellyfin-web's own player", { tag: '@smoke' }, async ({ page }) => {
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

test("the scroll wheel shows Lumen's volume pill, not jellyfin-web's card or the controls", async ({ page }) => {
  const { items } = loadState();
  await login(page, ADMIN);
  await page.goto(`/web/#/details?id=${items['Lumen Alpha']}`);
  await page.locator('#lmn-root').getByRole('button', { name: 'Play' }).click();
  await expect(page).toHaveURL(/#\/video/);
  await expect(page.locator('video.htmlvideoplayer')).toBeVisible();

  // Leave the controls to hide, then scroll over the picture: jellyfin-web turns the wheel into volume steps.
  await page.mouse.move(640, 360);
  await expect(page.locator('.lmn-osd')).toHaveClass(/is-idle/, { timeout: 6000 });
  await page.mouse.wheel(0, 120);

  const pill = page.getByRole('status', { name: 'Volume' });
  await expect(pill).toHaveClass(/is-shown/);
  await expect(pill).toContainText(/\d+%|Muted/);
  await expect(page.locator('.lmn-osd')).toHaveClass(/is-idle/);
  // jellyfin-web fades its own card in over ~0.3 s and hides it itself after 3 s, so check once, while it would be
  // up (an auto-retrying toBeHidden() would just wait for that).
  await page.waitForTimeout(800);
  expect(await page.locator('.volumeOsd').isVisible()).toBe(false);
  await expect(pill).not.toHaveClass(/is-shown/, { timeout: 4000 });
});

test("the volume slider's arrow keys change the volume, not the position", async ({ page }) => {
  const { items } = loadState();
  await login(page, ADMIN);
  await page.goto(`/web/#/details?id=${items['Lumen Alpha']}`);
  await page.locator('#lmn-root').getByRole('button', { name: 'Play' }).click();
  const video = page.locator('video.htmlvideoplayer');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0.3);
  await video.evaluate((v: HTMLVideoElement) => {
    v.pause();
    v.currentTime = 8;
  });
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(8, 0);
  const volume = page.getByRole('slider', { name: 'Volume' });
  const before = await video.evaluate((v: HTMLVideoElement) => v.volume);
  expect(before).toBeGreaterThan(0.05);

  await volume.focus();
  await page.keyboard.press('ArrowLeft');

  // jellyfin-web's shortcuts would have gone back 10 s, to the start.
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.volume)).toBeLessThan(before);
  await page.waitForTimeout(500);
  expect(await video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(8, 0);
  await expect(volume).toBeFocused();
});

test('the seek bar stays where you click and shows trickplay thumbnails', async ({ page }) => {
  const { items } = loadState();
  await login(page, ADMIN);
  await page.goto(`/web/#/details?id=${items['Lumen Alpha']}`);
  await page.locator('#lmn-root').getByRole('button', { name: 'Play' }).click();
  await expect(page.locator('video.htmlvideoplayer')).toBeVisible();
  const seek = page.getByRole('slider', { name: 'Seek' });
  await expect(seek).toBeVisible();
  const box = (await seek.boundingBox())!;

  // Hovering shows the frame for that time (global-setup generated trickplay images for Movies).
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2);
  await expect(page.locator('.lmn-seek__thumbnail')).toHaveCSS('background-image', /blob:/);

  // Clicking at 75%: the bar never shows the old position again on the way there.
  const duration = Number(await seek.getAttribute('aria-valuemax'));
  await page.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2);
  const target = duration * 0.75;
  for (let i = 0; i < 10; i++) {
    expect(Number(await seek.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(Math.floor(target) - 1);
    await page.waitForTimeout(100);
  }
});

test('a quality change that restarts the stream holds the last frame with "Switching to …"', async ({ page }) => {
  const { items } = loadState();
  await login(page, ADMIN);
  await page.goto(`/web/#/details?id=${items['Lumen Alpha']}`);
  await page.locator('#lmn-root').getByRole('button', { name: 'Play' }).click();
  await expect.poll(() => page.locator('video.htmlvideoplayer').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0.5);

  // On this tiny local file the restart takes milliseconds, so record the note appearing rather than racing it.
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __switching: string[] }).__switching = seen;
    new MutationObserver(() => {
      const note = document.querySelector('.lmn-switching__note');
      if (note?.textContent && !seen.includes(note.textContent)) seen.push(note.textContent);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  await page.getByRole('button', { name: /Quality/ }).click();
  const fixed = page.getByRole('dialog', { name: 'Quality' }).getByRole('radio').nth(1);
  const label = (await fixed.locator('.lmn-panel__option-label').textContent())!;
  await fixed.click();

  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __switching: string[] }).__switching))
    .toContain(`Switching to ${label}…`);
  await expect(page.locator('.lmn-switching')).toHaveCount(0, { timeout: 20_000 });
  await expect.poll(() => page.locator('video.htmlvideoplayer').evaluate((v: HTMLVideoElement) => !v.paused)).toBe(true);
});

test("Lumen's player controls drive jellyfin-web's player, including subtitle tracks", { tag: '@smoke' }, async ({ page }) => {
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
  await page.getByRole('radio', { name: /^Spanish/ }).click();
  await expect(page.getByRole('radio', { name: /^Spanish/ })).toHaveAttribute('aria-checked', 'true');
  // jellyfin-web renders these subtitles as the <video>'s own text track in Chromium, so read its cues; in Firefox and
  // Safari it draws the current cue itself, into .videoSubtitles: move to the first one (1–6 s) for that.
  await page.locator('video').first().evaluate((v: HTMLVideoElement) => (v.currentTime = 2));
  await expect
    .poll(() =>
      page
        .locator('video')
        .first()
        .evaluate((v: HTMLVideoElement) =>
          [...v.textTracks]
            .filter((t) => t.mode === 'showing')
            .flatMap((t) => [...(t.cues ?? [])].map((c) => (c as VTTCue).text))
            .concat(document.querySelector('.videoSubtitles')?.textContent ?? '')
            .some((text) => text.includes('Hola desde Lumen.')),
        ),
    )
    .toBe(true);
});

test("the player's panels are labelled dialogs that pass axe", async ({ page }) => {
  const { items } = loadState();
  await login(page, ADMIN);
  await page.goto(`/web/#/details?id=${items['Lumen Alpha']}`);
  await page.locator('#lmn-root').getByRole('button', { name: 'Play' }).click();
  await expect.poll(() => page.locator('video.htmlvideoplayer').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0.3);
  await page.getByRole('button', { name: 'Pause' }).click(); // the controls stay up

  for (const [pill, name, current] of [
    [/^Quality/, 'Quality', 'aria-checked'],
    [/^Audio & Subtitles$/, 'Audio & Subtitles', 'aria-checked'],
    [/^Settings$/, 'Settings', 'aria-pressed'], // Repeat's choice
  ] as const) {
    await page.getByRole('button', { name: pill }).click();
    const dialog = page.getByRole('dialog', { name });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(':focus')).toHaveAttribute(current, 'true'); // the current choice has focus
    const { violations } = await new AxeBuilder({ page })
      .include('#lmn-root .lmn-player__pills')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
      .analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(', ')}`)).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  }
});

test('the player says when it ends, repeats, and shows playback info', async ({ page }) => {
  const { items } = loadState();
  await login(page, ADMIN);
  await page.goto(`/web/#/details?id=${items['Lumen Alpha']}`);
  await page.locator('#lmn-root').getByRole('button', { name: 'Play' }).click();
  await expect.poll(() => page.locator('video.htmlvideoplayer').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0.3);
  // The loading screen is gone once the video plays.
  await expect(page.getByRole('status', { name: 'Starting…' })).toHaveCount(0);
  await page.mouse.move(400, 300);
  await expect(page.locator('#lmn-root').getByText(/^Ends at \d/)).toBeVisible();

  await page.getByRole('button', { name: 'Settings' }).click();
  // Watch together lives in the settings panel.
  await expect(page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: /Watch together/ })).toBeVisible();
  // A movie repeats itself.
  await page.getByRole('button', { name: 'Repeat', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Repeat', exact: true })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Playback info' }).click();
  const info = page.getByRole('complementary', { name: 'Playback info' });
  await expect(info).toContainText('Direct play');
  await expect(info).toContainText('VP9');
});

test('Cast moves what is playing to another Jellyfin session', async ({ page, browser }) => {
  const { items } = loadState();
  // A second browser (its own device id): a Jellyfin web session that takes remote control.
  const tv = await browser.newContext();
  const tvPage = await tv.newPage();
  await login(tvPage, ADMIN);

  await login(page, ADMIN);
  await page.goto(`/web/#/details?id=${items['Lumen Alpha']}`);
  await page.locator('#lmn-root').getByRole('button', { name: 'Play' }).click();
  await expect.poll(() => page.locator('video.htmlvideoplayer').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0.3);
  await page.mouse.move(400, 300);

  const cast = page.getByRole('button', { name: 'Cast' });
  await expect(cast).toBeVisible({ timeout: 15_000 });
  await cast.click();
  await page.getByRole('menu', { name: 'Cast' }).getByRole('menuitem').first().click();

  // It plays there, and stops here.
  await expect(tvPage).toHaveURL(/#\/video/, { timeout: 20_000 });
  await expect.poll(() => tvPage.locator('video.htmlvideoplayer').evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 20_000 }).toBeGreaterThan(0);
  await expect(page).not.toHaveURL(/#\/video/, { timeout: 20_000 });
  await tv.close();
});
