/**
 * The locales Lumen formats dates and numbers with: jellyfin-web's, so they follow the user's Jellyfin display language
 * and date/time format settings rather than the browser's. Lumen's text stays English (strings.ts); a German browser
 * with Jellyfin set to English shows "1,234 titles", and a German date setting shows "4. März 2010".
 *
 * jellyfin-web (lib/globalize/index.js updateCurrentCulture, the same in 10.11.11, 12.1 and 12.4):
 * - language: userSettings.language(), else getDefaultLanguage(): `<html data-culture>`, navigator.language,
 *   navigator.languages[0], then 'en-us'.
 * - date/time locale: userSettings.dateTimeLocale(), else the language.
 * Both settings live in localStorage under `${userId}-language` and `${userId}-datetimelocale` (appSettings.get).
 * Dates are formatted with the date/time locale (scripts/datetime.js); numbers inside translated text with the
 * language (globalize.translate), which is what Lumen's counts are.
 *
 * Lumen asks jellyfin-web's globalize first (handed to Lumen's web plugin, compat/webPlugin.ts): it has already done the
 * above and follows setting changes. Before it's loaded, or without the plugin, Lumen reads the same settings itself.
 * A tag Intl rejects (it throws RangeError on malformed ones) is skipped for the next; with none left, the browser's.
 */
import { getApiClient } from '../compat/jellyfin';
import { GLOBALIZE_METHODS, LOCALE_SETTINGS } from '../compat/registry';
import { webPluginDeps } from '../compat/webPlugin';

const checked = new Map<string, string | undefined>();

/** `tag` as Intl takes it, or undefined when it isn't a string Intl accepts. */
export function usableLocale(tag: unknown): string | undefined {
  if (typeof tag !== 'string' || !tag) return undefined;
  if (checked.has(tag)) return checked.get(tag);
  // jellyfin-web's normalizeLocaleName: 'pt_BR' -> 'pt-br' (Intl ignores case).
  let usable: string | undefined = tag.replace('_', '-');
  try {
    new Intl.NumberFormat(usable);
  } catch {
    usable = undefined;
  }
  checked.set(tag, usable);
  return usable;
}

function fromGlobalize(win: Window, method: string): unknown {
  const globalize = webPluginDeps(win)?.globalize as Record<string, unknown> | undefined;
  const fn = globalize?.[method];
  if (typeof fn !== 'function') return undefined;
  try {
    return (fn as () => unknown).call(globalize);
  } catch {
    return undefined;
  }
}

function storedSetting(win: Window, name: string): string | null {
  try {
    const userId = getApiClient(win)?.getCurrentUserId();
    return win.localStorage.getItem(userId ? `${userId}-${name}` : name);
  } catch {
    return null; // storage blocked, or no ApiClient method
  }
}

function firstUsable(candidates: (() => unknown)[]): string | undefined {
  for (const candidate of candidates) {
    const tag = usableLocale(candidate());
    if (tag) return tag;
  }
  return undefined;
}

/** The user's Jellyfin display language, for numbers; undefined means the browser's. */
export function languageLocale(win: Window = window): string | undefined {
  const nav = win.navigator as Navigator | undefined;
  return firstUsable([
    () => fromGlobalize(win, GLOBALIZE_METHODS.language),
    () => storedSetting(win, LOCALE_SETTINGS.language),
    () => win.document.documentElement.getAttribute('data-culture'),
    () => nav?.language,
    () => nav?.languages?.[0],
  ]);
}

/** The user's Jellyfin date/time locale, for dates and times; undefined means the browser's. */
export function dateTimeLocale(win: Window = window): string | undefined {
  return firstUsable([
    () => fromGlobalize(win, GLOBALIZE_METHODS.dateTimeLocale),
    () => storedSetting(win, LOCALE_SETTINGS.dateTimeLocale),
    () => languageLocale(win),
  ]);
}

/** "1,234" in the user's language. */
export function formatNumber(n: number, win: Window = window): string {
  return n.toLocaleString(languageLocale(win));
}

/** A date (no time) in the user's date/time locale. */
export function formatDate(date: Date, options: Intl.DateTimeFormatOptions, win: Window = window): string {
  return date.toLocaleDateString(dateTimeLocale(win), options);
}

/** A time of day in the user's date/time locale. */
export function formatTime(date: Date, options: Intl.DateTimeFormatOptions, win: Window = window): string {
  return date.toLocaleTimeString(dateTimeLocale(win), options);
}

/** A date and time in the user's date/time locale. */
export function formatDateTime(date: Date, win: Window = window): string {
  return date.toLocaleString(dateTimeLocale(win));
}
