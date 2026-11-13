import { expect, test, type Page } from '@playwright/test';
import { ADMIN, api, KID, loadState, SEERR_URL, STUB_SEERR } from '../support/api';
import { login } from '../support/login';
import { resetStub } from '../support/trakt';

// The Trailer section of a title's Media info: what the server found of its trailer online and why (GET
// /Lumen/Items/{id}/TrailerInfo), what happened with it on this device, and Check again for an administrator. A movie's
// Media info is jellyfin-web's own dialog, which Lumen adds the section to; a show has none, so its ⋯ menu has Trailer
// info, the same section in a Lumen dialog.
//
// Every fixture movie has a local trailer, which wins; the online ones are still looked up for Media info. Lumen Alpha
// gets IMDb id tt9000001, which the stub IMDb (support/stub-seerr.mjs) knows with a trailer in 1080p and 720p, and TMDB
// id 603, which the stub Seerr knows with a YouTube trailer; then tt9000503, for which the stub IMDb answers HTTP 503.
// Set LUMEN_E2E_SHOTS to a folder to save screenshots of the section there.
const MOVIE = 'Lumen Alpha';
const SHOW = 'Lumen Show';
type Config = Record<string, unknown>;
let saved: Config;

async function setIds(name: string, ids: Record<string, string>): Promise<void> {
  const { admin, items } = loadState();
  const { Trickplay: _, ...item } = await api<Record<string, unknown>>(`/Items/${items[name]}`, {
    token: admin.token,
    query: { userId: admin.userId },
  });
  await api(`/Items/${items[name]}`, { method: 'POST', token: admin.token, body: { ...item, ProviderIds: ids } });
}

const imdbLookups = async (): Promise<string[]> =>
  ((await (await fetch(`${STUB_SEERR}/__stub/imdb`)).json()) as { lookups: string[] }).lookups;

async function shoot(page: Page, name: string, target = page.locator('.dialogContainer .dialog')): Promise<void> {
  const folder = process.env.LUMEN_E2E_SHOTS;
  if (!folder) return;
  await target.screenshot({ path: `${folder}/${name}-${test.info().project.name}.png` });
}

const more = (page: Page) => page.locator('#lmn-root .lmn-details__header').getByRole('button', { name: /^More actions for / });
const section = (page: Page) => page.locator('.dialogContainer .dialog .lmn-trailer-info');

async function openMediaInfo(page: Page, name = MOVIE): Promise<void> {
  const { items } = loadState();
  await page.goto(`/web/#/details?id=${items[name]}`);
  await more(page).click();
  await page.getByRole('menu').getByRole('menuitem', { name: 'Media info' }).click();
  // jellyfin-web's own content, then Lumen's section beside it.
  await expect(page.locator('.dialogContainer .dialog #mediaInfoContent .mediaInfoStreamType').first()).toBeVisible();
  await expect(section(page)).toBeVisible();
}

test.beforeAll(async () => {
  const { admin } = loadState();
  saved = await api<Config>('/Lumen/Admin/Config', { token: admin.token });
  // The admin's Seerr account, for the YouTube lookup by TMDB id.
  await resetStub();
  await api('/Lumen/Admin/Config', {
    method: 'POST',
    token: admin.token,
    body: { ...saved, TrailerPreview: true, YouTubeTrailers: true, RequestsEnabled: true, SeerrUrl: SEERR_URL, SeerrApiKey: 'stub-key' },
  });
  await setIds(MOVIE, { Imdb: 'tt9000001', Tmdb: '603' });
  await setIds(SHOW, { Imdb: 'tt9000010', Tmdb: '1399' });
});
test.afterAll(async () => {
  const { admin } = loadState();
  await setIds(MOVIE, {});
  await setIds(SHOW, {});
  await api('/Lumen/Admin/Config', { method: 'POST', token: admin.token, body: saved });
});

