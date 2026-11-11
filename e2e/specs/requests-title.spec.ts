import { expect, test } from '@playwright/test';
import { ADMIN, KID, SEERR_URL, STUB_SEERR, api, loadState, resetLumen } from '../support/api';
import { login } from '../support/login';
import { lumenNav, navLink } from '../support/nav';

// Seerr permission bits (server/lib/permissions.ts): REQUEST = 32. Without ADMIN/AUTO_APPROVE the stub answers
// "pending approval", like real Seerr.
const REQUEST_PERMISSION = 32;

interface Recorded {
  user: string;
  body: { mediaType: string; mediaId: number; seasons?: number[] | 'all'; userId?: unknown };
}

test.beforeEach(async () => {
  const { admin } = loadState();
  await fetch(`${STUB_SEERR}/__stub/reset`, { method: 'POST' });
  // Only the admin has a Seerr account (Seerr user 1, as in requests-foundation: Lumen caches the mapping for
  // 10 minutes, so the id must match across specs). Request permission only; kid is unmapped.
  await fetch(`${STUB_SEERR}/__stub/users`, {
    method: 'POST',
    body: JSON.stringify({ [admin.userId.replace(/-/g, '')]: { id: 1, permissions: REQUEST_PERMISSION } }),
  });
  await fetch(`${STUB_SEERR}/__stub/jellyfin`, {
    method: 'POST',
    body: JSON.stringify({ name: 'This server', serverId: (await api<{ Id: string }>('/System/Info/Public')).Id }),
  });
  const config = await api<Record<string, unknown>>('/Lumen/Admin/Config', { token: admin.token });
  await api('/Lumen/Admin/Config', {
    method: 'POST',
    token: admin.token,
    body: { ...config, RequestsEnabled: true, SeerrUrl: SEERR_URL, SeerrApiKey: 'stub-key' },
  });
});
test.afterEach(resetLumen);

const requests = async (): Promise<Recorded[]> => (await fetch(`${STUB_SEERR}/__stub/requests`)).json() as Promise<Recorded[]>;

test('search offers catalog titles; a movie is requested as the signed-in Seerr user', async ({ page }) => {
  await login(page, ADMIN);
  await navLink(page, 'Search').click();
  await page.getByRole('searchbox', { name: 'Search' }).fill('matrix');

  const more = page.getByRole('list', { name: 'More to request' });
  await expect(more.getByRole('button', { name: 'The Matrix, Request' })).toBeVisible();
  await expect(more.getByRole('button', { name: 'The Matrix Reloaded, Requested' })).toBeVisible();

  await more.getByRole('button', { name: 'The Matrix, Request' }).click();
  await expect(page).toHaveURL(/#\/home\?title=movie-603$/);
  await expect(page.getByRole('heading', { name: 'The Matrix', level: 1 })).toBeVisible();
  await expect(page.getByText('Not in your library yet')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Trailer' })).toHaveAttribute('href', /youtube\.com\/watch\?v=dQw4w9WgXcQ/);

  await page.getByRole('button', { name: 'Request', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Request The Matrix' });
  await dialog.getByRole('button', { name: 'Request', exact: true }).click();
  await expect(dialog.getByText('Requested, waiting for approval.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Requested' })).toBeVisible();

  const filed = await requests();
  expect(filed).toHaveLength(1);
  expect(filed[0]!.user).toBe('1');
  expect(filed[0]!.body.mediaType).toBe('movie');
  expect(filed[0]!.body.mediaId).toBe(603);
  expect(filed[0]!.body.userId).toBeUndefined();
});

test('a partly available show requests only the chosen missing seasons', async ({ page }) => {
  await login(page, ADMIN);
  await page.goto('/web/#/home?title=tv-1399');

  await expect(page.getByRole('heading', { name: 'Lumen Saga', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Request more seasons' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('checkbox', { name: /Season 1/ })).toBeDisabled();
  await expect(dialog.getByRole('checkbox', { name: /Season 2/ })).toBeDisabled();
  // Season 3 is the only one left to request, so it's pre-selected (and there's no "All seasons" toggle).
  await expect(dialog.getByRole('checkbox', { name: /Season 3/ })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: /All seasons/ })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Request', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText(/Requested(\.|, waiting)/);

  const filed = await requests();
  expect(filed.map((r) => r.body)).toEqual([expect.objectContaining({ mediaType: 'tv', mediaId: 1399, seasons: [3] })]);
});

test('a user without a Seerr account gets library-only search and no title pages', async ({ page }) => {
  await login(page, KID);
  await navLink(page, 'Search').click();
  await page.getByRole('searchbox', { name: 'Search' }).fill('matrix');

  await expect(page.getByText('No results for “matrix”')).toBeVisible();
  await expect(page.getByRole('list', { name: 'More to request' })).toHaveCount(0);
});

test("a user without a Seerr account who opens a catalog title keeps Lumen's nav and a way back", async ({ page }) => {
  await login(page, KID);

  await page.goto('/web/#/home?title=movie-603');

  await expect(page.getByText("Couldn't load this title from Seerr.")).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back' })).toBeVisible();
  await expect(lumenNav(page)).toBeVisible();
});

test('on a phone, a partly available title keeps its card tab to one line', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, ADMIN);
  await page.goto('/web/#/search?query=matrix');

  const card = page
    .getByRole('list', { name: 'More to request' })
    .getByRole('button', { name: 'Lumen Saga, Partly available' });
  const tab = card.locator('.lmn-card__state');
  await expect(tab).toHaveText('Partial');
  expect((await tab.boundingBox())!.height).toBeLessThan(28);
});
