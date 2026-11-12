import { expect, test, type Page } from '@playwright/test';
import { ADMIN, KID, api, loadState, resetLumen } from '../support/api';
import { login } from '../support/login';

/** Titles a test marked watched: put back to never played afterwards (marking played, then unplayed, clears the date). */
let played: string[] = [];

test.afterEach(async () => {
  const { admin } = loadState();
  for (const id of played)
    for (const method of ['POST', 'DELETE'] as const)
      await api(`/UserPlayedItems/${id}`, { method, token: admin.token, query: { userId: admin.userId } });
  played = [];
});

test('movie details are rendered by Lumen, including the local trailer', { tag: '@smoke' }, async ({ page }) => {
  const { items } = loadState();
  await login(page, ADMIN);

  await page.goto(`/web/#/details?id=${items['Lumen Alpha']}`);

  const details = page.locator('#lmn-root .lmn-details--movie');
  await expect(details.getByRole('img', { name: 'Lumen Alpha' })).toBeVisible();
  await expect(details.getByRole('img', { name: 'Lumen Alpha' })).toBeInViewport();
  await expect(details.getByText('2001')).toBeVisible();
  await expect(details.getByRole('button', { name: 'Trailer' })).toBeVisible();
});

test('movie details offer the file as a download beside Play', async ({ page }) => {
  const { items } = loadState();
  await login(page, ADMIN);

  await page.goto(`/web/#/details?id=${items['Lumen Alpha']}`);

  const details = page.locator('#lmn-root .lmn-details--movie');
  // Named "Download" at every size, though a phone shows only its icon.
  const download = details.getByRole('link', { name: 'Download' });
  await expect(download).toBeVisible();
  await expect(download).toHaveAttribute('href', new RegExp(`/Items/${items['Lumen Alpha']}/Download\\?ApiKey=`));
  await expect(download).toHaveAttribute('title', /^Download \(\d/);

  const file = page.waitForEvent('download');
  await download.click();
  expect((await file).suggestedFilename()).toBe('Lumen Alpha (2001).webm');
});

test('the details trailer fades in over the backdrop once it plays, Mute in the corner', async ({ page, browserName }) => {
  // The fixture trailer is WebM, which Playwright's WebKit on Linux may not play.
  test.skip(browserName === 'webkit', 'WebM playback');
  const { items } = loadState();
  await login(page, ADMIN);

  await page.goto(`/web/#/details?id=${items['Lumen Zeta']}`);

  const header = page.locator('#lmn-root .lmn-details__header');
  const unmute = header.getByRole('button', { name: 'Unmute trailer' });
  // The backdrop first; no trailer controls until there's a trailer to control.
  await expect(header.locator('.lmn-details__backdrop')).toBeVisible();
  await expect(unmute).toBeHidden();

  const video = header.locator('.lmn-details__trailer video');
  await expect(video).toHaveClass(/\bis-shown\b/, { timeout: 20_000 });
  expect(await video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0);
  await expect(unmute).toBeVisible();
  await expect(header.getByRole('button', { name: 'Pause trailer' })).toBeVisible();

  // Top right of the backdrop, clear of the title and the action row.
  const box = (await unmute.boundingBox())!;
  const area = (await header.boundingBox())!;
  expect(box.x + box.width).toBeGreaterThan(area.x + area.width - 120);
  expect(box.y).toBeLessThan(area.y + 120);

  await unmute.click();
  await expect(header.getByRole('button', { name: 'Mute trailer' })).toBeFocused();
});

test('series details offer smart play and season browsing', { tag: '@smoke' }, async ({ page }) => {
  const { items } = loadState();
  await login(page, ADMIN);

  await page.goto(`/web/#/details?id=${items['Lumen Show']}`);

  const details = page.locator('#lmn-root .lmn-details--series');
  await expect(details.getByRole('button', { name: /S1:E1/ })).toBeVisible();
  await details.getByRole('button', { name: /^Season:/ }).click();
  await expect(details.getByRole('option')).toHaveText(['Season 1', 'Season 2']);
  await page.keyboard.press('Escape');
  await expect(details.locator('.lmn-episode')).toHaveCount(3);
  // A series is a folder: no Download (jellyfin-web's "Download all" stays in its own menu).
  await expect(details.getByRole('link', { name: 'Download' })).toHaveCount(0);
});

test('episode details are rendered by Lumen, with previous/next across seasons', async ({ page }) => {
  const { admin, items } = loadState();
  const episodes = await api<{ Items: { Id: string; ParentIndexNumber: number; IndexNumber: number }[] }>(
    `/Shows/${items['Lumen Show']}/Episodes`,
    { token: admin.token, query: { userId: admin.userId } },
  );
  const last = episodes.Items.find((e) => e.ParentIndexNumber === 1 && e.IndexNumber === 3)!;
  await login(page, ADMIN);

  await page.goto(`/web/#/details?id=${last.Id}`);

  const details = page.locator('#lmn-root .lmn-details--episode');
  await expect(details.getByText('S1:E3', { exact: true })).toBeVisible();
  await expect(details.getByRole('link', { name: 'Lumen Show', exact: true })).toBeVisible();
  await expect(details.getByRole('button', { name: 'Play' })).toBeVisible();
  await expect(details.getByRole('region', { name: 'More from Season 1' }).getByRole('link')).toHaveCount(3);

  await details.getByRole('link', { name: /^Next episode: S2:E1/ }).click();
  await expect(page.locator('#lmn-root .lmn-details--episode').getByText('S2:E1', { exact: true })).toBeVisible();

  // The show link opens the series page at the episode's season.
  await page.locator('#lmn-root .lmn-details--episode').getByRole('link', { name: 'Lumen Show', exact: true }).click();
  await expect(page.locator('#lmn-root .lmn-details--series').getByRole('button', { name: 'Season: Season 2' })).toBeVisible();
});

test("a season's episode rows link to the episode page", async ({ page }) => {
  const { items } = loadState();
  await login(page, ADMIN);
  await page.goto(`/web/#/details?id=${items['Lumen Show']}`);

  const series = page.locator('#lmn-root .lmn-details--series');
  await series.getByRole('link', { name: /^Details for / }).first().click();
  await expect(page.locator('#lmn-root .lmn-details--episode')).toBeVisible();
});

test('items Lumen does not handle stay on the stock details page', async ({ page }) => {
  const { admin } = loadState();
  // A library folder: Lumen has no details page for it.
  const views = await api<{ Items: { Id: string; CollectionType?: string }[] }>('/UserViews', {
    token: admin.token,
    query: { userId: admin.userId },
  });
  const library = views.Items.find((v) => v.CollectionType === 'movies')!;
  await login(page, ADMIN);

  await page.goto(`/web/#/details?id=${library.Id}`);

  await expect(page.locator('#itemDetailPage:not(.hide)')).toBeVisible();
  await expect(page.locator('#lmn-root')).toBeHidden();
});

test('Watched asks before marking unwatched: Cancel keeps it watched, confirming marks it unwatched', async ({ page }) => {
  const { admin, items } = loadState();
  const id = items['Lumen Delta']!;
  played = [id];
  await api(`/UserPlayedItems/${id}`, { method: 'POST', token: admin.token, query: { userId: admin.userId } });
  await login(page, ADMIN);
  await page.goto(`/web/#/details?id=${id}`);

  const details = page.locator('#lmn-root .lmn-details--movie');
  const watched = details.getByRole('button', { name: 'Watched', exact: true });
  const confirm = page.getByRole('alertdialog', { name: 'Mark as unwatched?' });
  const isPlayed = async () => {
    const data = await api<{ Played: boolean }>(`/UserItems/${id}/UserData`, {
      token: admin.token,
      query: { userId: admin.userId },
    });
    return data.Played;
  };

  await watched.click();
  await expect(confirm).toContainText('This resets how far you got and removes it from your History.');
  await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toBeHidden();
  await expect(watched).toBeVisible();
  expect(await isPlayed()).toBe(true);

  // Escape is Cancel too, on a computer.
  await watched.click();
  await expect(confirm).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(confirm).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`#/details\\?id=${id}`));
  await expect(watched).toBeVisible();

  await watched.click();
  await confirm.getByRole('button', { name: 'Mark unwatched' }).click();
  await expect(confirm).toBeHidden();
  const unwatched = details.getByRole('button', { name: 'Mark watched' });
  await expect(unwatched).toBeVisible();
  await expect.poll(isPlayed).toBe(false);

  // Marking watched doesn't ask.
  await unwatched.click();
  await expect(watched).toBeVisible();
  await expect(confirm).toHaveCount(0);
  await expect.poll(isPlayed).toBe(true);
});

