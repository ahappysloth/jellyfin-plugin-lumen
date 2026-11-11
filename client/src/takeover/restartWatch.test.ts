import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JellyfinApiClient } from '../compat/jellyfin';
import { RESTART_MESSAGES } from '../compat/registry';
import { createRestartWatch } from './restartWatch';

type Handler = (message: { MessageType?: string; Data?: unknown }) => void;

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

function setup({
  admin = true,
  pending = true,
  subscribe = true,
}: { admin?: boolean; pending?: boolean | 'error'; subscribe?: boolean } = {}) {
  const state = { pending };
  let handler: Handler | null = null;
  const unsubscribe = vi.fn();
  const ajax = vi.fn(async ({ url }: { url: string }) => {
    if (url === 'Users/Me') return { Policy: { IsAdministrator: admin } };
    if (url === 'System/Info') {
      if (state.pending === 'error') throw new Error('down');
      return { HasPendingRestart: state.pending };
    }
    throw new Error(`unexpected ${url}`);
  });
  const client = {
    getCurrentUserId: () => 'u1',
    accessToken: () => 't',
    deviceId: () => 'd',
    getUrl: (path: string) => path,
    ajax,
    ...(subscribe
      ? {
          subscribe: vi.fn((_types: string[], onMessage: Handler) => {
            handler = onMessage;
            return unsubscribe;
          }),
        }
      : {}),
  } as unknown as JellyfinApiClient;
  (window as unknown as { ApiClient?: JellyfinApiClient }).ApiClient = client;
  const banner = { showRestartBanner: vi.fn(async () => undefined), hideRestartBanner: vi.fn() };
  const load = vi.fn(async () => banner as never);
  const watch = createRestartWatch(document, window, load);
  const send = (MessageType: string, Data?: unknown): void => handler?.({ MessageType, Data });
  return { watch, banner, load, ajax, client, state, send, unsubscribe };
}

