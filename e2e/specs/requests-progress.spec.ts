import { expect, type Page, test } from '@playwright/test';
import { ADMIN, SEERR_URL, STUB_SEERR, api, loadState, resetLumen } from '../support/api';
import { walkDpad } from '../support/dpad';
import { login } from '../support/login';
import { accountButton, accountMenu, openSettingsMenu } from '../support/nav';

// Download progress for the user's own requests (docs/superpowers/specs/2026-11-12-request-progress-design.md): the
// stub Seerr's /__stub/progress gives each title's requests a state and a download queue, which can move on with
// every call (a download advancing between polls).

// Seerr permission bits: REQUEST = 32. The admin is Seerr user 1 in every requests spec (Lumen caches the mapping).
const REQUEST_PERMISSION = 32;
const ADMIN_SEERR_ID = 1;
// Lumen keeps a user's Seerr answer this long (RequestProgressService.Ttl), so a change in the stub shows after it.
const SERVER_CACHE_MS = 8_000;

test.beforeEach(async () => {
  const { admin } = loadState();
  await stub('reset');
  await stub('users', { [admin.userId.replace(/-/g, '')]: { id: ADMIN_SEERR_ID, permissions: REQUEST_PERMISSION } });
  await stub('jellyfin', { name: 'This server', serverId: (await api<{ Id: string }>('/System/Info/Public')).Id });
});
test.afterEach(resetLumen);

async function stub(control: string, body?: unknown): Promise<void> {
  await fetch(`${STUB_SEERR}/__stub/${control}`, { method: 'POST', body: JSON.stringify(body ?? {}) });
}

interface Scenario {
  /** Seerr's request status: 1 waiting for approval, 2 approved (the default), 3 declined, 4 failed. */
  requestStatus?: number;
  mediaStatus?: number;
  downloads?: Download[];
  /** Bytes every download moves on by with each Seerr call. */
  step?: number;
}

interface Download {
  size: number;
  sizeLeft: number;
  status?: string;
  etaSeconds?: number;
  downloadId?: string;
  season?: number;
  episode?: number;
}

/**
 * Files a request as the admin, through Lumen as a user would (which also has Lumen check on it afresh), and says
 * in the stub how it stands.
 */
async function request(mediaId: number, scenario: Scenario = {}, mediaType: 'movie' | 'tv' = 'movie'): Promise<void> {
  const { admin } = loadState();
  await api('/Lumen/Requests', { method: 'POST', token: admin.token, body: { MediaType: mediaType, TmdbId: mediaId } });
  await progress(mediaId, { requestStatus: 2, ...scenario });
}

async function progress(tmdbId: number, scenario: Scenario | null): Promise<void> {
  await stub('progress', { [tmdbId]: scenario });
}

/** Turns Seerr on, with these catalog rows first on home (saving also refreshes the home cache). */
async function enableSeerr(types: string[] = []): Promise<void> {
  const { admin } = loadState();
  const config = await api<Record<string, unknown> & { Sections: unknown[] }>('/Lumen/Admin/Config', {
    token: admin.token,
  });
  await api('/Lumen/Admin/Config', {
    method: 'POST',
    token: admin.token,
    body: {
      ...config,
      RequestsEnabled: true,
      SeerrUrl: SEERR_URL,
      SeerrApiKey: 'stub-key',
      Sections: [
        ...types.map((Type) => ({ Id: crypto.randomUUID(), Type, Enabled: true, Params: [] })),
        ...config.Sections,
      ],
    },
  });
}

/** Counts the page's progress checks (GET /Lumen/Requests/Mine). */
function countChecks(page: Page): () => number {
  let count = 0;
  page.on('request', (r) => {
    if (/\/Lumen\/Requests\/Mine\b/.test(r.url())) count++;
  });
  return () => count;
}

