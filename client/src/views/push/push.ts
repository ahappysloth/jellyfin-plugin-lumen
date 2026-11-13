import type { JellyfinApiClient } from '../../compat/jellyfin';
import { registerSessionCache } from '../../util/sessionCaches';
import { withTimeout } from '../../util/withTimeout';
import type { ViewContext } from '../context';
import { PUSH_FLAG, pushFlag } from './lazyPush';

/**
 * Push notifications for this device (web push design note, 2026-11-12): Lumen's own service worker, registered at
 * <server>/Lumen/Push/ (never jellyfin-web's, at /web/), the browser's push subscription, and the server's record of
 * it. Off until the user turns it on; the browser's permission is only ever asked for from that tap.
 *
 * - `on`: the browser allows notifications, has a subscription, and the server has that same one for this device.
 * - `off`: it could be turned on.
 * - `blocked`: the user (or the browser) refused notifications for this site; only the browser's settings undo that.
 * - `homeScreen`: an iPhone or iPad in Safari, where only the Home Screen app can get notifications.
 * - `none`: nothing to show: no Push API here, no request features for this user, or another origin's server.
 */
export type PushState = 'on' | 'off' | 'blocked' | 'homeScreen' | 'none';

export interface PushStatus {
  Available: boolean;
  /** Absent without request features. */
  PublicKey?: string | null;
  /** The push address the server has for this device; absent when it has none. */
  Endpoint?: string | null;
}

type Ctx = Pick<ViewContext, 'client' | 'userId' | 'navigate'>;

/** How long registering the worker, or the push service's answer, may take before the toggle gives up. */
const STEP_TIMEOUT_MS = 20_000;

const WORKER_PATH = 'Lumen/Push/sw.js';
const SCOPE_PATH = 'Lumen/Push/';

export function pushSupported(win: Window = window): boolean {
  return 'serviceWorker' in win.navigator && 'PushManager' in win && 'Notification' in win;
}

/** An iPhone, iPod or iPad (which calls itself a Mac, but has a touch screen). */
export function isIos(nav: Navigator = navigator): boolean {
  return /iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
}

/** iOS 16.4 brought Web Push to Home Screen apps; older ones would add the app and still find no notifications. */
export function iosHasWebPush(nav: Navigator = navigator): boolean {
  const version = /OS (\d+)_(\d+)/.exec(nav.userAgent) ?? /Version\/(\d+)\.(\d+)/.exec(nav.userAgent);
  if (!version) return false;
  const major = Number(version[1]);
  return major > 16 || (major === 16 && Number(version[2]) >= 4);
}

/** Opened from the Home Screen (or installed), not in a browser tab. */
export function isStandalone(win: Window = window): boolean {
  return (
    (win.navigator as Navigator & { standalone?: boolean }).standalone === true ||
    (typeof win.matchMedia === 'function' && win.matchMedia('(display-mode: standalone)').matches)
  );
}

/**
 * The worker's and its scope's addresses, or null when the server is another origin than the page (a hosted web
 * client): a worker can only be registered for the page's own origin.
 */
export function workerUrls(
  client: Pick<JellyfinApiClient, 'getUrl'>,
  loc: Location = window.location,
): { script: string; scope: string } | null {
  try {
    const script = new URL(client.getUrl(WORKER_PATH), loc.href);
    const scope = new URL(client.getUrl(SCOPE_PATH), loc.href);
    return script.origin === loc.origin ? { script: script.href, scope: scope.href } : null;
  } catch {
    return null;
  }
}

/** base64url (the server's public key) to the bytes `pushManager.subscribe` takes. */
export function keyBytes(key: string): Uint8Array<ArrayBuffer> {
  const base64 = key.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64 + '==='.slice((base64.length + 3) % 4));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Whether a subscription was made with this server key (unknown counts as yes: Safari before 16.4 has no `options`). */
