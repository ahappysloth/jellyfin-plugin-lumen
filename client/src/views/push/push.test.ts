import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient } from '../../../test/fakeClient';
import {
  createPushClient,
  ENDPOINT,
  type FakePush,
  installPush,
  OTHER_KEY,
  SERVER_KEY,
} from '../../../test/fakePush';
import { makeContext } from '../../../test/viewContext';
import { resetSessionCaches } from '../../util/sessionCaches';
import { PUSH_FLAG } from './lazyPush';
import {
  disablePush,
  enablePush,
  iosHasWebPush,
  isIos,
  isStandalone,
  keyBytes,
  madeWithKey,
  pushSupported,
  readPushState,
  resumePush,
  sendPushTest,
  workerUrls,
} from './push';

const IPHONE_17 =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPHONE_16_3 = IPHONE_17.replace('OS 17_5', 'OS 16_3').replace('Version/17.5', 'Version/16.3');
const IPAD_AS_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';

const nav = (userAgent: string, platform = 'iPhone', maxTouchPoints = 5) =>
  ({ userAgent, platform, maxTouchPoints }) as Navigator;

let push: FakePush | null = null;

beforeEach(() => localStorage.clear());
afterEach(() => {
  push?.remove();
  push = null;
  resetSessionCaches();
  vi.unstubAllGlobals();
});

describe('what the device can do', () => {
  it('has no Web Push without a service worker, the Push API or notifications', () => {
    expect(pushSupported()).toBe(false);
    push = installPush();
    expect(pushSupported()).toBe(true);
  });

  it('knows an iPhone, and an iPad calling itself a Mac, from a Mac', () => {
    expect(isIos(nav(IPHONE_17))).toBe(true);
    expect(isIos(nav(IPAD_AS_MAC, 'MacIntel', 5))).toBe(true);
    expect(isIos(nav(IPAD_AS_MAC, 'MacIntel', 0))).toBe(false);
  });

  it('knows which iOS versions can notify a Home Screen app at all (16.4 and later)', () => {
    expect(iosHasWebPush(nav(IPHONE_17))).toBe(true);
    expect(iosHasWebPush(nav(IPHONE_16_3))).toBe(false);
    expect(iosHasWebPush(nav(IPHONE_17.replace('OS 17_5', 'OS 16_4')))).toBe(true);
    expect(iosHasWebPush(nav(IPAD_AS_MAC, 'MacIntel'))).toBe(true);
    expect(iosHasWebPush(nav('Mozilla/5.0'))).toBe(false);
  });

  it('knows the Home Screen app from a browser tab', () => {
    const tab = { navigator: {}, matchMedia: () => ({ matches: false }) } as unknown as Window;
    const ios = {
      navigator: { standalone: true },
      matchMedia: () => ({ matches: false }),
    } as unknown as Window;
    const installed = { navigator: {}, matchMedia: () => ({ matches: true }) } as unknown as Window;
    expect([isStandalone(tab), isStandalone(ios), isStandalone(installed)]).toEqual([false, true, true]);
  });

  it("registers Lumen's worker under /Lumen/Push/, never over jellyfin-web's at /web/", () => {
    const loc = { href: 'https://jf.example/web/index.html', origin: 'https://jf.example' } as Location;
    const client = { getUrl: (name: string) => `https://jf.example/base/${name}` };

    expect(workerUrls(client, loc)).toEqual({
      script: 'https://jf.example/base/Lumen/Push/sw.js',
      scope: 'https://jf.example/base/Lumen/Push/',
    });
  });

  it("has no worker for a server on another origin than the page's", () => {
    const loc = { href: 'https://app.example/web/index.html', origin: 'https://app.example' } as Location;

    expect(workerUrls({ getUrl: (name: string) => `https://jf.example/${name}` }, loc)).toBeNull();
    expect(workerUrls({ getUrl: () => 'http://[' }, loc)).toBeNull();
  });

  it("turns the server's key into the bytes a subscription takes, and tells a subscription made with another", () => {
    expect(Array.from(keyBytes(SERVER_KEY)).slice(0, 4)).toEqual([4, 0, 1, 2]);
    expect(keyBytes(SERVER_KEY)).toHaveLength(65);

    const made = (key: ArrayBuffer | null) =>
      ({ options: { applicationServerKey: key } }) as PushSubscription;
    expect(madeWithKey(made(keyBytes(SERVER_KEY).buffer), SERVER_KEY)).toBe(true);
    expect(madeWithKey(made(keyBytes(OTHER_KEY).buffer), SERVER_KEY)).toBe(false);
    expect(madeWithKey(made(new ArrayBuffer(3)), SERVER_KEY)).toBe(false);
    // A browser that doesn't say: assume it matches rather than resubscribe on every load.
    expect(madeWithKey(made(null), SERVER_KEY)).toBe(true);
    expect(madeWithKey({} as PushSubscription, SERVER_KEY)).toBe(true);
  });
});

