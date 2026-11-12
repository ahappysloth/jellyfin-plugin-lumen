import { describe, expect, it } from 'vitest';
import { chartsHash, parseRoute } from './routes';

describe('parseRoute', () => {
  it.each([
    ['#/home', { kind: 'home' }],
    // jellyfin-web's root (it redirects to home): Lumen's home through the redirect, no stock frame.
    ['#/', { kind: 'home' }],
    ['#!/home', { kind: 'home' }],
    ['#/home?tab=0', { kind: 'home' }],
    ['#/home?tab=1', { kind: 'favorites' }],
    ['#/home?tab=2', { kind: 'other' }],
    ['#/home?title=movie-603', { kind: 'title', mediaType: 'movie', tmdbId: 603 }],
    ['#/home?title=tv-1399', { kind: 'title', mediaType: 'tv', tmdbId: 1399 }],
    ['#/home?title=person-1', { kind: 'home' }],
    ['#/home?title=movie-0', { kind: 'home' }],
    [
      '#/details?id=0123456789abcdef0123456789abcdef&serverId=s',
      { kind: 'details', id: '0123456789abcdef0123456789abcdef', serverId: 's' },
    ],
    ['#/details?id=not-an-id', { kind: 'other' }],
    ['#/details', { kind: 'other' }],
    ['#/movies?topParentId=x', { kind: 'other' }],
    [
      '#/movies?topParentId=0123456789abcdef0123456789abcdef&collectionType=movies',
      { kind: 'library', id: '0123456789abcdef0123456789abcdef', collection: 'movies', tab: 'items' },
    ],
    [
      '#/tv?topParentId=0123456789abcdef0123456789abcdef&collectionType=tvshows&tab=0',
      { kind: 'library', id: '0123456789abcdef0123456789abcdef', collection: 'tvshows', tab: 'items' },
    ],
    [
      '#/tv?topParentId=0123456789abcdef0123456789abcdef&tab=1',
      { kind: 'library', id: '0123456789abcdef0123456789abcdef', collection: 'tvshows', tab: 'suggestions' },
    ],
    [
      '#/tv?topParentId=0123456789abcdef0123456789abcdef&tab=2',
      { kind: 'library', id: '0123456789abcdef0123456789abcdef', collection: 'tvshows', tab: 'upcoming' },
    ],
    [
      '#/movies?topParentId=0123456789abcdef0123456789abcdef&tab=1',
      { kind: 'library', id: '0123456789abcdef0123456789abcdef', collection: 'movies', tab: 'suggestions' },
    ],
    ['#/tv?topParentId=0123456789abcdef0123456789abcdef&tab=7', { kind: 'other' }], // Playlists stays stock
    ['#/movies?topParentId=0123456789abcdef0123456789abcdef&tab=6', { kind: 'other' }], // Playlists stays stock
    [
      '#/movies?topParentId=0123456789abcdef0123456789abcdef&tab=2',
      { kind: 'library', id: '0123456789abcdef0123456789abcdef', collection: 'movies', tab: 'favorites' },
    ],
    [
      '#/movies?topParentId=0123456789abcdef0123456789abcdef&tab=3',
      { kind: 'library', id: '0123456789abcdef0123456789abcdef', collection: 'movies', tab: 'collections' },
    ],
    [
      '#/movies?topParentId=0123456789abcdef0123456789abcdef&tab=4',
      { kind: 'library', id: '0123456789abcdef0123456789abcdef', collection: 'movies', tab: 'genres' },
    ],
    [
      '#/movies?topParentId=0123456789abcdef0123456789abcdef&tab=5',
      { kind: 'library', id: '0123456789abcdef0123456789abcdef', collection: 'movies', tab: 'studios' },
    ],
    [
      '#/tv?topParentId=0123456789abcdef0123456789abcdef&tab=3',
      { kind: 'library', id: '0123456789abcdef0123456789abcdef', collection: 'tvshows', tab: 'genres' },
    ],
    [
      '#/tv?topParentId=0123456789abcdef0123456789abcdef&tab=4',
      { kind: 'library', id: '0123456789abcdef0123456789abcdef', collection: 'tvshows', tab: 'studios' },
    ],
    [
      '#/tv?topParentId=0123456789abcdef0123456789abcdef&tab=5',
      { kind: 'library', id: '0123456789abcdef0123456789abcdef', collection: 'tvshows', tab: 'episodes' },
    ],
    [
      '#/tv?topParentId=0123456789abcdef0123456789abcdef&tab=6',
      { kind: 'library', id: '0123456789abcdef0123456789abcdef', collection: 'tvshows', tab: 'collections' },
    ],
    ['#/movies?topParentId=0123456789abcdef0123456789abcdef&tab=x', { kind: 'other' }],
    ['#/music?topParentId=0123456789abcdef0123456789abcdef', { kind: 'other' }],
    ['#/search', { kind: 'search', query: '' }],
    ['#/search?query=star%20wars', { kind: 'search', query: 'star wars' }],
    ['#/mypreferencesmenu', { kind: 'profile' }],
    ['#/home?lumen=history', { kind: 'history' }],
    ['#/home?lumen=requests', { kind: 'requests' }],
    ['#/home?lumen=charts', { kind: 'charts' }],
    ['#/home?lumen=charts&chart=shows&period=monthly', { kind: 'charts' }],
    ['#/home?lumen=nope', { kind: 'home' }],
    ['#/mypreferencesdisplay?userId=x', { kind: 'settings', page: 'display' }],
    ['#/userprofile?userId=x', { kind: 'settings', page: 'profile' }],
    ['#/login', { kind: 'other' }],
    ['#/video', { kind: 'player' }],
    [
      '#/list?genreId=0123456789abcdef0123456789abcdef&serverId=s',
      { kind: 'genre', id: '0123456789abcdef0123456789abcdef' },
    ],
    [
      '#/list?genreId=0123456789abcdef0123456789abcdef&parentId=fedcba9876543210fedcba9876543210',
      { kind: 'genre', id: '0123456789abcdef0123456789abcdef', parentId: 'fedcba9876543210fedcba9876543210' },
    ],
    [
      '#/list?studioId=0123456789abcdef0123456789abcdef&parentId=fedcba9876543210fedcba9876543210',
      {
        kind: 'genre',
        id: '0123456789abcdef0123456789abcdef',
        facet: 'studio',
        parentId: 'fedcba9876543210fedcba9876543210',
      },
    ],
    [
      '#/list?studioId=0123456789abcdef0123456789abcdef',
      { kind: 'genre', id: '0123456789abcdef0123456789abcdef', facet: 'studio' },
    ],
    ['#/list?parentId=0123456789abcdef0123456789abcdef', { kind: 'other' }],
    ['#/list?genreId=nope', { kind: 'other' }],
    [
      '#/list?parentId=0123456789abcdef0123456789abcdef&collectionType=boxsets&serverId=s',
      { kind: 'library', id: '0123456789abcdef0123456789abcdef', collection: 'boxsets', tab: 'items' },
    ],
    ['', { kind: 'other' }],
  ])('%s', (hash, expected) => {
    expect(parseRoute(hash)).toEqual(expected);
  });
});

describe('chartsHash', () => {
  it('opens Top charts on a chart and period, This week by default', () => {
    expect(chartsHash('shows')).toBe('#/home?lumen=charts&chart=shows&period=weekly');
    expect(parseRoute(chartsHash('movies', 'yearly'))).toEqual({ kind: 'charts' });
  });
});
