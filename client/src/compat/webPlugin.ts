/**
 * Lumen's jellyfin-web plugin: jellyfin-web's supported way in. For each name in /web/config.json's `plugins` that is
 * also a key on `window`, jellyfin-web's pluginManager (components/pluginManager.js, the same in 10.11, 12.1–12.4 and
 * master) calls `await window[name]()`, constructs the class it returns with its core services (`playbackManager`,
 * `ServerConnections`, `events`, …) and registers the instance, all before it renders. compat/playbackManager.ts reads
 * the playback manager from here first.
 *
 * The plugin itself is webPluginDefiner.js: plain ES5, because the server inlines it into index.html as a script of its
 * own (Injection/HtmlInjector.cs), ahead of the guard, and jellyfin-web still supports browsers that can't parse
 * Lumen's ES2020 code. The server lists WEB_PLUGIN_NAME in config.json only while the page it served carries that
 * script (Injection/IndexHtmlMiddleware.cs); lumen.js runs it too (main.tsx).
 *
 * If the name is listed but not on window, jellyfin-web imports a module that doesn't exist and its plugin loading
 * fails (the stock UI still loads, with an error in the console), so the definer must not throw, and the instance
 * must be harmless: its type is none of jellyfin-web's (mediaplayer, preplayintercept, screensaver, syncplay), so
 * nothing jellyfin-web asks pluginManager for ever includes it.
 */

/** The name in config.json's `plugins`, and the window key jellyfin-web calls. Mirrors WebConfigInjector.PluginName. */
export const WEB_PLUGIN_NAME = 'LumenWebPlugin';
/** Where the plugin keeps what jellyfin-web gave it. */
export const WEB_PLUGIN_KEY = '__lmnWebPlugin';

/** What jellyfin-web passes the plugin's constructor (the parts Lumen may use; all unchecked). */
export interface WebPluginDeps {
  playbackManager?: unknown;
  /** lib/globalize: util/locale.ts asks it for the user's language and date/time locale. */
  globalize?: unknown;
  ServerConnections?: unknown;
  events?: unknown;
}

export interface WebPluginSlot {
  /** Set when jellyfin-web constructs the plugin. */
  deps?: WebPluginDeps;
  /** How lumen.js found the playback manager (set by compat/playbackManager.ts; e2e and debugging read it). */
  via?: 'plugin' | 'webpack';
}

/** The plugin's slot, or null when nothing defined the plugin. */
export function webPluginSlot(win: Window): WebPluginSlot | null {
  const slot = (win as unknown as Record<string, unknown>)[WEB_PLUGIN_KEY];
  return slot && typeof slot === 'object' ? (slot as WebPluginSlot) : null;
}

/** What jellyfin-web gave the plugin, or null before it loaded its plugins (or when it never will). */
export function webPluginDeps(win: Window): WebPluginDeps | null {
  const deps = webPluginSlot(win)?.deps;
  return deps && typeof deps === 'object' ? deps : null;
}