export function madeWithKey(subscription: PushSubscription, key: string): boolean {
  const used = subscription.options?.applicationServerKey;
  if (!used) return true;
  const a = new Uint8Array(used);
  const b = keyBytes(key);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** A call with a JSON answer (jellyfin-web's ajax parses it only when asked, and chokes on an empty one if asked). */
function getJson<T>(client: JellyfinApiClient, type: 'GET' | 'POST', path: string): Promise<T> {
  return client.ajax({ type, url: client.getUrl(path), dataType: 'json' }) as Promise<T>;
}

/** A call whose answer is empty (204). */
function send(
  client: JellyfinApiClient,
  type: 'POST' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<unknown> {
  return client.ajax({
    type,
    url: client.getUrl(path),
    ...(body === undefined ? {} : { data: JSON.stringify(body), contentType: 'application/json' }),
  });
}

export function getPushStatus(client: JellyfinApiClient): Promise<PushStatus> {
  return getJson(client, 'GET', 'Lumen/Push/Status');
}

const changeListeners = new Set<() => void>();

/**
 * Calls `listener` when this device's subscription changes behind the toggle's back: the check on load subscribed
 * again, or found the permission gone. Returns the way to stop listening.
 */
export function onPushChange(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => void changeListeners.delete(listener);
}

function setFlag(userId: string | null): void {
  try {
    if (userId) window.localStorage.setItem(PUSH_FLAG, userId);
    else window.localStorage.removeItem(PUSH_FLAG);
  } catch {
    // storage blocked: the next page load won't check the subscription, which still works
  }
}

async function registration(client: JellyfinApiClient): Promise<ServiceWorkerRegistration | undefined> {
  const urls = workerUrls(client);
  return urls ? navigator.serviceWorker.getRegistration(urls.scope) : undefined;
}

async function browserSubscription(client: JellyfinApiClient): Promise<PushSubscription | null> {
  const reg = await registration(client);
  return reg ? reg.pushManager.getSubscription() : null;
}

/** Resolves once the registration has an active worker (a subscription needs one). */
function whenActive(reg: ServiceWorkerRegistration): Promise<void> {
  if (reg.active) return Promise.resolve();
  const worker = reg.installing ?? reg.waiting;
  return new Promise<void>((resolve, reject) => {
    if (!worker) return reject(new Error('no worker'));
    const check = (): void => {
      if (worker.state === 'activated') resolve();
      else if (worker.state === 'redundant') reject(new Error('worker failed'));
    };
    worker.addEventListener('statechange', check);
    check();
  });
}

/** Safari 15 and older take a callback; everything else returns a promise. */
function askPermission(): Promise<NotificationPermission> {
  return new Promise((resolve) => {
    const asked = Notification.requestPermission(resolve) as Promise<NotificationPermission> | undefined;
    if (asked && typeof asked.then === 'function')
      asked.then(resolve, () => resolve(Notification.permission));
  });
}

/** What the toggle shows for this device right now. */
export async function readPushState(ctx: Ctx): Promise<PushState> {
  if (!pushSupported()) {
    return isIos() && iosHasWebPush() && !isStandalone() ? 'homeScreen' : 'none';
  }
  if (!workerUrls(ctx.client)) return 'none';
  const status = await getPushStatus(ctx.client);
  if (!status.Available || !status.PublicKey) return 'none';
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission !== 'granted' || !status.Endpoint) return 'off';
  const subscription = await browserSubscription(ctx.client);
  return subscription && subscription.endpoint === status.Endpoint ? 'on' : 'off';
}

/** Registers the worker, subscribes (again, if the server's key changed) and tells the server. */
async function subscribe(ctx: Ctx, publicKey: string): Promise<void> {
  const urls = workerUrls(ctx.client);
  if (!urls) throw new Error('another origin');
  const reg = await navigator.serviceWorker.register(urls.script, { scope: urls.scope });
  await withTimeout(whenActive(reg), STEP_TIMEOUT_MS);
  let subscription = await reg.pushManager.getSubscription();
  // A subscription made with another key (the admin replaced the server's) can't be sent to, or subscribed over.
  if (subscription && !madeWithKey(subscription, publicKey)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await withTimeout(
    reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }),
    STEP_TIMEOUT_MS,
  );
  const keys = subscription.toJSON().keys ?? {};
  try {
    await send(ctx.client, 'POST', 'Lumen/Push/Subscription', {
      Endpoint: subscription.endpoint,
      P256dh: keys.p256dh,
      Auth: keys.auth,
      Locale: navigator.language,
    });
  } catch (error) {
    // The server didn't take it: don't leave the browser subscribed to nothing.
    await subscription.unsubscribe().catch(() => undefined);
    throw error;
  }
  setFlag(ctx.userId);
  listenForOpen(ctx);
  changeListeners.forEach((listener) => listener());
}

/**
 * Turns notifications on, from the toggle's tap: the permission prompt comes first, while the tap still counts as the
 * user's gesture (Safari refuses it after anything asynchronous).
 */
export async function enablePush(ctx: Ctx): Promise<PushState> {
  const permission = Notification.permission === 'granted' ? 'granted' : await askPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off';
  const status = await getPushStatus(ctx.client);
  if (!status.Available || !status.PublicKey) return 'none';
  await subscribe(ctx, status.PublicKey);
  return 'on';
}

/** Turns notifications off for this device: on the server first, then in the browser. */
export async function disablePush(ctx: Ctx): Promise<PushState> {
  await send(ctx.client, 'DELETE', 'Lumen/Push/Subscription');
  setFlag(null);
  const subscription = await browserSubscription(ctx.client).catch(() => null);
  await subscription?.unsubscribe().catch(() => undefined);
  return 'off';
}

/** Sends this device a test. Resolves to null when the push service took it, else what to tell the user. */
export async function sendPushTest(ctx: Ctx): Promise<{ ok: boolean; error: string | null; wait: boolean }> {
  try {
    const result = await getJson<{ Ok: boolean; Error?: string | null }>(
      ctx.client,
      'POST',
      'Lumen/Push/Test',
    );
    return { ok: result.Ok, error: result.Error ?? null, wait: false };
  } catch (error) {
    return { ok: false, error: null, wait: (error as Response | undefined)?.status === 429 };
  }
}

let listening: Ctx | null = null;
let listenedOn: ServiceWorkerContainer | null = null;

/**
 * A tapped notification, with Lumen already open: the worker asks for the page (it can't navigate a page it doesn't
 * control). Only Lumen's own hashes are followed.
 */
function listenForOpen(ctx: Ctx): void {
  listening = ctx;
  if (listenedOn === navigator.serviceWorker) return;
  listenedOn = navigator.serviceWorker;
  listenedOn.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as { type?: unknown; hash?: unknown } | null;
    if (data?.type === 'lumen-push-open' && typeof data.hash === 'string' && data.hash.indexOf('#/') === 0)
      listening?.navigate(data.hash);
  });
}

