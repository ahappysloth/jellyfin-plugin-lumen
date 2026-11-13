import AxeBuilder from '@axe-core/playwright';
import { type BrowserContext, expect, type Page, test, type Worker } from '@playwright/test';
import { ADMIN, SEERR_URL, STUB_SEERR, api, loadState, resetLumen } from '../support/api';
import { login } from '../support/login';
import { type PushedMessage, type TestSubscription, decrypt, newSubscription, pushed, vapidClaims } from '../support/push';

// Push notifications on a device (docs/superpowers/specs/2026-11-12-web-push-design.md): the toggle, Lumen's service
// worker and what it shows. Playwright's browsers can't subscribe for real (there's no push service behind them), so
// the page's `pushManager.subscribe` is replaced by one that hands back a subscription whose keys the test holds and
// whose address is the stub push service (support/stub-seerr.mjs). Everything else is real: the permission, the
// worker's registration, the server's encryption and signature, and the worker showing what it's pushed and acting
// on a tap (the test dispatches the `push` and `notificationclick` events in the worker, as the browser does when a
// message arrives or a notification is tapped). The server's side is in push.spec.ts.

// The Push API stand-in, the permission grant and reaching into the worker are Chromium's.
test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium only');
// Chromium itself, in its new headless mode: the headless shell the other specs run in refuses notifications whatever
// is granted (`Notification.permission` is always "denied" there). A file of its own, as this needs its own browser.
test.use({
  channel: [async ({ browserName }, use) => use(browserName === 'chromium' ? 'chromium' : undefined), { scope: 'worker' }],
});

const REQUEST_PERMISSION = 32;
const ADMIN_SEERR_ID = 1;
const TOGGLE = 'Notify me when requests are ready';

test.beforeEach(async () => {
  const { admin } = loadState();
  await stub('reset');
  // Nobody starts with notifications on (a run that was cut short may have left a device behind).
  await api('/Lumen/Admin/Push/ResetKeys', { method: 'POST', token: admin.token });
  await stub('users', { [admin.userId.replace(/-/g, '')]: { id: ADMIN_SEERR_ID, permissions: REQUEST_PERMISSION } });
  await stub('jellyfin', { name: 'This server', serverId: (await api<{ Id: string }>('/System/Info/Public')).Id });
  const config = await api<Record<string, unknown>>('/Lumen/Admin/Config', { token: admin.token });
  await api('/Lumen/Admin/Config', {
    method: 'POST',
    token: admin.token,
    body: { ...config, RequestsEnabled: true, SeerrUrl: SEERR_URL, SeerrApiKey: 'stub-key' },
  });
});
test.afterEach(async () => {
  // No subscription may outlast its test: a user with one gets a push instead of the pop-up other specs wait for.
  await api('/Lumen/Admin/Push/ResetKeys', { method: 'POST', token: loadState().admin.token });
  await resetLumen();
});

async function stub(control: string, body?: unknown): Promise<void> {
  await fetch(`${STUB_SEERR}/__stub/${control}`, { method: 'POST', body: JSON.stringify(body ?? {}) });
}

const adminStatus = (): Promise<{ Devices: number; Users: number; Running: boolean }> =>
  api('/Lumen/Admin/Push', { token: loadState().admin.token });
const publicKey = async (): Promise<string> =>
  (await api<{ PublicKey: string }>('/Lumen/Push/Status', { token: loadState().admin.token })).PublicKey;

/** Waits for `count` messages at the stub push service for this subscription, and returns them. */
async function received(subscription: TestSubscription, count = 1): Promise<PushedMessage[]> {
  await expect.poll(async () => (await pushed(subscription)).length, { timeout: 20_000 }).toBeGreaterThanOrEqual(count);
  return pushed(subscription);
}

/**
 * Replaces the page's `pushManager.subscribe` with one that returns these subscriptions, one per call, as a browser
 * hands out a new one each time a page subscribes, and remembers the current one across page loads, with the server
 * key it was made with (`options.applicationServerKey`, which the page compares with the server's).
 */
