import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientConfig } from '../api/types';
import type { CompatReport } from '../compat/jellyfin';
import { Takeover, type TakeoverOptions } from './takeover';

const config: ClientConfig = {
  Enabled: true,
  HomeTakeover: true,
  DetailsTakeover: false,
  LibraryTakeover: false,
  StyleStockPages: true,
  StyleVideoPlayer: true,
  AccentColor: '#f5a524',
  HeroIntervalSeconds: 8,
  TrailerPreview: true,
  TrailerDelaySeconds: 4,
  BuildHash: 'h',
};

function create(overrides: Partial<TakeoverOptions> = {}) {
  const options: TakeoverOptions = {
    config,
    win: window,
    doc: document,
    mount: vi.fn(),
    unmount: vi.fn(),
    selfTest: vi.fn(() => ({ ok: true, failed: [] })),
    report: vi.fn(),
    ...overrides,
  };
  return { takeover: new Takeover(options), options };
}

describe('Takeover', () => {
  beforeEach(() => history.replaceState(null, '', '#/home'));
  afterEach(() => {
    document.documentElement.className = '';
    document.getElementById('lmn-root')?.remove();
  });

  it('mounts home once into its own root and marks <html>', () => {
    const { takeover, options } = create();

    takeover.handle({ kind: 'home' });
    takeover.handle({ kind: 'home' });

    expect(document.getElementById('lmn-root')?.parentElement).toBe(document.body);
    expect(document.documentElement.classList.contains('lmn-active')).toBe(true);
    expect(document.documentElement.classList.contains('lmn-route-home')).toBe(true);
    expect(options.mount).toHaveBeenCalledTimes(1);
  });

  it('sets a valid accent on #lmn-root, never inline on <html>', () => {
    const { takeover } = create({ config: { ...config, AccentColor: '#112233' } });

    takeover.handle({ kind: 'home' });

    expect(document.getElementById('lmn-root')?.style.getPropertyValue('--lmn-accent')).toBe('#112233');
    expect(document.documentElement.getAttribute('style')).toBeNull();
  });

  it('ignores an accent that is not #RRGGBB', () => {
    const { takeover } = create({ config: { ...config, AccentColor: 'red; background: url(x)' } });

    takeover.handle({ kind: 'home' });

    expect(document.getElementById('lmn-root')?.style.getPropertyValue('--lmn-accent')).toBe('');
  });

  it('leaves disabled routes and other routes to the stock UI', () => {
    const { takeover, options } = create();

    takeover.handle({ kind: 'details', id: 'a' });
    takeover.handle({ kind: 'other' });

    expect(options.mount).not.toHaveBeenCalled();
    expect(document.documentElement.classList.contains('lmn-active')).toBe(false);
  });

  describe('a failing compatibility check', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
      document.body.innerHTML = '';
    });

    it('is retried while jellyfin-web renders, and takes over without reporting once it passes', async () => {
      document.body.innerHTML = '<div id="reactRoot"></div>';
      const selfTest = vi.fn(() =>
        document.querySelector('#reactRoot .skinBody')
          ? { ok: true, failed: [] }
          : { ok: false, failed: ['stockPage'] },
      );
      const { takeover, options } = create({ selfTest });
      options.retry = vi.fn(() => takeover.handle({ kind: 'home' }));

      expect(takeover.handle({ kind: 'home' })).toBe('waiting');
      expect(options.mount).not.toHaveBeenCalled();

      document.getElementById('reactRoot')!.innerHTML = '<div class="skinBody"></div>';
      await vi.advanceTimersByTimeAsync(100);

      expect(options.retry).toHaveBeenCalledTimes(1);
      expect(options.mount).toHaveBeenCalledTimes(1);
      expect(options.report).not.toHaveBeenCalled();
      // The window is closed: nothing fires later.
      await vi.advanceTimersByTimeAsync(5000);
      expect(options.retry).toHaveBeenCalledTimes(1);
    });

    it('gives the page back and reports once when the retry window runs out', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { takeover, options } = create({ selfTest: vi.fn(() => ({ ok: false, failed: ['stockPage'] })) });
      const results: string[] = [];
      options.retry = vi.fn(() => results.push(takeover.handle({ kind: 'home' })));

      expect(takeover.handle({ kind: 'home' })).toBe('waiting');
      await vi.advanceTimersByTimeAsync(2900);
      expect(options.report).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(200);

      expect(results).toEqual(['released']);
      expect(options.report).toHaveBeenCalledTimes(1);
      expect(options.report).toHaveBeenCalledWith({ ok: false, failed: ['stockPage'] });
      expect(takeover.handle({ kind: 'home' })).toBe('released');
      expect(options.report).toHaveBeenCalledTimes(1);
      expect(options.mount).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('is still re-run after the window, so a later pass takes over', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const selfTest = vi.fn<() => CompatReport>().mockReturnValue({ ok: false, failed: ['stockPage'] });
      const { takeover, options } = create({ selfTest, retryMs: 10 });
      takeover.handle({ kind: 'home' });
      await vi.advanceTimersByTimeAsync(20);
      expect(takeover.handle({ kind: 'home' })).toBe('released');

      selfTest.mockReturnValue({ ok: true, failed: [] });
      expect(takeover.handle({ kind: 'home' })).toBe('active');
      expect(options.mount).toHaveBeenCalledTimes(1);
      expect(options.report).toHaveBeenCalledTimes(1);
    });

    it('stops retrying when the session is disposed', async () => {
      const { takeover, options } = create({ selfTest: vi.fn(() => ({ ok: false, failed: ['x'] })) });
      options.retry = vi.fn();
      takeover.handle({ kind: 'home' });
      takeover.dispose();
      await vi.advanceTimersByTimeAsync(5000);
      expect(options.retry).not.toHaveBeenCalled();
    });
  });

  it('leaves the stock player alone, and reports why, when the playback manager is missing', () => {
    const failed = { ok: false, failed: ['playbackManager.seek'] };
    const { takeover, options } = create({ playerCheck: vi.fn(() => failed) });

    expect(takeover.handle({ kind: 'player' })).toBe('released');
    takeover.handle({ kind: 'player' });

    expect(options.mount).not.toHaveBeenCalled();
    expect(document.documentElement.classList.contains('lmn-skin-player')).toBe(false);
    expect(options.report).toHaveBeenCalledTimes(1);
    expect(options.report).toHaveBeenCalledWith(failed);
  });

  it('reports stock elements it hides that are missing a while after mounting', async () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = '<div id="reactRoot"><div class="skinBody"></div></div>';
      const { takeover, options } = create({ probeMs: 100 });
      takeover.handle({ kind: 'home' });
      await vi.advanceTimersByTimeAsync(150);
      expect(options.report).toHaveBeenCalledWith({ ok: false, failed: ['selector.appBar'] });

      const ok = create({ probeMs: 100, config: { ...config, StyleVideoPlayer: true } });
      document.body.innerHTML = '<div class="videoOsdBottom"></div>';
      ok.takeover.handle({ kind: 'player' });
      await vi.advanceTimersByTimeAsync(150);
      expect(ok.options.report).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      document.body.innerHTML = '';
    }
  });

  it('release unmounts and clears classes', () => {
    const { takeover, options } = create();
    takeover.handle({ kind: 'home' });

    takeover.release();

    expect(options.unmount).toHaveBeenCalledTimes(1);
    expect(document.documentElement.className).toBe('');
  });

  it('a view fallback suppresses takeover for that URL until navigation', () => {
    let fallback: () => void = () => undefined;
    const { takeover, options } = create({
      mount: vi.fn((_route, _root, fb: () => void) => {
        fallback = fb;
      }),
    });
    takeover.handle({ kind: 'home' });

    fallback();
    takeover.handle({ kind: 'home' });
    expect(options.mount).toHaveBeenCalledTimes(1);
    expect(document.documentElement.classList.contains('lmn-active')).toBe(false);

    history.replaceState(null, '', '#/home?tab=0');
    takeover.handle({ kind: 'home' });
    expect(options.mount).toHaveBeenCalledTimes(2);
  });

  it('ignores a stale fallback from an earlier mount', () => {
    const fallbacks: (() => void)[] = [];
    const { takeover, options } = create({
      config: { ...config, DetailsTakeover: true },
      mount: vi.fn((_route, _root, fb: () => void) => {
        fallbacks.push(fb);
      }),
    });
    takeover.handle({ kind: 'home' });
    takeover.handle({ kind: 'details', id: 'x' });
    expect(options.mount).toHaveBeenCalledTimes(2);

    fallbacks[0]!();

    expect(options.unmount).not.toHaveBeenCalled();
    expect(document.documentElement.classList.contains('lmn-active')).toBe(true);
  });

  it('takes over library pages and favorites only when LibraryTakeover is on', () => {
    const off = create();
    off.takeover.handle({ kind: 'library', id: 'lib', collection: 'movies', tab: 'items' });
    off.takeover.handle({ kind: 'favorites' });
    expect(off.options.mount).not.toHaveBeenCalled();

    const on = create({ config: { ...config, LibraryTakeover: true } });
    on.takeover.handle({ kind: 'library', id: 'lib', collection: 'movies', tab: 'items' });
    expect(document.documentElement.classList.contains('lmn-route-library')).toBe(true);
    on.takeover.handle({ kind: 'library', id: 'lib', collection: 'movies', tab: 'items' });
    expect(on.options.mount).toHaveBeenCalledTimes(1);

    on.takeover.handle({ kind: 'favorites' });
    expect(on.options.mount).toHaveBeenCalledTimes(2);
    expect(document.documentElement.classList.contains('lmn-route-favorites')).toBe(true);
    expect(document.documentElement.classList.contains('lmn-route-library')).toBe(false);
  });

  it('frames settings pages without hiding them, when StyleStockPages is on', () => {
    const on = create({ config: { ...config, StyleStockPages: true } });
    on.takeover.handle({ kind: 'settings', page: 'playback' });
    const classes = document.documentElement.classList;
    expect(on.options.mount).toHaveBeenCalledTimes(1);
    expect(classes.contains('lmn-skin-settings')).toBe(true);
    expect(classes.contains('lmn-active')).toBe(false);

    on.takeover.handle({ kind: 'home' });
    expect(classes.contains('lmn-skin-settings')).toBe(false);
    expect(classes.contains('lmn-active')).toBe(true);
    on.takeover.release();

    const off = create({ config: { ...config, StyleStockPages: false } });
    off.takeover.handle({ kind: 'settings', page: 'playback' });
    expect(off.options.mount).not.toHaveBeenCalled();
  });
});