/** My requests, from the account menu (wide screens) or the Me tab's page (phones). */
const myRequestsPage = async (page: Page): Promise<void> => {
  if ((page.viewportSize()?.width ?? 1280) < 910) {
    await openSettingsMenu(page);
    await page.locator('#lmn-root .lmn-profile').getByRole('link', { name: /^My requests/ }).click();
  } else {
    await accountButton(page).click();
    await accountMenu(page).getByRole('menuitem', { name: 'My requests' }).click();
  }
  await expect(page).toHaveURL(/#\/home\?lumen=requests$/);
};

test('posters show the progress of the user’s own request: its status, a bar and the time left', { tag: '@smoke' }, async ({
  page,
}) => {
  await enableSeerr(['CatalogPopularMovies']);
  await request(603, { mediaStatus: 3, downloads: [{ size: 1000, sizeLeft: 600, etaSeconds: 750 }] });
  await login(page, ADMIN);

  // Shown once the first check has answered (after the page is up).
  const popular = page.getByRole('region', { name: 'Popular Movies' });
  const card = popular.getByRole('button', { name: /^The Matrix, Downloading, 40% · 1\d min left$/ });
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card.locator('.lmn-card__state')).toHaveText('Downloading');
  await expect(card.locator('.lmn-progress__fill')).toHaveAttribute('style', /width: 40%/);
  await expect(card.locator('.lmn-card__meta')).toHaveText(/^40% · 1\d min left$/);
  // My Requests (a default row) too.
  await expect(
    page.getByRole('region', { name: 'My Requests' }).getByRole('button', { name: /^The Matrix, Downloading, 40%/ }),
  ).toBeVisible();

  // And in search results.
  await page.goto('/web/#/search?query=matrix');
  await expect(page.getByRole('button', { name: /^The Matrix, Downloading, 40%/ })).toBeVisible();
});

test('a downloading movie’s title page shows its progress, and no Request button', { tag: '@smoke' }, async ({ page }) => {
  await enableSeerr();
  // No media status given: the stub has it as Seerr does, PROCESSING once the request is approved.
  await request(603, { downloads: [{ size: 1000, sizeLeft: 550, etaSeconds: 600 }] });
  await login(page, ADMIN);
  await page.goto('/web/#/home?title=movie-603');

  await expect(page.getByRole('heading', { name: 'The Matrix', level: 1 })).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Downloading' })).toHaveAttribute('aria-valuenow', '45', {
    timeout: 10_000,
  });
  await expect(page.locator('.lmn-request-progress__status')).toContainText(/45% · (9|10) min left/);
  await expect(page.getByRole('button', { name: 'Request', exact: true })).toHaveCount(0);
});

test('the title page follows a download as it moves', async ({ page }) => {
  test.setTimeout(90_000);
  await enableSeerr();
  // Two episodes, each a download of its own, moving a tenth on with every Seerr call (home's My Requests row asks
  // too).
  await request(
    1399,
    {
      mediaStatus: 3,
      step: 100,
      downloads: [
        { size: 1000, sizeLeft: 1000, downloadId: 'e1', season: 3, episode: 1, etaSeconds: 1200 },
        { size: 1000, sizeLeft: 1000, downloadId: 'e2', season: 3, episode: 2, etaSeconds: 1800 },
      ],
    },
    'tv',
  );
  await login(page, ADMIN);
  await page.goto('/web/#/home?title=tv-1399');

  const bar = page.getByRole('progressbar', { name: 'Downloading' });
  await expect(bar).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.lmn-request-progress__status')).toContainText(/0 of 2 episodes · (29|30) min left/);
  const first = Number(await bar.getAttribute('aria-valuenow'));
  expect(first).toBeLessThan(100);

  // Checked every 10 s on this page while it downloads: it moves without a reload.
  await expect
    .poll(async () => Number((await bar.getAttribute('aria-valuenow')) ?? 0), { timeout: 30_000 })
    .toBeGreaterThan(first);
});

