/**
 * Lumen's adapter to jellyfin-web: globals, the compatibility check, layout and the hashes Lumen links to. The names
 * themselves (selectors, routes, methods) live in ./registry.ts, the single list of jellyfin-web internals Lumen
 * depends on. Evidence for each is in docs/reference/jellyfin-web-12.1-notes.md. When jellyfin-web changes, fix it there.
 */
import {
  API_CLIENT_METHODS,
  APP_FEATURES,
  BACK_KEY_CODES,
  LAYOUT_CLASSES,
  LAYOUT_SETTING_KEY,
  LEGACY_LAYOUT_MODES,
  LIBRARY_ROUTES,
  LIST_PARAMS,
  LIVE_TV_ROUTE,
  METADATA_ITEM_PARAM,
  MODERN_LIBRARY_ROUTES,
  PIGGY_BACKED_PARAMS,
  SETTINGS_ROUTES,
  STOCK_ROUTES,
  STOCK_SELECTORS,
  WEB_CONFIG,
} from './registry';
import { webPluginDeps } from './webPlugin';

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
  /**
   * The server's web socket messages of these types (compat/registry.ts: RESTART_MESSAGES, and LibraryChanged as
   * jellyfin-web's own pages listen for it). Returns an unsubscribe, but isn't typed by jellyfin-web: check that it's a
   * function before calling it, and check `subscribe` is one too.
   */
  subscribe?(
    types: string[],
    onMessage: (message: { MessageType?: string; Data?: unknown }) => void,
  ): unknown;
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

/**
 * True when jellyfin-web runs its Modern app rather than the Legacy one (its `layoutManager.modern`, which it doesn't
 * expose). The TV layout is always Legacy; `desktop-legacy` and `mobile-legacy` are only known from the saved setting.
 * Nothing saved (or `auto`) is Modern outside the TV layout, in a browser and in the iOS and Android apps.
 */
export function isModernLayout(doc: Document = document, win: Window = window): boolean {
  if (getLayout(doc) === 'tv') return false;
  let saved: string | null = null;
  try {
    saved = win.localStorage.getItem(LAYOUT_SETTING_KEY);
  } catch {
    // storage blocked: jellyfin-web couldn't have saved a layout either
  }
  return !(saved && LEGACY_LAYOUT_MODES.includes(saved));
}

/**
 * jellyfin-web's `browser.tv && browser.hisense && browser.vidaa` (scripts/browser.js `detectBrowser`, `isTv`): a
 * Hisense VIDAA TV, whose remote's Back arrives as Backspace (scripts/keyboardNavigation.js).
 */
export function isHisenseVidaaTv(userAgent: string): boolean {
  const ua = userAgent.toLowerCase();
  if (!ua.includes('hisense') || !ua.includes('vidaa')) return false;
  const isTv =
    !ua.includes('oculusbrowser') &&
    ['tv', 'viera', 'titanos', 'netcast', 'web0s'].some((t) => ua.includes(t));
  return isTv || ['playstation 4', 'kepler', 'xbox'].some((t) => ua.includes(t));
}

/** Where Backspace edits text, so it's never Back (jellyfin-web's isInteractiveElement). */
function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLTextAreaElement || target.isContentEditable) return true;
  const nonText = ['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'reset', 'submit'];
  return target instanceof HTMLInputElement && !nonText.includes(target.type);
}

/**
 * Escape, or a TV remote's or gamepad's Back (registry.ts BACK_KEY_CODES; Backspace on a Hisense VIDAA TV, outside a
 * text field). An overlay that closes on it must also
 * preventDefault and stopPropagation: jellyfin-web's own handler, on `window` in the bubble phase, would otherwise go
 * back a page as well. A handler on Lumen's element runs before it; jellyfin-web's capture-phase keydown listeners (the
 * screensaver's, the video OSD's idle timer) don't act on Back.
 */
export function isBackKey(e: KeyboardEvent, userAgent: string = navigator.userAgent): boolean {
  // keyCode is deprecated, but it is all webOS and Tizen remotes report (their `key` is often "Unidentified").
  if (e.key === 'Escape' || BACK_KEY_CODES.includes(e.keyCode)) return true;
  return e.key === 'Backspace' && isHisenseVidaaTv(userAgent) && !isTextField(e.target);
}

