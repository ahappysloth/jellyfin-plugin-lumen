import { afterEach, describe, expect, it, vi } from 'vitest';
import { findSyncPlay, resetSyncPlayCache } from './syncPlay';
import { SYNCPLAY_MANAGER_METHODS } from './registry';
import { createEvents, createPluginManager, runDefiner } from '../../test/webPluginDefiner';
import { WEB_PLUGIN_NAME } from './webPlugin';

const manager = (): Record<string, unknown> =>
  Object.fromEntries(SYNCPLAY_MANAGER_METHODS.map((m) => [m, () => false]));
/** Babel-minified source of plugins/syncPlay/core/index.js: the export's keys survive. */
const CORE = 'var s=new o(r);t.default={Helper:i,Manager:s,PlayerFactory:r,Players:{GenericPlayer:a}}';

function fakeWebpack(modules: Record<string, { source: string; exports: unknown }>) {
  const required: string[] = [];
  const require = Object.assign(
    (id: string) => {
      required.push(id);
      return modules[id]!.exports;
    },
    { m: Object.fromEntries(Object.entries(modules).map(([id, m]) => [id, m.source])) },
  );
  const push = vi.fn((chunk: [unknown, unknown, (r: typeof require) => void]) => chunk[2](require));
  return { win: { webpackChunk: Object.assign([], { push }) } as unknown as Window, required };
}

describe('findSyncPlay', () => {
  afterEach(resetSyncPlayCache);

  it('finds the core module by its export keys and returns its Manager', () => {
    const m = manager();
    const { win, required } = fakeWebpack({
      '1': { source: 'x.Manager.isSyncPlayEnabled()', exports: {} },
      '2': { source: CORE, exports: { default: { Manager: m } } },
    });
    expect(findSyncPlay(win)).toBe(m);
    expect(required).toEqual(['2']);
  });

  it('returns null when the Manager lacks a method Lumen calls', () => {
    const m = manager();
    delete m.haltGroupPlayback;
    const { win } = fakeWebpack({ '2': { source: CORE, exports: { default: { Manager: m } } } });
    expect(findSyncPlay(win)).toBeNull();
  });

  it('requires nothing when two modules look like the core', () => {
    const { win, required } = fakeWebpack({
      '1': { source: CORE, exports: {} },
      '2': { source: CORE, exports: {} },
    });
    expect(findSyncPlay(win)).toBeNull();
    expect(required).toEqual([]);
  });

  it("reads the modules' code again only once more modules have loaded", () => {
    let reads = 0;
    const source = { toString: () => (reads++, 'nothing to see') } as unknown as string;
    const modules: Record<string, { source: string; exports: unknown }> = { '1': { source, exports: {} } };
    const { win } = fakeWebpack(modules);
    expect(findSyncPlay(win)).toBeNull();
    expect(findSyncPlay(win)).toBeNull();
    expect(reads).toBe(1);
  });

  /** `win` as jellyfin-web leaves it once it has loaded its plugins: Lumen's, and a SyncPlay plugin of `instance`. */
  async function withPlugins(win: Window, instance: unknown) {
    runDefiner(win);
    const pluginManager = createPluginManager(createEvents());
    await pluginManager.loadPlugin(win, { id: 'syncplay', type: 'syncplay', priority: 1, instance } as never);
    await pluginManager.loadPlugin(win, WEB_PLUGIN_NAME);
    return win;
  }

  it("takes the Manager of jellyfin-web's SyncPlay plugin, as its own UI does, without reading the bundle", async () => {
    const m = manager();
    const { win, required } = fakeWebpack({
      '2': { source: CORE, exports: { default: { Manager: manager() } } },
    });
    const push = (win as unknown as { webpackChunk: { push: ReturnType<typeof vi.fn> } }).webpackChunk.push;
    await withPlugins(win, { Helper: {}, Manager: m, PlayerFactory: {}, Players: {} });

    expect(findSyncPlay(win)).toBe(m);
    expect(push).not.toHaveBeenCalled();
    expect(required).toEqual([]);
  });

  it("searches the bundle when the SyncPlay plugin's Manager lacks a method, or there is no SyncPlay plugin", async () => {
    // (The plugin's Manager, when whole, is the one taken: the bundle's is another object here.)
    const whole = manager();
    const first = fakeWebpack({ '2': { source: CORE, exports: { default: { Manager: manager() } } } }).win;
    await withPlugins(first, { Manager: whole });
    expect(findSyncPlay(first)).toBe(whole);
    resetSyncPlayCache();

    const partial = manager();
    delete partial.getGroupInfo;
    const m = manager();
    const { win } = fakeWebpack({ '2': { source: CORE, exports: { default: { Manager: m } } } });
    await withPlugins(win, { Manager: partial });
    expect(findSyncPlay(win)).toBe(m);

    resetSyncPlayCache();
    const none = fakeWebpack({ '2': { source: CORE, exports: { default: { Manager: m } } } }).win;
    runDefiner(none);
    await createPluginManager(createEvents()).loadPlugin(none, WEB_PLUGIN_NAME);
    expect(findSyncPlay(none)).toBe(m);
  });

  it('returns null without webpack', () => {
    expect(findSyncPlay({} as Window)).toBeNull();
  });
});
