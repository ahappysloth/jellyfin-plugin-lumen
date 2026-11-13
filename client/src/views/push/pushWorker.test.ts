import { describe, expect, it, vi } from 'vitest';
import { detailsHash, MY_REQUESTS_HASH } from '../../compat/jellyfin';
import { STOCK_ROUTES } from '../../compat/registry';
import { titleHash } from '../../takeover/routes';
import source from './pushWorker.js?raw';

type Listener = (event: Record<string, unknown>) => void;

interface FakeWindow {
  url: string;
  focused: boolean;
  focus: ReturnType<typeof vi.fn>;
  postMessage: ReturnType<typeof vi.fn>;
}

/** Runs the worker's file as a browser would, at `location`, and hands back what it registered. */
function startWorker(location = 'https://jf.example/Lumen/Push/sw.js', windows: FakeWindow[] = []) {
  const listeners: Record<string, Listener> = {};
  const self = {
    location: { href: location },
    addEventListener: (type: string, listener: Listener) => (listeners[type] = listener),
    skipWaiting: vi.fn(),
    registration: { showNotification: vi.fn(async () => undefined) },
    clients: {
      matchAll: vi.fn(async () => windows),
      openWindow: vi.fn(async () => null),
    },
  };
  new Function('self', source)(self);
  /** Dispatches an event and waits for what the worker asked the browser to wait for. */
  const dispatch = async (type: string, event: Record<string, unknown>): Promise<void> => {
    let waited: Promise<unknown> | undefined;
    listeners[type]!({ ...event, waitUntil: (p: Promise<unknown>) => (waited = p) });
    await waited;
  };
  const push = (payload: unknown) =>
    dispatch('push', {
      data:
        payload === undefined
          ? null
          : {
              json: () => {
                if (typeof payload === 'string') throw new SyntaxError('not JSON');
                return payload;
              },
            },
    });
  const click = (hash?: string) => {
    const notification = { close: vi.fn(), data: hash === undefined ? undefined : { hash } };
    return dispatch('notificationclick', { notification }).then(() => notification);
  };
  return { self, listeners, push, click };
}

const win = (url: string, focused = false): FakeWindow => ({
  url,
  focused,
  focus: vi.fn(async () => undefined),
  postMessage: vi.fn(),
});