describe('readPushState', () => {
  it('is none without the Push API, and asks the server nothing', async () => {
    const client = createPushClient();

    expect(await readPushState(makeContext(client))).toBe('none');
    expect(client.requests).toHaveLength(0);
  });

  it('says an iPhone in Safari needs the Home Screen app, but not one too old for it, nor the app itself', async () => {
    const ctx = makeContext(createPushClient());
    const as = (userAgent: string, standalone: boolean) => {
      vi.stubGlobal('navigator', { userAgent, platform: 'iPhone', maxTouchPoints: 5, standalone });
    };

    as(IPHONE_17, false);
    expect(await readPushState(ctx)).toBe('homeScreen');
    as(IPHONE_16_3, false);
    expect(await readPushState(ctx)).toBe('none');
    // In the Home Screen app without a Push API (notifications switched off for web apps): nothing to offer.
    as(IPHONE_17, true);
    expect(await readPushState(ctx)).toBe('none');
  });

  it('is none for a server on another origin, or a user without request features', async () => {
    push = installPush();

    expect(await readPushState(makeContext(createFakeClient()))).toBe('none');
    expect(await readPushState(makeContext(createPushClient({ available: false })))).toBe('none');
  });

  it('is off until the user turns it on', async () => {
    push = installPush();

    expect(await readPushState(makeContext(createPushClient()))).toBe('off');
    expect(push.requestPermission).not.toHaveBeenCalled();
    expect(push.register).not.toHaveBeenCalled();
  });

  it('is blocked when the browser refuses notifications for the site', async () => {
    push = installPush({ permission: 'denied' });

    expect(await readPushState(makeContext(createPushClient({ endpoint: ENDPOINT })))).toBe('blocked');
  });

  it('is on only when the browser and the server hold the same subscription', async () => {
    push = installPush({ permission: 'granted', endpoint: ENDPOINT });

    expect(await readPushState(makeContext(createPushClient({ endpoint: ENDPOINT })))).toBe('on');
    // The server lost it (its keys were reset), or has an older address.
    expect(await readPushState(makeContext(createPushClient()))).toBe('off');
    expect(
      await readPushState(makeContext(createPushClient({ endpoint: 'https://web.push.apple.com/old' }))),
    ).toBe('off');
    // The browser lost it.
    push.subscription = null;
    expect(await readPushState(makeContext(createPushClient({ endpoint: ENDPOINT })))).toBe('off');
  });
});

