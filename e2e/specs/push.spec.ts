import { expect, test } from '@playwright/test';
import { ADMIN, BASE_URL, SEERR_URL, STUB_SEERR, api, loadState, resetLumen } from '../support/api';
import { login } from '../support/login';
import { type PushedMessage, type TestSubscription, decrypt, newSubscription, pushed, vapidClaims } from '../support/push';

// Push notifications when a request is ready to watch (docs/superpowers/specs/2026-11-12-web-push-design.md): the
// server's side. The stub Seerr also stands in for a push service (/push/:id): the Jellyfin server may post there
// because the tests' server runs with LUMEN_PUSH_TEST_ENDPOINT. The tests hold a subscription's keys, as a browser
// would, and read what arrives: the encryption, the signature and the job that sends are the real ones. The toggle
// and Lumen's service worker in a browser are in push-device.spec.ts.

// Seerr permission bits: REQUEST = 32. The admin is Seerr user 1 in every requests spec, and the kid has no Seerr
// account in any (Lumen caches the mapping for 10 minutes, across specs).
const REQUEST_PERMISSION = 32;
const ADMIN_SEERR_ID = 1;
// Lumen keeps a user's Seerr answer this long (RequestProgressService.Ttl), so a change in the stub shows after it.
const SERVER_CACHE_MS = 8_000;
const TOGGLE = 'Notify me when requests are ready';

interface PushAdminStatus {
  Devices: number;
  Users: number;
  Running: boolean;
  LastSend?: { Kind: string; Sent: number; Gone: number };
  WebhookPath: string;
  WebhookSecret?: string;
}

test.beforeEach(async () => {
  const { admin } = loadState();
  await stub('reset');
  // Nobody starts with notifications on (a run that was cut short may have left a device behind).
  await api('/Lumen/Admin/Push/ResetKeys', { method: 'POST', token: admin.token });
  await stub('users', { [admin.userId.replace(/-/g, '')]: { id: ADMIN_SEERR_ID, permissions: REQUEST_PERMISSION } });
  await stub('jellyfin', { name: 'This server', serverId: (await api<{ Id: string }>('/System/Info/Public')).Id });
  await enableSeerr();
});
test.afterEach(async () => {
  // No subscription may outlast its test: a user with one gets a push instead of the pop-up other specs wait for.
  await api('/Lumen/Admin/Push/ResetKeys', { method: 'POST', token: loadState().admin.token });
  await resetLumen();
});

async function stub(control: string, body?: unknown): Promise<void> {
  await fetch(`${STUB_SEERR}/__stub/${control}`, { method: 'POST', body: JSON.stringify(body ?? {}) });
}

async function enableSeerr(): Promise<void> {
  const { admin } = loadState();
  const config = await api<Record<string, unknown>>('/Lumen/Admin/Config', { token: admin.token });
  await api('/Lumen/Admin/Config', {
    method: 'POST',
    token: admin.token,
    body: { ...config, RequestsEnabled: true, SeerrUrl: SEERR_URL, SeerrApiKey: 'stub-key' },
  });
}

const adminStatus = (): Promise<PushAdminStatus> => api('/Lumen/Admin/Push', { token: loadState().admin.token });
const publicKey = async (): Promise<string> =>
  (await api<{ PublicKey: string }>('/Lumen/Push/Status', { token: loadState().admin.token })).PublicKey;

/** Turns notifications on for the tests' own device (the API token's), as the toggle would. */
async function subscribe(subscription: TestSubscription): Promise<void> {
  await api('/Lumen/Push/Subscription', {
    method: 'POST',
    token: loadState().admin.token,
    body: { Endpoint: subscription.endpoint, P256dh: subscription.p256dh, Auth: subscription.auth, Locale: 'en-GB' },
  });
}

/** Files a request as the admin through Lumen (so Lumen watches it), downloading. */
async function requestDownloading(tmdbId: number): Promise<void> {
  await api('/Lumen/Requests', { method: 'POST', token: loadState().admin.token, body: { MediaType: 'movie', TmdbId: tmdbId } });
  await stub('progress', { [tmdbId]: { requestStatus: 2, mediaStatus: 3, downloads: [{ size: 1000, sizeLeft: 500, etaSeconds: 300 }] } });
}

/** The title lands on the server, as one of the library's movies. */
async function makeAvailable(tmdbId: number, itemName: string): Promise<string> {
  const itemId = loadState().items[itemName]!.replace(/-/g, '');
  await stub('progress', { [tmdbId]: null });
  await stub('library', { tmdbId, jellyfinMediaId: itemId });
  return itemId;
}

