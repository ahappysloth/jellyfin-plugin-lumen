import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  defineWebPlugin,
  WEB_PLUGIN_KEY,
  WEB_PLUGIN_NAME,
  webPluginDeps,
  webPluginSlot,
  type WebPluginDeps,
} from './webPlugin';

type PluginClass = new (deps: WebPluginDeps) => { id: string; name: string; type: string };
const globals = window as unknown as Record<string, unknown>;

/** What jellyfin-web's pluginManager.loadPlugin does with a name that's on window (components/pluginManager.js). */
async function loadLikeJellyfinWeb(win: Window, deps: WebPluginDeps) {
  const definition = await (win as unknown as Record<string, unknown>)[WEB_PLUGIN_NAME];
  if (typeof definition !== 'function') throw new TypeError('not a function');
  const PluginClass = await (definition as () => unknown)();
  if (typeof PluginClass !== 'function') throw new TypeError('not a class');
  return new (PluginClass as PluginClass)(deps);
}

describe("Lumen's jellyfin-web plugin", () => {
  afterEach(() => {
    Reflect.deleteProperty(window, WEB_PLUGIN_NAME);
    Reflect.deleteProperty(window, WEB_PLUGIN_KEY);
    vi.resetModules();
    vi.doUnmock('../veil/runGuard');
    vi.doUnmock('../takeover/bootstrap');
  });

  it('loads the way jellyfin-web loads window plugins, and keeps what jellyfin-web passes it', async () => {
    const win = {} as Window;
    defineWebPlugin(win);
    expect(webPluginDeps(win)).toBeNull();

    const deps = { playbackManager: {}, ServerConnections: {}, events: {} };
    const plugin = await loadLikeJellyfinWeb(win, deps);

    expect(webPluginDeps(win)).toBe(deps);
    // An id for pluginManager's bookkeeping, and a type none of jellyfin-web's lookups (PluginType) ever ask for.
    expect(plugin.id).toBe(WEB_PLUGIN_NAME);
    expect(plugin.name).toBe('Lumen');
    expect(['mediaplayer', 'preplayintercept', 'screensaver', 'syncplay', 'skin']).not.toContain(plugin.type);
  });

  it('hands back the class synchronously: jellyfin-web awaits every plugin before it renders', () => {
    const win = {} as Window;
    defineWebPlugin(win);
    const definition = (win as unknown as Record<string, () => unknown>)[WEB_PLUGIN_NAME]!;
    expect(typeof definition()).toBe('function');
  });

  it('has nothing to read when no guard defined it', () => {
    expect(webPluginSlot({} as Window)).toBeNull();
    expect(webPluginDeps({} as Window)).toBeNull();
  });

  it('is defined by the inline guard even when the rest of the guard throws', async () => {
    vi.doMock('../veil/runGuard', () => ({
      runGuard: () => {
        throw new Error('boom');
      },
    }));
    await import('../veil/guard');
    expect(typeof globals[WEB_PLUGIN_NAME]).toBe('function');
    expect(webPluginSlot(window)).toEqual({});
  });

  it('is defined by lumen.js when the guard did not run (a Content-Security-Policy blocked it)', async () => {
    vi.doMock('../takeover/bootstrap', () => ({ startLumen: vi.fn() }));
    await import('../main');
    expect(typeof globals[WEB_PLUGIN_NAME]).toBe('function');
  });

  it("lumen.js keeps the guard's plugin, which jellyfin-web may already have loaded", async () => {
    defineWebPlugin(window);
    const deps = { playbackManager: {} };
    await loadLikeJellyfinWeb(window, deps);
    const definition = globals[WEB_PLUGIN_NAME];

    vi.doMock('../takeover/bootstrap', () => ({ startLumen: vi.fn() }));
    await import('../main');

    expect(globals[WEB_PLUGIN_NAME]).toBe(definition);
    expect(webPluginDeps(window)).toBe(deps);
  });
});