describe('enablePush', () => {
  it('asks for the permission first, then registers the worker, subscribes and tells the server', async () => {
    push = installPush();
    const client = createPushClient();
    const order: string[] = [];
    push.requestPermission.mockImplementation(async () => {
      order.push(`permission (after ${client.requests.length} requests)`);
      return ((window.Notification as unknown as { permission: string }).permission = 'granted');
    });
    push.register.mockImplementationOnce(async (...args: unknown[]) => {
      order.push('register');
      push!.registered = true;
      return (await navigator.serviceWorker.getRegistration(args[0] as string))!;
    });
    const ctx = makeContext(client);

    expect(await enablePush(ctx)).toBe('on');

    // The prompt opens straight from the tap, before anything is fetched.
    expect(order).toEqual(['permission (after 0 requests)', 'register']);
    expect(push.register).toHaveBeenCalledWith(`${location.origin}/Lumen/Push/sw.js`, {
      scope: `${location.origin}/Lumen/Push/`,
    });
    const options = push.subscribe.mock.calls[0]![0] as {
      userVisibleOnly: boolean;
      applicationServerKey: Uint8Array;
    };
    expect(options.userVisibleOnly).toBe(true);
    expect(Array.from(options.applicationServerKey)).toEqual(Array.from(keyBytes(SERVER_KEY)));
    const posted = client.requests.find((r) => r.type === 'POST')!;
    expect(new URL(posted.url).pathname).toBe('/Lumen/Push/Subscription');
    // The server answers 204: jellyfin-web's ajax must not be asked to parse it (it would reject the empty body).
    expect(posted.dataType).toBeUndefined();
    expect(JSON.parse(posted.data!)).toEqual({
      Endpoint: ENDPOINT,
      P256dh: 'p256-key',
      Auth: 'auth-secret',
      Locale: navigator.language,
    });
    expect(localStorage.getItem(PUSH_FLAG)).toBe(ctx.userId);
    expect(await readPushState(ctx)).toBe('on');
  });

  it('is blocked when the user refuses, and stays off when they close the prompt', async () => {
    push = installPush({ answer: 'denied' });
    const client = createPushClient();
    expect(await enablePush(makeContext(client))).toBe('blocked');

    push.remove();
    push = installPush({ answer: 'default' });
    expect(await enablePush(makeContext(client))).toBe('off');

    expect(push.register).not.toHaveBeenCalled();
    expect(client.requests.filter((r) => r.type === 'POST')).toHaveLength(0);
    expect(localStorage.getItem(PUSH_FLAG)).toBeNull();
  });

  it("doesn't ask again when the permission is already there", async () => {
    push = installPush({ permission: 'granted' });

    expect(await enablePush(makeContext(createPushClient()))).toBe('on');
    expect(push.requestPermission).not.toHaveBeenCalled();
  });

  it("replaces a subscription made with another server key (the admin reset the server's)", async () => {
    push = installPush({ permission: 'granted', endpoint: 'https://web.push.apple.com/old', key: OTHER_KEY });
    const old = push.subscription!;
    const client = createPushClient();

    expect(await enablePush(makeContext(client))).toBe('on');

    expect(old.unsubscribe).toHaveBeenCalled();
    expect(push.subscribe).toHaveBeenCalledTimes(1);
    expect(client.server.endpoint).toBe(ENDPOINT);
  });

  it('keeps a subscription that still stands, and only tells the server', async () => {
    push = installPush({ permission: 'granted', endpoint: ENDPOINT });
    const client = createPushClient();

    expect(await enablePush(makeContext(client))).toBe('on');

    expect(push.subscribe).not.toHaveBeenCalled();
    expect(client.server.endpoint).toBe(ENDPOINT);
  });

  it("doesn't leave the browser subscribed when the server refuses the subscription", async () => {
    push = installPush({ permission: 'granted' });
    const client = createPushClient();
    const respond = client.respond;
    client.respond = (request) =>
      request.type === 'POST' ? Promise.reject(new Response(null, { status: 400 })) : respond(request);

    await expect(enablePush(makeContext(client))).rejects.toBeInstanceOf(Response);

    expect(push.subscription).toBeNull();
    expect(localStorage.getItem(PUSH_FLAG)).toBeNull();
  });
});

describe('disablePush', () => {
  it('removes the subscription from the server and the browser', async () => {
    push = installPush({ permission: 'granted', endpoint: ENDPOINT });
    const subscription = push.subscription!;
    const client = createPushClient({ endpoint: ENDPOINT });
    localStorage.setItem(PUSH_FLAG, 'user1');

    expect(await disablePush(makeContext(client))).toBe('off');

    expect(client.requests.map((r) => `${r.type} ${new URL(r.url).pathname}`)).toEqual([
      'DELETE /Lumen/Push/Subscription',
    ]);
    expect(client.server.endpoint).toBeNull();
    expect(subscription.unsubscribe).toHaveBeenCalled();
    expect(localStorage.getItem(PUSH_FLAG)).toBeNull();
  });

  it('leaves everything as it was when the server cannot be told', async () => {
    push = installPush({ permission: 'granted', endpoint: ENDPOINT });
    const client = createPushClient({ endpoint: ENDPOINT });
    client.respond = () => Promise.reject(new Response(null, { status: 502 }));
    localStorage.setItem(PUSH_FLAG, 'user1');

    await expect(disablePush(makeContext(client))).rejects.toBeInstanceOf(Response);

    expect(push.subscription).not.toBeNull();
    expect(localStorage.getItem(PUSH_FLAG)).toBe('user1');
  });
});

describe('sendPushTest', () => {
  it("reports the server's answer", async () => {
    expect(await sendPushTest(makeContext(createPushClient({ test: { Ok: true } })))).toEqual({
      ok: true,
      error: null,
      wait: false,
    });
    expect(
      await sendPushTest(makeContext(createPushClient({ test: { Ok: false, Error: 'Expired.' } }))),
    ).toEqual({ ok: false, error: 'Expired.', wait: false });
  });

  it('says to wait when the server limits tests, and fails quietly otherwise', async () => {
    const limited = createPushClient({ test: () => Promise.reject(new Response(null, { status: 429 })) });
    const down = createPushClient({ test: () => Promise.reject(new Response(null, { status: 502 })) });

    expect(await sendPushTest(makeContext(limited))).toEqual({ ok: false, error: null, wait: true });
    expect(await sendPushTest(makeContext(down))).toEqual({ ok: false, error: null, wait: false });
  });
});

