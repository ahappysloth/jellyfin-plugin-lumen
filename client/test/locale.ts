import { WEB_PLUGIN_KEY } from '../src/compat/webPlugin';

/**
 * Gives Lumen jellyfin-web's globalize as its web plugin would, reporting these locales (util/locale.ts asks it first).
 * Returns a function that takes it away again.
 */
export function setJellyfinLocale(language: string, dateTime: string = language): () => void {
  const globalize = { getCurrentLocale: () => language, getCurrentDateTimeLocale: () => dateTime };
  const slots = window as unknown as Record<string, unknown>;
  const had = WEB_PLUGIN_KEY in slots;
  const before = slots[WEB_PLUGIN_KEY];
  slots[WEB_PLUGIN_KEY] = { deps: { globalize } };
  // Put back whatever was there, so a test that set up the plugin itself keeps it.
  return () => {
    if (had) slots[WEB_PLUGIN_KEY] = before;
    else Reflect.deleteProperty(window, WEB_PLUGIN_KEY);
  };
}
