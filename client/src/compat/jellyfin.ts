/**
 * Lumen's adapter to jellyfin-web: globals, the compatibility check, layout and the hashes Lumen links to. The names
 * themselves (selectors, routes, methods) live in ./registry.ts, the single list of jellyfin-web internals Lumen
 * depends on. Evidence for each is in docs/reference/jellyfin-web-12.1-notes.md. When jellyfin-web changes, fix it there.
 */
import {
  API_CLIENT_METHODS,
  LAYOUT_CLASSES,
  LIBRARY_ROUTES,
  LIST_PARAMS,
  PIGGY_BACKED_PARAMS,
  SETTINGS_ROUTES,
  STOCK_ROUTES,
  STOCK_SELECTORS,
} from './registry';

export interface AjaxRequest {
  type: 'GET' | 'POST' | 'DELETE';
  url: string;
  dataType?: 'json';
  data?: string;
  contentType?: string;
}

/** The subset of jellyfin-web's `window.ApiClient` that Lumen uses. */
export interface JellyfinApiClient {
  getCurrentUserId(): string | null;
  accessToken(): string | null;
  /** URL-encoded device id; the server stores the decoded form. */
  deviceId(): string;
  getUrl(name: string, params?: Record<string, unknown>): string;
  ajax(request: AjaxRequest): Promise<unknown>;
  getPublicSystemInfo?(): Promise<{ Version?: string; ServerName?: string }>;
  /** The connected server's id (jellyfin-web's ApiClient has it; absent in older or test clients). */
  serverId?(): string | null;
}

export const SELECTORS = {
  reactRoot: STOCK_SELECTORS.reactRoot.selector,
  /** Routed page content in both the Modern and Legacy layouts. Hidden via CSS only. */
  stockPage: STOCK_SELECTORS.stockPage.selector,
  backdrop: STOCK_SELECTORS.backdrop.selector,
  modernAppBar: STOCK_SELECTORS.modernAppBar.selector,
  legacyHeader: STOCK_SELECTORS.legacyHeader.selector,
} as const;

export type Layout = 'tv' | 'mobile' | 'desktop';

export interface CompatReport {
  ok: boolean;
  failed: string[];
}

type JellyfinWindow = Window & { ApiClient?: JellyfinApiClient; __LUMEN_FORCE_COMPAT_FAIL__?: boolean };

export function getApiClient(win: Window = window): JellyfinApiClient | undefined {
  return (win as JellyfinWindow).ApiClient;
}

export function getLayout(doc: Document = document): Layout {
  const classes = doc.documentElement.classList;
  if (classes.contains(LAYOUT_CLASSES.tv)) return 'tv';
  if (classes.contains(LAYOUT_CLASSES.mobile)) return 'mobile';
  return 'desktop';
}

/** Height of the visible fixed app bar (Modern) or header (Legacy), in CSS pixels. */
export function getAppBarHeight(doc: Document = document): number {
  for (const selector of [SELECTORS.modernAppBar, SELECTORS.legacyHeader]) {
    for (const element of Array.from(doc.querySelectorAll<HTMLElement>(selector))) {
      const height = element.getBoundingClientRect().height;
      if (height > 0) return Math.round(height);
    }
  }
  return 0;
}

export function selfTest(win: Window = window, doc: Document = document): CompatReport {
  if ((win as JellyfinWindow).__LUMEN_FORCE_COMPAT_FAIL__) return { ok: false, failed: ['forced'] };
  const client = getApiClient(win) as unknown as Record<string, unknown> | undefined;

  const checks: Record<string, boolean> = {
    apiClient: client !== undefined && API_CLIENT_METHODS.every((m) => typeof client[m] === 'function'),
    reactRoot: doc.querySelector(SELECTORS.reactRoot) !== null,
    stockPage: doc.querySelector(SELECTORS.stockPage) !== null,
    layoutClass: Object.values(LAYOUT_CLASSES).some((c) => doc.documentElement.classList.contains(c)),
    history: typeof win.history?.pushState === 'function' && typeof win.history?.replaceState === 'function',
    hashRouting: /^#!?\//.test(win.location.hash),
  };
  const failed = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
  return { ok: failed.length === 0, failed };
}

/** jellyfin-web's hash router follows a manual hash assignment (it fires popstate and hashchange). */
export function navigateTo(hash: string, win: Window = window): void {
  win.location.hash = hash;
}

export function detailsHash(itemId: string, serverId?: string): string {
  const server = serverId ? `&serverId=${encodeURIComponent(serverId)}` : '';
  return `#${STOCK_ROUTES.details}?id=${encodeURIComponent(itemId)}${server}`;
}

