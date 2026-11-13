import { expect, test, type Locator, type Page } from '@playwright/test';
import { ADMIN, BASE_URL, SEERR_URL, STUB_SEERR, api, loadState, resetLumen } from '../support/api';
import { walkDpad } from '../support/dpad';
import { login } from '../support/login';

// The settings page's Health tab (client/src/admin/health, Jellyfin.Plugin.Lumen/Health): the server's checks and the
// browser's, against the real server and the stub Seerr. Each test puts back what it changes.

/** Opens Lumen's settings on the Health tab and waits for the checks to finish. */
async function openHealth(page: Page): Promise<Locator> {
  await page.goto('/web/#/configurationpage?name=Lumen');
  const root = page.locator('[id="lmn-admin-root"]:visible');
  await root.getByRole('tab', { name: /^Health/ }).click();
  await expect(root.getByRole('button', { name: 'Run checks again' })).toBeEnabled({ timeout: 20_000 });
  return root;
}

/** "Run checks again": asks the server for fresh checks (it keeps them a minute otherwise). */
async function rerun(root: Locator): Promise<void> {
  await root.getByRole('button', { name: 'Run checks again' }).click();
  await expect(root.getByRole('button', { name: 'Run checks again' })).toBeEnabled({ timeout: 20_000 });
}

const row = (root: Locator, id: string): Locator => root.locator(`[data-check="${id}"]`);

async function lumenConfig(change: Record<string, unknown>): Promise<void> {
  const { admin } = loadState();
  const config = await api<Record<string, unknown>>('/Lumen/Admin/Config', { token: admin.token });
  await api('/Lumen/Admin/Config', { method: 'POST', token: admin.token, body: { ...config, ...change } });
}

async function brandingCss(css: string): Promise<void> {
  const { admin } = loadState();
  const branding = await api<Record<string, unknown>>('/System/Configuration/branding', { token: admin.token });
  await api('/System/Configuration/branding', { method: 'POST', token: admin.token, body: { ...branding, CustomCss: css } });
}

async function setQuickConnect(on: boolean): Promise<void> {
  const { admin } = loadState();
  const config = await api<Record<string, unknown>>('/System/Configuration', { token: admin.token });
  await api('/System/Configuration', { method: 'POST', token: admin.token, body: { ...config, QuickConnectAvailable: on } });
}