describe('resumePush', () => {
  it('does nothing on a device that never turned notifications on', async () => {
    push = installPush({ permission: 'granted', endpoint: ENDPOINT });
    const client = createPushClient();

    await resumePush(makeContext(client));

    expect(client.requests).toHaveLength(0);
    expect(push.messages).toHaveLength(0);
  });

  it('leaves a standing subscription alone, and follows a tapped notification to its page', async () => {
    push = installPush({ permission: 'granted', endpoint: ENDPOINT });
    const client = createPushClient({ endpoint: ENDPOINT });
    const ctx = makeContext(client);
    localStorage.setItem(PUSH_FLAG, ctx.userId);

    await resumePush(ctx);

    expect(client.requests.map((r) => r.type)).toEqual(['GET']);
    expect(push.subscribe).not.toHaveBeenCalled();
    const [listener] = push.messages;
    listener!({ data: { type: 'lumen-push-open', hash: '#/details?id=abc' } } as MessageEvent);
    expect(ctx.navigate).toHaveBeenCalledWith('#/details?id=abc');

    // Only Lumen's own hashes, and only that message.
    listener!({ data: { type: 'lumen-push-open', hash: 'https://evil.example/' } } as MessageEvent);
    listener!({ data: { type: 'lumen-push-open', hash: 'javascript:alert(1)' } } as MessageEvent);
    listener!({ data: { type: 'something-else', hash: '#/home' } } as MessageEvent);
    listener!({ data: null } as MessageEvent);
    expect(ctx.navigate).toHaveBeenCalledTimes(1);
  });

  it('subscribes again, quietly, when the server no longer has the subscription or changed its key', async () => {
    push = installPush({ permission: 'granted', endpoint: 'https://web.push.apple.com/old', key: OTHER_KEY });
    const client = createPushClient();
    const ctx = makeContext(client);
    localStorage.setItem(PUSH_FLAG, ctx.userId);

    await resumePush(ctx);

    expect(push.requestPermission).not.toHaveBeenCalled();
    expect(push.subscribe).toHaveBeenCalledTimes(1);
    expect(client.server.endpoint).toBe(ENDPOINT);
    expect(await readPushState(ctx)).toBe('on');
  });

  it('checks once per session, however many pages mount', async () => {
    push = installPush({ permission: 'granted', endpoint: ENDPOINT });
    const client = createPushClient({ endpoint: ENDPOINT });
    const ctx = makeContext(client);
    localStorage.setItem(PUSH_FLAG, ctx.userId);

    await resumePush(ctx);
    await resumePush(makeContext(client));

    expect(client.requests).toHaveLength(1);
  });

  it("stops this browser's subscription when another user is signed in now", async () => {
    push = installPush({ permission: 'granted', endpoint: ENDPOINT });
    const subscription = push.subscription!;
    const client = createPushClient({ endpoint: null });
    localStorage.setItem(PUSH_FLAG, 'the-user-before');

    await resumePush(makeContext(client));

    // The first user's notifications must not arrive in front of the second: the address is gone for good.
    expect(subscription.unsubscribe).toHaveBeenCalled();
    expect(localStorage.getItem(PUSH_FLAG)).toBeNull();
    expect(client.requests).toHaveLength(0);
    expect(push.subscribe).not.toHaveBeenCalled();
  });

  it('has the server forget the device when the permission was taken away', async () => {
    push = installPush({ permission: 'denied', endpoint: ENDPOINT });
    const client = createPushClient({ endpoint: ENDPOINT });
    const ctx = makeContext(client);
    localStorage.setItem(PUSH_FLAG, ctx.userId);

    await resumePush(ctx);

    expect(client.server.endpoint).toBeNull();
    expect(localStorage.getItem(PUSH_FLAG)).toBeNull();
  });

  it('changes nothing while request features are unavailable (Seerr may only be down)', async () => {
    push = installPush({ permission: 'granted', endpoint: ENDPOINT });
    const client = createPushClient({ available: false, endpoint: ENDPOINT });
    const ctx = makeContext(client);
    localStorage.setItem(PUSH_FLAG, ctx.userId);

    await resumePush(ctx);

    expect(client.server.endpoint).toBe(ENDPOINT);
    expect(push.subscription).not.toBeNull();
    expect(localStorage.getItem(PUSH_FLAG)).toBe(ctx.userId);
  });
});