let resumed: string | null = null;

/**
 * On a device where notifications were turned on (lazyPush.tsx runs this once the first page is up):
 * - another user is signed in now: this browser stops being subscribed, so the first user's notifications don't
 *   arrive in front of the second;
 * - the permission was taken away in the browser's settings: the server forgets the device;
 * - the subscription is gone or changed, or the server no longer has it (its keys were replaced): subscribe again,
 *   quietly, as the permission still stands.
 */
export async function resumePush(ctx: Ctx): Promise<void> {
  const owner = pushFlag();
  if (!owner || resumed === ctx.userId || !pushSupported() || !workerUrls(ctx.client)) return;
  resumed = ctx.userId;
  if (owner !== ctx.userId) {
    setFlag(null);
    const subscription = await browserSubscription(ctx.client).catch(() => null);
    await subscription?.unsubscribe().catch(() => undefined);
    return;
  }
  const status = await getPushStatus(ctx.client);
  // No request features right now (Seerr may only be down): leave everything as it is.
  if (!status.Available || !status.PublicKey) return;
  if (Notification.permission !== 'granted') {
    setFlag(null);
    await send(ctx.client, 'DELETE', 'Lumen/Push/Subscription').catch(() => undefined);
    changeListeners.forEach((listener) => listener());
    return;
  }
  const subscription = await browserSubscription(ctx.client);
  if (
    subscription &&
    subscription.endpoint === status.Endpoint &&
    madeWithKey(subscription, status.PublicKey)
  ) {
    listenForOpen(ctx);
    return;
  }
  await subscribe(ctx, status.PublicKey);
}

registerSessionCache(() => {
  resumed = null;
});
