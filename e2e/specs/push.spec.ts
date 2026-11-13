import { expect, test } from '@playwright/test';
import { ADMIN, type Auth, BASE_URL, DEVICE_ID, SEERR_URL, STUB_SEERR, api, authenticate, loadState, resetLumen } from '../support/api';
import { login } from '../support/login';
import { type PushedMessage, type TestSubscription, decrypt, newSubscription, pushed, vapidClaims } from '../support/push';

// Push notifications when a request is ready to watch (docs/superpowers/specs/2026-11-12-web-push-design.md): the
// server's side. The stub Seerr also stands in for a push service (/push/:id): the Jellyfin server may post there
// because the tests' server runs with LUMEN_PUSH_TEST_ENDPOINT. The tests hold a subscription's keys, as a browser
// would, and read what arrives: the encryption, the signature and the job that sends are the real ones. The toggle
// and Lumen's service worker in a browser are in push-device.spec.ts.
//
// The tests' server runs with LUMEN_PUSH_TEST_PASS_SECONDS=3600 and LUMEN_PUSH_TEST_RETRY_SECONDS=2 (ReadyPushTimings):
// the job's own two-minute pass can't run during a test, so whatever is pushed here was caused by what the test did
// (Seerr's webhook, or an open page's check), and a failed send is tried again after 2 s and 4 s, not 2 and 4 minutes.

// Seerr permission bits: REQUEST = 32. The admin is Seerr user 1 in every requests spec, and the kid has no Seerr
// account in any (Lumen caches the mapping for 10 minutes, across specs).
const REQUEST_PERMISSION = 32;
const ADMIN_SEERR_ID = 1;
// Lumen keeps a user's Seerr answer this long (RequestProgressService.Ttl), so a change in the stub shows after it.
const SERVER_CACHE_MS = 8_000;
const TOGGLE = 'Notify me when requests are ready';
// A device is sent one notification this often before the job gives up on it (ReadyPushJob.MaxAttempts).
const MAX_ATTEMPTS = 3;
/** Another device the admin is signed in on, for the tests that need two. */
const SECOND_DEVICE = 'lumen-e2e-second';