/** Waits for `count` messages at the stub push service for this subscription, and returns them. */
async function received(subscription: TestSubscription, count = 1, timeout = 20_000): Promise<PushedMessage[]> {
  await expect.poll(async () => (await pushed(subscription)).length, { timeout }).toBeGreaterThanOrEqual(count);
  return pushed(subscription);
}

test('a request that becomes ready is pushed once, with the app closed, and the pop-up stays away', async ({ page }) => {
  test.setTimeout(120_000);
  const subscription = newSubscription();
  await subscribe(subscription);
  await requestDownloading(605);
  // Lumen has seen it in flight (it was filed through Lumen). Nothing is pushed while it downloads.
  const itemId = await makeAvailable(605, 'Lumen Beta');

  // No page is open anywhere: Seerr's webhook tells Lumen, which asks Seerr what's ready and for whom.
  const { WebhookSecret, WebhookPath } = await adminStatus();
  await new Promise((resolve) => setTimeout(resolve, SERVER_CACHE_MS)); // until Lumen asks Seerr again
  const hook = (authorization: string, body: unknown): Promise<Response> =>
    fetch(new URL(WebhookPath, `${BASE_URL}/`), {
      method: 'POST',
      headers: { Authorization: authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  expect((await hook('not-the-secret', { notification_type: 'MEDIA_AVAILABLE' })).status).toBe(401);
  expect(await pushed(subscription)).toHaveLength(0);
  expect((await hook(WebhookSecret!, { notification_type: 'MEDIA_AVAILABLE', subject: 'Lumen Future' })).status).toBe(204);

  const [message] = await received(subscription);
  expect(message).toMatchObject({ encoding: 'aes128gcm', ttl: String(3 * 24 * 3600) });
  vapidClaims(message!, await publicKey());
  const payload = decrypt(subscription, message!);
  expect(payload).toMatchObject({
    kind: 'ready',
    title: 'Lumen Future is ready to watch',
    item: itemId,
    tag: 'lumen-ready-movie-605',
    icon: 'Lumen/Assets/lumen-icon-192.png',
  });
  // The artwork is Lumen's own proxy, which answers the URL as it is (a notification can't send headers).
  expect(payload.image).toMatch(/^Lumen\/Requests\/Image\/w780\/stubbackdrop605\.jpg\?t=/);
  const image = await fetch(new URL(payload.image!, `${BASE_URL}/`));
  expect(image.status).toBe(200);
  expect(image.headers.get('content-type')).toMatch(/^image\//);
  expect((await adminStatus()).LastSend).toMatchObject({ Kind: 'ready', Sent: 1 });

  // Seerr calling again, and the user opening Lumen: no second push, and no pop-up for what the push already said.
  expect((await hook(`Bearer ${WebhookSecret!}`, { notification_type: 'MEDIA_AVAILABLE', subject: 'Lumen Future' })).status).toBe(204);
  const checked = page.waitForResponse(/\/Lumen\/Requests\/Mine\b/);
  await login(page, ADMIN);
  expect((await (await checked).json()).Requests[0]).toMatchObject({ Status: 'Ready', Announce: false });
  // The pop-up would show as the answer lands: give it a moment to show it doesn't.
  await page.waitForTimeout(500);
  await expect(page.getByRole('alert')).toBeEmpty();
  expect(await pushed(subscription)).toHaveLength(1);
});

test('an open page that sees a request turn ready has the push sent, not the pop-up shown', async ({ page }) => {
  test.setTimeout(120_000);
  const subscription = newSubscription();
  await subscribe(subscription);
  await requestDownloading(605);
  const checked = page.waitForResponse(/\/Lumen\/Requests\/Mine\b/);
  await login(page, ADMIN);
  expect((await (await checked).json()).Requests[0].Status).toBe('Downloading');
  expect(await pushed(subscription)).toHaveLength(0);

  await makeAvailable(605, 'Lumen Beta');
  await page.waitForTimeout(SERVER_CACHE_MS); // until Lumen asks Seerr again
  const again = page.waitForResponse(/\/Lumen\/Requests\/Mine\b/);
  await page.reload();

  // The page's own check found it: the answer has no pop-up to show, and the push goes out at once.
  expect((await (await again).json()).Requests[0]).toMatchObject({ Status: 'Ready', Announce: false });
  const [message] = await received(subscription);
  expect(decrypt(subscription, message!).title).toBe('Lumen Future is ready to watch');
  await expect(page.getByRole('alert')).toBeEmpty();

  // Once: the next checks send nothing more.
  const third = page.waitForResponse(/\/Lumen\/Requests\/Mine\b/);
  await page.reload();
  await third;
  await page.waitForTimeout(500);
  expect(await pushed(subscription)).toHaveLength(1);
});

test('a subscription the push service says is gone is removed, and the pop-up is back', async ({ page }) => {
  test.setTimeout(120_000);
  const gone = newSubscription(`gone-${Date.now()}`);
  await subscribe(gone);
  expect((await adminStatus()).Devices).toBe(1);

  // The test button tells the user, and the device is forgotten.
  // (Lumen spaces a user's tests 10 s apart: an earlier test's, or a retry's, may still be in the way.)
  let result: { Ok: boolean; Error?: string } | undefined;
  await expect(async () => {
    result = await api('/Lumen/Push/Test', { method: 'POST', token: loadState().admin.token });
  }).toPass({ timeout: 40_000, intervals: [4_000] });
  expect(result).toEqual({ Ok: false, Error: "This device's notifications have expired. Turn them off and on again." });
  expect(await pushed(gone)).toHaveLength(1);
  expect(await adminStatus()).toMatchObject({ Devices: 0, LastSend: { Kind: 'test', Sent: 0, Gone: 1 } });
  const status = await api<{ Endpoint?: string }>('/Lumen/Push/Status', { token: loadState().admin.token });
  expect(status.Endpoint).toBeUndefined();

  // With no device left, a ready request pops up in the app again (as before notifications).
  await requestDownloading(605);
  await makeAvailable(605, 'Lumen Beta');
  await page.waitForTimeout(SERVER_CACHE_MS);
  await login(page, ADMIN);
  await expect(page.getByRole('alert')).toContainText('Lumen Future is ready to watch', { timeout: 15_000 });
});

test('the test button is rate-limited, a subscription can only point at a push service, and only its user manages it', async () => {
  const { admin, kid } = loadState();
  const subscription = newSubscription();
  await subscribe(subscription);
  const as = (token: string): Record<string, string> => ({
    Authorization: `MediaBrowser Client="Lumen E2E", Device="Playwright", DeviceId="lumen-e2e", Version="1.0.0", Token="${token}"`,
  });
  const send = (): Promise<Response> => fetch(new URL('Lumen/Push/Test', `${BASE_URL}/`), { method: 'POST', headers: as(admin.token) });

  // Lumen spaces a user's tests 10 s apart: the first goes through once an earlier test's has aged out, the next doesn't.
  await expect.poll(async () => (await send()).status, { timeout: 40_000, intervals: [4_000] }).toBe(200);
  const limited = await send();
  expect(limited.status).toBe(429);
  expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
  await expect.poll(async () => (await pushed(subscription)).length).toBe(1);
  expect(decrypt(subscription, (await pushed(subscription))[0]!).kind).toBe('test');

  // Not a push service: the server would be posting into its own network on a user's say-so.
  for (const endpoint of [`${SEERR_URL}/api/v1/settings/main`, 'http://localhost:8096/Users', 'https://example.com/push']) {
    await expect(
      api('/Lumen/Push/Subscription', {
        method: 'POST',
        token: admin.token,
        body: { Endpoint: endpoint, P256dh: subscription.p256dh, Auth: subscription.auth },
      }),
    ).rejects.toThrow(/-> 400/);
  }

  // Another user (the kid, on a device with the very same id) sees nothing of it and can't remove or use it. The kid
  // has no Seerr account, so no notifications of their own either.
  expect(await api('/Lumen/Push/Status', { token: kid.token })).toEqual({ Available: false });
  await api('/Lumen/Push/Subscription', { method: 'DELETE', token: kid.token });
  expect((await fetch(new URL('Lumen/Push/Test', `${BASE_URL}/`), { method: 'POST', headers: as(kid.token) })).status).toBe(404);
  await expect(
    api('/Lumen/Push/Subscription', {
      method: 'POST',
      token: kid.token,
      body: { Endpoint: subscription.endpoint, P256dh: subscription.p256dh, Auth: subscription.auth },
    }),
  ).rejects.toThrow(/-> 404/);
  const mine = await api<{ Endpoint?: string }>('/Lumen/Push/Status', { token: admin.token });
  expect(mine.Endpoint).toBe(subscription.endpoint);
  expect((await adminStatus()).Devices).toBe(1);
  // The admin's status counts devices, and never carries an address.
  expect(JSON.stringify(await adminStatus())).not.toContain('/push/');

  // Nobody without a sign-in reads or changes anything, and the kid is no admin.
  for (const [method, path] of [['GET', 'Lumen/Push/Status'], ['POST', 'Lumen/Push/Subscription'], ['DELETE', 'Lumen/Push/Subscription'], ['POST', 'Lumen/Push/Test'], ['GET', 'Lumen/Admin/Push'], ['POST', 'Lumen/Admin/Push/ResetKeys']] as const) {
    const response = await fetch(new URL(path, `${BASE_URL}/`), { method });
    expect([path, response.status]).toEqual([path, 401]);
  }
  await expect(api('/Lumen/Admin/Push', { token: kid.token })).rejects.toThrow(/-> 403/);
  await expect(api('/Lumen/Admin/Push/ResetKeys', { method: 'POST', token: kid.token })).rejects.toThrow(/-> 403/);
});

test('the admin page shows who has notifications on, and resets the keys after asking', async ({ page }) => {
  const subscription = newSubscription();
  await subscribe(subscription);
  const before = await publicKey();
  const secretBefore = (await adminStatus()).WebhookSecret!;
  await login(page, ADMIN);
  await page.goto('/web/#/configurationpage?name=Lumen');

  const card = page.locator('.lmn-admin__push');
  await expect(card.getByText('1 device of 1 user has notifications on.')).toBeVisible();
  await expect(card.getByText('Nothing has been sent since Jellyfin started.').or(card.getByText(/was sent to|wasn't delivered/))).toBeVisible();
  await card.getByText('Notify at once, with Seerr’s webhook (optional)').click();
  await expect(card.getByText(/\/Lumen\/Push\/Seerr$/)).toBeVisible();
  await expect(card.getByText(secretBefore, { exact: true })).toBeVisible();

  // Cancelled: nothing changes.
  page.once('dialog', (dialog) => void dialog.dismiss());
  await card.getByRole('button', { name: 'Reset notification keys' }).click();
  await expect(card.getByText('1 device of 1 user has notifications on.')).toBeVisible();
  expect(await publicKey()).toBe(before);

  let asked = '';
  page.once('dialog', (dialog) => {
    asked = dialog.message();
    void dialog.accept();
  });
  await card.getByRole('button', { name: 'Reset notification keys' }).click();
  await expect(card.getByText('No device has notifications on yet.')).toBeVisible();
  expect(asked).toContain('Every device stops getting notifications');
  expect(await publicKey()).not.toBe(before);
  const after = await adminStatus();
  expect(after.Devices).toBe(0);
  expect(after.WebhookSecret).not.toBe(secretBefore);
  // Neither key, nor any device's address, is in what the admin page (or Jellyfin's own endpoint) can read.
  const config = JSON.stringify(await api('/Lumen/Admin/Config', { token: loadState().admin.token }));
  const raw = JSON.stringify(await api('/Plugins/186f9cb8ba8e4555a700ffa619f48264/Configuration', { token: loadState().admin.token }));
  for (const text of [config, raw]) expect(text).not.toMatch(/Vapid|PushWebhookSecret/);
});

test('the notifications toggle shows on My requests and the profile page', { tag: '@smoke' }, async ({ page, browserName }) => {
  await login(page, ADMIN);
  await page.goto('/web/#/home?lumen=requests');
  await expect(page.getByRole('heading', { name: 'My requests', level: 1 })).toBeVisible();
  // What this browser can do decides what shows: a switch where the Push API is (off, or blocked, until tapped), the
  // Home Screen explanation on an iPhone in Safari, nothing where there's no Push API at all.
  const support = await page.evaluate(() => ({
    push: 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window,
    iphone: /iPhone/.test(navigator.userAgent),
  }));
  const card = page.locator('.lmn-push');
  if (support.push) {
    await expect(card.getByRole('switch', { name: TOGGLE })).toHaveAttribute('aria-checked', 'false');
  } else if (support.iphone) {
    await expect(card.getByText(/notifications need the Home Screen app/)).toBeVisible();
    await expect(card.getByRole('switch')).toHaveCount(0);
  } else {
    await expect(card).toHaveCount(0);
  }
  test.info().annotations.push({ type: 'push support', description: `${browserName}: ${JSON.stringify(support)}` });

  if (support.push || support.iphone) {
    await page.goto('/web/#/mypreferencesmenu');
    await expect(page.getByRole('region', { name: 'Notifications' }).locator('.lmn-push')).toBeVisible();
  }
});
