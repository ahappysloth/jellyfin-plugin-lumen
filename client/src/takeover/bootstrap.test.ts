import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient, routes, type FakeClient } from '../../test/fakeClient';
import { startLumen } from './bootstrap';

const clientConfig = {
  Enabled: true,
  HomeTakeover: true,
  DetailsTakeover: true,
  LibraryTakeover: true,
  StyleStockPages: true,
  StyleVideoPlayer: true,
  AccentColor: '#112233',
  HeroIntervalSeconds: 8,
  TrailerPreview: true,
  TrailerDelaySeconds: 4,
  HeroWaitForTrailer: false,
  BuildHash: 'h',
};

describe('startLumen', () => {
  let client: FakeClient;
  let stop: () => void = () => undefined;

  beforeEach(() => {
    document.body.innerHTML = '<div id="reactRoot"><div class="skinBody"></div></div>';
    document.documentElement.className = 'layout-desktop';
    history.replaceState(null, '', '#/home');
    client = createFakeClient(routes({ 'Lumen/ClientConfig': clientConfig, 'Lumen/Diagnostics': {} }));
    Object.assign(window, { ApiClient: client, __LUMEN_FORCE_COMPAT_FAIL__: false });
  });

  afterEach(() => {
    stop();
    vi.restoreAllMocks();
    document.getElementById('lmn-root')?.remove();
    document.documentElement.removeAttribute('style');
  });

  const start = () => {
    const mount = vi.fn();
    const unmount = vi.fn();
    stop = startLumen({ mount, unmount, pollMs: 5, timeoutMs: 1000, compatRetryMs: 100, signInWaitMs: 300 });
    return { mount, unmount };
  };

  it('waits for a signed-in user, then takes over home and applies the accent to #lmn-root', async () => {
    client.userId = null;
    const { mount } = start();
    await new Promise((r) => setTimeout(r, 20));
    expect(mount).not.toHaveBeenCalled();

    client.userId = 'user1';
    await vi.waitFor(() => expect(mount).toHaveBeenCalledTimes(1));
    expect(mount.mock.calls[0]![0]).toEqual({ kind: 'home' });
    expect(mount.mock.calls[0]![2]).toMatchObject({ userId: 'user1', layout: 'desktop' });
    expect(document.getElementById('lmn-root')?.style.getPropertyValue('--lmn-accent')).toBe('#112233');
    expect(document.documentElement.style.getPropertyValue('--lmn-accent')).toBe('');
    expect(document.documentElement.getAttribute('style')).toBeNull();
  });

  it('keeps the pending guard until the takeover decides, then swaps it for lmn-active', async () => {
    document.documentElement.classList.add('lmn-pending');
    client.userId = null;
    const { mount } = start();
    await new Promise((r) => setTimeout(r, 20));
    expect(document.documentElement.classList.contains('lmn-pending')).toBe(true);

    client.userId = 'user1';
    await vi.waitFor(() => expect(mount).toHaveBeenCalled());
    expect(document.documentElement.classList.contains('lmn-pending')).toBe(false);
    expect(document.documentElement.classList.contains('lmn-active')).toBe(true);
  });

  it('drops the pending guard when Lumen is disabled for the user', async () => {
    document.documentElement.classList.add('lmn-pending');
    client.respond = () => Promise.resolve({ ...clientConfig, Enabled: false });
    start();
    await vi.waitFor(() => expect(document.documentElement.classList.contains('lmn-pending')).toBe(false));
    expect(document.documentElement.classList.contains('lmn-active')).toBe(false);
  });

  it('leaves a details link for another server to jellyfin-web', async () => {
    Object.assign(client, { serverId: () => 'thisServer' });
    history.replaceState(null, '', '#/details?id=0123456789abcdef0123456789abcdef&serverId=otherServer');
    const { mount } = start();
    await new Promise((r) => setTimeout(r, 50));
    expect(mount).not.toHaveBeenCalled();

    history.pushState(null, '', '#/details?id=0123456789abcdef0123456789abcdef&serverId=thisServer');
    await vi.waitFor(() => expect(mount).toHaveBeenCalled());
  });

  it('releases takeover when the user signs out', async () => {
    const { mount, unmount } = start();
    await vi.waitFor(() => expect(mount).toHaveBeenCalled());

    client.userId = null;
    history.pushState(null, '', '#/login');

    await vi.waitFor(() => expect(unmount).toHaveBeenCalled());
    expect(document.documentElement.classList.contains('lmn-active')).toBe(false);
  });

  it('starts a fresh session for a different user', async () => {
    const { mount } = start();
    await vi.waitFor(() => expect(mount).toHaveBeenCalledTimes(1));

    client.userId = 'user2';
    history.pushState(null, '', '#/home?tab=0');

    await vi.waitFor(() => expect(mount).toHaveBeenCalledTimes(2));
    expect(mount.mock.calls[1]![2]).toMatchObject({ userId: 'user2' });
  });

  it('fails open when the client config cannot be loaded', async () => {
    client.respond = () => Promise.reject(new Error('down'));
    const { mount } = start();

    await vi.waitFor(() =>
      expect(client.requests.some((r) => r.url.endsWith('Lumen/ClientConfig'))).toBe(true),
    );
    await new Promise((r) => setTimeout(r, 30));
    expect(mount).not.toHaveBeenCalled();
  });

  it('asks for the client config again on a later navigation after it failed', async () => {
    const now = vi.spyOn(Date, 'now');
    client.respond = () => Promise.reject(new Error('down'));
    const { mount } = start();
    await vi.waitFor(() =>
      expect(client.requests.some((r) => r.url.endsWith('Lumen/ClientConfig'))).toBe(true),
    );
    await new Promise((r) => setTimeout(r, 30));
    expect(mount).not.toHaveBeenCalled();

    client.respond = routes({ 'Lumen/ClientConfig': clientConfig, 'Lumen/Diagnostics': {} });
    now.mockReturnValue(Date.now() + 60_000);
    history.pushState(null, '', '#/home?tab=0');

    await vi.waitFor(() => expect(mount).toHaveBeenCalledTimes(1));
  });

  it('does nothing when Lumen is disabled', async () => {
    client.respond = routes({ 'Lumen/ClientConfig': { ...clientConfig, Enabled: false } });
    const { mount } = start();

    await vi.waitFor(() =>
      expect(client.requests.some((r) => r.url.endsWith('Lumen/ClientConfig'))).toBe(true),
    );
    await new Promise((r) => setTimeout(r, 30));
    expect(mount).not.toHaveBeenCalled();
  });

  it('never installs a session for a user who signed out while it was loading', async () => {
    let release: (value: unknown) => void = () => undefined;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    client.respond = routes({ 'Lumen/ClientConfig': () => gate.then(() => clientConfig) });
    const { mount } = start();
    await vi.waitFor(() =>
      expect(client.requests.some((r) => r.url.endsWith('Lumen/ClientConfig'))).toBe(true),
    );

    client.userId = 'user2';
    history.pushState(null, '', '#/home?tab=0');
    release(undefined);

    await vi.waitFor(() => expect(mount).toHaveBeenCalled());
    expect(mount.mock.calls.every((call) => (call[2] as { userId: string }).userId === 'user2')).toBe(true);
  });

  it('reports compatibility failures to the server', async () => {
    Object.assign(window, { __LUMEN_FORCE_COMPAT_FAIL__: true });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    start();

    await vi.waitFor(() =>
      expect(client.requests.some((r) => r.url.endsWith('Lumen/Diagnostics'))).toBe(true),
    );
    const report = client.requests.find((r) => r.url.endsWith('Lumen/Diagnostics'))!;
    expect(JSON.parse(report.data!)).toMatchObject({ ServerVersion: '12.4.0', FailedChecks: ['forced'] });
  });

  it('retries the compatibility check on a cold load, keeping the stock page hidden until it passes', async () => {
    document.body.innerHTML = '<div id="reactRoot"></div>';
    document.documentElement.classList.add('lmn-pending');
    const { mount } = start();
    await new Promise((r) => setTimeout(r, 40));
    expect(mount).not.toHaveBeenCalled();
    expect(document.documentElement.classList.contains('lmn-pending')).toBe(true);

    // jellyfin-web renders its page shell after loading its plugins.
    document.getElementById('reactRoot')!.innerHTML = '<div class="skinBody"></div>';

    await vi.waitFor(() => expect(mount).toHaveBeenCalledTimes(1));
    expect(document.documentElement.classList.contains('lmn-active')).toBe(true);
    expect(client.requests.some((r) => r.url.endsWith('Lumen/Diagnostics'))).toBe(false);
  });

  it('reports only after the retry window, then lifts the veil onto the stock page', async () => {
    document.body.innerHTML = '<div id="reactRoot"></div>';
    document.documentElement.classList.add('lmn-pending');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    start();
    await new Promise((r) => setTimeout(r, 40));
    expect(client.requests.some((r) => r.url.endsWith('Lumen/Diagnostics'))).toBe(false);

    await vi.waitFor(() =>
      expect(client.requests.some((r) => r.url.endsWith('Lumen/Diagnostics'))).toBe(true),
    );
    expect(document.documentElement.classList.contains('lmn-pending')).toBe(false);
    expect(document.documentElement.classList.contains('lmn-active')).toBe(false);
  });

  it('takes over when jellyfin-web sets the user just after navigating home from sign-in', async () => {
    const { mount, unmount } = start();
    await vi.waitFor(() => expect(mount).toHaveBeenCalledTimes(1));
    client.userId = null;
    history.pushState(null, '', '#/login');
    await vi.waitFor(() => expect(unmount).toHaveBeenCalled());

    // Signed in again: jellyfin-web navigates first, and sets the user a moment later.
    history.pushState(null, '', '#/home');
    await new Promise((r) => setTimeout(r, 30));
    expect(document.documentElement.classList.contains('lmn-pending')).toBe(true);
    client.userId = 'user1';

    await vi.waitFor(() => expect(mount).toHaveBeenCalledTimes(2));
    expect(document.documentElement.classList.contains('lmn-pending')).toBe(false);
  });

  it('gives a signed-out page back once the sign-in wait runs out, without looping', async () => {
    client.userId = 'user1';
    const { mount, unmount } = start();
    await vi.waitFor(() => expect(mount).toHaveBeenCalledTimes(1));
    client.userId = null;
    const getUser = vi.spyOn(client, 'getCurrentUserId');
    history.pushState(null, '', '#/home?tab=0');
    await vi.waitFor(() => expect(unmount).toHaveBeenCalled());

    await vi.waitFor(() => expect(document.documentElement.classList.contains('lmn-pending')).toBe(false));
    const calls = getUser.mock.calls.length;
    await new Promise((r) => setTimeout(r, 400));
    expect(getUser.mock.calls.length).toBe(calls);
  });

  it("takes the veil's safety net over from the inline guard", async () => {
    const clear = vi.spyOn(window, 'clearTimeout');
    Object.assign(window, { __lmnVeilSafety: 4242 });
    start();
    expect(clear).toHaveBeenCalledWith(4242);
  });
});
