import { expect, type Page, test } from '@playwright/test';
import { ADMIN, BASE_URL, KID, SEERR_URL, STUB_SEERR, api, loadState, resetLumen } from '../support/api';
import { walkDpad } from '../support/dpad';
import { login } from '../support/login';
import { accountButton, accountMenu, openSettingsMenu } from '../support/nav';

// My requests' search, filter chips and, for administrators, "Everyone's requests" (GET /Lumen/Requests/All, which
// asks Seerr's GET /request as its API key). The stub Seerr's /__stub/progress says how each title's requests stand.

// Seerr permission bits: REQUEST = 32. The admin is Seerr user 1, as in every requests spec; kid is Seerr user 2 there,
// with a Seerr name of their own, so the page showing "kid" shows Lumen found their Jellyfin account. Seerr user 7 is
// someone with a Seerr account only.
const REQUEST_PERMISSION = 32;
const ADMIN_SEERR_ID = 1;
const KID_SEERR_ID = 2;
const SEERR_ONLY_ID = 7;
// Seerr's API key here: Lumen remembers who kid is in Seerr for 10 minutes per Seerr address and key, and the specs
// after this one expect kid to have no Seerr account (support/stub-seerr.mjs, STUB_API_KEY_2).
const API_KEY = 'stub-key-filters';

test.beforeEach(async () => {
  const { admin, kid } = loadState();
  await stub('reset');
  await stub('users', {
    [admin.userId.replace(/-/g, '')]: { id: ADMIN_SEERR_ID, permissions: REQUEST_PERMISSION, displayName: 'admin' },
    [kid.userId.replace(/-/g, '')]: { id: KID_SEERR_ID, permissions: REQUEST_PERMISSION, displayName: 'Kiddo in Seerr' },
  });
  await stub('jellyfin', { name: 'This server', serverId: (await api<{ Id: string }>('/System/Info/Public')).Id });
});
test.afterEach(resetLumen);

async function stub(control: string, body?: unknown): Promise<void> {
  await fetch(`${STUB_SEERR}/__stub/${control}`, { method: 'POST', body: JSON.stringify(body ?? {}) });
}

/** Says in the stub how a title's requests stand: 1 waiting for approval, 2 approved, 3 declined, 4 failed. */
async function progress(tmdbId: number, scenario: Record<string, unknown>): Promise<void> {
  await stub('progress', { [tmdbId]: scenario });
}

/** Files a request as the admin, through Lumen as a user would. */
async function request(mediaId: number, scenario: Record<string, unknown> = {}): Promise<void> {
  const { admin } = loadState();
  await api('/Lumen/Requests', { method: 'POST', token: admin.token, body: { MediaType: 'movie', TmdbId: mediaId } });
  await progress(mediaId, { requestStatus: 2, ...scenario });
}

/** Files a request in Seerr's own interface as Seerr user `seerrUserId` (Lumen never saw it). */
async function requestInSeerr(seerrUserId: number, mediaId: number, scenario: Record<string, unknown> = {}): Promise<void> {
  const response = await fetch(`${STUB_SEERR}/api/v1/request`, {
    method: 'POST',
    headers: { 'X-Api-Key': API_KEY, 'X-Api-User': String(seerrUserId), 'Content-Type': 'application/json' },
    body: JSON.stringify({ mediaType: 'movie', mediaId, is4k: false }),
  });
  expect(response.status).toBe(201);
  await progress(mediaId, { requestStatus: 2, ...scenario });
}