test('Mark as unwatched? goes away when jellyfin-web changes page, leaving the title watched', async ({
  page,
  isMobile,
}) => {
  const { admin, items } = loadState();
  const id = items['Lumen Delta']!;
  played = [id];
  await api(`/UserPlayedItems/${id}`, { method: 'POST', token: admin.token, query: { userId: admin.userId } });
  // A blue accent: the button that goes ahead stays Lumen's red.
  await page.route(/\/Lumen\/ClientConfig/, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), AccentColor: '#3b82f6' } });
  });
  await login(page, ADMIN);
  await page.goto(`/web/#/details?id=${id}`);

  const watched = page.locator('#lmn-root .lmn-details--movie').getByRole('button', { name: 'Watched', exact: true });
  const confirm = page.getByRole('alertdialog', { name: 'Mark as unwatched?' });
  await watched.click();
  await expect(confirm).toBeVisible();
  // The page behind doesn't scroll while it's open.
  const goAhead = confirm.getByRole('button', { name: 'Mark unwatched' });
  expect(await goAhead.evaluate((el) => getComputedStyle(el).getPropertyValue('--lmn-accent').trim())).toBe('#3b82f6');
  await expect(goAhead).toHaveCSS('background-color', 'rgb(227, 11, 23)');
  if (!isMobile) {
    // Hovered, it's a darker red.
    await goAhead.hover();
    await expect(goAhead).toHaveCSS('background-color', 'rgb(227, 11, 23)');
    await expect(goAhead).toHaveCSS('filter', 'brightness(0.85)');
  }
  expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe('hidden');

  // What a remote's Home key, or a "go home" sent from another device, does: jellyfin-web's pushState.
  await page.evaluate(() => (window as unknown as { Emby: { Page: { goHome(): void } } }).Emby.Page.goHome());
  await expect(page).toHaveURL(/#\/home$/);
  await expect(confirm).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
  const data = await api<{ Played: boolean }>(`/UserItems/${id}/UserData`, {
    token: admin.token,
    query: { userId: admin.userId },
  });
  expect(data.Played).toBe(true);
});

