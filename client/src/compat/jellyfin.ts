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
  getPublicSystemInfo?(): Promise<{ Version?: string }>;
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

/** Server version; the served web client matches it. ApiClient.appVersion() reports the native app's version, so it isn't used. */
export async function getServerVersion(client: JellyfinApiClient): Promise<string> {
  try {
    return (await client.getPublicSystemInfo?.())?.Version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
