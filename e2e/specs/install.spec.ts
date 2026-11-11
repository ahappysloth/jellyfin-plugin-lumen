import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { api, loadState, resetLumen } from '../support/api';

/**
 * "Add to Home Screen" (iPhone) and "Install app" (Android) read the page's manifest link and app tags, then fetch the
 * manifest and icons without the user's token. While Lumen is on they're Lumen's; with it off, jellyfin-web's again.
 */
test.afterEach(resetLumen);

interface Manifest {
  name: string;
  short_name: string;
  display: string;
  orientation: string;
  theme_color: string;
  background_color: string;
  start_url: string;
  scope: string;
  icons: { src: string; sizes: string; type: string; purpose: string }[];
}

async function setConfig(patch: Record<string, unknown>): Promise<void> {
  const { admin } = loadState();
  const config = await api<Record<string, unknown>>('/Lumen/Admin/Config', { token: admin.token });
  await api('/Lumen/Admin/Config', { method: 'POST', token: admin.token, body: { ...config, ...patch } });
}

const meta = (page: Page, name: string) => page.locator(`meta[name="${name}"]`);

async function manifestOf(
  page: Page,
  request: APIRequestContext,
): Promise<{ url: string; manifest: Manifest }> {
  const url = await page.locator('link[rel="manifest"]').evaluate((l) => (l as HTMLLinkElement).href);
  // `request` carries no token or cookie: what a phone's installer sees.
  const response = await request.get(url);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('application/manifest+json');
  return { url, manifest: (await response.json()) as Manifest };
}

/** A PNG's width and height, from its IHDR chunk. */
async function pngSize(request: APIRequestContext, url: string): Promise<string> {
  const response = await request.get(url);
  expect(response.status(), url).toBe(200);
  expect(response.headers()['content-type']).toBe('image/png');
  const png = await response.body();
  return `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`;
}

test(
  'a home-screen install gets Lumen: its manifest, icons and app tags',
  { tag: '@smoke' },
  async ({ page, request }) => {
    await page.goto('/web/#/login');
    await expect(page.locator('#txtManualName')).toBeVisible();

    const { url, manifest } = await manifestOf(page, request);
    expect(new URL(url).pathname).toBe('/Lumen/Manifest');
    expect(manifest).toMatchObject({
      name: 'Lumen',
      short_name: 'Lumen',
      display: 'standalone',
      orientation: 'any',
      theme_color: '#0f0f0f',
      background_color: '#0f0f0f',
    });
    const scope = new URL(manifest.scope, url).href;
    expect(new URL(scope).pathname).toBe('/web/');
    expect(new URL(manifest.start_url, url).href.startsWith(scope)).toBe(true);
    expect(manifest.icons.map((i) => `${i.sizes} ${i.purpose}`).sort()).toEqual([
      '192x192 any',
      '512x512 any',
      '512x512 maskable',
    ]);
    for (const icon of manifest.icons) {
      expect(await pngSize(request, new URL(icon.src, url).href)).toBe(icon.sizes);
    }

    const touchIcons = page.locator('link[rel="apple-touch-icon"]');
    await expect(touchIcons).toHaveCount(1);
    const touchIcon = await touchIcons.evaluate((l) => (l as HTMLLinkElement).href);
    expect(touchIcon).toMatch(/\/Lumen\/Assets\/lumen-icon-180\.png/);
    expect(await pngSize(request, touchIcon)).toBe('180x180');

    await expect(meta(page, 'apple-mobile-web-app-capable')).toHaveAttribute('content', 'yes');
    await expect(meta(page, 'apple-mobile-web-app-status-bar-style')).toHaveAttribute(
      'content',
      'black-translucent',
    );
    await expect(meta(page, 'apple-mobile-web-app-title')).toHaveAttribute('content', 'Lumen');
    await expect(meta(page, 'application-name')).toHaveAttribute('content', 'Lumen');
    await expect(meta(page, 'viewport')).toHaveAttribute('content', /viewport-fit=cover/);
    // jellyfin-web sets #themeColor to its theme's colour as it loads; browsers use the first theme-color, Lumen's.
    await expect(page.locator('#themeColor')).not.toHaveAttribute('content', '#0f0f0f');
    await expect(meta(page, 'theme-color').first()).toHaveAttribute('content', '#0f0f0f');
  },
);

test('the admin can name the home-screen app after the server', async ({ page, request }) => {
  await setConfig({ AppNameFromServer: true });
  const { ServerName } = await api<{ ServerName: string }>('/System/Info/Public');

  await page.goto('/web/#/login');

  expect((await manifestOf(page, request)).manifest).toMatchObject({
    name: ServerName,
    short_name: ServerName,
  });
  await expect(meta(page, 'apple-mobile-web-app-title')).toHaveAttribute('content', ServerName);
});

test('with Lumen off, a home-screen install is Jellyfin’s again', async ({ page }) => {
  await setConfig({ Enabled: false });

  await page.goto('/web/#/login');
  await expect(page.locator('#txtManualName')).toBeVisible();

  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', 'manifest.json');
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', /^touchicon\./);
  await expect(meta(page, 'application-name')).toHaveAttribute('content', 'Jellyfin');
  await expect(meta(page, 'apple-mobile-web-app-title')).toHaveCount(0);
  await expect(meta(page, 'apple-mobile-web-app-status-bar-style')).toHaveCount(0);
});