const more = (page: Page) => page.locator('#lmn-root .lmn-details__header').getByRole('button', { name: /^More actions for / });

test("More offers an administrator jellyfin-web's item actions", { tag: '@smoke' }, async ({ page }) => {
  const { items } = loadState();
  await login(page, ADMIN);
  await page.goto(`/web/#/details?id=${items['Lumen Alpha']}`);

  await more(page).click();
  const menu = page.getByRole('menu', { name: 'More actions for Lumen Alpha' });
  // Download has its own button beside Play, so the menu doesn't repeat it.
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Add to playlist',
    'Add to collection',
    'Copy stream URL',
    'Media info',
    'Edit metadata',
    'Edit images',
    'Edit subtitles',
    'Identify',
    'Refresh metadata',
    'Delete movie',
  ]);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(more(page)).toBeFocused();
});

/**
 * jellyfin-web's Delete confirmation (components/dialog/dialog.js) wears Lumen's confirmation's look: a rounded panel
 * floating over the page at any size, Cancel grey and Delete filled in Lumen's red. Cancelled: nothing is deleted.
 */
async function expectLumenDeleteDialog(page: Page, isMobile: boolean): Promise<void> {
  const dialog = page.locator('.dialogContainer .dialog.formDialog.align-items-center');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS('border-top-left-radius', '20px');
  await expect(dialog).toHaveCSS('background-color', 'rgb(24, 24, 24)');
  // Floating, not jellyfin-web's full screen below 80em × 45em: clear of the window's edges, at most 420px wide.
  const box = (await dialog.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.width).toBeLessThanOrEqual(420);
  expect(box.x).toBeGreaterThanOrEqual(16);
  expect(box.y).toBeGreaterThan(0);
  expect(box.y + box.height).toBeLessThan(viewport.height);
  await expect(dialog.locator('.formDialogHeaderTitle')).toHaveCSS('text-align', 'left');
  const cancel = dialog.getByRole('button', { name: 'Cancel' });
  const remove = dialog.getByRole('button', { name: 'Delete' });
  await expect(cancel).toHaveCSS('background-color', 'rgba(109, 109, 110, 0.7)');
  await expect(remove).toHaveCSS('background-color', 'rgb(227, 11, 23)');
  await expect(remove).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(remove).toHaveCSS('border-top-left-radius', '8px');
  // The answers side by side at the bottom right, Delete last.
  const cancelBox = (await cancel.boundingBox())!;
  const removeBox = (await remove.boundingBox())!;
  expect(Math.abs(cancelBox.y - removeBox.y)).toBeLessThan(1);
  expect(removeBox.x).toBeGreaterThan(cancelBox.x);
  // Lumen's ring from the keyboard. (Safari's Tab skips buttons; there the dialog's focus on Cancel shows it.)
  if (isMobile) await cancel.focus();
  else {
    await remove.focus();
    await page.keyboard.press('Shift+Tab');
  }
  await expect(cancel).toBeFocused();
  await expect(cancel).toHaveCSS('outline-style', 'solid');
  await expect(cancel).toHaveCSS('outline-color', 'rgb(255, 255, 255)');
  await cancel.click();
  await expect(dialog).toHaveCount(0);
  // jellyfin-web closes it by going back in history, and takes its backdrop away once that's done: a page opened before
  // then would see that Back.
  await expect(page.locator('.dialogBackdrop')).toHaveCount(0);
}