interface PushAdminStatus {
  Devices: number;
  Users: number;
  Running: boolean;
  LastSend?: { Kind: string; Sent: number; Gone: number; Failed: number; Status?: number };
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

/** Turns notifications on for the tests' own device (the API token's), or for `session`'s, as the toggle would. */
async function subscribe(subscription: TestSubscription, session?: Auth & { deviceId: string }): Promise<void> {
  await api('/Lumen/Push/Subscription', {
    method: 'POST',
    token: session?.token ?? loadState().admin.token,
    deviceId: session?.deviceId,
    body: { Endpoint: subscription.endpoint, P256dh: subscription.p256dh, Auth: subscription.auth },
  });
}

/** The admin, signed in on a second device: its own session and access token, beside the tests' own. */
async function secondDevice(): Promise<Auth & { deviceId: string }> {
  return { ...(await authenticate(ADMIN, SECOND_DEVICE)), deviceId: SECOND_DEVICE };
}

async function signOut(session: Auth & { deviceId: string }): Promise<void> {
  await api('/Sessions/Logout', { method: 'POST', token: session.token, deviceId: session.deviceId });
}

/**
 * Files a request as the admin in Seerr's own interface, not through Lumen: Lumen knows nothing of it until it next
 * asks Seerr. Returns Seerr's id for it.
 */
async function requestInSeerr(tmdbId: number): Promise<number> {
  const response = await fetch(`${STUB_SEERR}/api/v1/request`, {
    method: 'POST',
    headers: { 'X-Api-Key': 'stub-key', 'X-Api-User': String(ADMIN_SEERR_ID), 'Content-Type': 'application/json' },
    body: JSON.stringify({ mediaType: 'movie', mediaId: tmdbId }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: number }).id;
}

/** Seerr's webhook, as Seerr calls it. */
async function webhook(authorization: string, body: unknown): Promise<Response> {
  const { WebhookPath } = await adminStatus();
  return fetch(new URL(WebhookPath, `${BASE_URL}/`), {
    method: 'POST',
    headers: { Authorization: authorization, 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
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
  // Filed in Seerr's own interface, and on the server before Lumen ever looks: Lumen never sees it in flight, so
  // neither a pass of its job (were one to run) nor an open page would ever announce it. Only Seerr's webhook, by
  // naming it, can: whatever arrives below, the webhook caused.
  const itemId = await makeAvailable(605, 'Lumen Beta');
  const requestId = await requestInSeerr(605);
  const { WebhookSecret } = await adminStatus();
  await new Promise((resolve) => setTimeout(resolve, SERVER_CACHE_MS)); // until Lumen asks Seerr again

  // Without the secret, nothing; and with it but no request named, Lumen looks and finds nothing new to say.
  expect((await webhook('not-the-secret', { notification_type: 'MEDIA_AVAILABLE', request: { request_id: String(requestId) } })).status).toBe(401);
  expect((await webhook(WebhookSecret!, { notification_type: 'MEDIA_AVAILABLE', subject: 'Lumen Future' })).status).toBe(204);
  const mine = await api<{ Requests: { Status: string; Announce: boolean }[] }>('/Lumen/Requests/Mine', { token: loadState().admin.token });
  expect(mine.Requests[0]).toMatchObject({ Status: 'Ready', Announce: false });
  await page.waitForTimeout(2_000); // the job has long looked by then
  expect(await pushed(subscription)).toHaveLength(0);

  // No page is open anywhere: Seerr's webhook names the request (its default payload), and Lumen asks Seerr what's
  // ready and for whom.
  expect((await webhook(WebhookSecret!, { notification_type: 'MEDIA_AVAILABLE', subject: 'Lumen Future', request: { request_id: String(requestId) } })).status).toBe(204);

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
  expect((await webhook(`Bearer ${WebhookSecret!}`, { notification_type: 'MEDIA_AVAILABLE', subject: 'Lumen Future', request: { request_id: String(requestId) } })).status).toBe(204);
  const checked = page.waitForResponse(/\/Lumen\/Requests\/Mine\b/);
  await login(page, ADMIN);
  expect((await (await checked).json()).Requests[0]).toMatchObject({ Status: 'Ready', Announce: false });
  // The pop-up would show as the answer lands: give it a moment to show it doesn't.
  await page.waitForTimeout(500);
  await expect(page.getByRole('alert')).toBeEmpty();
  expect(await pushed(subscription)).toHaveLength(1);
});

test("Seerr's webhook refuses a body that's too large, with or without the secret", async () => {
  const { WebhookSecret } = await adminStatus();
  const large = JSON.stringify({ notification_type: 'MEDIA_AVAILABLE', message: 'x'.repeat(70 * 1024) });

  // 413, not the 500 an unhandled size limit gives; and still nothing for a caller without the secret.
  expect((await webhook(WebhookSecret!, large)).status).toBe(413);
  expect((await webhook('not-the-secret', large)).status).toBe(401);
  // What isn't JSON is a bad request, and Seerr's "Test" button is fine.
  expect((await webhook(WebhookSecret!, 'notification_type=MEDIA_AVAILABLE')).status).toBe(400);
  expect((await webhook(WebhookSecret!, { notification_type: 'TEST_NOTIFICATION' })).status).toBe(204);
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
  // Nothing was pushed meanwhile: the job's own pass is an hour away on the tests' server, and nobody called the
  // webhook. So the push below is the page's doing.
  expect(await pushed(subscription)).toHaveLength(0);
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

test("a push service that keeps failing is tried three times, then the app's pop-up says it", async ({ page }) => {
  test.setTimeout(120_000);
  // The stub push service answers 503 for this device, every time.
  const down = newSubscription(`down-${Date.now()}`);
  await subscribe(down);
  await requestDownloading(605);
  const checked = page.waitForResponse(/\/Lumen\/Requests\/Mine\b/);
  await login(page, ADMIN);
  expect((await (await checked).json()).Requests[0].Status).toBe('Downloading');

  await makeAvailable(605, 'Lumen Beta');
  await page.waitForTimeout(SERVER_CACHE_MS); // until Lumen asks Seerr again
  const again = page.waitForResponse(/\/Lumen\/Requests\/Mine\b/);
  await page.reload();

  // The device still has notifications on, so the page's check leaves the request to the push: no pop-up yet.
  expect((await (await again).json()).Requests[0]).toMatchObject({ Status: 'Ready', Announce: false });
  await expect(page.getByRole('alert')).toBeEmpty();

  // Three attempts (at once, after 2 s, after 4 s more on the tests' server), and the job gives up.
  await expect.poll(async () => (await pushed(down)).length, { timeout: 30_000 }).toBe(MAX_ATTEMPTS);
  expect(await adminStatus()).toMatchObject({ Devices: 1, LastSend: { Kind: 'ready', Sent: 0, Failed: 1, Status: 503 } });

  // The user still hears of it: the next check shows the pop-up, though the device still has notifications on.
  const told = page.waitForResponse(/\/Lumen\/Requests\/Mine\b/);
  await page.reload();
  expect((await (await told).json()).Requests[0]).toMatchObject({ Status: 'Ready', Announce: true });
  await expect(page.getByRole('alert')).toContainText('Lumen Future is ready to watch', { timeout: 15_000 });

  // And that was all: however often the page checks from here, the push service isn't tried again, and the pop-up
  // doesn't come back.
  for (let i = 0; i < 2; i++) {
    const next = page.waitForResponse(/\/Lumen\/Requests\/Mine\b/);
    await page.reload();
    expect((await (await next).json()).Requests[0]).toMatchObject({ Status: 'Ready', Announce: false });
  }
  await page.waitForTimeout(7_000); // longer than both waits between attempts
  expect(await pushed(down)).toHaveLength(MAX_ATTEMPTS);
  await expect(page.getByRole('alert')).toBeEmpty();
});

test("a device whose push service refuses a notification isn't sent it again and stays subscribed, and the app's pop-up says it", async ({ page }) => {
  test.setTimeout(120_000);
  // The stub push service answers 403 for this device, every time.
  const refused = newSubscription(`refused-${Date.now()}`);
  await subscribe(refused);
  await requestDownloading(605);
  const checked = page.waitForResponse(/\/Lumen\/Requests\/Mine\b/);
  await login(page, ADMIN);
  expect((await (await checked).json()).Requests[0].Status).toBe('Downloading');

  await makeAvailable(605, 'Lumen Beta');
  await page.waitForTimeout(SERVER_CACHE_MS); // until Lumen asks Seerr again
  const again = page.waitForResponse(/\/Lumen\/Requests\/Mine\b/);
  await page.reload();
  expect((await (await again).json()).Requests[0]).toMatchObject({ Status: 'Ready', Announce: false });

  // One attempt, not three: the same message would be refused again, and three refusals running remove a
  // subscription (one message the push service won't have mustn't do that by itself).
  await expect.poll(async () => (await pushed(refused)).length, { timeout: 30_000 }).toBe(1);
  await page.waitForTimeout(7_000); // longer than both waits between a failing device's attempts
  expect(await pushed(refused)).toHaveLength(1);
  expect(await adminStatus()).toMatchObject({ Devices: 1, LastSend: { Kind: 'ready', Sent: 0, Failed: 0, Status: 403 } });

  // Nobody was told, so the request is the pop-up's, though the device still has notifications on.
  const told = page.waitForResponse(/\/Lumen\/Requests\/Mine\b/);
  await page.reload();
  expect((await (await told).json()).Requests[0]).toMatchObject({ Status: 'Ready', Announce: true });
  await expect(page.getByRole('alert')).toContainText('Lumen Future is ready to watch', { timeout: 15_000 });

  // And no later check has the job take the request back and send the refused message again.
  const next = page.waitForResponse(/\/Lumen\/Requests\/Mine\b/);
  await page.reload();
  expect((await (await next).json()).Requests[0]).toMatchObject({ Status: 'Ready', Announce: false });
  await page.waitForTimeout(3_000);
  expect(await pushed(refused)).toHaveLength(1);
  expect((await adminStatus()).Devices).toBe(1);
});

test('with two devices, the one whose push service fails is tried again on its own, and nobody is told twice', async ({ page }) => {
  test.setTimeout(120_000);
  const second = await secondDevice();
  try {
    // The tests' own device at a push service that answers 201, the admin's second device at one that answers 503.
    const fine = newSubscription();
    const down = newSubscription(`down-${Date.now()}`);
    await subscribe(fine);
    await subscribe(down, second);
    expect(await adminStatus()).toMatchObject({ Devices: 2, Users: 1 });

    // As in the first test: only the webhook, naming the request, can have it announced.
    await makeAvailable(605, 'Lumen Beta');
    const requestId = await requestInSeerr(605);
    const { WebhookSecret } = await adminStatus();
    await new Promise((resolve) => setTimeout(resolve, SERVER_CACHE_MS));
    expect((await webhook(WebhookSecret!, { notification_type: 'MEDIA_AVAILABLE', request: { request_id: String(requestId) } })).status).toBe(204);

    // The first device has it at once. The second is sent it three times in all; the first never again.
    const [message] = await received(fine);
    expect(decrypt(fine, message!).title).toBe('Lumen Future is ready to watch');
    await expect.poll(async () => (await pushed(down)).length, { timeout: 30_000 }).toBe(MAX_ATTEMPTS);
    await page.waitForTimeout(7_000);
    expect(await pushed(down)).toHaveLength(MAX_ATTEMPTS);
    expect(await pushed(fine)).toHaveLength(1);
    // Both are still subscribed: a push service being down removes nobody.
    expect((await adminStatus()).Devices).toBe(2);

    // One device told the user, so the app has no pop-up to add.
    const checked = page.waitForResponse(/\/Lumen\/Requests\/Mine\b/);
    await login(page, ADMIN);
    expect((await (await checked).json()).Requests[0]).toMatchObject({ Status: 'Ready', Announce: false });
    await page.waitForTimeout(500);
    await expect(page.getByRole('alert')).toBeEmpty();
  } finally {
    await signOut(second);
  }
});

test("a session can't read, replace, remove or test another of its user's devices by naming it", async () => {
  const { admin } = loadState();
  const second = await secondDevice();
  // The second device's access token, on requests whose Authorization header names the first device: Jellyfin's own
  // sign-in takes the device id from that header, so this goes through its real authentication.
  const posing = { token: second.token, deviceId: DEVICE_ID };
  try {
    const first = newSubscription();
    await subscribe(first);

    // It sees none of the first device's subscription, and removing "its" subscription leaves the first's alone.
    expect((await api<{ Endpoint?: string }>('/Lumen/Push/Status', posing)).Endpoint).toBeUndefined();
    await api('/Lumen/Push/Subscription', { method: 'DELETE', ...posing });
    expect((await api<{ Endpoint?: string }>('/Lumen/Push/Status', { token: admin.token })).Endpoint).toBe(first.endpoint);
    await expect(api('/Lumen/Push/Test', { method: 'POST', ...posing })).rejects.toThrow(/-> 404/);

    // What it subscribes is stored for the device its token was issued to: beside the first's, never in its place.
    const other = newSubscription();
    await api('/Lumen/Push/Subscription', { method: 'POST', ...posing, body: { Endpoint: other.endpoint, P256dh: other.p256dh, Auth: other.auth } });
    expect((await adminStatus()).Devices).toBe(2);
    expect((await api<{ Endpoint?: string }>('/Lumen/Push/Status', { token: admin.token })).Endpoint).toBe(first.endpoint);
    expect((await api<{ Endpoint?: string }>('/Lumen/Push/Status', second)).Endpoint).toBe(other.endpoint);

    // And turning "the first device" off turns off its own.
    await api('/Lumen/Push/Subscription', { method: 'DELETE', ...posing });
    expect((await adminStatus()).Devices).toBe(1);
    expect((await api<{ Endpoint?: string }>('/Lumen/Push/Status', { token: admin.token })).Endpoint).toBe(first.endpoint);
  } finally {
    await signOut(second);
  }
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
  expect(result).toEqual({ Ok: false, Error: "This device's notifications had expired and were turned off. Turn them on again." });
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
  // The admin's status, with the webhook's secret in it, is never cached.
  const status = await fetch(new URL('Lumen/Admin/Push', `${BASE_URL}/`), { headers: as(admin.token) });
  expect(status.headers.get('cache-control')).toBe('no-store');
  await expect.poll(async () => (await pushed(subscription)).length).toBe(1);
  expect(decrypt(subscription, (await pushed(subscription))[0]!).kind).toBe('test');

  // Not a push service: the server would be posting into its own network on a user's say-so.
  // Nor another service of a company that runs one, nor the stub's other routes by way of "..".
  const notPushServices = [
    `${SEERR_URL}/api/v1/settings/main`,
    `${SEERR_URL}/push/../api/v1/settings/main`,
    `${SEERR_URL}/push/%2e%2e/__stub/reset`,
    'http://localhost:8096/Users',
    'https://example.com/push',
    'https://storage.googleapis.com/bucket/object',
    'https://docs.google.com/forms/d/e/x/formResponse',
    'https://evil.push.services.mozilla.com/wpush/v2/x',
  ];
  for (const endpoint of notPushServices) {
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
  // The notifications card, not the admin's "Everyone's requests" row below it, which is drawn like it.
  const card = page.locator('.lmn-push:not(.lmn-requests-everyone)');
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
