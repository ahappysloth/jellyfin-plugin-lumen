import { expect, test } from '@playwright/test';
import { ADMIN, api, loadState, resetLumen } from '../support/api';
import { login } from '../support/login';

test.afterEach(resetLumen);

test('turning off home takeover restores the stock home', async ({ page }) => {
  const { admin } = loadState();
  const config = await api<Record<string, unknown>>('/Lumen/Admin/Config', { token: admin.token });
  await api('/Lumen/Admin/Config', { method: 'POST', token: admin.token, body: { ...config, HomeTakeover: false } });

  await login(page, ADMIN);

  await expect(page.locator('#indexPage')).toBeVisible();
  await expect(page.locator('#lmn-root .lmn-home')).toHaveCount(0);
});

test('the master switch off shows the stock UI everywhere', async ({ page }) => {
  const { admin, items } = loadState();
  const config = await api<Record<string, unknown>>('/Lumen/Admin/Config', { token: admin.token });
  await api('/Lumen/Admin/Config', { method: 'POST', token: admin.token, body: { ...config, Enabled: false } });

  await login(page, ADMIN);

  await expect(page.locator('#indexPage')).toBeVisible();
  await expect(page.locator('#lmn-root .lmn-home')).toHaveCount(0);

  await page.goto(`/web/#/details?id=${items['Lumen Alpha']}`);

  await expect(page.locator('#itemDetailPage:not(.hide)')).toBeVisible();
  await expect(page.locator('#lmn-root .lmn-details')).toHaveCount(0);
});

test('a failed compatibility check shows the stock UI and is reported to admins', async ({ page }) => {
  const { admin } = loadState();
  await page.addInitScript(() => {
    (window as unknown as { __LUMEN_FORCE_COMPAT_FAIL__: boolean }).__LUMEN_FORCE_COMPAT_FAIL__ = true;
  });

  await login(page, ADMIN);

  await expect(page.locator('#indexPage')).toBeVisible();
  await expect
    .poll(async () =>
      (await api<{ FailedChecks: string[] }[]>('/Lumen/Admin/Diagnostics', { token: admin.token })).some((d) => d.FailedChecks.includes('forced')),
    )
    .toBe(true);
});
