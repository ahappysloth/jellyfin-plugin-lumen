import { expect, test } from '@playwright/test';
import { ADMIN, SEERR_URL, STUB_SEERR, api, loadState, resetLumen } from '../support/api';
import { login } from '../support/login';

// Seerr permission bits (server/lib/permissions.ts): ADMIN = 2.
const ADMIN_PERMISSION = 2;

test.beforeEach(async () => {
  const { admin } = loadState();
  // Only the admin has a Seerr account; kid is unmapped.
  await fetch(`${STUB_SEERR}/__stub/users`, {
    method: 'POST',
    body: JSON.stringify({ [admin.userId.replace(/-/g, '')]: { id: 1, permissions: ADMIN_PERMISSION } }),
  });
});
test.afterEach(resetLumen);

test('an admin connects Seerr from the dashboard; the key is never sent back', async ({ page }) => {
  const { admin } = loadState();
  await login(page, ADMIN);
  await page.goto('/web/#/configurationpage?name=Lumen');

  await page.getByLabel('Enable catalog browsing and requests').check();
  await page.getByLabel('Seerr address').fill(SEERR_URL);
  await page.getByLabel('Seerr API key').fill('wrong-key');
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByText('Seerr rejected the API key.')).toBeVisible();

  await page.getByLabel('Seerr API key').fill('stub-key');
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByText('Connected to Seerr 3.5.1-stub')).toBeVisible();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();

  const config = await api<Record<string, unknown>>('/Lumen/Admin/Config', { token: admin.token });
  expect(config.SeerrApiKey ?? null).toBeNull();
  expect(config.SeerrApiKeySet).toBe(true);
  await expect(page.getByLabel('Seerr API key')).toHaveAttribute('placeholder', 'Saved (leave blank to keep it)');
  await expect(page.getByText(/have no Seerr account/)).toBeVisible();
  await expect(page.locator('.lmn-admin__unmapped li', { hasText: 'kid' })).toBeVisible();
});

test.describe('with Seerr configured', () => {
  test.beforeEach(async () => {
    const { admin } = loadState();
    const config = await api<Record<string, unknown>>('/Lumen/Admin/Config', { token: admin.token });
    await api('/Lumen/Admin/Config', {
      method: 'POST',
      token: admin.token,
      body: { ...config, RequestsEnabled: true, SeerrUrl: SEERR_URL, SeerrApiKey: 'stub-key' },
    });
  });

  test('only users with a Seerr account get the catalog, with their Seerr permissions', async () => {
    const { admin, kid } = loadState();

    expect(await api('/Lumen/Requests/Status', { token: admin.token })).toEqual({
      Enabled: true,
      CanRequestMovies: true,
      CanRequestTv: true,
    });
    expect(await api('/Lumen/Requests/Status', { token: kid.token })).toEqual({
      Enabled: false,
      CanRequestMovies: false,
      CanRequestTv: false,
    });
  });

  test('the image proxy serves TMDB art only to catalog users, only for allowed paths', async () => {
    const { admin, kid } = loadState();
    const image = (token: string, path: string) =>
      fetch(new URL(`Lumen/Requests/Image/${path}`, `${process.env.LUMEN_E2E_BASE_URL ?? 'http://localhost:8096'}/`), {
        headers: { Authorization: `MediaBrowser Token="${token}"` },
      });

    const ok = await image(admin.token, 'w300/abc123.png');
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/png');
    expect((await image(admin.token, 'w9999/abc123.png')).status).toBe(400);
    expect((await image(kid.token, 'w300/abc123.png')).status).toBe(404);
  });
});
