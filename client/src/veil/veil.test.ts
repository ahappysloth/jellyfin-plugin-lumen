import { afterEach, describe, expect, it, vi } from 'vitest';
import { SAFETY_MS } from './runGuard';
import { liftVeil, rememberVeilName, shouldVeil, showVeil, SLOW_MS, VEIL_ID } from './veil';

describe('veil', () => {
  afterEach(() => {
    document.getElementById(VEIL_ID)?.remove();
    document.documentElement.className = '';
    localStorage.clear();
    vi.useRealTimers();
  });

  it.each([
    ['', true],
    ['#/', true],
    ['#/home', true],
    ['#/home?tab=1', true],
    ['#/details?id=0123456789abcdef0123456789abcdef', true],
    ['#/login', false],
    ['#/dashboard', false],
  ])('shouldVeil(%s) = %s', (hash, expected) => {
    expect(shouldVeil(hash)).toBe(expected);
  });

  it('veils an empty hash only at the app root, not when jellyfin-web is path-routed', () => {
    expect(shouldVeil('', '/web/')).toBe(true);
    expect(shouldVeil('', '/jf/web/index.html')).toBe(true);
    expect(shouldVeil('', '/web/home')).toBe(false);
    expect(shouldVeil('#/', '/web/details')).toBe(false);
    expect(shouldVeil('#/home', '/web/')).toBe(true);
  });

  it('shows the mark and the last known server name, then lifts and removes itself', () => {
    vi.useFakeTimers();
    rememberVeilName('Den');
    document.documentElement.classList.add('lmn-pending');
    const veil = showVeil(document, '<svg></svg>');
    expect(veil.textContent).toBe('Den');
    expect(showVeil(document, '<svg></svg>')).toBe(veil);

    liftVeil(document);
    expect(veil.classList.contains('is-lifting')).toBe(true);
    expect(document.documentElement.classList.contains('lmn-pending')).toBe(false);
    vi.advanceTimersByTime(1200);
    expect(document.getElementById(VEIL_ID)).toBeNull();
  });

  it("sizes and centres the mark inline, so it isn't drawn full screen when lumen.css doesn't load", () => {
    const veil = showVeil(document, '<svg viewBox="0 0 64 64"></svg>');
    const svg = veil.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('56');
    expect(svg.getAttribute('height')).toBe('56');
    expect(veil.style.display).toBe('grid');
    expect(veil.style.placeItems).toBe('center');
  });

  it('says it is slow after a while and offers Try again, which reloads the page', () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload });
    const veil = showVeil(document, '<svg></svg>');
    vi.advanceTimersByTime(SLOW_MS - 1);
    expect(veil.querySelector('.lmn-veil__slow')).toBeNull();

    vi.advanceTimersByTime(1);
    const slow = veil.querySelector('.lmn-veil__slow')!;
    expect(slow).toHaveAttribute('role', 'alert');
    expect(slow.textContent).toContain('This is taking longer than usual.');
    expect(veil).not.toHaveAttribute('aria-hidden');
    const retry = slow.querySelector('button')!;
    expect(retry).toHaveTextContent('Try again');
    expect(retry).toHaveFocus();
    retry.click();
    expect(reload).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("lets go of Try again as it lifts, so a remote's OK during the lift doesn't reload", () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload });
    const veil = showVeil(document, '<svg></svg>');
    vi.advanceTimersByTime(SLOW_MS);
    const retry = veil.querySelector('button')!;
    expect(retry).toHaveFocus();

    liftVeil(document);
    expect(retry).not.toHaveFocus();
    expect(retry).toBeDisabled();
    expect(veil).toHaveAttribute('aria-hidden', 'true');
    retry.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(reload).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("waits past the guard's safety timer, so a veil the guard lifts never flashes the message", () => {
    expect(SLOW_MS).toBeGreaterThan(SAFETY_MS);
  });

  it('stays quiet when the page is ready in time', () => {
    vi.useFakeTimers();
    const veil = showVeil(document, '<svg></svg>');
    liftVeil(document);
    vi.advanceTimersByTime(SLOW_MS);
    expect(veil.querySelector('.lmn-veil__slow')).toBeNull();
  });

  it('falls back to "Jellyfin" when no name is stored', () => {
    expect(showVeil(document, '').textContent).toBe('Jellyfin');
  });
});
