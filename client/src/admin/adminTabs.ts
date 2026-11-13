/** The settings page's tabs, and how the open one is kept across a reload. */

export const ADMIN_TABS = ['settings', 'storage', 'health'] as const;
export type AdminTab = (typeof ADMIN_TABS)[number];

export const TAB_LABELS: Record<AdminTab, string> = {
  settings: 'Settings',
  storage: 'Storage',
  health: 'Health',
};

const isTab = (value: unknown): value is AdminTab => (ADMIN_TABS as readonly unknown[]).includes(value);

const STORAGE_KEY = 'lumen-admin-tab';

/** jellyfin-web's route is in the hash, its query after the `?`: `#/configurationpage?name=Lumen&tab=storage` (or `health`). */
function tabInHash(hash: string): AdminTab | null {
  const query = hash.indexOf('?');
  if (query < 0) return null;
  const tab = new URLSearchParams(hash.slice(query + 1)).get('tab');
  return isTab(tab) ? tab : null;
}

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * The tab to open with: the one a link names (`&tab=storage`), else the one last open in this browser tab, else
 * Settings.
 */
export function initialTab(hash: string, store: Storage | null = sessionStore()): AdminTab {
  const linked = tabInHash(hash);
  if (linked) return linked;
  try {
    const kept = store?.getItem(STORAGE_KEY);
    return isTab(kept) ? kept : 'settings';
  } catch {
    return 'settings';
  }
}

/**
 * Remembers the open tab for a reload in this browser tab. Not in the URL: jellyfin-web keeps a page it has left by
 * its exact URL, so a changed URL would have Back open a fresh copy, losing unsaved changes.
 */
export function rememberTab(tab: AdminTab, store: Storage | null = sessionStore()): void {
  try {
    if (tab === 'settings') store?.removeItem(STORAGE_KEY);
    else store?.setItem(STORAGE_KEY, tab);
  } catch {
    // Private modes may refuse storage: only a reload forgets the tab.
  }
}