test('Delete asks in Lumen’s own confirmation, from the details page and from a card’s menu', { tag: '@smoke' }, async ({
  page,
  isMobile,
}) => {
  const { admin, items, libraries } = loadState();
  await login(page, ADMIN);
  await page.goto(`/web/#/details?id=${items['Lumen Alpha']}`);
  await more(page).click();
  await page.getByRole('menu', { name: 'More actions for Lumen Alpha' }).getByRole('menuitem', { name: 'Delete movie' }).click();
  await expectLumenDeleteDialog(page, isMobile);
  await expect(page.locator('#lmn-root .lmn-details__header')).toBeVisible();

  // A card's menu (on the Movies grid) opens the same dialog. (A right-click: on a phone it's the page's More.) Lumen
  // Gamma, whose card has no trailer preview to start under the pointer.
  if (!isMobile) {
    await page.goto(`/web/#/movies?topParentId=${libraries.movies}&collectionType=movies`);
    await page.getByRole('list', { name: 'Movies' }).getByRole('link', { name: 'Lumen Gamma' }).click({ button: 'right' });
    await page.getByRole('menu', { name: 'Actions for Lumen Gamma' }).getByRole('menuitem', { name: 'More actions…' }).click();
    await page.getByRole('menu', { name: 'More actions for Lumen Gamma' }).getByRole('menuitem', { name: 'Delete movie' }).click();
    await expectLumenDeleteDialog(page, isMobile);
  }
  // Still there.
  for (const name of ['Lumen Alpha', 'Lumen Gamma'])
    await api(`/Items/${items[name]}`, { token: admin.token, query: { userId: admin.userId } });
});