async function fakeBrowserSubscription(page: Page, ...subscriptions: TestSubscription[]): Promise<void> {
  await page.addInitScript(
    (handedOut) => {
      const KEY = '__lumen_e2e_push'; // the server key the current subscription was made with
      const COUNT = '__lumen_e2e_push_count'; // how many subscriptions this "browser" has handed out
      const b64url = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const bytes = (key: string): ArrayBuffer => Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)).buffer;
      const make = (): unknown => {
        const { endpoint, p256dh, auth } = handedOut[Math.min(Number(localStorage.getItem(COUNT)), handedOut.length) - 1]!;
        return {
          endpoint,
          options: { userVisibleOnly: true, applicationServerKey: bytes(localStorage.getItem(KEY)!) },
          toJSON: () => ({ endpoint, keys: { p256dh, auth } }),
          unsubscribe: async () => {
            localStorage.removeItem(KEY);
            return true;
          },
        };
      };
      PushManager.prototype.subscribe = async function (options) {
        localStorage.setItem(KEY, b64url(new Uint8Array(options!.applicationServerKey as ArrayBuffer)));
        localStorage.setItem(COUNT, String(Number(localStorage.getItem(COUNT) ?? 0) + 1));
        return make() as PushSubscription;
      };
      PushManager.prototype.getSubscription = async function () {
        return (localStorage.getItem(KEY) ? make() : null) as PushSubscription | null;
      };
    },
    subscriptions.map(({ endpoint, p256dh, auth }) => ({ endpoint, p256dh, auth })),
  );
}

/**
 * Stands in for the browser's permission prompt, which a headless browser can't answer: the permission starts as
 * "default" and a call to `Notification.requestPermission` grants it. Each call is recorded with whether it came
 * during the user's own gesture, and how many requests the page had made to Lumen's push endpoints by then.
 */
async function recordPermissionPrompts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const GRANTED = '__lumen_e2e_permission';
    const record = { prompts: [] as { duringTap: boolean; pushRequests: number }[], pushRequests: 0 };
    (window as unknown as { __lumenPush: typeof record }).__lumenPush = record;
    const fetch = window.fetch;
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (/\/Lumen\/Push\//.test(url)) record.pushRequests++;
      return fetch.call(this, input, init);
    };
    Object.defineProperty(Notification, 'permission', { get: () => (localStorage.getItem(GRANTED) ? 'granted' : 'default') });
    Notification.requestPermission = async () => {
      record.prompts.push({ duringTap: navigator.userActivation.isActive, pushRequests: record.pushRequests });
      localStorage.setItem(GRANTED, '1');
      return 'granted';
    };
  });
}

/** The permission prompts this page load has opened, and its requests to Lumen's push endpoints so far. */
function promptsOf(page: Page): Promise<{ prompts: { duringTap: boolean; pushRequests: number }[]; pushRequests: number }> {
  return page.evaluate(() => (window as unknown as { __lumenPush: { prompts: { duringTap: boolean; pushRequests: number }[]; pushRequests: number } }).__lumenPush);
}

/** What the server has for the browser's own device (the page's sign-in, not the tests' API token). */
function deviceStatus(page: Page): Promise<{ Available: boolean; PublicKey?: string; Endpoint?: string }> {
  return page.evaluate(() => {
    const client = (window as unknown as { ApiClient: { getUrl(path: string): string; ajax(request: object): Promise<unknown> } }).ApiClient;
    return client.ajax({ type: 'GET', url: client.getUrl('Lumen/Push/Status'), dataType: 'json' }) as Promise<{ Available: boolean; PublicKey?: string; Endpoint?: string }>;
  });
}

