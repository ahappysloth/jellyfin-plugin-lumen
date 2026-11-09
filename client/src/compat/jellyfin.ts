/**
 * The ONLY module that knows jellyfin-web internals: globals, selectors, routes, and layout classes.
 * Evidence for each is in docs/reference/jellyfin-web-12.1-notes.md. When jellyfin-web changes, fix it here.
 */
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
}

export const SELECTORS = {
  reactRoot: '#reactRoot',
  /** Routed page content in both the Modern and Legacy layouts. Hidden via CSS only. */
  stockPage: '#reactRoot .skinBody',
  backdrop: '.backdropContainer',
  modernAppBar: '.MuiAppBar-root',
  legacyHeader: '.skinHeader',
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
  if (classes.contains('layout-tv')) return 'tv';
  if (classes.contains('layout-mobile')) return 'mobile';
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
    apiClient:
      client !== undefined &&
      ['getCurrentUserId', 'accessToken', 'deviceId', 'getUrl', 'ajax'].every(
        (m) => typeof client[m] === 'function',
      ),
    reactRoot: doc.querySelector(SELECTORS.reactRoot) !== null,
    stockPage: doc.querySelector(SELECTORS.stockPage) !== null,
    layoutClass: ['layout-tv', 'layout-mobile', 'layout-desktop'].some((c) =>
      doc.documentElement.classList.contains(c),
    ),
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
  return `#/details?id=${encodeURIComponent(itemId)}${server}`;
}

/** jellyfin-web's own library page for a user view (mirrors appRouter.getRouteUrl in 12.x). */
export function libraryHash(view: { Id: string; CollectionType?: string; ServerId?: string }): string {
  const id = encodeURIComponent(view.Id);
  const routes: Record<string, string> = {
    movies: 'movies',
    tvshows: 'tv',
    music: 'music',
    musicvideos: 'musicvideos',
    books: 'books',
    playlists: 'playlists',
  };
  const route = view.CollectionType ? routes[view.CollectionType] : undefined;
  if (route) return `#/${route}?topParentId=${id}&collectionType=${view.CollectionType}`;
  const server = view.ServerId ? `&serverId=${encodeURIComponent(view.ServerId)}` : '';
  return `#/list?parentId=${id}${server}`;
}

/** jellyfin-web's item list filtered to one genre. */
export function genreHash(genreId: string, serverId?: string): string {
  const server = serverId ? `&serverId=${encodeURIComponent(serverId)}` : '';
  return `#/list?genreId=${encodeURIComponent(genreId)}${server}`;
}

export const HOME_HASH = '#/home';
/** jellyfin-web's Favorites tab of home, which Lumen takes over. */
export const FAVORITES_HASH = '#/home?tab=1';
export const SEARCH_HASH = '#/search';
export const PREFERENCES_HASH = '#/mypreferencesmenu';

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
