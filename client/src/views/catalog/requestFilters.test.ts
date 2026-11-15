import { describe, expect, it } from 'vitest';
import { myRequest } from '../../../test/myRequest';
import type { RequestProgressStatus } from '../../api/types';
import { nextCheck } from './allRequests';
import {
  countByFilter,
  filterOf,
  inFilter,
  matchesSearch,
  myRequestHash,
  REQUEST_FILTERS,
  requestFromHash,
  searchWords,
  shownFilters,
} from './requestFilters';
import { strings } from '../../strings';
import { FAST_MS } from './requestProgress';

describe('filterOf', () => {
  const statuses: RequestProgressStatus[] = [
    'Requested',
    'Queued',
    'Downloading',
    'Processing',
    'Ready',
    'Declined',
    'Failed',
  ];

  it('puts each status under one chip', () => {
    expect(statuses.map(filterOf)).toEqual([
      'Requested',
      'Queued',
      'Downloading',
      'Downloading',
      'Ready',
      'Declined',
      'Failed',
    ]);
  });

  it('names each chip by the word its rows show, and every chip but All is one some row shows', () => {
    // The chips' names are strings.progress[chip]: the rows under each say the same.
    for (const status of statuses) expect(strings.progress[filterOf(status)]).toBe(strings.progress[status]);
    const words = statuses.map((s) => strings.progress[s]);
    for (const f of REQUEST_FILTERS) if (f !== 'all') expect(words).toContain(strings.progress[f]);
    expect(REQUEST_FILTERS.map((f) => (f === 'all' ? 'All' : strings.progress[f]))).toEqual([
      'All',
      'Pending',
      'Queued',
      'Downloading',
      'Ready',
      'Declined',
      'Failed',
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
      myRequest({ Status: 'Downloading' }),
      myRequest({ Status: 'Ready' }),
      myRequest({ Status: 'Failed' }),
      myRequest({ Status: 'Declined' }),
    ];
    expect(countByFilter(list)).toEqual({
      all: 7,
      Requested: 1,
      Queued: 1,
      Downloading: 2,
      Ready: 1,
      Declined: 1,
      Failed: 1,
    });
    expect(list.filter((r) => inFilter(r, 'Downloading')).map((r) => r.Status)).toEqual([
      'Processing',
      'Downloading',
    ]);
    expect(list.filter((r) => inFilter(r, 'all'))).toHaveLength(7);
  });
});

describe('shownFilters', () => {
  it('shows All and the chips with requests, in a request’s order, and the active one even with none', () => {
    const counts = countByFilter([
      myRequest({ Status: 'Failed' }),
      myRequest({ Status: 'Ready' }),
      myRequest({ Status: 'Requested' }),
    ]);
    expect(shownFilters(counts, 'all')).toEqual(['all', 'Requested', 'Ready', 'Failed']);
    expect(shownFilters(counts, 'Queued')).toEqual(['all', 'Requested', 'Queued', 'Ready', 'Failed']);
    expect(shownFilters(countByFilter([]), 'all')).toEqual(['all']);
  });
});

describe("everyone's requests: when to check again", () => {
  it('soon while something downloads or titles are missing, later while something waits, never otherwise', () => {
    expect(nextCheck({ Requests: [myRequest({ Status: 'Downloading' })], Partial: false })).toBe(FAST_MS);
    expect(nextCheck({ Requests: [myRequest({ Status: 'Ready' })], Partial: true })).toBe(FAST_MS);
    expect(nextCheck({ Requests: [myRequest({ Status: 'Requested' })], Partial: false })).toBe(45_000);
    expect(nextCheck({ Requests: [myRequest({ Status: 'Queued' })], Partial: false })).toBe(45_000);
    expect(
      nextCheck({
        Requests: [myRequest({ Status: 'Ready' }), myRequest({ Status: 'Declined' })],
        Partial: false,
      }),
    ).toBeNull();
  });
});

describe('My requests on one request', () => {
  it('carries the title’s key in its address, read back by the page', () => {
    expect(myRequestHash('tv-1399')).toBe('#/home?lumen=requests&request=tv-1399');
    expect(requestFromHash(myRequestHash('tv-1399'))).toBe('tv-1399');
    expect(requestFromHash('#/home?lumen=requests')).toBeNull();
    expect(requestFromHash('#/home')).toBeNull();
  });
});