/** The toggle's card has no accessibility violation, its text's contrast included (it sits on a plain surface). */
async function expectAccessible(page: Page, state: string): Promise<void> {
  const { violations } = await new AxeBuilder({ page })
    .include('.lmn-push')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`), `axe on the toggle, ${state}`).toEqual([]);
}

/** Lumen's service worker in this browser (registered once notifications are on). */
function lumenWorker(context: BrowserContext): Worker {
  const worker = context.serviceWorkers().find((w) => /\/Lumen\/Push\/sw\.js$/.test(w.url()));
  if (!worker) throw new Error("Lumen's service worker isn't running");
  return worker;
}

/**
 * Hands the worker a push message as the browser does when one arrives: a real `push` event in the real worker, and
 * waits for what the worker asked the browser to wait for (the notification being shown).
 */
async function deliver(context: BrowserContext, payload: object): Promise<void> {
  await lumenWorker(context).evaluate(async (data) => {
    // The worker's own globals (the tests are typed for a page).
    const scope = self as unknown as {
      PushEvent: new (type: string, init: { data: string }) => Event & { waitUntil(p: Promise<unknown>): void };
      dispatchEvent(event: Event): boolean;
    };
    const event = new scope.PushEvent('push', { data });
    let waited: Promise<unknown> = Promise.resolve();
    const waitUntil = event.waitUntil.bind(event);
    event.waitUntil = (promise) => {
      waited = promise;
      waitUntil(promise);
    };
    scope.dispatchEvent(event);
    await waited;
  }, JSON.stringify(payload));
}

/** What the page's browser knows of Lumen's worker and jellyfin-web's. */
function workers(page: Page): Promise<{ lumen: string | null; lumenScope: string | null; stock: string | null }> {
  return page.evaluate(async () => {
    const script = (r?: ServiceWorkerRegistration): string | null =>
      (r?.active ?? r?.waiting ?? r?.installing)?.scriptURL ?? null;
    const base = location.pathname.replace(/web\/.*$/, '');
    const lumen = await navigator.serviceWorker.getRegistration(`${base}Lumen/Push/`);
    const stock = await navigator.serviceWorker.getRegistration(`${base}web/`);
    return { lumen: script(lumen), lumenScope: lumen?.scope ?? null, stock: script(stock) };
  });
}

// Chromium itself, in its new headless mode: the headless shell the other specs run in refuses notifications
// whatever is granted (`Notification.permission` is always "denied" there).
test.use({ channel: 'chromium' });

test('the toggle turns notifications on, sends a test the worker shows, and turns them off', async ({ page, context }) => {
  test.setTimeout(90_000);
  const subscription = newSubscription();
  await context.grantPermissions(['notifications']);
  await fakeBrowserSubscription(page, subscription);
  await login(page, ADMIN);
  await page.goto('/web/#/home?lumen=requests');

  // Off by default, and nothing registered or asked for until the tap.
  const toggle = page.getByRole('switch', { name: TOGGLE });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  const before = await workers(page);
  expect(before.lumen).toBeNull();
  await expectAccessible(page, 'off');
  expect((await adminStatus()).Devices).toBe(0);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('On for this device.')).toBeVisible();

  // Lumen's own worker, under /Lumen/Push/; whatever jellyfin-web registered for /web/ is as it was.
  const registered = await workers(page);
  expect(registered.lumen).toMatch(/\/Lumen\/Push\/sw\.js$/);
  expect(registered.lumenScope).toMatch(/\/Lumen\/Push\/$/);
  expect(registered.stock).toBe(before.stock);
  expect(registered.stock ?? '').not.toContain('/Lumen/');
  // The browser subscribed with the server's public key, and the server has this device.
  expect(await page.evaluate(() => localStorage.getItem('__lumen_e2e_push'))).toBe(await publicKey());
  expect(await adminStatus()).toMatchObject({ Devices: 1, Users: 1, Running: true });

  // A test notification: encrypted for this browser alone, signed as this server.
  // (Lumen spaces a user's tests 10 s apart: an earlier test's, or a retry's, may still be in the way.)
  await expect(async () => {
    await page.getByRole('button', { name: 'Send a test notification' }).click();
    await expect(page.getByRole('status')).toHaveText('Sent. It should arrive in a moment.', { timeout: 3_000 });
  }).toPass({ timeout: 40_000, intervals: [4_000] });
  await expectAccessible(page, 'on, a test sent');
  const [message] = await received(subscription);
  expect(message).toMatchObject({ encoding: 'aes128gcm', ttl: '60', urgency: 'normal' });
  const claims = vapidClaims(message!, await publicKey());
  expect(claims.aud).toBe(new URL(SEERR_URL).origin);
  expect(claims.exp).toBeGreaterThan(Date.now() / 1000);
  expect(claims.exp).toBeLessThanOrEqual(Date.now() / 1000 + 24 * 3600);
  expect(Buffer.from(message!.body, 'base64').toString('latin1')).not.toContain('Notifications are on');
  const payload = decrypt(subscription, message!);
  expect(payload).toMatchObject({ v: 1, kind: 'test', title: 'Notifications are on', page: 'requests' });

  // Handed to the real worker as a push event, as the browser does: it shows the notification, with where a tap goes.
  await deliver(context, payload);
  const shown = (): Promise<{ title: string; body: string; icon: string; hash: string }[]> =>
    page.evaluate(async () => {
      const base = location.pathname.replace(/web\/.*$/, '');
      const registration = await navigator.serviceWorker.getRegistration(`${base}Lumen/Push/`);
      return (await registration!.getNotifications()).map((n) => ({
        title: n.title,
        body: n.body,
        icon: n.icon,
        hash: (n.data as { hash: string }).hash,
      }));
    });
  await expect.poll(shown).toEqual([
    {
      title: 'Notifications are on',
      body: payload.body,
      icon: new URL('/Lumen/Assets/lumen-icon-192.png', page.url()).href,
      hash: '#/home?lumen=requests',
    },
  ]);

  // Still on after a reload (the device's check on load keeps the subscription it has).
  await page.reload();
  await expect(page.getByRole('switch', { name: TOGGLE })).toHaveAttribute('aria-checked', 'true');
  expect((await adminStatus()).Devices).toBe(1);

  // And on the profile page, where it turns off.
  await page.goto('/web/#/mypreferencesmenu');
  const group = page.getByRole('region', { name: 'Notifications' });
  await expect(group.getByRole('switch', { name: TOGGLE })).toHaveAttribute('aria-checked', 'true');
  await group.getByRole('switch', { name: TOGGLE }).click();
  await expect(group.getByRole('switch', { name: TOGGLE })).toHaveAttribute('aria-checked', 'false');
  await expect(group.getByRole('button', { name: 'Send a test notification' })).toHaveCount(0);
  expect((await adminStatus()).Devices).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('__lumen_e2e_push'))).toBeNull();
});

test('a tapped notification takes an open Lumen to the title', async ({ page, context }) => {
  const subscription = newSubscription();
  await context.grantPermissions(['notifications']);
  await fakeBrowserSubscription(page, subscription);
  await login(page, ADMIN);
  await page.goto('/web/#/home?lumen=requests');
  await page.getByRole('switch', { name: TOGGLE }).click();
  await expect(page.getByRole('switch', { name: TOGGLE })).toHaveAttribute('aria-checked', 'true');
  const itemId = loadState().items['Lumen Beta']!.replace(/-/g, '');

  // The worker shows "ready to watch" for a title in the library, and its notification is tapped.
  await deliver(context, { v: 1, kind: 'ready', title: 'Lumen Beta is ready to watch', item: itemId, tag: 'lumen-ready-movie-1' });
  await lumenWorker(context).evaluate(async () => {
    // The worker's own globals (the tests are typed for a page).
    const scope = self as unknown as {
      registration: { getNotifications(): Promise<Notification[]> };
      NotificationEvent: new (type: string, init: { notification: Notification }) => Event & { waitUntil(p: Promise<unknown>): void };
      dispatchEvent(event: Event): boolean;
    };
    const [notification] = await scope.registration.getNotifications();
    const event = new scope.NotificationEvent('notificationclick', { notification: notification! });
    let waited: Promise<unknown> = Promise.resolve();
    const waitUntil = event.waitUntil.bind(event);
    event.waitUntil = (promise) => {
      waited = promise;
      waitUntil(promise);
    };
    scope.dispatchEvent(event);
    // Bringing the window forward needs a real tap; the worker has asked the page for the title by then.
    await waited.catch(() => undefined);
  });

  // The worker doesn't control the page, so it asked it to go there: the title's library page, in the same window.
  await expect(page).toHaveURL(new RegExp(`#/details\\?id=${itemId}$`));
  await expect(page.getByRole('heading', { name: 'Lumen Beta', level: 1 })).toBeVisible();
  expect(context.pages()).toHaveLength(1);
});