test('More offers a restricted user only what their policy allows', async ({ page }) => {
  const { items } = loadState();
  // The kid may download and make playlists: no editors, no collections, no Delete.
  await login(page, KID);
  await page.goto(`/web/#/details?id=${items['Lumen Show']}`);

  await more(page).click();
  await expect(page.getByRole('menu', { name: 'More actions for Lumen Show' }).getByRole('menuitem')).toHaveText([
    'Add to playlist',
    'Download all',
  ]);
});

test.describe("More's Add to collection", () => {
  let collectionId: string | undefined;
  test.afterEach(async () => {
    if (collectionId) await api('/Items', { method: 'DELETE', token: loadState().admin.token, query: { ids: collectionId } });
    collectionId = undefined;
  });

  test("opens jellyfin-web's own dialog, which adds the movie to a new collection", async ({ page }) => {
    const { items } = loadState();
    await login(page, ADMIN);
    await page.goto(`/web/#/details?id=${items['Lumen Alpha']}`);

    await more(page).click();
    await page.getByRole('menu').getByRole('menuitem', { name: 'Add to collection' }).click();

    // jellyfin-web's collection editor, over Lumen's page: no stock action sheet came first.
    const dialog = page.locator('.dialogContainer .dialog');
    await expect(dialog.locator('#txtNewCollectionName')).toBeVisible();
    await expect(page.locator('.actionSheet')).toHaveCount(0);
    const name = `More menu ${Date.now()}`;
    await dialog.locator('#txtNewCollectionName').fill(name);
    await dialog.locator('button[type="submit"]').click();

    // jellyfin-web opens the new collection, which Lumen's collection page shows with the movie in it.
    const collection = page.locator('#lmn-root .lmn-details--collection');
    await expect(collection.getByRole('heading', { level: 1, name })).toBeVisible();
    const { admin } = loadState();
    const created = await api<{ Items: { Id: string }[] }>('/Items', {
      token: admin.token,
      query: { userId: admin.userId, includeItemTypes: 'BoxSet', recursive: true, searchTerm: name },
    });
    collectionId = created.Items[0]?.Id;
    expect(collectionId).toBeTruthy();
    await expect(page).toHaveURL(new RegExp(`#/details\\?id=${collectionId}`));
    await expect(collection.getByRole('list', { name: 'In this collection' }).getByText('Lumen Alpha')).toBeVisible();
  });
});