/** jellyfin-web's own library page for a user view (mirrors appRouter.getRouteUrl in 12.x). */
export function libraryHash(view: { Id: string; CollectionType?: string; ServerId?: string }): string {
  const id = encodeURIComponent(view.Id);
  const route = view.CollectionType ? LIBRARY_ROUTES[view.CollectionType] : undefined;
  if (route) return `#${route}?topParentId=${id}&collectionType=${view.CollectionType}`;
  const server = view.ServerId ? `&serverId=${encodeURIComponent(view.ServerId)}` : '';
  // Tagged so Lumen can take the Collections library over; jellyfin-web's list page ignores the extra parameter
  // (registry.ts PIGGY_BACKED_PARAMS), so without Lumen it's the stock list of the library.
  if (view.CollectionType === 'boxsets')
    return `#${STOCK_ROUTES.list}?parentId=${id}&${PIGGY_BACKED_PARAMS.collectionType}=boxsets${server}`;
  return `#${STOCK_ROUTES.list}?parentId=${id}${server}`;
}

/** A Movies or Shows library page on one of its tabs (jellyfin-web's `?tab=` index, registry.ts LIBRARY_TABS). */
export function libraryTabHash(id: string, collection: 'movies' | 'tvshows', tab: number): string {
  const base = libraryHash({ Id: id, CollectionType: collection });
  return tab === 0 ? base : `${base}&tab=${tab}`;
}

/** jellyfin-web's item list filtered to one genre or studio, optionally inside one library. */
export function facetHash(facet: 'genre' | 'studio', id: string, parentId?: string): string {
  const param = facet === 'genre' ? LIST_PARAMS.genre : LIST_PARAMS.studio;
  const parent = parentId ? `&${LIST_PARAMS.parent}=${encodeURIComponent(parentId)}` : '';
  return `#${STOCK_ROUTES.list}?${param}=${encodeURIComponent(id)}${parent}`;
}

/** jellyfin-web's item list filtered to one genre. */
export function genreHash(genreId: string, serverId?: string): string {
  const server = serverId ? `&serverId=${encodeURIComponent(serverId)}` : '';
  return `#${STOCK_ROUTES.list}?genreId=${encodeURIComponent(genreId)}${server}`;
}

export const HOME_HASH = `#${STOCK_ROUTES.home}`;
/** jellyfin-web's Favorites tab of home, which Lumen takes over. */
export const FAVORITES_HASH = `#${STOCK_ROUTES.home}?tab=1`;
export const SEARCH_HASH = `#${STOCK_ROUTES.search}`;
export const PREFERENCES_HASH = `#${STOCK_ROUTES.preferencesMenu}`;

/** The server's display name for the nav, or null. */
export async function getServerName(client: JellyfinApiClient): Promise<string | null> {
  try {
    return (await client.getPublicSystemInfo?.())?.ServerName ?? null;
  } catch {
    return null;
  }
}

/** Server version; the served web client matches it. ApiClient.appVersion() reports the native app's version, so it isn't used. */
export async function getServerVersion(client: JellyfinApiClient): Promise<string> {
  try {
    return (await client.getPublicSystemInfo?.())?.Version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Points the tab icon at Lumen's mark. jellyfin-web ships `<link rel="shortcut icon">`; it is updated in place (or
 * added) so browsers pick up the change without a reload.
 */
export function setFavicon(svg: string, doc: Document = document): void {
  const href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  const links = Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'));
  if (links.length === 0) {
    const link = doc.createElement('link');
    link.rel = 'icon';
    doc.head.appendChild(link);
    links.push(link);
  }
  for (const link of links) {
    link.type = 'image/svg+xml';
    link.href = href;
  }
}

type DashboardWindow = Window & { Dashboard?: { logout?: () => void } };

/** True when jellyfin-web exposes its sign-out (window.Dashboard.logout, all 10.9+ releases). */
export function canSignOut(win: Window = window): boolean {
  return typeof (win as DashboardWindow).Dashboard?.logout === 'function';
}

/** Signs out through jellyfin-web, which clears credentials and shows the login (or server select) page. */
export function signOut(win: Window = window): void {
  (win as DashboardWindow).Dashboard?.logout?.();
}

/** jellyfin-web's settings pages, linked from Lumen's profile page. */
const settingsHash = (path: string) => (userId: string) => `#${path}?userId=${encodeURIComponent(userId)}`;
export const SETTINGS_HASHES = {
  profile: settingsHash(SETTINGS_ROUTES.profile),
  quickConnect: settingsHash(SETTINGS_ROUTES.quickConnect),
  display: settingsHash(SETTINGS_ROUTES.display),
  home: settingsHash(SETTINGS_ROUTES.home),
  playback: settingsHash(SETTINGS_ROUTES.playback),
  subtitles: settingsHash(SETTINGS_ROUTES.subtitles),
  controls: settingsHash(SETTINGS_ROUTES.controls),
  dashboard: () => `#${STOCK_ROUTES.dashboard}`,
  metadata: () => `#${STOCK_ROUTES.metadata}`,
} as const;