test('after the keys are reset, the device subscribes again by itself, with the new key and without asking', async ({ page, context }) => {
  test.setTimeout(90_000);
  const [before, after] = [newSubscription(), newSubscription()];
  await context.grantPermissions(['notifications']);
  await fakeBrowserSubscription(page, before, after);
  await login(page, ADMIN);
  await page.goto('/web/#/home?lumen=requests');
  await page.getByRole('switch', { name: TOGGLE }).click();
  await expect(page.getByRole('switch', { name: TOGGLE })).toHaveAttribute('aria-checked', 'true');
  const oldKey = await publicKey();
  expect(await page.evaluate(() => localStorage.getItem('__lumen_e2e_push'))).toBe(oldKey);
  expect((await deviceStatus(page)).Endpoint).toBe(before.endpoint);

  // The admin replaces Web Push's keys: every subscription is dropped, and the browser's was made with the old key.
  await api('/Lumen/Admin/Push/ResetKeys', { method: 'POST', token: loadState().admin.token });
  const newKey = await publicKey();
  expect(newKey).not.toBe(oldKey);
  expect((await adminStatus()).Devices).toBe(0);

  // The next page load, anywhere in Lumen (the toggle isn't on this page): the device's own check, when the browser
  // is idle, gives up the old subscription and makes one with the new key.
  await page.goto('/web/#/home');
  await page.reload();
  await expect.poll(async () => (await adminStatus()).Devices, { timeout: 30_000 }).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem('__lumen_e2e_push'))).toBe(newKey);
  expect(await page.evaluate(() => localStorage.getItem('__lumen_e2e_push_count'))).toBe('2');
  expect((await deviceStatus(page)).Endpoint).toBe(after.endpoint);
  await page.goto('/web/#/home?lumen=requests');
  await expect(page.getByRole('switch', { name: TOGGLE })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('button', { name: 'Send a test notification' })).toBeVisible();
  // (No test is sent here: Lumen allows a user five in ten minutes, and the specs that need one share them.)
});