describe('the restart watch', () => {
  beforeEach(() => document.documentElement.setAttribute('data-lmn-skin', ''));
  afterEach(() => {
    document.documentElement.removeAttribute('data-lmn-skin');
    delete (window as unknown as { ApiClient?: unknown }).ApiClient;
  });

  it('shows the banner on an admin page when Jellyfin has a restart pending', async () => {
    const { watch, banner, client } = setup();
    watch.sync('#/dashboard/plugins');
    await flush();
    expect(banner.showRestartBanner).toHaveBeenCalledTimes(1);
    expect(banner.showRestartBanner).toHaveBeenCalledWith(
      expect.objectContaining({ client, removed: [], doc: document }),
    );
    watch.stop();
  });

  it("doesn't load the banner's code while no restart is pending", async () => {
    const { watch, load, ajax } = setup({ pending: false });
    watch.sync('#/dashboard');
    await flush();
    expect(ajax).toHaveBeenCalledWith(expect.objectContaining({ url: 'System/Info' }));
    expect(load).not.toHaveBeenCalled();
    watch.stop();
  });

  it.each([
    ['a user who is not an admin', { admin: false }, '#/dashboard'],
    ['a failed check', { pending: 'error' as const }, '#/dashboard'],
    ["Lumen's own pages", {}, '#/home'],
  ])('shows nothing for %s', async (_name, options, hash) => {
    const { watch, load } = setup(options);
    watch.sync(hash);
    await flush();
    expect(load).not.toHaveBeenCalled();
    watch.stop();
  });

  it('leaves stock Jellyfin alone when the admin look is off', async () => {
    document.documentElement.removeAttribute('data-lmn-skin');
    const { watch, ajax, client } = setup();
    watch.sync('#/dashboard');
    await flush();
    expect(ajax).not.toHaveBeenCalled();
    expect(client.subscribe).not.toHaveBeenCalled();
  });

  it('asks whether the user is an admin once, and whether a restart is pending on every admin page', async () => {
    const { watch, ajax } = setup({ pending: false });
    watch.sync('#/dashboard');
    await flush();
    watch.sync('#/dashboard/users');
    await flush();
    const urls = ajax.mock.calls.map(([r]) => r.url);
    expect(urls.filter((u) => u === 'Users/Me')).toHaveLength(1);
    expect(urls.filter((u) => u === 'System/Info')).toHaveLength(2);
    watch.stop();
  });

  it('hides the banner once no restart is pending', async () => {
    const { watch, banner, state } = setup();
    watch.sync('#/dashboard');
    await flush();
    state.pending = false;
    watch.sync('#/dashboard/plugins');
    await flush();
    expect(banner.hideRestartBanner).toHaveBeenCalledWith(document);
    watch.stop();
  });

  it("checks again when a plugin is installed or uninstalled, and names what's uninstalled", async () => {
    const { watch, banner, client, state, send } = setup({ pending: false });
    watch.sync('#/dashboard/plugins');
    await flush();
    expect(client.subscribe).toHaveBeenCalledWith(Object.values(RESTART_MESSAGES), expect.any(Function));

    state.pending = true;
    send(RESTART_MESSAGES.uninstalled, { Name: 'Trakt', Id: 'x' });
    await flush();
    expect(banner.showRestartBanner).toHaveBeenLastCalledWith(
      expect.objectContaining({ removed: ['Trakt'] }),
    );

    send(RESTART_MESSAGES.installed, { Name: 'Webhook' });
    await flush();
    expect(banner.showRestartBanner).toHaveBeenCalledTimes(2);
    watch.stop();
  });

  it('hides the banner when Jellyfin restarts from elsewhere', async () => {
    const { watch, banner, send } = setup();
    watch.sync('#/dashboard');
    await flush();
    send(RESTART_MESSAGES.restarting);
    expect(banner.hideRestartBanner).toHaveBeenCalledWith(document);
    watch.stop();
  });

  it('stops listening, and takes the banner away, when the page leaves the admin pages', async () => {
    const { watch, banner, unsubscribe } = setup();
    watch.sync('#/dashboard');
    await flush();
    watch.sync('#/home');
    expect(unsubscribe).toHaveBeenCalled();
    expect(banner.hideRestartBanner).toHaveBeenCalledWith(document, true);
  });

  it('still checks on each admin page without a websocket', async () => {
    const { watch, banner } = setup({ subscribe: false });
    watch.sync('#/dashboard');
    await flush();
    expect(banner.showRestartBanner).toHaveBeenCalled();
    watch.stop();
  });

  it('stays dismissed on the admin pages, until the admin comes back to them or something else changes', async () => {
    const { watch, banner, send } = setup();
    watch.sync('#/dashboard');
    await flush();
    const [[{ onDismiss }]] = banner.showRestartBanner.mock.calls as unknown as [[{ onDismiss: () => void }]];
    onDismiss();

    watch.sync('#/dashboard/users');
    await flush();
    expect(banner.showRestartBanner).toHaveBeenCalledTimes(1);

    watch.sync('#/home');
    watch.sync('#/dashboard');
    await flush();
    expect(banner.showRestartBanner).toHaveBeenCalledTimes(2);

    const [, [second]] = banner.showRestartBanner.mock.calls as unknown as [
      unknown,
      [{ onDismiss: () => void }],
    ];
    second.onDismiss();
    send(RESTART_MESSAGES.installed, { Name: 'Webhook' });
    await flush();
    expect(banner.showRestartBanner).toHaveBeenCalledTimes(3);
    watch.stop();
  });

  it("doesn't show a banner for a check that answers after the page left the admin pages", async () => {
    const { watch, banner, ajax } = setup();
    let answer: (v: unknown) => void = () => undefined;
    ajax.mockImplementation(({ url }: { url: string }) =>
      url === 'Users/Me'
        ? Promise.resolve({ Policy: { IsAdministrator: true } })
        : new Promise((r) => (answer = r)),
    );
    watch.sync('#/dashboard');
    await flush();
    watch.sync('#/home');
    answer({ HasPendingRestart: true });
    await flush();
    expect(banner.showRestartBanner).not.toHaveBeenCalled();
  });
});
