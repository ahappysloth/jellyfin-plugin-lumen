import { describe, expect, it } from 'vitest';
import { parseRoute } from './routes';

describe('parseRoute', () => {
  it.each([
    ['#/home', { kind: 'home' }],
    ['#!/home', { kind: 'home' }],
    ['#/home?tab=0', { kind: 'home' }],
    ['#/home?tab=1', { kind: 'other' }],
    [
      '#/details?id=0123456789abcdef0123456789abcdef&serverId=s',
      { kind: 'details', id: '0123456789abcdef0123456789abcdef' },
    ],
    ['#/details?id=not-an-id', { kind: 'other' }],
    ['#/details', { kind: 'other' }],
    ['#/movies?topParentId=x', { kind: 'other' }],
    ['', { kind: 'other' }],
  ])('%s', (hash, expected) => {
    expect(parseRoute(hash)).toEqual(expected);
  });
});
