import type { MyRequest, RequestProgressStatus } from '../../api/types';

/** My requests' filter chips, in the order they show. */
export const REQUEST_FILTERS = ['all', 'pending', 'downloading', 'available', 'problem'] as const;
export type RequestFilter = (typeof REQUEST_FILTERS)[number];

/**
 * Which chip each status the server gives a title (RequestProgressState, Requests/RequestProgress.cs) falls under:
 * - pending: Requested, waiting for an admin's approval (Seerr's request status PENDING);
 * - downloading: approved and on its way: Queued (Radarr/Sonarr looking for a release, or a download waiting to start),
 *   Downloading, and Processing (downloaded, being imported). A show that's partly on the server with more seasons
 *   coming is one of these too: the server only says Ready once Seerr has the requested media AVAILABLE;
 * - available: Ready, on the server;
 * - problem: Declined by an admin, or Failed (Seerr couldn't hand it to Radarr or Sonarr).
 */
const FILTER_OF: Record<RequestProgressStatus, Exclude<RequestFilter, 'all'>> = {
  Requested: 'pending',
  Queued: 'downloading',
  Downloading: 'downloading',
  Processing: 'downloading',
  Ready: 'available',
  Declined: 'problem',
  Failed: 'problem',
};

export const filterOf = (status: RequestProgressStatus): Exclude<RequestFilter, 'all'> => FILTER_OF[status];

/** Lower case without accents, so "amelie" finds "Amélie". */
export const fold = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/** The words of a search, folded: a request matches when each of them is in its title or (everyone's) requester. */
export const searchWords = (query: string): string[] => fold(query).split(/\s+/).filter(Boolean);

export function matchesSearch(request: MyRequest, words: string[]): boolean {
  if (words.length === 0) return true;
  const text = fold(`${request.Item.Title} ${request.RequestedBy?.Name ?? ''}`);
  return words.every((w) => text.indexOf(w) >= 0);
}

/** How many of `requests` each chip would show. */
export function countByFilter(requests: MyRequest[]): Record<RequestFilter, number> {
  const counts: Record<RequestFilter, number> = {
    all: requests.length,
    pending: 0,
    downloading: 0,
    available: 0,
    problem: 0,
  };
  for (const r of requests) counts[filterOf(r.Status)]++;
  return counts;
}

export const inFilter = (request: MyRequest, filter: RequestFilter): boolean =>
  filter === 'all' || filterOf(request.Status) === filter;
