import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQuickConnectSignIn, signInDeps, signInTarget } from './quickConnectSignIn';

/** A window as jellyfin-web's sign-in page leaves it, with `omit` taken away. */
function fakeWindow(hash: string, omit: string[] = []): Window {
  const client: Record<string, unknown> = {
    quickConnect: vi.fn(),
    ajax: vi.fn(),
    getUrl: vi.fn(),
    serverId: () => 'abc123',
  };
  const dashboard: Record<string, unknown> = { onServerChanged: vi.fn(), navigate: vi.fn() };
  // Missing: not a function any more, as the pre-flight checks.
  for (const name of omit) {
    if (name.startsWith('ApiClient.')) client[name.slice(10)] = undefined;
    else dashboard[name.slice(10)] = undefined;
  }
  return { ApiClient: client, Dashboard: dashboard, location: { hash } } as unknown as Window;
}

afterEach(() => {
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-lmn-skin');
});

describe('signInTarget', () => {
  it("goes where the sign-in page's url says, only within the app, or home", () => {
    expect(signInTarget('#/login?serverid=abc123&url=%2Fquickconnect%3Fcode%3D123456')).toBe(
      '/quickconnect?code=123456',
    );
    expect(signInTarget('#/login')).toBe('/home');
    expect(signInTarget('#/login?url=https%3A%2F%2Fevil.example')).toBe('/home');
    expect(signInTarget('#/login?url=%2F%2Fevil.example')).toBe('/home');
  });
});

describe('signInDeps', () => {
  const button = document.createElement('button');

  it('has everything when jellyfin-web lends it, for this server', () => {
    const deps = signInDeps(fakeWindow('#/login?serverid=ABC123&url=%2Fhome'), button);
    expect(deps?.target).toBe('/home');
    expect(deps?.returnFocus).toBe(button);
  });

  it("is nothing (jellyfin-web's dialog runs) when a piece is missing, or the page is another server's", () => {
    for (const missing of ['ApiClient.quickConnect', 'Dashboard.onServerChanged', 'Dashboard.navigate'])
      expect(signInDeps(fakeWindow('#/login', [missing]), button), missing).toBeNull();
    expect(signInDeps(fakeWindow('#/login?serverid=other'), button)).toBeNull();
    expect(signInDeps({ location: { hash: '#/login' } } as unknown as Window, button)).toBeNull();
  });
});

describe('createQuickConnectSignIn', () => {
  function setUp(hash = '#/login', skin = true) {
    if (skin) document.documentElement.setAttribute('data-lmn-skin', '');
    const button = document.createElement('button');
    button.className = 'btnQuick';
    const stock = vi.fn();
    button.addEventListener('click', stock);
    document.body.appendChild(button);
    const close = vi.fn();
    const open = vi.fn(() => close);
    const load = vi.fn(() => Promise.resolve({ openSignInScreen: open }));
    const stop = createQuickConnectSignIn(document, fakeWindow(hash), load);
    return { button, stock, open, load, close, stop };
  }

  it("takes the click from jellyfin-web's own listener and opens Lumen's screen; stopping closes it", async () => {
    const { button, stock, open, close, stop } = setUp();
    button.click();
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(stock).not.toHaveBeenCalled();
    stop();
    expect(close).toHaveBeenCalled();
  });

  it("leaves the click to jellyfin-web where the sign-in page isn't Lumen's, or off the sign-in page", () => {
    for (const [hash, skin] of [
      ['#/login', false],
      ['#/home', true],
    ] as const) {
      const { button, stock, load, stop } = setUp(hash, skin);
      button.click();
      expect(stock).toHaveBeenCalledTimes(1);
      expect(load).not.toHaveBeenCalled();
      stop();
      document.body.innerHTML = '';
    }
  });

  it("hands the click back to jellyfin-web when Lumen's file can't load", async () => {
    document.documentElement.setAttribute('data-lmn-skin', '');
    const button = document.createElement('button');
    button.className = 'btnQuick';
    const stock = vi.fn();
    button.addEventListener('click', stock);
    document.body.appendChild(button);
    const stop = createQuickConnectSignIn(document, fakeWindow('#/login'), () =>
      Promise.reject(new Error('offline')),
    );
    button.click();
    await vi.waitFor(() => expect(stock).toHaveBeenCalledTimes(1));
    stop();
  });
});