/**
 * A Back that jellyfin-web goes back on in every layout: a TV remote's Back (webOS 461, Tizen 10009, Hisense VIDAA's
 * Backspace). Escape and a gamepad's B (keyCodes 27 and 196, both "Escape" to jellyfin-web) go back only in the TV
 * layout (scripts/keyboardNavigation.js).
 */
export function isRemoteBack(e: KeyboardEvent, userAgent: string = navigator.userAgent): boolean {
  // jellyfin-web reads the keyCode first.
  if (e.keyCode === 461 || e.keyCode === 10009) return true;
  return e.key === 'Backspace' && isBackKey(e, userAgent);
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
/**
 * jellyfin-web's 404 page is up showing only its own content: one block of heading, message and Go Home link. A plugin
 * may draw its own page into it for a route jellyfin-web doesn't know (e.g. a custom hash), and then it isn't a 404.
 */
export function isStockNotFound(doc: Document = document): boolean {
  const page = doc.querySelector(STOCK_SELECTORS.notFoundPage.selector);
  const content = page?.firstElementChild;
  if (
    !page ||
    !content ||
    page.children.length !== 1 ||
    !content.matches(STOCK_SELECTORS.notFoundContent.selector)
  )
    return false;
  const [heading, message, home] = Array.from(content.children);
  return (
    content.children.length === 3 &&
    heading!.tagName === 'H1' &&
    message!.tagName === 'P' &&
    home!.matches(STOCK_SELECTORS.notFoundHomeLink.selector)
  );
}

export function navigateTo(hash: string, win: Window = window): void {
  win.location.hash = hash;
}

export function detailsHash(itemId: string, serverId?: string): string {
  const server = serverId ? `&serverId=${encodeURIComponent(serverId)}` : '';
  return `#${STOCK_ROUTES.details}?id=${encodeURIComponent(itemId)}${server}`;
}

/**
 * jellyfin-web's own library page for a user view (mirrors appRouter.getRouteUrl in 12.x). Some library pages exist
 * only in the Modern layout (registry.ts MODERN_LIBRARY_ROUTES); `modern` defaults to the running layout.
 */
export function libraryHash(
  view: { Id: string; CollectionType?: string; ServerId?: string },
  modern: boolean = isModernLayout(),
): string {
  const id = encodeURIComponent(view.Id);
  if (view.CollectionType === 'livetv') return `#${LIVE_TV_ROUTE}?collectionType=livetv`;
  const route = view.CollectionType
    ? (LIBRARY_ROUTES[view.CollectionType] ??
      (modern ? MODERN_LIBRARY_ROUTES[view.CollectionType] : undefined))
    : undefined;
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
  const base = libraryHash({ Id: id, CollectionType: collection }, true); // both routes exist in every layout
  return tab === 0 ? base : `${base}&tab=${tab}`;
}

/** jellyfin-web's item list filtered to one genre or studio, optionally inside one library. */
export function facetHash(facet: 'genre' | 'studio', id: string, parentId?: string): string {
  const param = facet === 'genre' ? LIST_PARAMS.genre : LIST_PARAMS.studio;
  const parent = parentId ? `&${LIST_PARAMS.parent}=${encodeURIComponent(parentId)}` : '';
  return `#${STOCK_ROUTES.list}?${param}=${encodeURIComponent(id)}${parent}`;
}

/** jellyfin-web's metadata manager, opened on one item (administrators only). */
export function metadataHash(itemId: string): string {
  return `#${STOCK_ROUTES.metadata}?${METADATA_ITEM_PARAM}=${encodeURIComponent(itemId)}`;
}

/** jellyfin-web's item list filtered to one genre. */
export function genreHash(genreId: string, serverId?: string): string {
  const server = serverId ? `&serverId=${encodeURIComponent(serverId)}` : '';
  return `#${STOCK_ROUTES.list}?genreId=${encodeURIComponent(genreId)}${server}`;
}

/** An item's page: where its card links to and its menu's "More info" goes. */
export function infoHash(item: { Id: string; Type: string; ServerId?: string }): string {
  return item.Type === 'Genre' ? genreHash(item.Id, item.ServerId) : detailsHash(item.Id, item.ServerId);
}

export const HOME_HASH = `#${STOCK_ROUTES.home}`;
/** jellyfin-web's Favorites tab of home, which Lumen takes over. */
export const FAVORITES_HASH = `#${STOCK_ROUTES.home}?tab=1`;
export const SEARCH_HASH = `#${STOCK_ROUTES.search}`;
export const PREFERENCES_HASH = `#${STOCK_ROUTES.preferencesMenu}`;
/** Lumen's watch history: a page jellyfin-web doesn't have, so it rides on home (PIGGY_BACKED_PARAMS). */
export const HISTORY_HASH = `#${STOCK_ROUTES.home}?${PIGGY_BACKED_PARAMS.lumenPage}=history`;

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

type DashboardWindow = Window & { Dashboard?: { logout?: () => void; selectServer?: () => void } };

/** True when jellyfin-web exposes its sign-out (window.Dashboard.logout, all 10.9+ releases). */
export function canSignOut(win: Window = window): boolean {
  return typeof (win as DashboardWindow).Dashboard?.logout === 'function';
}

/** Signs out through jellyfin-web, which clears credentials and shows the login (or server select) page. */
export function signOut(win: Window = window): void {
  (win as DashboardWindow).Dashboard?.logout?.();
}

/** True when jellyfin-web exposes Select server (window.Dashboard.selectServer). */
export function canSelectServer(win: Window = window): boolean {
  return typeof (win as DashboardWindow).Dashboard?.selectServer === 'function';
}

/** jellyfin-web's Select server: the app's own server list, or its `#/selectserver` page in a browser. */
export function selectServer(win: Window = window): void {
  (win as DashboardWindow).Dashboard?.selectServer?.();
}

export type AppFeature = (typeof APP_FEATURES)[keyof typeof APP_FEATURES];

interface NativeShell {
  AppHost?: { supports?: (feature: string) => boolean; exit?: () => void };
  openClientSettings?: () => void;
  openDownloadManager?: () => void;
}
const nativeShell = (win: Window): NativeShell | undefined =>
  (win as Window & { NativeShell?: NativeShell }).NativeShell;

/** jellyfin-web's own answer (appHost.supports, from Lumen's web plugin), or undefined without the plugin. */
function appHostSupports(feature: AppFeature, win: Window): boolean | undefined {
  const appHost = webPluginDeps(win)?.appHost as { supports?: (feature: string) => unknown } | undefined;
  if (typeof appHost?.supports !== 'function') return undefined;
  try {
    return appHost.supports(feature) === true;
  } catch {
    return undefined;
  }
}

/**
 * Whether the app around jellyfin-web offers `feature`, as jellyfin-web's user menu decides it: its appHost when
 * Lumen's web plugin has it; otherwise the official app's NativeShell (false in a browser).
 */
export function appSupports(feature: AppFeature, win: Window = window): boolean {
  const known = appHostSupports(feature, win);
  if (known !== undefined) return known;
  try {
    return nativeShell(win)?.AppHost?.supports?.(feature) === true;
  } catch {
    return false;
  }
}

/** The app's own screens and actions, offered only where appSupports() says so (as jellyfin-web's user menu does). */
export const appActions = {
  /** jellyfin-web's appHost.exit() (it knows Tizen's and webOS's ways out too), else the official app's. */
  exit: (win: Window = window) => {
    const appHost = webPluginDeps(win)?.appHost as { exit?: () => void } | undefined;
    if (typeof appHost?.exit === 'function') appHost.exit();
    else nativeShell(win)?.AppHost?.exit?.();
  },
  clientSettings: (win: Window = window) => nativeShell(win)?.openClientSettings?.(),
  downloadManager: (win: Window = window) => nativeShell(win)?.openDownloadManager?.(),
};

let multiServer: Promise<boolean> | null = null;

/**
 * Whether this client can switch servers (jellyfin-web's AppFeature.MultiServer): jellyfin-web's appHost says so, or
 * without it, the app does, or in a browser the web config turns it on (fetched once per page load; failing, it's
 * off, as in jellyfin-web).
 */
export function supportsMultiServer(win: Window = window): Promise<boolean> {
  const known = appHostSupports(APP_FEATURES.multiServer, win);
  if (known !== undefined) return Promise.resolve(known);
  if (nativeShell(win)) return Promise.resolve(appSupports(APP_FEATURES.multiServer, win));
  multiServer ??= win
    .fetch(WEB_CONFIG.file)
    .then((r): Promise<Record<string, unknown>> | object => (r.ok ? r.json() : {}))
    .then((config) => (config as Record<string, unknown>)[WEB_CONFIG.multiServer] === true)
    .catch(() => false);
  return multiServer;
}

/** For tests: forget the fetched web config. */
export function resetMultiServer(): void {
  multiServer = null;
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
