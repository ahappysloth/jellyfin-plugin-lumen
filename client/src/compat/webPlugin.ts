/**
 * Lumen's jellyfin-web plugin: jellyfin-web's supported way in. For each name in /web/config.json's `plugins` that is
 * also a key on `window`, jellyfin-web's pluginManager (components/pluginManager.js, the same in 10.11, 12.1–12.4 and
 * master) calls `await window[name]()`, constructs the class it returns with its core services (`playbackManager`,
 * `ServerConnections`, `events`, …) and registers the instance, all before it renders. The server lists
 * WEB_PLUGIN_NAME in config.json (Injection/IndexHtmlMiddleware.cs) only while it inlines the guard that defines it;
 * the guard keeps the services on window[WEB_PLUGIN_KEY] for lumen.js (compat/playbackManager.ts reads them first).
 *
 * If the name is listed but not on window, jellyfin-web imports a module that doesn't exist and its plugin loading
 * fails (the stock UI still loads, with an error in the console), so the definition must always run, must not throw,
 * and the instance must be harmless: its type is none of jellyfin-web's (mediaplayer, preplayintercept, screensaver,
 * syncplay), so nothing jellyfin-web asks pluginManager for ever includes it.
 *
 * Pure apart from the window it's given, and import-free: the inline guard bundles it.
 */

/** The name in config.json's `plugins`, and the window key jellyfin-web calls. Mirrors WebConfigInjector.PluginName. */
export const WEB_PLUGIN_NAME = 'LumenWebPlugin';
/** Where the plugin keeps what jellyfin-web gave it. */
export const WEB_PLUGIN_KEY = '__lmnWebPlugin';

/** What jellyfin-web passes the plugin's constructor (the parts Lumen may use; all unchecked). */
export interface WebPluginDeps {
  playbackManager?: unknown;
  ServerConnections?: unknown;
  events?: unknown;
}

export interface WebPluginSlot {
  /** Set when jellyfin-web constructs the plugin. */
  deps?: WebPluginDeps;
  /** How lumen.js found the playback manager (set by compat/playbackManager.ts; e2e and debugging read it). */
  via?: 'plugin' | 'webpack';
}

const slots = (win: Window): Record<string, unknown> => win as unknown as Record<string, unknown>;

/** Defines window[WEB_PLUGIN_NAME] for jellyfin-web's pluginManager. Returns synchronously; nothing it defines throws. */
export function defineWebPlugin(win: Window): void {
  const slot: WebPluginSlot = {};
  slots(win)[WEB_PLUGIN_KEY] = slot;
  slots(win)[WEB_PLUGIN_NAME] = () =>
    class {
      id = WEB_PLUGIN_NAME;
      name = 'Lumen';
      type = 'lumen';
      constructor(deps: WebPluginDeps) {
        slot.deps = deps;
      }
    };
}

/** The plugin's slot, or null when no guard (and no lumen.js fallback) defined the plugin. */
export function webPluginSlot(win: Window): WebPluginSlot | null {
  const slot = slots(win)[WEB_PLUGIN_KEY];
  return slot && typeof slot === 'object' ? (slot as WebPluginSlot) : null;
}

/** What jellyfin-web gave the plugin, or null before it loaded its plugins (or when it never will). */
export function webPluginDeps(win: Window): WebPluginDeps | null {
  const deps = webPluginSlot(win)?.deps;
  return deps && typeof deps === 'object' ? deps : null;
}
