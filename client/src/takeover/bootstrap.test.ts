import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient, routes, type FakeClient } from '../../test/fakeClient';
import { startLumen } from './bootstrap';

const clientConfig = {
  Enabled: true,
  HomeTakeover: true,
  DetailsTakeover: true,
  AccentColor: '#112233',
  HeroIntervalSeconds: 8,
  TrailerPreview: true,
  TrailerDelaySeconds: 4,
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
    stop = startLumen({ mount, unmount, pollMs: 5, timeoutMs: 1000 });
    return { mount, unmount };
  };

  it('waits for a signed-in user, then takes over home and applies the accent', async () => {
    client.userId = null;
    const { mount } = start();
    await new Promise((r) => setTimeout(r, 20));
    expect(mount).not.toHaveBeenCalled();

    client.userId = 'user1';
    await vi.waitFor(() => expect(mount).toHaveBeenCalledTimes(1));
    expect(mount.mock.calls[0]![0]).toEqual({ kind: 'home' });
    expect(mount.mock.calls[0]![2]).toMatchObject({ userId: 'user1', layout: 'desktop' });
    expect(document.documentElement.style.getPropertyValue('--lmn-accent')).toBe('#112233');
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
    expect(JSON.parse(report.data!)).toMatchObject({ ServerVersion: '12.1.0', FailedChecks: ['forced'] });
  });
});
