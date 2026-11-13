import { describe, expect, it } from 'vitest';
import { myRequest } from '../../../test/myRequest';
import type { RequestProgressStatus } from '../../api/types';
import { nextCheck } from './allRequests';
import { countByFilter, filterOf, inFilter, matchesSearch, searchWords } from './requestFilters';
import { FAST_MS } from './requestProgress';

describe('filterOf', () => {
  it('puts each status under one chip', () => {
    const statuses: RequestProgressStatus[] = [
      'Requested',
      'Queued',
      'Downloading',
      'Processing',
      'Ready',
      'Declined',
      'Failed',
    ];
    expect(statuses.map(filterOf)).toEqual([
      'pending',
      'downloading',
      'downloading',
      'downloading',
      'available',
      'problem',
      'problem',
    ]);
  });
});

describe('search', () => {
  const amelie = myRequest({ key: 'movie-194', title: 'Amélie', RequestedBy: { Name: 'Zoë' } });
  const matrix = myRequest({ title: 'The Matrix' });

  it('matches every word, in any case and without accents, in the title or who requested it', () => {
    expect(matchesSearch(amelie, searchWords('AMELIE'))).toBe(true);
    expect(matchesSearch(amelie, searchWords('  ame  zoe '))).toBe(true);
    expect(matchesSearch(amelie, searchWords('amelie matrix'))).toBe(false);
    expect(matchesSearch(matrix, searchWords('matr'))).toBe(true);
    expect(matchesSearch(matrix, searchWords('zoe'))).toBe(false);
  });

  it('matches everything with nothing typed', () => {
    expect(searchWords('   ')).toEqual([]);
    expect(matchesSearch(matrix, [])).toBe(true);
  });
});

describe('countByFilter', () => {
  it('counts each chip, All being every one', () => {
    const list = [
      myRequest({ Status: 'Requested' }),
      myRequest({ Status: 'Queued' }),
      myRequest({ Status: 'Processing' }),
      myRequest({ Status: 'Ready' }),
      myRequest({ Status: 'Failed' }),
      myRequest({ Status: 'Declined' }),
    ];
    expect(countByFilter(list)).toEqual({ all: 6, pending: 1, downloading: 2, available: 1, problem: 2 });
    expect(list.filter((r) => inFilter(r, 'problem')).map((r) => r.Status)).toEqual(['Failed', 'Declined']);
    expect(list.filter((r) => inFilter(r, 'all'))).toHaveLength(6);
  });
});

describe("everyone's requests: when to check again", () => {
  it('soon while something downloads or titles are missing, later while something waits, never otherwise', () => {
    expect(nextCheck({ Requests: [myRequest({ Status: 'Downloading' })], Partial: false })).toBe(FAST_MS);
    expect(nextCheck({ Requests: [myRequest({ Status: 'Ready' })], Partial: true })).toBe(FAST_MS);
    expect(nextCheck({ Requests: [myRequest({ Status: 'Requested' })], Partial: false })).toBe(45_000);
    expect(
      nextCheck({
        Requests: [myRequest({ Status: 'Ready' }), myRequest({ Status: 'Declined' })],
        Partial: false,
      }),
    ).toBeNull();
  });
});