test('My requests lists the user’s requests newest first, and opens each title', { tag: '@smoke' }, async ({ page }) => {
  const { items } = loadState();
  await enableSeerr();
  // Oldest first: one in each state.
  await request(705, { requestStatus: 1 }); // waiting for approval
  await request(702, { requestStatus: 3 }); // declined
  await request(703, { requestStatus: 4 }); // failed
  await request(701, { mediaStatus: 3 }); // approved, nothing downloading yet
  await request(704, { mediaStatus: 3, downloads: [{ size: 1000, sizeLeft: 0 }] }); // downloaded, being imported
  // On the server (as Lumen Alpha). A title only these tests use: Seerr's title cache, shared with other specs' rows,
  // keeps it "available" for 10 minutes.
  await stub('library', { tmdbId: 706, jellyfinMediaId: items['Lumen Alpha']!.replace(/-/g, '') });
  await request(706);
  await request(603, { mediaStatus: 3, downloads: [{ size: 1000, sizeLeft: 250, etaSeconds: 90 }] }); // downloading
  await login(page, ADMIN);
  await myRequestsPage(page);

  const list = page.getByRole('list', { name: 'My requests' });
  const rows = list.getByRole('link');
  await expect(rows).toHaveCount(7);
  const expected = [
    ['The Matrix', 'Downloading'],
    ['Stub Ready', 'Ready'],
    ['Stub Processing', 'Processing'],
    ['Stub Queued', 'Queued'],
    ['Stub Failed', 'Failed'],
    ['Stub Declined', 'Declined'],
    ['Stub Awaiting Approval', 'Requested'],
  ];
  for (const [i, [title, status]] of expected.entries()) {
    await expect(rows.nth(i).locator('.lmn-request__title')).toHaveText(title!);
    await expect(rows.nth(i).locator('.lmn-request-progress__status strong')).toHaveText(status!);
  }
  await expect(rows.nth(0)).toContainText(/75% · (1|2) min left/);
  await expect(rows.nth(0).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '75');

  // Ready: its library page.
  await rows.nth(1).click();
  await expect(page).toHaveURL(new RegExp(`#/details\\?id=${items['Lumen Alpha']!.replace(/-/g, '')}`));
  await expect(page.getByRole('heading', { name: 'Lumen Alpha', level: 1 })).toBeVisible();
  await page.goBack();
  // The rest: the title's page.
  await rows.nth(0).click();
  await expect(page).toHaveURL(/#\/home\?title=movie-603$/);
  await expect(page.getByRole('heading', { name: 'The Matrix', level: 1 })).toBeVisible();
});

test('a pop-up says when a request is ready to watch, once, on every device', async ({ page, browser }) => {
  test.setTimeout(90_000);
  const { items } = loadState();
  await enableSeerr();
  await request(605, { mediaStatus: 3, downloads: [{ size: 1000, sizeLeft: 500, etaSeconds: 300 }] });
  const checked = page.waitForResponse(/\/Lumen\/Requests\/Mine\b/);
  await login(page, ADMIN);
  // Lumen sees it downloading...
  expect((await (await checked).json()).Requests[0].Status).toBe('Downloading');

  // ...then it lands on the server (as Lumen Beta).
  await progress(605, null);
  await stub('library', { tmdbId: 605, jellyfinMediaId: items['Lumen Beta']!.replace(/-/g, '') });
  await page.waitForTimeout(SERVER_CACHE_MS); // until Lumen asks Seerr again
  await page.reload();

  const toast = page.getByRole('alert');
  await expect(toast).toContainText('Lumen Future is ready to watch', { timeout: 10_000 });
  await toast.getByRole('button', { name: 'Open' }).click();
  await expect(page).toHaveURL(new RegExp(`#/details\\?id=${items['Lumen Beta']!.replace(/-/g, '')}`));

  // Not again: neither after a reload here, nor on another device.
  const again = page.waitForResponse(/\/Lumen\/Requests\/Mine\b/);
  await page.reload();
  expect((await (await again).json()).Requests[0]).toMatchObject({ Status: 'Ready', Announce: false });
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  const otherCheck = otherPage.waitForResponse(/\/Lumen\/Requests\/Mine\b/);
  await login(otherPage, ADMIN);
  await otherCheck;
  // The pop-up would show as the answer lands: give it a moment to show it doesn't.
  await otherPage.waitForTimeout(500);
  await expect(otherPage.getByRole('alert')).toBeEmpty();
  await expect(page.getByRole('alert')).toBeEmpty();
  await other.close();
});

test('a request that becomes ready while one of jellyfin-web’s pages is up pops up on the next Lumen page', async ({ page }) => {
  test.setTimeout(90_000);
  const { items } = loadState();
  await page.clock.install();
  await enableSeerr();
  await request(605, { mediaStatus: 3, downloads: [{ size: 1000, sizeLeft: 500, etaSeconds: 300 }] });
  const announced: string[] = [];
  page.on('request', (r) => {
    if (/\/Lumen\/Requests\/Announced\b/.test(r.url())) announced.push(r.url());
  });
  const first = page.waitForResponse(/\/Lumen\/Requests\/Mine\b/);
  await login(page, ADMIN);
  await page.clock.fastForward(4_000); // past the idle callback's deadline
  expect((await (await first).json()).Requests[0].Status).toBe('Downloading');

  // The Dashboard is jellyfin-web's: Lumen's page, and its pop-ups with it, is taken down. The checks go on.
  await page.goto('/web/#/dashboard');
  await expect(page.locator('#lmn-root > *')).toHaveCount(0);
  await progress(605, null);
  await stub('library', { tmdbId: 605, jellyfinMediaId: items['Lumen Beta']!.replace(/-/g, '') });
  await page.waitForTimeout(SERVER_CACHE_MS); // until Lumen asks Seerr again
  const ready = page.waitForResponse(/\/Lumen\/Requests\/Mine\b/);
  await page.clock.fastForward(46_000);
  expect((await (await ready).json()).Requests[0]).toMatchObject({ Status: 'Ready', Announce: true });
  // Nothing there could show it, so it isn't marked as shown.
  expect(announced).toEqual([]);

  // Home again: it pops up from the answer already here (nothing is in flight, so there's no further check).
  await page.goBack();
  const toast = page.getByRole('alert');
  await expect(toast).toContainText('Lumen Future is ready to watch');
  await expect.poll(() => announced.length).toBe(1);
});

test('My requests on a phone: a long title ends in an ellipsis, and the page doesn’t scroll sideways', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const long = 'The Lord of the Rings: The Fellowship of the Ring (Extended Edition)';
  await enableSeerr();
  await request(603, { mediaStatus: 3, downloads: [{ size: 1000, sizeLeft: 250, etaSeconds: 7_170 }] });
  // The stub's titles are short: this one's is lengthened on its way to the page.
  await page.route(/\/Lumen\/Requests\/Mine\b/, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.Requests[0].Item.Title = long;
    await route.fulfill({ response, json: body });
  });
  await login(page, ADMIN);
  await page.goto('/web/#/home?lumen=requests');

  const row = page.getByRole('list', { name: 'My requests' }).getByRole('link');
  const title = row.locator('.lmn-request__title');
  await expect(title).toHaveText(long);
  expect(await title.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  // The row, and everything in it, within the window: half a minute short of two hours is two hours, not "1 hr 60 min".
  await expect(row.getByText('75% · 2 hr 0 min left')).toBeInViewport({ ratio: 1 });
  const box = (await row.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(360);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});

test('nothing in flight, no polling: one check per page load, and none without Seerr', async ({ page }) => {
  await page.clock.install();
  const checks = countChecks(page);

  // Without Seerr: not even the first.
  await login(page, ADMIN);
  await expect(page.locator('#lmn-root .lmn-home')).toBeVisible();
  for (let i = 0; i < 3; i++) await page.clock.fastForward('01:00');
  expect(checks()).toBe(0);

  // With Seerr, and only finished requests: the one check, then nothing however long the page stays open.
  await enableSeerr();
  await request(702, { requestStatus: 3 });
  await stub('library', { tmdbId: 706, jellyfinMediaId: loadState().items['Lumen Alpha']!.replace(/-/g, '') });
  await request(706);
  const first = page.waitForResponse(/\/Lumen\/Requests\/Mine\b/);
  await page.reload();
  await page.clock.fastForward(4_000); // past the idle callback's deadline
  await first;
  for (let i = 0; i < 5; i++) await page.clock.fastForward('01:00');
  expect(checks()).toBe(1);

  // One in flight: checked again after 45 s (and only while the page is visible).
  await request(701, { mediaStatus: 3 });
  const next = page.waitForResponse(/\/Lumen\/Requests\/Mine\b/);
  await page.reload();
  await page.clock.fastForward(4_000);
  await next;
  expect(checks()).toBe(2);
  const polled = page.waitForResponse(/\/Lumen\/Requests\/Mine\b/);
  await page.clock.fastForward(46_000);
  await polled;
  expect(checks()).toBe(3);
});

test('TV layout: the D-pad reaches My requests from the account menu, and every request on it', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(() => localStorage.setItem('layout', 'tv'));
  await enableSeerr();
  for (const id of [701, 702, 703]) await request(id, { requestStatus: id === 702 ? 3 : 2 });
  await request(603, { mediaStatus: 3, downloads: [{ size: 1000, sizeLeft: 400, etaSeconds: 600 }] });
  const checked = page.waitForResponse(/\/Lumen\/Requests\/Mine\b/);
  await login(page, ADMIN);
  await expect(page.locator('html')).toHaveClass(/\blayout-tv\b/);
  await checked;

  // The account button, OK, then Down past History to My requests, and OK.
  const account = page.getByRole('button', { name: /^Account/ });
  await account.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: 'Account' });
  await expect(menu.getByRole('menuitem', { name: 'History' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'My requests' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/home\?lumen=requests$/);

  // The newest request has focus; Down moves through the list.
  const rows = page.getByRole('list', { name: 'My requests' }).getByRole('link');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(1)).toBeFocused();

  const { unreachable } = await walkDpad(page, rows.nth(0));
  expect(unreachable.map((c) => c.name)).toEqual([]);
});
