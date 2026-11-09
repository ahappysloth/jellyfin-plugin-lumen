import { afterEach, describe, expect, it, vi } from 'vitest';
import { liftVeil, rememberVeilName, shouldVeil, showVeil, VEIL_ID } from './veil';

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

  it('falls back to "Jellyfin" when no name is stored', () => {
    expect(showVeil(document, '').textContent).toBe('Jellyfin');
  });
});
