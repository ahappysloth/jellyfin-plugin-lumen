import { Linter } from 'eslint';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFINER_SOURCE, runDefiner } from '../../test/webPluginDefiner';
import {
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
    vi.doUnmock('../takeover/bootstrap');
  });

  it('is plain ES5, so browsers jellyfin-web supports but Lumen does not still define it', () => {
    const messages = new Linter().verify(DEFINER_SOURCE, {
      languageOptions: { ecmaVersion: 5, sourceType: 'script' },
    });
    expect(messages.filter((m) => m.fatal)).toEqual([]);
    // The check itself rejects newer syntax.
    const modern = new Linter().verify('let a = () => 1;', {
      languageOptions: { ecmaVersion: 5, sourceType: 'script' },
    });
    expect(modern.some((m) => m.fatal)).toBe(true);
  });

  it('loads the way jellyfin-web loads window plugins, and keeps what jellyfin-web passes it', async () => {
    const win = {} as Window;
    runDefiner(win);
    expect(webPluginSlot(win)).toEqual({});
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
    runDefiner(win);
    const definition = (win as unknown as Record<string, () => unknown>)[WEB_PLUGIN_NAME]!;
    expect(typeof definition()).toBe('function');
  });

  it('keeps a plugin already defined, which jellyfin-web may already have loaded', async () => {
    const win = {} as Window;
    runDefiner(win);
    const deps = { playbackManager: {} };
    await loadLikeJellyfinWeb(win, deps);
    const definition = (win as unknown as Record<string, unknown>)[WEB_PLUGIN_NAME];

    runDefiner(win);

    expect((win as unknown as Record<string, unknown>)[WEB_PLUGIN_NAME]).toBe(definition);
    expect(webPluginDeps(win)).toBe(deps);
  });

  it('never throws, even on a window it cannot write to', () => {
    expect(() => runDefiner(Object.freeze({}) as Window)).not.toThrow();
    expect(() => runDefiner(null as unknown as Window)).not.toThrow();
  });

  it('has nothing to read when nothing defined it', () => {
    expect(webPluginSlot({} as Window)).toBeNull();
    expect(webPluginDeps({} as Window)).toBeNull();
  });

  it('is defined by lumen.js when the page has no inline definer', async () => {
    vi.doMock('../takeover/bootstrap', () => ({ startLumen: vi.fn() }));
    await import('../main');
    expect(typeof globals[WEB_PLUGIN_NAME]).toBe('function');
    expect(webPluginSlot(window)).toEqual({});
  });
});