test("a movie's Media info says what IMDb and YouTube have, that its local trailer wins, and what played here", { tag: '@smoke' }, async ({ page }) => {
  await login(page, ADMIN);
  const { items } = loadState();
  await page.goto(`/web/#/details?id=${items[MOVIE]}`);
  // The header's local trailer plays first: this device's attempt.
  await expect(page.locator('#lmn-root .lmn-details__trailer video')).toHaveClass(/\bis-shown\b/, { timeout: 20_000 });

  await more(page).click();
  await page.getByRole('menu').getByRole('menuitem', { name: 'Media info' }).click();
  const trailer = section(page);
  await expect(trailer).toBeVisible();
  // In the dialog's own markup, after its content.
  await expect(page.locator('.dialogContainer .dialog #mediaInfoContent + div > .lmn-trailer-info')).toHaveCount(1);
  await expect(trailer.locator('h2.mediaInfoStreamType')).toHaveText('Trailer');
  await expect(trailer).toContainText('Local trailerYes: it plays instead of the online ones');
  await expect(trailer).toContainText('IMDb idtt9000001');
  await expect(trailer).toContainText('IMDbFound: 1080p, 720p available');
  // Never an address: IMDb's are signed.
  await expect(trailer).not.toContainText('/imdb/video/');
  const youTube = trailer.getByRole('link', { name: 'dQw4w9WgXcQ' });
  await expect(youTube).toHaveAttribute('href', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await expect(trailer).toContainText('from Seerr (TMDB)');
  await expect(trailer).toContainText(/Local trailer \(the file\)Played, under way after \d+\.\d s/);
  await expect(trailer.getByRole('button', { name: 'Check again' })).toBeVisible();
  // jellyfin-web's content is as it was.
  await expect(page.locator('.dialogContainer .dialog #mediaInfoContent')).toContainText('Video');
  await shoot(page, 'media-info-found', trailer);

  // Taken down with the dialog (its Back button: only the TV layout closes it on Escape).
  await page.locator('.dialogContainer .dialog .btnCancel').click();
  await expect(page.locator('.dialogContainer .dialog')).toHaveCount(0);
  await expect(page.locator('.lmn-trailer-info')).toHaveCount(0);
});

test('IMDb failing says so, and Check again asks it again, once per title every half minute', async ({ page }) => {
  await setIds(MOVIE, { Imdb: 'tt9000503', Tmdb: '603' });
  await login(page, ADMIN);
  await openMediaInfo(page);
  const trailer = section(page);
  await expect(trailer).toContainText('IMDbIMDb error: HTTP 503');
  await shoot(page, 'media-info-failure', trailer);

  const before = (await imdbLookups()).filter((id) => id === 'tt9000503').length;
  await trailer.getByRole('button', { name: 'Check again' }).click();
  const status = trailer.getByRole('status');
  // A retry of this test within half a minute is limited from the start.
  await expect(status).toHaveText(/^(Checked again|Checked a moment ago\. Try again in \d+ s\.)$/);
  if ((await status.textContent()) === 'Checked again')
    expect((await imdbLookups()).filter((id) => id === 'tt9000503').length).toBe(before + 1);
  await expect(trailer).toContainText('IMDbIMDb error: HTTP 503');

  // Straight after: limited.
  await trailer.getByRole('button', { name: 'Check again' }).click();
  await expect(status).toHaveText(/^Checked a moment ago\. Try again in \d+ s\.$/);
  await setIds(MOVIE, { Imdb: 'tt9000001', Tmdb: '603' });
});

test('a restricted user sees the status but not Check again, which the server refuses them too', async ({ page }) => {
  const { items } = loadState();
  // The kid sees the Shows library only.
  await login(page, KID);
  await page.goto(`/web/#/details?id=${items[SHOW]}`);
  await more(page).click();
  await page.getByRole('menu').getByRole('menuitem', { name: 'Trailer info' }).click();
  const dialog = page.getByRole('dialog', { name: `Trailer info: ${SHOW}` });
  await expect(dialog).toContainText('IMDbFound: 1080p, 720p available');
  await expect(dialog.getByRole('button', { name: 'Check again' })).toHaveCount(0);

  // Refused by the server too, whatever a client shows.
  await expect(api(`/Lumen/Items/${items[SHOW]}/TrailerInfo/Refresh`, { method: 'POST', token: loadState().kid.token })).rejects.toThrow(/-> 403 /);
});

test("a show's ⋯ menu has Trailer info, the same section in Lumen's dialog", { tag: '@smoke' }, async ({ page }) => {
  const { items } = loadState();
  await login(page, ADMIN);
  await page.goto(`/web/#/details?id=${items[SHOW]}`);
  await more(page).click();
  await page.getByRole('menu').getByRole('menuitem', { name: 'Trailer info' }).click();

  const dialog = page.getByRole('dialog', { name: `Trailer info: ${SHOW}` });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('IMDb idtt9000010');
  await expect(dialog).toContainText('IMDbFound: 1080p, 720p available');
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
  await shoot(page, 'show-trailer-info', dialog);

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(more(page)).toBeFocused();
});

test('TV layout: the D-pad reaches Check again in Media info', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('layout', 'tv'));
  await login(page, ADMIN);
  const { items } = loadState();
  await page.goto(`/web/#/details?id=${items[MOVIE]}`);
  const play = page.locator('#lmn-root .lmn-details__header').getByRole('button', { name: 'Play' });
  await expect(play).toBeFocused();
  for (let i = 0; i < 4 && !(await more(page).evaluate((b) => b === document.activeElement)); i++)
    await page.keyboard.press('ArrowRight');
  await expect(more(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu').getByRole('menuitem').first()).toHaveText('Media info');
  await page.keyboard.press('Enter');

  const check = section(page).getByRole('button', { name: 'Check again' });
  await expect(check).toBeVisible();
  // As the dialog opens, jellyfin-web's autofocus (once its opening animation has finished, which is when it looks)
  // passes over the section, so a TV's Media info doesn't open scrolled to its end.
  await page.locator('.dialogContainer .dialog').evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
  expect(await section(page).evaluate((el) => el.contains(document.activeElement))).toBe(false);
  expect(await page.locator('.dialogContainer .dialog .formDialogContent').evaluate((el) => el.scrollTop)).toBe(0);
  // Down from where focus is (the page's More, under the dialog) to the YouTube link, then Check again: each press once
  // jellyfin-web has moved focus for the last, which it does a moment later.
  const focused = () => page.evaluate(() => document.activeElement?.textContent ?? '');
  for (let i = 0; i < 8 && (await focused()) !== 'Check again'; i++) {
    const before = await focused();
    await page.keyboard.press('ArrowDown');
    await expect.poll(focused).not.toBe(before);
  }
  await expect(check).toBeFocused();
  await expect(check).toBeInViewport({ ratio: 1 });
  // And stays there: nothing moves it on a moment later.
  await page.waitForTimeout(1000);
  await expect(check).toBeFocused();
  await shoot(page, 'media-info-tv');

  await page.keyboard.press('Escape');
  await expect(page.locator('.dialogContainer .dialog')).toHaveCount(0);
  await expect(more(page)).toBeFocused();
});
