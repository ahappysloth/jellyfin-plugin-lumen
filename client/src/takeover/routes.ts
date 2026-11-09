import {
  LIBRARY_ROUTES,
  PIGGY_BACKED_PARAMS,
  SETTINGS_ROUTES,
  SIGN_IN_ROUTES,
  STOCK_ROUTES,
} from '../compat/registry';

export type LibraryCollection = 'movies' | 'tvshows' | 'boxsets';

export type Route =
  | { kind: 'home' }
  | { kind: 'details'; id: string; serverId?: string }
  | { kind: 'library'; id: string; collection: LibraryCollection }
  | { kind: 'favorites' }
  | { kind: 'genre'; id: string; parentId?: string }
  | { kind: 'search'; query: string }
  | { kind: 'title'; mediaType: 'movie' | 'tv'; tmdbId: number }
  | { kind: 'profile' }
  /** A stock settings page Lumen restyles and frames with its own nav; the page itself stays jellyfin-web's. */
  | { kind: 'settings'; page: SettingsPage }
  /** jellyfin-web's video player: Lumen draws its controls over it; playback stays jellyfin-web's. */
  | { kind: 'player' }
  | { kind: 'other' };
export type TakeoverRoute = Exclude<Route, { kind: 'other' }>;

const ITEM_ID = /^[0-9a-f]{32}$|^[0-9a-f-]{36}$/i;
export type SettingsPage =
  'profile' | 'quickConnect' | 'display' | 'home' | 'playback' | 'subtitles' | 'controls';
const SETTINGS_PATHS: Record<string, SettingsPage> = Object.fromEntries(
  Object.entries(SETTINGS_ROUTES).map(([page, path]) => [path, page as SettingsPage]),
);
/** jellyfin-web's signed-out pages, which Lumen restyles (CSS only; see veil/skin.ts). */
export const SIGN_IN_PATHS = SIGN_IN_ROUTES;

const TITLE_KEY = /^(movie|tv)-([1-9][0-9]{0,9})$/;
const LIBRARY_PATHS: Record<string, LibraryCollection> = {
  [LIBRARY_ROUTES.movies!]: 'movies',
  [LIBRARY_ROUTES.tvshows!]: 'tvshows',
};

/**
 * Maps jellyfin-web hash routes to Lumen routes. Home tab 0 is Lumen's home and tab 1 its Favorites; the Movies and
 * Shows library pages are taken over on their default tab only (Suggestions, Genres, etc. stay stock). Search and the
 * settings menu (#/mypreferencesmenu) are Lumen's too; the settings pages they link to stay stock.
 */
export function parseRoute(hash: string): Route {
  const value = hash.replace(/^#!?/, '');
  const queryStart = value.indexOf('?');
  const path = (queryStart < 0 ? value : value.slice(0, queryStart)).toLowerCase();
  const query = new URLSearchParams(queryStart < 0 ? '' : value.slice(queryStart + 1));
  const tab = query.get('tab');

  if (path === STOCK_ROUTES.home) {
    // A catalog title the server may not have (requests spec §2.2): jellyfin-web renders home and ignores the
    // parameter, so Lumen can own the route; a new path would hit jellyfin-web's 404 page. Without Lumen (switched
    // off, DetailsTakeover off, or a failed compatibility check) the link shows stock home: see PIGGY_BACKED_PARAMS.
    const title = TITLE_KEY.exec(query.get(PIGGY_BACKED_PARAMS.catalogTitle) ?? '');
    if (title) return { kind: 'title', mediaType: title[1] as 'movie' | 'tv', tmdbId: Number(title[2]) };
    if (tab === null || tab === '0') return { kind: 'home' };
    if (tab === '1') return { kind: 'favorites' };
    return { kind: 'other' };
  }
  if (path === STOCK_ROUTES.details) {
    const id = query.get('id');
    const serverId = query.get('serverId');
    if (id && ITEM_ID.test(id)) return serverId ? { kind: 'details', id, serverId } : { kind: 'details', id };
  }
  if (path === STOCK_ROUTES.search) return { kind: 'search', query: query.get('query') ?? '' };
  if (path === STOCK_ROUTES.preferencesMenu) return { kind: 'profile' };
  if (path === STOCK_ROUTES.video) return { kind: 'player' };
  const settings = SETTINGS_PATHS[path];
  if (settings) return { kind: 'settings', page: settings };
  if (path === STOCK_ROUTES.list) {
    // jellyfin-web's item list filtered to one genre (home genre tiles, a library's Genres tab).
    const genreId = query.get('genreId');
    const parentId = query.get('parentId');
    if (genreId && ITEM_ID.test(genreId))
      return parentId && ITEM_ID.test(parentId)
        ? { kind: 'genre', id: genreId, parentId }
        : { kind: 'genre', id: genreId };
    // A Collections library (Lumen's own links tag it; jellyfin-web ignores the extra parameter).
    if (
      query.get(PIGGY_BACKED_PARAMS.collectionType) === 'boxsets' &&
      parentId &&
      ITEM_ID.test(parentId) &&
      (tab === null || tab === '0')
    )
      return { kind: 'library', id: parentId, collection: 'boxsets' };
    return { kind: 'other' };
  }
  const collection = LIBRARY_PATHS[path];
  if (collection && (tab === null || tab === '0')) {
    const id = query.get('topParentId');
    if (id && ITEM_ID.test(id)) return { kind: 'library', id, collection };
  }
  return { kind: 'other' };
}

/** A key that changes exactly when a different page should mount. */
export function routeKey(route: TakeoverRoute): string {
  switch (route.kind) {
    case 'details':
    case 'library':
      return `${route.kind}:${route.id}`;
    case 'genre':
      return `genre:${route.id}:${route.parentId ?? ''}`;
    case 'title':
      return `title:${route.mediaType}-${route.tmdbId}`;
    case 'settings':
      return `settings:${route.page}`;
    default:
      return route.kind;
  }
}

/** The Lumen route for a catalog title. */
export function titleHash(mediaType: 'movie' | 'tv', tmdbId: number): string {
  return `#${STOCK_ROUTES.home}?${PIGGY_BACKED_PARAMS.catalogTitle}=${mediaType}-${tmdbId}`;
}