test.describe("a card's More actions… Delete", () => {
  const ids: string[] = [];
  test.afterEach(async () => {
    // The test deletes one through jellyfin-web; whatever is left goes here.
    const left = ids.splice(0);
    for (const id of left) await api('/Items', { method: 'DELETE', token: loadState().admin.token, query: { ids: id } }).catch(() => undefined);
  });

  test('takes the card off the grid, and Back to the grid does not bring it back', async ({ page }) => {
    const { admin, items } = loadState();
    const collection = async (name: string, movie: string) =>
      (await api<{ Id: string }>('/Collections', { method: 'POST', token: admin.token, query: { name, ids: items[movie] } })).Id;
    ids.push(await collection('Lumen Doomed Set', 'Lumen Alpha'), await collection('Lumen Kept Set', 'Lumen Gamma'));
    const views = await api<{ Items: { Id: string; CollectionType?: string }[] }>('/UserViews', {
      token: admin.token,
      query: { userId: admin.userId },
    });
    const movies = views.Items.find((v) => v.CollectionType === 'movies')!.Id;
    await login(page, ADMIN);
    await page.goto(`/web/#/movies?topParentId=${movies}&collectionType=movies&tab=3`);

    const grid = page.locator('#lmn-root');
    const doomed = grid.getByRole('link', { name: 'Lumen Doomed Set' });
    await doomed.click({ button: 'right' });
    await page.getByRole('menu', { name: 'Actions for Lumen Doomed Set' }).getByRole('menuitem', { name: 'More actions…' }).click();
    await page.getByRole('menu', { name: 'More actions for Lumen Doomed Set' }).getByRole('menuitem', { name: 'Delete collection' }).click();
    // jellyfin-web's own confirmation.
    await page.locator('.dialogContainer .dialog').getByRole('button', { name: 'Delete' }).click();

    await expect(doomed).toHaveCount(0);
    await expect(grid.getByRole('link', { name: 'Lumen Kept Set' })).toBeVisible();

    // Back restores the grid as it was saved when the other card was opened: still without the deleted one.
    await grid.getByRole('link', { name: 'Lumen Kept Set' }).click();
    await expect(page.locator('#lmn-root .lmn-details--collection')).toBeVisible();
    await page.goBack();
    await expect(grid.getByRole('link', { name: 'Lumen Kept Set' })).toBeVisible();
    await expect(doomed).toHaveCount(0);
  });
});

test.describe('two titles deleted in quick succession', () => {
  const ids: string[] = [];
  test.afterEach(async () => {
    await resetLumen();
    const left = ids.splice(0);
    for (const id of left) await api('/Items', { method: 'DELETE', token: loadState().admin.token, query: { ids: id } }).catch(() => undefined);
  });

  test('both stay off Home, though the server takes up to 30 s to notice the second', async ({ page }) => {
    const { admin, items } = loadState();
    const collection = async (name: string, ...members: string[]) =>
      (await api<{ Id: string }>('/Collections', { method: 'POST', token: admin.token, query: { name, ids: members.join(',') } })).Id;
    const first = await collection('Lumen Doomed One', items['Lumen Alpha']);
    const second = await collection('Lumen Doomed Two', items['Lumen Alpha']);
    ids.push(first, second);
    // A curated row of collections: titles Home shows that a test can delete without touching the media.
    ids.push(await collection('Lumen Shelf', first, second, items['Lumen Gamma']));
    const config = await api<{ Sections: unknown[] } & Record<string, unknown>>('/Lumen/Admin/Config', { token: admin.token });
    await api('/Lumen/Admin/Config', {
      method: 'POST',
      token: admin.token,
      body: {
        ...config,
        Sections: [
          { Id: crypto.randomUUID(), Type: 'Curated', Enabled: true, Title: null, Params: [{ Name: 'collectionId', Value: ids[2] }] },
          ...config.Sections,
        ],
      },
    });
    await login(page, ADMIN);
    const row = page.getByRole('region', { name: 'Lumen Shelf' });
    const card = (name: string) => row.getByRole('link', { name });
    const confirm = () => page.locator('.dialogContainer .dialog').getByRole('button', { name: 'Delete' }).click();

    // The first from its card on Home: focus moves on to the card after it. (Scrolled to first: the menu closes on a
    // scroll, and the one a click makes to reach the card can land just after it opens.)
    await card('Lumen Doomed One').scrollIntoViewIfNeeded();
    await card('Lumen Doomed One').click({ button: 'right' });
    await page.getByRole('menu', { name: 'Actions for Lumen Doomed One' }).getByRole('menuitem', { name: 'More actions…' }).click();
    await page.getByRole('menu', { name: 'More actions for Lumen Doomed One' }).getByRole('menuitem', { name: 'Delete collection' }).click();
    await confirm();
    await expect(card('Lumen Doomed One')).toHaveCount(0);
    await expect(card('Lumen Doomed Two')).toBeFocused();

    // Seconds later, the second from its page. The server's home refreshes at most every 30 s after library changes
    // (creating the collections was one), so the home Back fetches still lists both.
    await card('Lumen Doomed Two').click();
    await more(page).click();
    await page.getByRole('menu', { name: 'More actions for Lumen Doomed Two' }).getByRole('menuitem', { name: 'Delete collection' }).click();
    await confirm();

    // Back on Home: neither is there, and the card after the second has focus.
    await expect(card('Lumen Gamma')).toBeVisible();
    await expect(card('Lumen Doomed Two')).toHaveCount(0);
    await expect(card('Lumen Doomed One')).toHaveCount(0);
    await expect(card('Lumen Gamma')).toBeFocused();
  });
});

