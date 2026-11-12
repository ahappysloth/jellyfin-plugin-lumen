/** The settings page's tabs, and how the open one is kept in the page's URL across a reload. */

export const ADMIN_TABS = ['settings', 'storage'] as const;
export type AdminTab = (typeof ADMIN_TABS)[number];

export const TAB_LABELS: Record<AdminTab, string> = { settings: 'Settings', storage: 'Storage' };

/** jellyfin-web's route is in the hash, its query after the `?`: `#/configurationpage?name=Lumen&tab=storage`. */
function splitHash(hash: string): [string, URLSearchParams] {
  const query = hash.indexOf('?');
  return query < 0
    ? [hash, new URLSearchParams()]
    : [hash.slice(0, query), new URLSearchParams(hash.slice(query + 1))];
}

export function tabFromHash(hash: string): AdminTab {
  return splitHash(hash)[1].get('tab') === 'storage' ? 'storage' : 'settings';
}

/** The hash with `tab` set (or, for the first tab, left out), and the rest of its query as it was. */
export function hashWithTab(hash: string, tab: AdminTab): string {
  const [route, params] = splitHash(hash);
  if (tab === 'settings') params.delete('tab');
  else params.set('tab', tab);
  const query = params.toString();
  return query ? `${route}?${query}` : route;
}

/**
 * Writes the tab into the address bar without navigating: a changed hash would have jellyfin-web's router open the page
 * again (as a new copy beside this one), and replaceState fires no hashchange. Its history state is kept, since
 * jellyfin-web's router keeps its place in the history there.
 */
export function rememberTab(tab: AdminTab, win: Window = window): void {
  const next = hashWithTab(win.location.hash, tab);
  if (next === win.location.hash) return;
  try {
    win.history.replaceState(win.history.state, '', next || '#');
  } catch {
    // Only the reload would forget the tab.
  }
}