test('a device the push service gave up on is off, and subscribes afresh on the next load, never posting the dead one back', async ({ page, context }) => {
  test.setTimeout(120_000);
  // The stub push service answers 410 for the first subscription the browser hands out: it has expired.
  const [dead, fresh] = [newSubscription(`gone-${Date.now()}`), newSubscription()];
  await context.grantPermissions(['notifications']);
  await fakeBrowserSubscription(page, dead, fresh);
  await login(page, ADMIN);
  await page.goto('/web/#/home?lumen=requests');
  const toggle = page.getByRole('switch', { name: TOGGLE });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  const key = await publicKey();

  // A test finds out: the server drops the device, and the switch says what's true, with what to do about it.
  await expect(async () => {
    await page.getByRole('button', { name: 'Send a test notification' }).click();
    await expect(page.getByRole('status')).toHaveText("This device's notifications had expired and were turned off. Turn them on again.", { timeout: 3_000 });
  }).toPass({ timeout: 40_000, intervals: [4_000] });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  expect((await adminStatus()).Devices).toBe(0);
  expect(await pushed(dead)).toHaveLength(1);

  // The browser still has that subscription, made with the very key the server still uses. The next page load must
  // not hand it back to the server: it gives it up and subscribes anew (the permission still stands).
  const posted: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/Lumen\/Push\/Subscription$/.test(request.url())) posted.push((request.postDataJSON() as { Endpoint: string }).Endpoint);
  });
  await page.reload();
  await expect.poll(async () => (await adminStatus()).Devices, { timeout: 30_000 }).toBe(1);
  expect(posted).toEqual([fresh.endpoint]);
  expect((await deviceStatus(page)).Endpoint).toBe(fresh.endpoint);
  expect(await publicKey()).toBe(key);
  await expect(page.getByRole('switch', { name: TOGGLE })).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(() => localStorage.getItem('__lumen_e2e_push_count'))).toBe('2');
  // The dead one was never tried again.
  expect(await pushed(dead)).toHaveLength(1);
});

