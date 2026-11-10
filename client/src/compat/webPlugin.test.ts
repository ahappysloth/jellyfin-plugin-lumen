import { Linter } from 'eslint';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEvents, createPluginManager, DEFINER_SOURCE, runDefiner } from '../../test/webPluginDefiner';
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

  it('keeps the pluginManager that registers it, and puts events.trigger back after that one call', async () => {
    const win = {} as Window;
    runDefiner(win);
    const events = createEvents();
    const trigger = events.trigger;
    const pluginManager = createPluginManager(events);
    const heard = vi.fn();
    events.on(pluginManager, 'registered', heard);

    // Another plugin registering first changes nothing.
    await pluginManager.loadPlugin(win, { id: 'syncplay', type: 'syncplay' });
    expect(events.trigger).toBe(trigger);
    const lumen = await pluginManager.loadPlugin(win, WEB_PLUGIN_NAME);

    expect(webPluginSlot(win)?.pluginManager).toBe(pluginManager);
    expect(events.trigger).toBe(trigger);
    // jellyfin-web's own listeners still hear Lumen's registration, with pluginManager as `this`.
    expect(heard).toHaveBeenCalledTimes(2);
    expect(heard).toHaveBeenLastCalledWith({ type: 'registered' }, lumen);
    expect(heard.mock.contexts[1]).toBe(pluginManager);
  });

  it("watches only trigger's next call: keeps no pluginManager when that isn't its registration", () => {
    const win = {} as Window;
    runDefiner(win);
    const events = createEvents();
    const trigger = events.trigger;
    const definition = (win as unknown as Record<string, () => new (d: WebPluginDeps) => unknown>)[
      WEB_PLUGIN_NAME
    ]!;
    new (definition())({ events });
    // Watching for its registration…
    expect(events.trigger).not.toBe(trigger);
    // …but the first call is something else.
    const other = {};
    events.trigger(other, 'registered', [{}]);
    expect(events.trigger).toBe(trigger);
    expect(webPluginSlot(win)?.pluginManager).toBeUndefined();

    // No events, or events without trigger (a jellyfin-web that changed): nothing to catch, nothing thrown.
    expect(() => new (definition())({})).not.toThrow();
    expect(() => new (definition())({ events: Object.freeze({ trigger }) })).not.toThrow();
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
