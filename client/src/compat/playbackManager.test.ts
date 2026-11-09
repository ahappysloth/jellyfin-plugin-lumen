import { afterEach, describe, expect, it, vi } from 'vitest';
import { findPlaybackManager, getPlaybackManager, resetPlaybackManagerCache } from './playbackManager';
import { PLAYBACK_MANAGER_METHODS } from './registry';

const fullManager = (): Record<string, unknown> =>
  Object.fromEntries(PLAYBACK_MANAGER_METHODS.required.map((m) => [m, () => undefined]));

/** The source of jellyfin-web's playbackmanager module, minified by Babel (its class keys are quoted). */
const PM_SOURCE =
  'key:"getCurrentPlayer",value:function(){return this._currentPlayer} setMaxStreamingBitrate';

interface FakeModule {
  source: string;
  exports: Record<string, unknown>;
  /** Already run by jellyfin-web (in webpack's module cache). */
  loaded?: boolean;
}

/** A stand-in for jellyfin-web's webpack runtime: `push` hands chunk runtimes the module loader. */
function fakeWebpack(modules: Record<string, FakeModule>, { exposeCache = false } = {}) {
  const required: string[] = [];
  const m: Record<string, string> = Object.fromEntries(
    Object.entries(modules).map(([id, mod]) => [id, mod.source]),
  );
  const require = Object.assign(
    (id: string) => {
      required.push(id);
      return modules[id]!.exports;
    },
    {
      m,
      ...(exposeCache
        ? {
            c: Object.fromEntries(
              Object.entries(modules)
                .filter(([, m]) => m.loaded)
                .map(([id, m]) => [id, { exports: m.exports }]),
            ),
          }
        : {}),
    },
  );
  const push = vi.fn((chunk: [unknown, unknown, (r: typeof require) => void]) => chunk[2](require));
  const win = { webpackChunk: Object.assign([], { push }) } as unknown as Window;
  return { win, required, push, modules, m };
}

describe('findPlaybackManager', () => {
  afterEach(resetPlaybackManagerCache);

  it("finds jellyfin-web's playback manager by shape, not by module id", () => {
    const manager = fullManager();
    const { win } = fakeWebpack({
      '1': {
        source: 'x.getCurrentPlayer() setMaxStreamingBitrate',
        exports: { a: { getCurrentPlayer: 'x' } },
      },
      '68221': { source: PM_SOURCE, exports: { g: 1, f: manager } },
    });
    expect(getPlaybackManager(win)).toBe(manager);
  });

  it('requires only the module that defines the manager, never one that merely calls it', () => {
    const { win, required } = fakeWebpack({
      '1': { source: 'p.getCurrentPlayer();p.setMaxStreamingBitrate()', exports: {} },
      '2': { source: PM_SOURCE, exports: { f: fullManager() } },
    });
    findPlaybackManager(win);
    expect(required).toEqual(['2']);
  });

  it('requires nothing when more than one module could be the manager', () => {
    const { win, required } = fakeWebpack({
      '1': { source: PM_SOURCE, exports: { f: fullManager() } },
      '2': { source: PM_SOURCE, exports: { f: fullManager() } },
    });
    expect(findPlaybackManager(win)).toEqual({ manager: null, failed: ['playbackManager:ambiguous'] });
    expect(required).toEqual([]);
  });

  it("reads only modules already in webpack's cache when the build exposes it", () => {
    const manager = fullManager();
    const notLoaded = fakeWebpack(
      { '2': { source: PM_SOURCE, exports: { f: manager }, loaded: false } },
      { exposeCache: true },
    );
    expect(findPlaybackManager(notLoaded.win)).toEqual({
      manager: null,
      failed: ['playbackManager:notLoaded'],
    });
    expect(notLoaded.required).toEqual([]);

    const loaded = fakeWebpack(
      {
        '1': { source: PM_SOURCE, exports: {}, loaded: false },
        '2': { source: PM_SOURCE, exports: { f: manager }, loaded: true },
      },
      { exposeCache: true },
    );
    expect(findPlaybackManager(loaded.win).manager).toBe(manager);
    expect(loaded.required).toEqual([]);
  });

  it('names the methods a renamed manager is missing', () => {
    const partial = fullManager();
    delete partial.seek;
    delete partial.getPlaylist;
    const { win } = fakeWebpack({ '2': { source: PM_SOURCE, exports: { f: partial, g: {} } } });
    expect(findPlaybackManager(win)).toEqual({
      manager: null,
      failed: ['playbackManager.seek', 'playbackManager.getPlaylist'],
    });
  });

  it('says why when there is no webpack runtime or no such module', () => {
    expect(findPlaybackManager({} as Window).failed).toEqual(['playbackManager:webpack']);
    const { win } = fakeWebpack({ '1': { source: 'nothing', exports: {} } });
    expect(findPlaybackManager(win).failed).toEqual(['playbackManager:module']);
  });

  it("doesn't remember a miss: a later look finds a manager that has loaded since", () => {
    const { win, modules, m } = fakeWebpack({ '1': { source: 'nothing', exports: {} } });
    expect(getPlaybackManager(win)).toBeNull();

    // A lazily loaded chunk adds its modules to webpack's live registry.
    const manager = fullManager();
    modules['2'] = { source: PM_SOURCE, exports: { f: manager } };
    m['2'] = PM_SOURCE;
    expect(getPlaybackManager(win)).toBe(manager);
  });
});