test('the Health tab lists the checks by group, each with its status in words, and is kept across a reload', { tag: '@smoke' }, async ({
  page,
}) => {
  await login(page, ADMIN);
  const root = await openHealth(page);
  // Fresh: the server keeps a report a minute, and an earlier spec may have had Seerr on.
  await rerun(root);

  for (const group of ['Health check', 'Server', 'Proxy and network', 'Requests (Seerr)', 'Notifications', 'Trakt', 'Trailers', 'Skip Intro', 'Quick Connect', 'Devices'])
    await expect(root.getByRole('group', { name: group, exact: true })).toBeVisible();
  await expect(row(root, 'server.jellyfin')).toContainText('OK');
  await expect(row(root, 'server.jellyfin')).toContainText(/Lumen has been tested with Jellyfin 12\.\d+\./);
  // No proxy here: the probe's headers arrive as Lumen sent them.
  await expect(row(root, 'proxy.cache')).toContainText("Lumen's files arrive with the caching headers Lumen sends");
  await expect(row(root, 'proxy.cache')).toContainText('Received: Cache-Control: no-cache.');
  // The test server is plain HTTP on a local address: a note, not a problem.
  await expect(row(root, 'proxy.https')).toContainText('Not applicable');
  // Requests are off by default; a fix opens their card on the Settings tab.
  await expect(row(root, 'requests.seerr')).toContainText('Requests are off');
  await row(root, 'requests.seerr').getByRole('button', { name: 'Open Requests settings' }).click();
  await expect(root.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true');
  await expect(root.getByRole('switch', { name: 'Enable catalog browsing and requests' })).toBeFocused();

  await root.getByRole('tab', { name: /^Health/ }).click();
  await page.reload();
  await expect(page.locator('[id="lmn-admin-root"]:visible').getByRole('tab', { name: /^Health/ })).toHaveAttribute('aria-selected', 'true');
});

test('custom CSS in Branding is a warning, with a link to Branding, until it is removed', async ({ page }) => {
  await login(page, ADMIN);
  try {
    // An address that never resolves (.invalid), so the page doesn't wait on the network for it.
    await brandingCss('@import url("https://lumen-e2e.invalid/theme.css");\nh1 { font-family: serif; }');
    const root = await openHealth(page);
    await rerun(root);
    const css = row(root, 'server.customCss');
    await expect(css).toContainText('Warning');
    await expect(css).toContainText("Jellyfin adds it to Lumen's pages too");
    await expect(css).toContainText('loads 1 stylesheet from other sites');
    await expect(css.getByRole('link', { name: 'Open Branding' })).toHaveAttribute('href', '#/dashboard/branding');

    await brandingCss('');
    await rerun(root);
    await expect(css).toContainText('OK');
    await expect(css).toContainText('No custom CSS is set');
    await expect(css.getByRole('link')).toHaveCount(0);
  } finally {
    await brandingCss('');
  }
});

test('Seerr: answering, with Radarr and Sonarr; without them; and down, a problem that names no address', async ({ page }) => {
  await login(page, ADMIN);
  try {
    await lumenConfig({ RequestsEnabled: true, SeerrUrl: SEERR_URL, SeerrApiKey: 'stub-key' });
    const root = await openHealth(page);
    await rerun(root);
    await expect(row(root, 'requests.seerr')).toContainText('Seerr 3.5.1-stub answers and the API key works.');
    await expect(row(root, 'requests.services')).toContainText('Seerr sends movies to Radarr and shows to Sonarr');

    await fetch(`${STUB_SEERR}/__stub/services`, { method: 'POST', body: JSON.stringify({ radarr: 1, sonarr: 0 }) });
    await rerun(root);
    await expect(row(root, 'requests.services')).toContainText('Warning');
    await expect(row(root, 'requests.services')).toContainText('no Sonarr server');

    // Down: nothing listens on port 9 there.
    const down = SEERR_URL.replace(/:\d+$/, ':9');
    await lumenConfig({ SeerrUrl: down, SeerrApiKey: 'stub-key' });
    await rerun(root);
    const seerr = row(root, 'requests.seerr');
    await expect(seerr).toContainText('Problem');
    await expect(seerr).toContainText("Lumen can't reach Seerr.");
    expect(await seerr.innerText()).not.toContain(new URL(down).hostname);
    await expect(row(root, 'requests.services')).toContainText('Not applicable');
    // A problem shows on the tab, in its name too.
    await expect(root.getByRole('tab', { name: /^Health\s*\d+ problems?$/ })).toBeVisible();
  } finally {
    await fetch(`${STUB_SEERR}/__stub/reset`, { method: 'POST' });
    await resetLumen();
  }
});

test('Notifications: off with requests; with Seerr, the job, the devices, this address, and Seerr’s webhook with its secret', async ({ page }) => {
  const { admin } = loadState();
  await login(page, ADMIN);
  try {
    let root = await openHealth(page);
    await rerun(root);
    // Requests are off by default: push notifications come with them.
    for (const id of ['notifications.service', 'notifications.https', 'notifications.devices', 'notifications.lastSend', 'notifications.webhook'])
      await expect(row(root, id)).toContainText('Not applicable');
    await expect(row(root, 'notifications.service')).toContainText('Notifications come with requests, which are off.');

    await lumenConfig({ RequestsEnabled: true, SeerrUrl: SEERR_URL, SeerrApiKey: 'stub-key' });
    // The webhook's secret, as the Requests card shows it (made once Seerr is set up).
    const { WebhookSecret: secret } = await api<{ WebhookSecret: string }>('/Lumen/Admin/Push', { token: admin.token });
    await rerun(root);
    await expect(row(root, 'notifications.service')).toContainText('The job that sends notifications is running');
    await expect(row(root, 'notifications.devices')).toContainText('No device has notifications on yet.');
    // The test server is plain HTTP on localhost.
    await expect(row(root, 'notifications.https')).toContainText('only on this computer');
    await expect(row(root, 'notifications.webhook')).toContainText("Seerr's webhook is off.");

    // Pointed at Lumen with an old secret: Lumen would turn its calls away.
    const webhook = (authHeader: string, types = 8) =>
      fetch(`${STUB_SEERR}/__stub/webhook`, {
        method: 'POST',
        body: JSON.stringify({ enabled: true, types, webhookUrl: `${BASE_URL.replace(/\/$/, '')}/Lumen/Push/Seerr`, authHeader }),
      });
    await webhook('not-the-secret');
    await rerun(root);
    const hook = row(root, 'notifications.webhook');
    await expect(hook).toContainText('Problem');
    await expect(hook).toContainText('calls Lumen with a different secret');
    await expect(hook.getByRole('button', { name: 'Open Requests settings' })).toBeVisible();

    await webhook(secret);
    await rerun(root);
    await expect(hook).toContainText('OK');
    await expect(hook).toContainText('notifications go out at once');
    expect(await root.innerText()).not.toContain(secret);

    // Nothing of it in the copied report either.
    await page.reload();
    root = await openHealth(page);
    await page.evaluate(() => {
      const w = window as unknown as { __copied?: string };
      if (navigator.clipboard) navigator.clipboard.writeText = async (text: string) => void (w.__copied = text);
    });
    await root.getByRole('button', { name: 'Copy report' }).click();
    const report = (await page.evaluate(() => (window as unknown as { __copied?: string }).__copied)) ?? '';
    expect(report).toContain('[notifications.webhook]');
    expect(report).not.toContain(secret);
  } finally {
    await fetch(`${STUB_SEERR}/__stub/reset`, { method: 'POST' });
    await resetLumen();
  }
});

test('a fix saved on the Settings tab shows on the Health tab at once, without running the checks again', async ({ page }) => {
  await login(page, ADMIN);
  try {
    await lumenConfig({ RequestsEnabled: true, SeerrUrl: SEERR_URL, SeerrApiKey: 'wrong-key' });
    const root = await openHealth(page);
    await rerun(root);
    const seerr = row(root, 'requests.seerr');
    await expect(seerr).toContainText('Seerr refused the saved API key.');
    // The badge's count (devices other specs reported count too, until Jellyfin restarts).
    const problems = async (): Promise<number> =>
      Number(/(\d+) problems?$/.exec((await root.getByRole('tab', { name: /^Health/ }).textContent()) ?? '')?.[1] ?? 0);
    const before = await problems();
    expect(before).toBeGreaterThan(0);

    // The row's fix, the right key, Save: the server dropped the report it kept, and the page asked again.
    await seerr.getByRole('button', { name: 'Open Requests settings' }).click();
    await root.getByLabel('Seerr API key').fill('stub-key');
    await root.getByRole('button', { name: 'Save' }).click();
    await expect(root.locator('.lmna-savebar').getByText('Settings saved.')).toBeVisible();
    await root.getByRole('tab', { name: /^Health/ }).click();
    await expect(seerr).toContainText('Seerr 3.5.1-stub answers and the API key works.');
    await expect.poll(problems).toBe(before - 1);
  } finally {
    await resetLumen();
  }
});

test('the Health report is for admins only: a user (kid) and a visitor get nothing from it', async () => {
  const { kid } = loadState();
  const call = (token?: string) =>
    fetch(new URL('Lumen/Admin/Health?refresh=true', `${BASE_URL.replace(/\/$/, '')}/`), {
      headers: {
        Authorization: `MediaBrowser Client="Lumen E2E", Device="Playwright", DeviceId="lumen-e2e-kid", Version="1.0.0"${token ? `, Token="${token}"` : ''}`,
      },
    });

  // The kid's token works, so a 403 below is the endpoint refusing a signed-in user, not an expired session.
  expect((await api('/Users/Me', { token: kid.token })) as unknown).toBeTruthy();
  for (const [who, token, status] of [
    ['kid', kid.token, 403],
    ['nobody', undefined, 401],
  ] as const) {
    const response = await call(token);
    expect(response.status, who).toBe(status);
    // No check, setting or device in an error body.
    expect(await response.text()).not.toMatch(/Checks|QuickConnectAddress|Devices|requests\.seerr/);
  }
});

test('Quick Connect on, with the public address answering as this server; and off', async ({ page }) => {
  await login(page, ADMIN);
  try {
    await setQuickConnect(true);
    await lumenConfig({ QuickConnectAddress: BASE_URL });
    const root = await openHealth(page);
    await rerun(root);
    await expect(row(root, 'quickConnect.enabled')).toContainText('Quick Connect is on');
    await expect(row(root, 'quickConnect.address')).toContainText('Set: QR codes send phones to the public address');
    await expect(row(root, 'quickConnect.reachable')).toContainText("The public address answers, and it's this server.");

    await setQuickConnect(false);
    await rerun(root);
    const enabled = row(root, 'quickConnect.enabled');
    await expect(enabled).toContainText('Not applicable');
    await expect(enabled).toContainText('Quick Connect is off');
    await expect(enabled.getByRole('link', { name: 'Open General' })).toHaveAttribute('href', '#/dashboard/settings');
    await expect(row(root, 'quickConnect.reachable')).toContainText('Quick Connect is off.');
  } finally {
    await setQuickConnect(true);
    await resetLumen();
  }
});

test('Copy report copies a plain summary with no keys or addresses', async ({ page }) => {
  // Catch what the page copies, the same way in every browser (and without clipboard permissions).
  await page.addInitScript(() => {
    const w = window as unknown as { __copied?: string };
    if (navigator.clipboard)
      navigator.clipboard.writeText = async (text: string) => {
        w.__copied = text;
      };
  });
  const { admin } = loadState();
  await api('/Lumen/Diagnostics', {
    method: 'POST',
    token: admin.token,
    body: { Client: 'tv Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 Chrome/68.0.3440.106', ServerVersion: '12.4.0', FailedChecks: ['selector.upNext'] },
  });
  await login(page, ADMIN);
  try {
    await lumenConfig({ RequestsEnabled: true, SeerrUrl: SEERR_URL, SeerrApiKey: 'stub-key', QuickConnectAddress: 'https://tv.lumen-e2e.example' });
    const root = await openHealth(page);
    await rerun(root);
    await root.getByRole('button', { name: 'Copy report' }).click();
    await expect(root.getByText(/^Report copied\./)).toBeVisible();
    const report = (await page.evaluate(() => (window as unknown as { __copied?: string }).__copied)) ?? '';

    expect(report).toContain('Lumen health report');
    expect(report).toContain('- OK: Seerr connection [requests.seerr]: Seerr 3.5.1-stub answers and the API key works.');
    expect(report).toContain('Seerr address set, API key set');
    expect(report).toContain('Public address for QR codes: set');
    expect(report).toContain("What Lumen did: Lumen shows Jellyfin's own next-episode card instead.");
    expect(report).toContain('Checks: selector.upNext');
    for (const secret of ['stub-key', new URL(SEERR_URL).host, 'lumen-e2e.example', new URL(BASE_URL).host, admin.token])
      expect(report, secret).not.toContain(secret);
  } finally {
    await resetLumen();
  }
});

test('TV layout: the D-pad reaches the Health tab and every control on it', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(() => localStorage.setItem('layout', 'tv'));
  await login(page, ADMIN);
  await expect(page.locator('html')).toHaveClass(/\blayout-tv\b/);
  // A device report, so the walk includes its Technical details toggle.
  await api('/Lumen/Diagnostics', {
    method: 'POST',
    token: loadState().admin.token,
    body: { Client: 'tv Mozilla/5.0 (Web0S; Linux/SmartTV) Chrome/68.0.3440.106', ServerVersion: '12.4.0', FailedChecks: ['selector.appBar'] },
  });
  await page.goto('/web/#/configurationpage?name=Lumen');
  const root = page.locator('[id="lmn-admin-root"]:visible');
  const health = root.getByRole('tab', { name: /^Health/ });
  await expect(root.getByRole('tab', { name: 'Settings' })).toBeVisible();

  // From the header to the tabs, then Right twice to Health, and Down into it.
  await page.getByRole('button', { name: 'Back', exact: true }).first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(root.getByRole('tab', { name: 'Settings' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(root.getByRole('tab', { name: 'Storage' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(health).toBeFocused();
  await expect(health).toHaveAttribute('aria-selected', 'true');
  const again = root.getByRole('button', { name: 'Run checks again' });
  await expect(again).toBeEnabled({ timeout: 20_000 });
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => root.locator('.lmna-health').evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await expect(page.locator(':focus')).toHaveCSS('outline-style', 'solid');
  // Up from the top buttons goes back to the tab, and Down comes in again.
  await page.keyboard.press('ArrowUp');
  await expect(health).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => root.locator('.lmna-health').evaluate((el) => el.contains(document.activeElement))).toBe(true);
  // Down from fix to fix, past the rows' text, stays in the tab (the Dashboard's drawer can be nearer).
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('ArrowDown');
    expect(await root.locator('.lmna-health').evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }

  // Every button, link and toggle on the tab, with the tab strip kept out of the walk (Left and Right there change tab).
  await root.locator('[role="tab"]').evaluateAll((tabs) => tabs.forEach((tab) => ((tab as HTMLButtonElement).disabled = true)));
  const { controls, unreachable } = await walkDpad(page, again, '.lmna-health');
  expect(controls.length).toBeGreaterThan(4);
  // The devices' Technical details toggles are in the walk too.
  expect(controls.some((c) => c.name.startsWith('summary'))).toBe(true);
  expect(unreachable.map((c) => c.name)).toEqual([]);
});