async function enableSeerr(): Promise<void> {
  const { admin } = loadState();
  const config = await api<Record<string, unknown>>('/Lumen/Admin/Config', { token: admin.token });
  await api('/Lumen/Admin/Config', {
    method: 'POST',
    token: admin.token,
    body: { ...config, RequestsEnabled: true, SeerrUrl: SEERR_URL, SeerrApiKey: API_KEY },
  });
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

const rowTitles = (page: Page) => page.getByRole('list', { name: 'My requests' }).locator('.lmn-request__title');
const chip = (page: Page, name: string) =>
  page.getByRole('group', { name: 'Show' }).getByRole('button', { name: new RegExp(`^${name}`) });

test('My requests: the search filters as you type, and the chips by where each request stands, with their counts', { tag: '@smoke' }, async ({
  page,
}) => {
  await enableSeerr();
  // Oldest first.
  await request(705, { requestStatus: 1 }); // waiting for approval
  await request(702, { requestStatus: 3 }); // declined
  await request(701, { mediaStatus: 3 }); // approved, nothing downloading yet
  await request(603, { mediaStatus: 3, downloads: [{ size: 1000, sizeLeft: 250, etaSeconds: 90 }] }); // downloading
  await login(page, ADMIN);
  await myRequestsPage(page);

  await expect(rowTitles(page)).toHaveText(['The Matrix', 'Stub Queued', 'Stub Declined', 'Stub Awaiting Approval']);
  // The admin has the switch (below), off.
  await expect(page.getByRole('switch', { name: 'Everyone’s requests' })).toHaveAttribute('aria-checked', 'false');

  // As you type (the on-screen keyboard's Search key just closes it: the list is already filtered).
  const search = page.getByRole('searchbox', { name: 'Search requests' });
  await search.fill('STUB');
  await expect(rowTitles(page)).toHaveText(['Stub Queued', 'Stub Declined', 'Stub Awaiting Approval']);
  await search.fill('matrix');
  await expect(rowTitles(page)).toHaveText(['The Matrix']);
  await search.press('Enter');
  await expect(search).not.toBeFocused();
  await expect(rowTitles(page)).toHaveText(['The Matrix']);
  await search.fill('nothing like it');
  await expect(page.getByText('No requests match “nothing like it”')).toBeVisible();
  await page.locator('.lmn-requests-empty').getByRole('button', { name: 'Clear search' }).click();
  await expect(search).toHaveValue('');
  await expect(rowTitles(page)).toHaveCount(4);

  // One chip at a time, each with its count.
  await expect(page.getByRole('group', { name: 'Show' }).getByRole('button')).toHaveText([
    'All4',
    'Pending1',
    'Downloading2',
    'Available0',
    'Declined or failed1',
  ]);
  await chip(page, 'Pending').click();
  await expect(chip(page, 'Pending')).toHaveAttribute('aria-pressed', 'true');
  await expect(rowTitles(page)).toHaveText(['Stub Awaiting Approval']);
  await chip(page, 'Downloading').click();
  await expect(rowTitles(page)).toHaveText(['The Matrix', 'Stub Queued']);
  await expect(page.getByRole('list', { name: 'My requests' }).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '75');
  await chip(page, 'Declined or failed').click();
  await expect(rowTitles(page)).toHaveText(['Stub Declined']);
  await chip(page, 'Available').click();
  await expect(page.getByText('Nothing is ready to watch yet')).toBeVisible();
  await page.getByRole('button', { name: 'Show all requests' }).click();
  await expect(chip(page, 'All')).toHaveAttribute('aria-pressed', 'true');
  await expect(rowTitles(page)).toHaveCount(4);

  // A phone: nothing on the page scrolls sideways (the chips scroll within their own row).
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('an administrator turns on Everyone’s requests: every user’s requests, with who asked, and search finds them by name', { tag: '@smoke' }, async ({
  page,
}) => {
  await enableSeerr();
  await request(701, { mediaStatus: 3 }); // the admin's own
  await requestInSeerr(KID_SEERR_ID, 603, { mediaStatus: 3, downloads: [{ size: 1000, sizeLeft: 600, etaSeconds: 600 }] });
  await requestInSeerr(SEERR_ONLY_ID, 702, { requestStatus: 3 });
  await login(page, ADMIN);
  await myRequestsPage(page);
  await expect(rowTitles(page)).toHaveText(['Stub Queued']);

  const everyone = page.getByRole('switch', { name: 'Everyone’s requests' });
  const asked = page.waitForResponse(/\/Lumen\/Requests\/All\b/);
  await everyone.click();
  expect((await asked).status()).toBe(200);
  await expect(everyone).toHaveAttribute('aria-checked', 'true');
  await expect(rowTitles(page)).toHaveText(['Stub Declined', 'The Matrix', 'Stub Queued']);

  // Who asked: kid by their Jellyfin name (not their Seerr one), a Seerr-only account by its Seerr name.
  const rows = page.getByRole('list', { name: 'My requests' }).getByRole('link');
  await expect(rows.nth(0).locator('.lmn-request__by > span:last-child')).toHaveText('Requested by Seerr user 7');
  await expect(rows.nth(1).locator('.lmn-request__by > span:last-child')).toHaveText('Requested by kid');
  await expect(rows.nth(2).locator('.lmn-request__by > span:last-child')).toHaveText('Requested by admin');
  await expect(rows.nth(1)).toContainText(/40% · (9|10) min left/);

  // The search finds who asked; the chips work the same.
  const search = page.getByRole('searchbox', { name: 'Search requests' });
  await search.fill('kid');
  await expect(rowTitles(page)).toHaveText(['The Matrix']);
  await search.fill('');
  await expect(chip(page, 'Declined or failed')).toHaveText('Declined or failed1');
  await chip(page, 'Declined or failed').click();
  await expect(rowTitles(page)).toHaveText(['Stub Declined']);

  // Kept on in this browser.
  await page.reload();
  await expect(page.getByRole('switch', { name: 'Everyone’s requests' })).toHaveAttribute('aria-checked', 'true');
  await expect(rowTitles(page)).toHaveCount(3);

  // Off: the admin's own again.
  await page.getByRole('switch', { name: 'Everyone’s requests' }).click();
  await expect(rowTitles(page)).toHaveText(['Stub Queued']);
  await expect(page.locator('.lmn-request__by')).toHaveCount(0);
});

test('everyone’s requests name the requester, never their email, and only ask Seerr what its spec takes', async () => {
  const { admin, kid } = loadState();
  await enableSeerr();
  await requestInSeerr(KID_SEERR_ID, 603);

  // Seerr answers a parameter its OpenAPI spec doesn't define for GET /request with a 400, and so does the stub.
  const refused = await fetch(`${STUB_SEERR}/api/v1/request?take=1&skip=0&sort=added&page=2`, { headers: { 'X-Api-Key': API_KEY } });
  expect(refused.status).toBe(400);
  expect(await refused.json()).toMatchObject({ message: "Unknown query parameter 'page'" });

  const response = await fetch(`${BASE_URL}/Lumen/Requests/All`, {
    headers: { Authorization: `MediaBrowser Client="Lumen E2E", Device="Playwright", DeviceId="lumen-e2e", Version="1.0.0", Token="${admin.token}"` },
  });
  expect(response.status).toBe(200);
  const text = await response.text();
  expect(text).not.toContain('must-not-leak');
  const all = JSON.parse(text) as { Requests: { Item: { Title: string }; RequestedBy: { Name: string; UserId: string } }[]; Partial: boolean };
  expect(all.Requests.map((r) => [r.Item.Title, r.RequestedBy.Name, r.RequestedBy.UserId.replace(/-/g, '')])).toEqual([
    ['The Matrix', 'kid', kid.userId.replace(/-/g, '')],
  ]);
});

test('someone who isn’t an administrator never sees the switch, and the server refuses them everyone’s requests', { tag: '@smoke' }, async ({
  page,
}) => {
  const { kid } = loadState();
  await enableSeerr();
  await requestInSeerr(KID_SEERR_ID, 603, { mediaStatus: 3 });
  await requestInSeerr(ADMIN_SEERR_ID, 701, { mediaStatus: 3 });

  const refused = await fetch(`${BASE_URL}/Lumen/Requests/All`, {
    headers: { Authorization: `MediaBrowser Client="Lumen E2E", Device="Playwright", DeviceId="lumen-e2e", Version="1.0.0", Token="${kid.token}"` },
  });
  expect(refused.status).toBe(403);

  // Even with the switch left on in this browser (by an administrator, say).
  await page.addInitScript((id) => localStorage.setItem(`${id}-lumen-everyone-requests`, '1'), kid.userId.replace(/-/g, ''));
  let askedAll = false;
  page.on('request', (r) => {
    if (/\/Lumen\/Requests\/All\b/.test(r.url())) askedAll = true;
  });
  await login(page, KID);
  await page.goto('/web/#/home?lumen=requests');
  await expect(rowTitles(page)).toHaveText(['The Matrix']);
  await expect(page.getByRole('searchbox', { name: 'Search requests' })).toBeVisible();
  // (The notifications toggle is a switch too: only that one.)
  await expect(page.getByRole('switch', { name: 'Everyone’s requests' })).toHaveCount(0);
  await expect(page.locator('.lmn-requests-everyone')).toHaveCount(0);
  expect(askedAll).toBe(false);
});

test('TV layout: the D-pad reaches the search, every chip and the Everyone’s requests switch', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(() => localStorage.setItem('layout', 'tv'));
  await enableSeerr();
  await request(705, { requestStatus: 1 });
  await request(701, { mediaStatus: 3 });
  await requestInSeerr(KID_SEERR_ID, 603, { mediaStatus: 3 });
  await login(page, ADMIN);
  await expect(page.locator('html')).toHaveClass(/\blayout-tv\b/);
  await page.goto('/web/#/home?lumen=requests');

  // The newest request has focus, as before; Up goes to the chips, and Up again to the search.
  const rows = page.getByRole('list', { name: 'My requests' }).getByRole('link');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('group', { name: 'Show' }).getByRole('button').first()).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(chip(page, 'Pending')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(rowTitles(page)).toHaveText(['Stub Awaiting Approval']);
  await page.keyboard.press('ArrowUp');
  const search = page.getByRole('searchbox', { name: 'Search requests' });
  await expect(search).toBeFocused();
  // A TV's remote types through its on-screen keyboard; a keyboard plugged into it, as here.
  await page.keyboard.type('zzz');
  await expect(page.getByText('No requests match “zzz”')).toBeVisible();
  await search.fill('');

  const { unreachable, controls } = await walkDpad(page, rows.nth(0));
  expect(unreachable.map((c) => c.name)).toEqual([]);
  // Among them: the search, the five chips and the switch.
  const classes = controls.map((c) => c.classes);
  expect(classes.filter((c) => /\blmn-chip\b/.test(c))).toHaveLength(5);
  expect(classes.filter((c) => /\blmn-requests-search__input\b/.test(c))).toHaveLength(1);
  expect(classes.filter((c) => /\blmn-requests-everyone__switch\b/.test(c))).toHaveLength(1);

  // OK on the switch turns it on.
  const everyone = page.getByRole('switch', { name: 'Everyone’s requests' });
  await everyone.focus();
  await page.keyboard.press('Enter');
  await expect(everyone).toHaveAttribute('aria-checked', 'true');
  await expect(everyone).toBeFocused();
  await chip(page, 'All').click();
  await expect(rowTitles(page)).toHaveText(['The Matrix', 'Stub Queued', 'Stub Awaiting Approval']);
});