test('TV layout: More opens with the D-pad, and focus comes back to it when the dialog closes', async ({ page }) => {
  const { items } = loadState();
  await page.addInitScript(() => localStorage.setItem('layout', 'tv'));
  await login(page, ADMIN);
  await page.goto(`/web/#/details?id=${items['Lumen Alpha']}`);

  const play = page.locator('#lmn-root .lmn-details__header').getByRole('button', { name: 'Play' });
  await expect(play).toBeFocused();
  // On a TV: no collection or playlist pickers and no downloads, like jellyfin-web.
  for (let i = 0; i < 4 && !(await more(page).evaluate((b) => b === document.activeElement)); i++)
    await page.keyboard.press('ArrowRight');
  await expect(more(page)).toBeFocused();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem').first()).toHaveText('Media info');
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('Enter');

  // jellyfin-web's media info dialog; Back closes it and leaves the page where it was.
  await expect(page.locator('.dialogContainer .dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.dialogContainer .dialog')).toHaveCount(0);
  await expect(page.locator('#lmn-root .lmn-details--movie')).toBeVisible();
  await expect(more(page)).toBeFocused();
});

test('"You may like" cards keep to their own place in the grid, wide and on a phone', { tag: '@smoke' }, async ({
  page,
  isMobile,
}) => {
  const { items } = loadState();
  await login(page, ADMIN);
  await page.goto(`/web/#/details?id=${items['Lumen Alpha']}`);

  const similar = page.locator('#lmn-root .lmn-similar');
  // Every other fixture movie shares a genre with this one: enough for more than one row of the grid.
  await expect(similar.locator('.lmn-card')).not.toHaveCount(0);
  expect(await similar.locator('.lmn-card').count()).toBeGreaterThan(4);
  // The phone's own width on webkit-iphone; elsewhere a desktop one, then an iPhone-wide window.
  for (const viewport of isMobile ? [null] : [{ width: 1280, height: 720 }, { width: 393, height: 852 }]) {
    if (viewport) await page.setViewportSize(viewport);
    await similar.scrollIntoViewIfNeeded();
    // Each card (with its artwork) inside its grid cell, and no two cards over each other. A card sized by its content
    // rather than its column spilled into the next one.
    const boxes = await similar.locator('.lmn-card-cell').evaluateAll((cells) =>
      cells.map((cell) => {
        const c = cell.getBoundingClientRect();
        const a = cell.querySelector('.lmn-card__art')!.getBoundingClientRect();
        return { cell: [c.left, c.top, c.right, c.bottom], art: [a.left, a.top, a.right, a.bottom] };
      }),
    );
    for (const { cell, art } of boxes) {
      expect(art[0]).toBeGreaterThanOrEqual(cell[0] - 0.5);
      expect(art[2]).toBeLessThanOrEqual(cell[2] + 0.5);
    }
    const overlaps = (a: number[], b: number[]) =>
      a[0] < b[2] - 0.5 && b[0] < a[2] - 0.5 && a[1] < b[3] - 0.5 && b[1] < a[3] - 0.5;
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++)
        expect(overlaps(boxes[i].art, boxes[j].art), `cards ${i} and ${j}`).toBe(false);
  }
});
