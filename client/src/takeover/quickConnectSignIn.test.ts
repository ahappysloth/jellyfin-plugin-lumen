import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createQuickConnectSignIn,
  QUICK_CONNECT_SHOWN_CLASS,
  signInDeps,
  signInTarget,
} from './quickConnectSignIn';

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
    const [owner, key] = name.split('.') as [string, string];
    (owner === 'ApiClient' ? client : dashboard)[key] = undefined;
  }
  return { ApiClient: client, Dashboard: dashboard, location: { hash } } as unknown as Window;
}

/** Every listener a test started, stopped after it (they listen on the whole document). */
const started: { stop: () => void }[] = [];

afterEach(() => {
  started.splice(0).forEach((s) => s.stop());
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-lmn-skin');
  document.documentElement.classList.remove(QUICK_CONNECT_SHOWN_CLASS);
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
    for (const missing of [
      'ApiClient.quickConnect',
      'ApiClient.ajax',
      'ApiClient.getUrl',
      'Dashboard.onServerChanged',
      'Dashboard.navigate',
    ])
      expect(signInDeps(fakeWindow('#/login', [missing]), button), missing).toBeNull();
    expect(signInDeps(fakeWindow('#/login?serverid=other'), button)).toBeNull();
    expect(signInDeps({ location: { hash: '#/login' } } as unknown as Window, button)).toBeNull();
  });
});

describe('createQuickConnectSignIn', () => {
  /** A deferred load of the screen's file: `finish` lets it arrive, `fail` makes it fail. */
  function slowLoad() {
    let finish: () => void = () => undefined;
    let fail: () => void = () => undefined;
    const close = vi.fn();
    const open = vi.fn(() => close);
    const load = vi.fn(
      () =>
        new Promise<{ openSignInScreen: typeof open }>((resolve, reject) => {
          finish = () => resolve({ openSignInScreen: open });
          fail = () => reject(new Error('offline'));
        }),
    );
    return { load, open, close, finish: () => finish(), fail: () => fail() };
  }

  function setUp(hash = '#/login', skin = true, load = slowLoad()) {
    if (skin) document.documentElement.setAttribute('data-lmn-skin', '');
    const button = document.createElement('button');
    button.className = 'btnQuick';
    const stock = vi.fn();
    button.addEventListener('click', stock);
    document.body.appendChild(button);
    const win = fakeWindow(hash);
    const signIn = createQuickConnectSignIn(document, win, load.load);
    started.push(signIn);
    return { button, stock, win, signIn, ...load };
  }

  it("takes the click from jellyfin-web's own listener and opens Lumen's screen; stopping closes it", async () => {
    const { button, stock, open, close, signIn, finish } = setUp();
    button.click();
    finish();
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(stock).not.toHaveBeenCalled();
    signIn.stop();
    expect(close).toHaveBeenCalled();
  });

  it('opens one screen however often the button is pressed while its file loads', async () => {
    const { button, stock, load, open, finish } = setUp();
    button.click();
    button.click();
    button.click();
    finish();
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 10));
    expect(open).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(1);
    expect(stock).not.toHaveBeenCalled();
  });

  it("doesn't open the screen if the sign-in page is gone by the time its file arrives", async () => {
    // Signed in with the password meanwhile (jellyfin-web went home), the sign-in page's look turned off, Lumen
    // stopped, or the button gone.
    const cases: [string, (s: ReturnType<typeof setUp>) => void][] = [
      ['went home', (s) => (s.win.location.hash = '#/home')],
      ['no skin', () => document.documentElement.removeAttribute('data-lmn-skin')],
      ['stopped', (s) => s.signIn.stop()],
      ['button gone', (s) => s.button.remove()],
    ];
    for (const [name, change] of cases) {
      const s = setUp();
      s.button.click();
      change(s);
      s.finish();
      await new Promise((r) => setTimeout(r, 10));
      expect(s.open, name).not.toHaveBeenCalled();
      expect(s.stock, name).not.toHaveBeenCalled();
      s.signIn.stop();
      document.body.innerHTML = '';
    }
  });

  it('opens it again once the page is back, on the next press', async () => {
    const s = setUp();
    s.button.click();
    s.win.location.hash = '#/home';
    s.finish();
    await new Promise((r) => setTimeout(r, 10));
    s.win.location.hash = '#/login';
    s.button.click();
    s.finish();
    await vi.waitFor(() => expect(s.open).toHaveBeenCalledTimes(1));
  });

  it("leaves the click to jellyfin-web where the sign-in page isn't Lumen's, or off the sign-in page", () => {
    for (const [hash, skin] of [
      ['#/login', false],
      ['#/home', true],
    ] as const) {
      const { button, stock, load, signIn } = setUp(hash, skin);
      button.click();
      expect(stock).toHaveBeenCalledTimes(1);
      expect(load).not.toHaveBeenCalled();
      signIn.stop();
      document.body.innerHTML = '';
    }
  });

  it("hands the click back to jellyfin-web when Lumen's file can't load, unless the page has changed", async () => {
    const a = setUp();
    a.button.click();
    a.fail();
    await vi.waitFor(() => expect(a.stock).toHaveBeenCalledTimes(1));
    a.signIn.stop();
    document.body.innerHTML = '';

    const b = setUp();
    b.button.click();
    b.win.location.hash = '#/home';
    b.fail();
    await new Promise((r) => setTimeout(r, 10));
    expect(b.stock).not.toHaveBeenCalled();
    b.signIn.stop();
  });

  it('says whether "Use Quick Connect" shows, which jellyfin-web decides once the server answers', async () => {
    const page = document.createElement('div');
    page.className = 'page';
    const { button, signIn } = setUp();
    button.classList.add('hide');
    page.appendChild(button);
    document.body.appendChild(page);
    const shown = () => document.documentElement.classList.contains(QUICK_CONNECT_SHOWN_CLASS);
    signIn.sync('#/login');
    expect(shown()).toBe(false);
    button.classList.remove('hide');
    await vi.waitFor(() => expect(shown()).toBe(true));
    // Quick Connect off: jellyfin-web hides it again on the next visit.
    button.classList.add('hide');
    await vi.waitFor(() => expect(shown()).toBe(false));
    button.classList.remove('hide');
    await vi.waitFor(() => expect(shown()).toBe(true));
    // Another page: the sign-in page is hidden, and nothing is watched any more.
    page.classList.add('hide');
    signIn.sync('#/home');
    expect(shown()).toBe(false);
    page.classList.remove('hide');
    await new Promise((r) => setTimeout(r, 10));
    expect(shown()).toBe(false);
    signIn.stop();
  });
});