test('the permission prompt comes from the tap on the switch, first thing, and from nowhere else', async ({ page }) => {
  test.setTimeout(90_000);
  const [first, second] = [newSubscription(), newSubscription()];
  await recordPermissionPrompts(page);
  await fakeBrowserSubscription(page, first, second);
  await login(page, ADMIN);

  // Looking at the toggle, on either page it's on, and loading Lumen again: nothing asks.
  await page.goto('/web/#/home?lumen=requests');
  const toggle = page.getByRole('switch', { name: TOGGLE });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  expect((await promptsOf(page)).prompts).toEqual([]);
  await page.goto('/web/#/mypreferencesmenu');
  await expect(page.getByRole('region', { name: 'Notifications' }).getByRole('switch', { name: TOGGLE })).toHaveAttribute('aria-checked', 'false');
  await page.reload();
  await expect(page.getByRole('region', { name: 'Notifications' }).getByRole('switch', { name: TOGGLE })).toHaveAttribute('aria-checked', 'false');
  expect((await promptsOf(page)).prompts).toEqual([]);
  expect((await adminStatus()).Devices).toBe(0);

  // The tap: one prompt, inside the user's gesture (Safari shows it only then), before the page asked the server
  // anything more.
  await page.goto('/web/#/home?lumen=requests');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  const { pushRequests } = await promptsOf(page);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  expect((await promptsOf(page)).prompts).toEqual([{ duringTap: true, pushRequests }]);
  expect((await adminStatus()).Devices).toBe(1);

  // On from here: loading Lumen again doesn't ask, nor does subscribing again by itself after the server lost the
  // device (its keys were reset).
  await page.reload();
  await expect(page.getByRole('switch', { name: TOGGLE })).toHaveAttribute('aria-checked', 'true');
  await api('/Lumen/Admin/Push/ResetKeys', { method: 'POST', token: loadState().admin.token });
  await page.reload();
  await expect.poll(async () => (await adminStatus()).Devices, { timeout: 30_000 }).toBe(1);
  expect((await deviceStatus(page)).Endpoint).toBe(second.endpoint);
  expect((await promptsOf(page)).prompts).toEqual([]);
});

test('a device the browser blocks says so, and one without the Push API shows no toggle', async ({ page, browser }) => {
  // Notifications refused for the site (in the browser's settings, or at an earlier prompt): what the page is told.
  await page.addInitScript(() => {
    Object.defineProperty(Notification, 'permission', { get: () => 'denied' });
  });
  await login(page, ADMIN);
  await page.goto('/web/#/home?lumen=requests');
  const toggle = page.getByRole('switch', { name: TOGGLE });
  await expect(toggle).toBeDisabled();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByText(/Notifications are blocked for this site/)).toBeVisible();
  expect((await workers(page)).lumen).toBeNull();
  await expectAccessible(page, 'blocked');

  // A browser without the Push API (a TV's, Safari 13): the page is as it was before notifications.
  const old = await browser.newContext();
  const oldPage = await old.newPage();
  await oldPage.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).PushManager;
  });
  const status = oldPage.waitForResponse(/\/Lumen\/Requests\/Mine\b/);
  await login(oldPage, ADMIN);
  await oldPage.goto('/web/#/home?lumen=requests');
  await status;
  await expect(oldPage.getByRole('heading', { name: 'My requests', level: 1 })).toBeVisible();
  await expect(oldPage.getByText(TOGGLE)).toHaveCount(0);
  await old.close();
});
