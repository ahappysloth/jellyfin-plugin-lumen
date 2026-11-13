import { vi } from 'vitest';
import type { AjaxRequest } from '../src/compat/jellyfin';
import { createFakeClient, type FakeClient } from './fakeClient';

/** A server public key as the server sends it (base64url of 65 bytes: an uncompressed point). */
export const SERVER_KEY = btoa(String.fromCharCode(4, ...Array.from({ length: 64 }, (_, i) => i)))
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/, '');
export const OTHER_KEY = SERVER_KEY.replace(/^B/, 'C');
export const ENDPOINT = 'https://web.push.apple.com/QGdevice';

export interface FakeSubscription {
  endpoint: string;
  options: { applicationServerKey: ArrayBuffer | null };
  toJSON: () => { keys: Record<string, string> };
  unsubscribe: ReturnType<typeof vi.fn>;
}

export interface FakePush {
  /** The browser's subscription for Lumen's worker, or null. */
  subscription: FakeSubscription | null;
  /** Whether Lumen's worker is registered. */
  registered: boolean;
  /** What the permission prompt answers. */
  answer: NotificationPermission;
  register: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  requestPermission: ReturnType<typeof vi.fn>;
  /** Listeners for the worker's messages (navigator.serviceWorker). */
  messages: ((event: MessageEvent) => void)[];
  remove: () => void;
}

function bytes(key: string): ArrayBuffer {
  const raw = atob(key.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0)).buffer;
}

/**
 * The browser's side of Web Push, which jsdom doesn't have: the permission, a service worker registration and its
 * push subscription. `key` is the server key an existing subscription was made with.
 */
export function installPush(
  options: {
    permission?: NotificationPermission;
    answer?: NotificationPermission;
    endpoint?: string | null;
    key?: string;
  } = {},
): FakePush {
  const make = (endpoint: string, key: string): FakeSubscription => {
    const subscription: FakeSubscription = {
      endpoint,
      options: { applicationServerKey: bytes(key) },
      toJSON: () => ({ keys: { p256dh: 'p256-key', auth: 'auth-secret' } }),
      unsubscribe: vi.fn(async () => {
        if (push.subscription === subscription) push.subscription = null;
        return true;
      }),
    };
    return subscription;
  };
  const registration = {
    active: {},
    pushManager: {
      getSubscription: vi.fn(async () => push.subscription),
      subscribe: vi.fn(async (o: { applicationServerKey: Uint8Array }) => {
        const key = btoa(String.fromCharCode(...Array.from(o.applicationServerKey)))
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');
        return (push.subscription = make(ENDPOINT, key));
      }),
    },
  };
  const notification = {
    permission: options.permission ?? 'default',
    requestPermission: vi.fn(async () => (notification.permission = push.answer)),
  };
  const push: FakePush = {
    subscription: options.endpoint ? make(options.endpoint, options.key ?? SERVER_KEY) : null,
    registered: !!options.endpoint,
    answer: options.answer ?? 'granted',
    register: vi.fn(async () => {
      push.registered = true;
      return registration;
    }),
    subscribe: registration.pushManager.subscribe,
    requestPermission: notification.requestPermission,
    messages: [],
    remove: () => {
      delete (window as unknown as Record<string, unknown>).PushManager;
      delete (window as unknown as Record<string, unknown>).Notification;
      delete (navigator as unknown as Record<string, unknown>).serviceWorker;
    },
  };
  Object.defineProperty(window, 'PushManager', { configurable: true, value: function PushManager() {} });
  Object.defineProperty(window, 'Notification', { configurable: true, value: notification });
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      register: push.register,
      getRegistration: vi.fn(async () => (push.registered ? registration : undefined)),
      addEventListener: (type: string, listener: (event: MessageEvent) => void) => {
        if (type === 'message') push.messages.push(listener);
      },
    },
  });
  return push;
}

/**
 * A fake ApiClient on the page's own origin (a worker can only be registered there) with Lumen's push endpoints:
 * `server.endpoint` is the push address the server has stored for this device.
 */
export function createPushClient(
  server: { available?: boolean; endpoint?: string | null; key?: string; test?: unknown } = {},
): FakeClient & { server: { endpoint: string | null } } {
  const state = { endpoint: server.endpoint ?? null };
  const client = createFakeClient((request: AjaxRequest) => {
    const path = new URL(request.url).pathname.slice(1);
    if (path === 'Lumen/Push/Status')
      return server.available === false
        ? { Available: false, Endpoint: state.endpoint ?? undefined }
        : { Available: true, PublicKey: server.key ?? SERVER_KEY, Endpoint: state.endpoint ?? undefined };
    if (path === 'Lumen/Push/Subscription') {
      // As jellyfin-web's ajax: asked for JSON, it parses the answer, and this one is empty (204).
      if (request.dataType === 'json') return Promise.reject(new SyntaxError('Unexpected end of JSON input'));
      state.endpoint =
        request.type === 'POST' ? (JSON.parse(request.data!) as { Endpoint: string }).Endpoint : null;
      return undefined;
    }
    if (path === 'Lumen/Push/Test')
      return typeof server.test === 'function'
        ? (server.test as () => unknown)()
        : (server.test ?? { Ok: true });
    return Promise.reject(new Error(`unexpected request: ${request.type} ${path}`));
  }) as FakeClient & { server: { endpoint: string | null } };
  client.getUrl = (name) => `${window.location.origin}/${name}`;
  client.server = state;
  return client;
}
