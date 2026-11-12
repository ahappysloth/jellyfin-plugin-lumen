import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runGuard, SAFETY_TIMER_KEY } from './runGuard';
import { DASHBOARD_CLASS, SIGN_IN_CLASS } from './skin';
import { VEIL_ID } from './veil';

describe('inline guard', () => {
  const originals = { pushState: history.pushState, replaceState: history.replaceState };

  beforeEach(() => {
    document.documentElement.setAttribute('data-lmn-skin', '');
  });
  afterEach(() => {
    Object.assign(history, originals);
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-lmn-skin');
    document.documentElement.removeAttribute('style');
    document.getElementById(VEIL_ID)?.remove();
    vi.useRealTimers();
  });

  it('drops the sign-in look when jellyfin-web navigates away with pushState (no lumen.js needed)', () => {
    history.replaceState(null, '', '#/login');
    runGuard(window, document);
    expect(document.documentElement.classList.contains(SIGN_IN_CLASS)).toBe(true);

    history.pushState(null, '', '#/home');
    expect(document.documentElement.classList.contains(SIGN_IN_CLASS)).toBe(false);

    history.replaceState(null, '', '#/login');
    expect(document.documentElement.classList.contains(SIGN_IN_CLASS)).toBe(true);
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(document.documentElement.classList.contains(SIGN_IN_CLASS)).toBe(true);
  });

  it('puts the admin look on the Dashboard and takes it off again as jellyfin-web navigates', () => {
    history.replaceState(null, '', '#/dashboard');
    runGuard(window, document);
    expect(document.documentElement.classList.contains(DASHBOARD_CLASS)).toBe(true);
    // The Dashboard isn't a route Lumen takes over: no veil.
    expect(document.getElementById(VEIL_ID)).toBeNull();

    history.pushState(null, '', '#/dashboard/users');
    expect(document.documentElement.classList.contains(DASHBOARD_CLASS)).toBe(true);
    history.pushState(null, '', '#/home');
    expect(document.documentElement.classList.contains(DASHBOARD_CLASS)).toBe(false);
  });

  it('follows back/forward (popstate) too', () => {
    history.replaceState(null, '', '#/login');
    runGuard(window, document);
    Object.assign(history, originals); // as if a later script replaced pushState without calling ours
    history.replaceState(null, '', '#/home');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(document.documentElement.classList.contains(SIGN_IN_CLASS)).toBe(false);
  });

  it('writes stylesheets into the page only on its first run, never from a navigation event during the parse', () => {
    document.head.replaceChildren(); // what earlier tests linked
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    vi.spyOn(document, 'currentScript', 'get').mockReturnValue(document.createElement('script'));
    const write = vi.spyOn(document, 'write').mockImplementation(() => undefined);
    history.replaceState(null, '', '#/login');
    runGuard(window, document);
    expect(write).toHaveBeenCalledTimes(1);

    // As if the browser ran these between two chunks of the page (the parse window): from an event handler,
    // document.write would wipe the page.
    history.replaceState(null, '', '#/dashboard');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(write).toHaveBeenCalledTimes(1);
    expect(document.querySelector('link[data-lmn-css="lumen-dashboard.css"]')).not.toBeNull();
    vi.restoreAllMocks();
    document.head.replaceChildren();
  });

  it('veils a route Lumen may own and leaves its safety timer for lumen.js to clear', () => {
    vi.useFakeTimers();
    history.replaceState(null, '', '#/home');
    runGuard(window, document);
    expect(document.getElementById(VEIL_ID)).not.toBeNull();
    expect(document.documentElement.classList.contains('lmn-pending')).toBe(true);
    expect((window as unknown as Record<string, unknown>)[SAFETY_TIMER_KEY]).toBeDefined();

    vi.advanceTimersByTime(8000);
    expect(document.documentElement.classList.contains('lmn-pending')).toBe(false);
  });
});
