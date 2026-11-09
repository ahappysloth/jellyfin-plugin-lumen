import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runGuard, SAFETY_TIMER_KEY } from './runGuard';
import { SIGN_IN_CLASS } from './skin';
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

  it('follows back/forward (popstate) too', () => {
    history.replaceState(null, '', '#/login');
    runGuard(window, document);
    Object.assign(history, originals); // as if a later script replaced pushState without calling ours
    history.replaceState(null, '', '#/home');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(document.documentElement.classList.contains(SIGN_IN_CLASS)).toBe(false);
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
