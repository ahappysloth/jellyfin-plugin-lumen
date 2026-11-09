import { describe, expect, it } from 'vitest';
import type { BaseItem } from '../../api/types';
import { adjacentSeasons, episodeNeighbors } from './episodeNeighbors';

const item = (Id: string, IndexNumber?: number): BaseItem => ({ Id, Name: Id, Type: 'Episode', IndexNumber });
const seasons = [item('sp', 0), item('s1', 1), item('s2', 2), item('s3', 3)];

describe('adjacentSeasons', () => {
  it('skips specials when moving between regular seasons', () => {
    expect(adjacentSeasons(seasons, 's1')).toEqual({ before: null, after: seasons[2] });
    expect(adjacentSeasons(seasons, 's2')).toEqual({ before: seasons[1], after: seasons[3] });
    expect(adjacentSeasons(seasons, 's3')).toEqual({ before: seasons[2], after: null });
  });

  it('moves from specials to the next season in order', () => {
    expect(adjacentSeasons(seasons, 'sp')).toEqual({ before: null, after: seasons[1] });
  });

  it('has no neighbours for an unknown season', () => {
    expect(adjacentSeasons(seasons, 'x')).toEqual({ before: null, after: null });
  });
});

describe('episodeNeighbors', () => {
  const season = [item('e1'), item('e2'), item('e3')];

  it('uses the same season in the middle', () => {
    expect(episodeNeighbors('e2', season)).toEqual({ previous: season[0], next: season[2] });
  });

  it('crosses into the neighbouring seasons at the edges', () => {
    const before = [item('p1'), item('p2')];
    const after = [item('n1')];
    expect(episodeNeighbors('e1', season, before, after).previous).toBe(before[1]);
    expect(episodeNeighbors('e3', season, before, after).next).toBe(after[0]);
  });

  it('stops at the ends of the show', () => {
    expect(episodeNeighbors('e1', season)).toEqual({ previous: null, next: season[1] });
    expect(episodeNeighbors('e3', season).next).toBeNull();
  });
});
