import { afterEach, describe, expect, it, vi } from 'vitest';

describe('reloadIfReachable', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  const load = async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    const mod = await import('./reloadPage');
    return { mod, reload };
  };

  it('reloads when the server answers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 200 })),
    );
    const { mod, reload } = await load();
    expect(await mod.reloadIfReachable()).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      '../System/Info/Public',
      expect.objectContaining({ cache: 'no-store' }),
    );
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('stays put offline, when the server is down, or when it answers with an error: no browser error page', async () => {
    const { mod, reload } = await load();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValueOnce(false);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 200 })),
    );
    expect(await mod.reloadIfReachable()).toBe(false);
    expect(fetch).not.toHaveBeenCalled();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
    );
    expect(await mod.reloadIfReachable()).toBe(false);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 503 })),
    );
    expect(await mod.reloadIfReachable()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
