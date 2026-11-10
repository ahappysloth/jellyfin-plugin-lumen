import { WEB_PLUGIN_KEY } from '../src/compat/webPlugin';

/**
 * Gives Lumen jellyfin-web's globalize as its web plugin would, reporting these locales (util/locale.ts asks it first).
 * Returns a function that takes it away again.
 */
export function setJellyfinLocale(language: string, dateTime: string = language): () => void {
  const globalize = { getCurrentLocale: () => language, getCurrentDateTimeLocale: () => dateTime };
  (window as unknown as Record<string, unknown>)[WEB_PLUGIN_KEY] = { deps: { globalize } };
  return () => Reflect.deleteProperty(window, WEB_PLUGIN_KEY);
}
