import { describe, expect, it } from 'vitest';
import { parseRoute } from './routes';

describe('parseRoute', () => {
  it.each([
    ['#/home', { kind: 'home' }],
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
      { kind: 'details', id: '0123456789abcdef0123456789abcdef' },
    ],
    ['#/details?id=not-an-id', { kind: 'other' }],
    ['#/details', { kind: 'other' }],
    ['#/movies?topParentId=x', { kind: 'other' }],
    [
      '#/movies?topParentId=0123456789abcdef0123456789abcdef&collectionType=movies',
      { kind: 'library', id: '0123456789abcdef0123456789abcdef', collection: 'movies' },
    ],
    [
      '#/tv?topParentId=0123456789abcdef0123456789abcdef&collectionType=tvshows&tab=0',
      { kind: 'library', id: '0123456789abcdef0123456789abcdef', collection: 'tvshows' },
    ],
    ['#/tv?topParentId=0123456789abcdef0123456789abcdef&tab=2', { kind: 'other' }],
    ['#/music?topParentId=0123456789abcdef0123456789abcdef', { kind: 'other' }],
    ['#/search', { kind: 'search', query: '' }],
    ['#/search?query=star%20wars', { kind: 'search', query: 'star wars' }],
    ['#/mypreferencesmenu', { kind: 'profile' }],
    ['#/mypreferencesdisplay?userId=x', { kind: 'other' }],
    ['', { kind: 'other' }],
  ])('%s', (hash, expected) => {
    expect(parseRoute(hash)).toEqual(expected);
  });
});