describe("Lumen's service worker", () => {
  it('only handles pushes and their taps: it never sees a page or a request', () => {
    const { listeners, self } = startWorker();

    expect(Object.keys(listeners).sort()).toEqual(['install', 'notificationclick', 'push']);
    // A new version replaces the old at once.
    listeners.install!({});
    expect(self.skipWaiting).toHaveBeenCalled();
  });

  it('is plain ES5, as it is served as written', () => {
    expect(source).not.toMatch(/=>|\bconst\b|\blet\b|`|\basync\b|\bawait\b|\?\.|\?\?/);
  });

  it('shows a ready title with its artwork, and remembers its library page', async () => {
    const { self, push } = startWorker();

    await push({
      v: 1,
      kind: 'ready',
      title: 'Dune is ready to watch',
      body: 'It’s in your library now.',
      item: 'abc123',
      image: 'Lumen/Requests/Image/w780/backdrop.jpg?t=user.sig',
      icon: 'Lumen/Assets/lumen-icon-192.png',
      tag: 'lumen-ready-movie-438631',
    });

    expect(self.registration.showNotification).toHaveBeenCalledWith('Dune is ready to watch', {
      body: 'It’s in your library now.',
      icon: 'https://jf.example/Lumen/Assets/lumen-icon-192.png',
      image: 'https://jf.example/Lumen/Requests/Image/w780/backdrop.jpg?t=user.sig',
      tag: 'lumen-ready-movie-438631',
      data: { hash: detailsHash('abc123') },
    });
  });

  it("opens the routes the app itself links to (jellyfin-web's and Lumen's: compat/registry.ts)", async () => {
    const { self, push } = startWorker();
    const hashOf = async (payload: Record<string, unknown>): Promise<string> => {
      self.registration.showNotification.mockClear();
      await push({ title: 'x', ...payload });
      const options = (self.registration.showNotification.mock.calls[0] as unknown[])[1];
      return (options as { data: { hash: string } }).data.hash;
    };

    expect(await hashOf({ item: 'abc 123' })).toBe(detailsHash('abc 123'));
    expect(await hashOf({ key: 'movie-603' })).toBe(titleHash('movie', 603));
    expect(await hashOf({ key: 'tv-1399' })).toBe(titleHash('tv', 1399));
    expect(await hashOf({ page: 'requests' })).toBe(MY_REQUESTS_HASH);
    expect(await hashOf({})).toBe(`#${STOCK_ROUTES.home}`);
    expect(await hashOf({ page: 'somewhere-else' })).toBe(`#${STOCK_ROUTES.home}`);
  });

  it("resolves the server's paths under its base URL", async () => {
    const { self, push } = startWorker('https://jf.example/jellyfin/Lumen/Push/sw.js');

    await push({ title: 'x', image: 'Lumen/Requests/Image/w780/a.jpg?t=1' });

    const options = (self.registration.showNotification.mock.calls[0] as unknown[])[1] as Record<
      string,
      string
    >;
    expect(options.icon).toBe('https://jf.example/jellyfin/Lumen/Assets/lumen-icon-192.png');
    expect(options.image).toBe('https://jf.example/jellyfin/Lumen/Requests/Image/w780/a.jpg?t=1');
  });

  it('never loads a picture from anywhere but the server', async () => {
    const { self, push } = startWorker('https://jf.example/jellyfin/Lumen/Push/sw.js');

    for (const image of [
      'https://evil.example/a.png',
      '//evil.example/a.png',
      '../outside.png',
      '/root.png',
      42,
    ]) {
      self.registration.showNotification.mockClear();
      await push({ title: 'x', image, icon: image });
      const options = (self.registration.showNotification.mock.calls[0] as unknown[])[1] as Record<
        string,
        string
      >;
      expect(options.image).toBeUndefined();
      // The icon falls back to nothing or Lumen's own; never the address sent.
      expect(options.icon === undefined || options.icon.indexOf('https://jf.example/jellyfin/') === 0).toBe(
        true,
      );
    }
  });

  it.each([[undefined], ['not json'], [null], [42], [{ body: 'no title' }], [{ title: 7 }]])(
    'always shows something, even for a message it cannot read (%j)',
    async (payload) => {
      const { self, push } = startWorker();

      await push(payload);

      // A push without a notification costs the permission (Safari), or shows the browser's own (Chrome).
      expect(self.registration.showNotification).toHaveBeenCalledTimes(1);
      const [title, options] = self.registration.showNotification.mock.calls[0] as unknown as [
        string,
        { body: string; data: { hash: string } },
      ];
      expect(title).toBe('Lumen');
      expect(options.body).toBe('Something you requested is ready to watch.');
      expect(options.data.hash).toBe('#/home');
    },
  );

  it('opens Lumen on the page when no window of it is open', async () => {
    const { self, click } = startWorker('https://jf.example/Lumen/Push/sw.js', [
      win('https://jf.example/somewhere/else'),
      win('https://other.example/web/index.html'),
    ]);

    const notification = await click('#/details?id=abc');

    expect(notification.close).toHaveBeenCalled();
    expect(self.clients.matchAll).toHaveBeenCalledWith({ type: 'window', includeUncontrolled: true });
    expect(self.clients.openWindow).toHaveBeenCalledWith('https://jf.example/web/index.html#/details?id=abc');
  });

  it('brings an open Lumen forward and asks it for the page, rather than opening another', async () => {
    const background = win('https://jf.example/web/index.html#/home');
    const front = win('https://jf.example/web/index.html#/movies', true);
    const { self, click } = startWorker('https://jf.example/Lumen/Push/sw.js', [background, front]);

    await click('#/home?title=movie-603');

    expect(front.postMessage).toHaveBeenCalledWith({
      type: 'lumen-push-open',
      hash: '#/home?title=movie-603',
    });
    expect(front.focus).toHaveBeenCalled();
    expect(background.postMessage).not.toHaveBeenCalled();
    expect(self.clients.openWindow).not.toHaveBeenCalled();
  });

  it('opens a window after all when the open one cannot be brought forward', async () => {
    const stuck = win('https://jf.example/web/index.html');
    stuck.focus.mockRejectedValue(new Error('not allowed'));
    const { self, click } = startWorker('https://jf.example/Lumen/Push/sw.js', [stuck]);

    await click('#/home?lumen=requests');

    expect(self.clients.openWindow).toHaveBeenCalledWith(
      'https://jf.example/web/index.html#/home?lumen=requests',
    );
  });

  it('opens home for a notification that carries no page', async () => {
    const { self, click } = startWorker();

    await click();

    expect(self.clients.openWindow).toHaveBeenCalledWith('https://jf.example/web/index.html#/home');
  });
});
