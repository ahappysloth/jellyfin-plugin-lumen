export type LibraryCollection = 'movies' | 'tvshows';

export type Route =
  | { kind: 'home' }
  | { kind: 'details'; id: string }
  | { kind: 'library'; id: string; collection: LibraryCollection }
  | { kind: 'favorites' }
  | { kind: 'search'; query: string }
  | { kind: 'title'; mediaType: 'movie' | 'tv'; tmdbId: number }
  | { kind: 'profile' }
  | { kind: 'other' };
export type TakeoverRoute = Exclude<Route, { kind: 'other' }>;

const ITEM_ID = /^[0-9a-f]{32}$|^[0-9a-f-]{36}$/i;
const TITLE_KEY = /^(movie|tv)-([1-9][0-9]{0,9})$/;
const LIBRARY_PATHS: Record<string, LibraryCollection> = { '/movies': 'movies', '/tv': 'tvshows' };

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

  if (path === '/home') {
    // A catalog title the server may not have (requests spec §2.2): jellyfin-web renders home and ignores the
    // parameter, so Lumen can own the route; a new path would hit jellyfin-web's 404 page.
    const title = TITLE_KEY.exec(query.get('title') ?? '');
    if (title) return { kind: 'title', mediaType: title[1] as 'movie' | 'tv', tmdbId: Number(title[2]) };
    if (tab === null || tab === '0') return { kind: 'home' };
    if (tab === '1') return { kind: 'favorites' };
    return { kind: 'other' };
  }
  if (path === '/details') {
    const id = query.get('id');
    if (id && ITEM_ID.test(id)) return { kind: 'details', id };
  }
  if (path === '/search') return { kind: 'search', query: query.get('query') ?? '' };
  if (path === '/mypreferencesmenu') return { kind: 'profile' };
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
    case 'title':
      return `title:${route.mediaType}-${route.tmdbId}`;
    default:
      return route.kind;
  }
}

/** The Lumen route for a catalog title. */
export function titleHash(mediaType: 'movie' | 'tv', tmdbId: number): string {
  return `#/home?title=${mediaType}-${tmdbId}`;
}
