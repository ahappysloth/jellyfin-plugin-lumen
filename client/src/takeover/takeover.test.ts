import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientConfig } from '../api/types';
import type { CompatReport } from '../compat/jellyfin';
import { Takeover, type TakeoverOptions } from './takeover';

const config: ClientConfig = {
  Enabled: true,
  HomeTakeover: true,
  DetailsTakeover: false,
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
    expect(document.documentElement.classList.contains('lmn-home')).toBe(true);
    expect(options.mount).toHaveBeenCalledTimes(1);
  });

  it('leaves disabled routes and other routes to the stock UI', () => {
    const { takeover, options } = create();

    takeover.handle({ kind: 'details', id: 'a' });
    takeover.handle({ kind: 'other' });

    expect(options.mount).not.toHaveBeenCalled();
    expect(document.documentElement.classList.contains('lmn-active')).toBe(false);
  });

  it('reports a failed compatibility check once and never takes over', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { takeover, options } = create({ selfTest: vi.fn(() => ({ ok: false, failed: ['stockPage'] })) });

    takeover.handle({ kind: 'home' });
    takeover.handle({ kind: 'home' });

    expect(options.report).toHaveBeenCalledTimes(1);
    expect(options.mount).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('re-runs a failed compatibility check and takes over once it passes, reporting only once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const selfTest = vi
      .fn<() => CompatReport>()
      .mockReturnValueOnce({ ok: false, failed: ['stockPage'] })
      .mockReturnValue({ ok: true, failed: [] });
    const { takeover, options } = create({ selfTest });

    takeover.handle({ kind: 'home' });
    expect(options.mount).not.toHaveBeenCalled();

    takeover.handle({ kind: 'home' });
    takeover.handle({ kind: 'home' });

    expect(options.mount).toHaveBeenCalledTimes(1);
    expect(selfTest).toHaveBeenCalledTimes(2);
    expect(options.report).toHaveBeenCalledTimes(1);
    warn.mockRestore();
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
});
