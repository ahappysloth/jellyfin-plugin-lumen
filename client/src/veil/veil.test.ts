import { afterEach, describe, expect, it, vi } from 'vitest';
import { SAFETY_MS } from './runGuard';
import {
  FONT_WAIT_MS,
  liftVeil,
  liftVeilNow,
  rememberVeilName,
  shouldVeil,
  showVeil,
  SLOW_MS,
  VEIL_ID,
} from './veil';

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

describe("the veil waits for Lumen's fonts", () => {
  /** document.fonts as a browser has it, with `ready` as given (jsdom has none). */
  const fonts = (ready: Promise<unknown>) =>
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready } });
  const pending = () => {
    let resolve!: () => void;
    return { ready: new Promise<void>((r) => (resolve = r)), resolve: () => resolve() };
  };
  const lifting = (veil: HTMLElement) => veil.classList.contains('is-lifting');
  /** How many times the veil was lifted: each lift listens once for the end of its transition. */
  const lifts = (veil: HTMLElement) => {
    const listen = vi.spyOn(veil, 'addEventListener');
    return () => listen.mock.calls.filter(([type]) => type === 'transitionend').length;
  };

  afterEach(() => {
    Reflect.deleteProperty(document, 'fonts');
    document.getElementById(VEIL_ID)?.remove();
    document.documentElement.className = '';
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('lifts once the fonts the page is fetching are in, and shows the page under it meanwhile', async () => {
    vi.useFakeTimers();
    const fetching = pending();
    fonts(fetching.ready);
    document.documentElement.classList.add('lmn-pending');
    const veil = showVeil(document, '<svg></svg>');

    liftVeil(document);
    expect(document.documentElement).not.toHaveClass('lmn-pending');
    await vi.advanceTimersByTimeAsync(FONT_WAIT_MS - 100);
    expect(lifting(veil)).toBe(false);

    fetching.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(lifting(veil)).toBe(true);
  });

  it('lifts at once when nothing is loading (a device that uses no Inter, or has it cached)', async () => {
    vi.useFakeTimers();
    fonts(Promise.resolve());
    const veil = showVeil(document, '<svg></svg>');

    liftVeil(document);
    await Promise.resolve();
    expect(lifting(veil)).toBe(true);
  });

  it(`never waits more than ${FONT_WAIT_MS} ms`, async () => {
    vi.useFakeTimers();
    fonts(new Promise(() => undefined));
    const veil = showVeil(document, '<svg></svg>');
    const count = lifts(veil);

    liftVeil(document);
    await vi.advanceTimersByTimeAsync(FONT_WAIT_MS - 1);
    expect(lifting(veil)).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(lifting(veil)).toBe(true);
    expect(count()).toBe(1);
  });

  it("lifts when the fonts can't load", async () => {
    vi.useFakeTimers();
    fonts(Promise.reject(new Error('offline')));
    const veil = showVeil(document, '<svg></svg>');

    liftVeil(document);
    await vi.advanceTimersByTimeAsync(0);
    expect(lifting(veil)).toBe(true);
  });

  it('lifts once: a second call while it waits starts no second wait, and the cap after a lift does nothing', async () => {
    vi.useFakeTimers();
    const fetching = pending();
    fonts(fetching.ready);
    const veil = showVeil(document, '<svg></svg>');
    const count = lifts(veil);

    liftVeil(document);
    await vi.advanceTimersByTimeAsync(FONT_WAIT_MS / 2);
    liftVeil(document);
    fetching.resolve();
    await vi.advanceTimersByTimeAsync(FONT_WAIT_MS * 2);
    expect(count()).toBe(1);
  });

  it("doesn't hold up a safety timer: liftVeilNow lifts at once, and the fonts arriving later change nothing", async () => {
    vi.useFakeTimers();
    const fetching = pending();
    fonts(fetching.ready);
    const veil = showVeil(document, '<svg></svg>');
    const count = lifts(veil);

    liftVeil(document);
    liftVeilNow(document);
    expect(lifting(veil)).toBe(true);
    fetching.resolve();
    await vi.advanceTimersByTimeAsync(FONT_WAIT_MS);
    expect(count()).toBe(1);
  });

  it("doesn't say it's slow while it only waits for the fonts", async () => {
    vi.useFakeTimers();
    fonts(new Promise(() => undefined));
    const veil = showVeil(document, '<svg></svg>');
    await vi.advanceTimersByTimeAsync(SLOW_MS - 100);

    liftVeil(document);
    await vi.advanceTimersByTimeAsync(100);
    expect(veil.querySelector('.lmn-veil__slow')).toBeNull();
  });

  it("doesn't touch document.fonts, or lay the page out, when there's no veil (every later navigation)", () => {
    const read = vi.fn(() => ({ ready: Promise.resolve() }));
    Object.defineProperty(document, 'fonts', { configurable: true, get: read });
    document.documentElement.classList.add('lmn-pending');

    liftVeil(document);
    expect(read).not.toHaveBeenCalled();
    expect(document.documentElement).not.toHaveClass('lmn-pending');
  });

  it('lifts at once with a document.fonts that has no ready', () => {
    Object.defineProperty(document, 'fonts', { configurable: true, value: {} });
    const veil = showVeil(document, '<svg></svg>');

    liftVeil(document);
    expect(lifting(veil)).toBe(true);
  });

  it('lifts at once in a browser without document.fonts', () => {
    expect('fonts' in document).toBe(false);
    const veil = showVeil(document, '<svg></svg>');

    liftVeil(document);
    expect(lifting(veil)).toBe(true);
  });
});
