import type { MyRequest, RequestProgressStatus } from '../../api/types';
import { MY_REQUESTS_HASH } from '../../compat/jellyfin';

/**
 * My requests' filter chips, in the order they show: All, then a request's life. Each of the others is a status, named
 * by the word its rows show (strings.progress: Requested shows as "Pending"), so no row says something no chip does:
 * - Requested: waiting for an admin's approval (Seerr's request status PENDING);
 * - Queued: approved, nothing downloading yet (Radarr/Sonarr looking for a release, or a download waiting to start);
 * - Downloading: and Processing (downloaded, being imported), which shows as Downloading too. A show that's partly on
 *   the server with more seasons coming is one of these or Queued: the server only says Ready once Seerr has the
 *   requested media AVAILABLE;
 * - Ready: on the server;
 * - Declined: by an admin;
 * - Failed: Seerr couldn't hand it to Radarr or Sonarr.
 * (RequestProgressState, Requests/RequestProgress.cs.)
 */
export const REQUEST_FILTERS = [
  'all',
  'Requested',
  'Queued',
  'Downloading',
  'Ready',
  'Declined',
  'Failed',
] as const;
export type RequestFilter = (typeof REQUEST_FILTERS)[number];

export const filterOf = (status: RequestProgressStatus): Exclude<RequestFilter, 'all'> =>
  status === 'Processing' ? 'Downloading' : status;

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
  const counts = {} as Record<RequestFilter, number>;
  REQUEST_FILTERS.forEach((f) => (counts[f] = 0));
  counts.all = requests.length;
  for (const r of requests) counts[filterOf(r.Status)]++;
  return counts;
}

/**
 * The chips to show, in their fixed order: All, those with a request under the search (a short list doesn't get a row
 * of zeros), and the active one even with none (a check or the search emptied it: its "nothing here" says so, with the
 * way back to All).
 */
export const shownFilters = (counts: Record<RequestFilter, number>, active: RequestFilter): RequestFilter[] =>
  REQUEST_FILTERS.filter((f) => f === 'all' || f === active || counts[f] > 0);

export const inFilter = (request: MyRequest, filter: RequestFilter): boolean =>
  filter === 'all' || filterOf(request.Status) === filter;

/**
 * My requests showing one request (a title page's status links here): the title's catalog key ("movie-603", nothing to
 * escape) rides along as `request`. Read by the page itself, as Top charts reads its chart (charts/chartsRoute.ts), not by parseRoute,
 * which the inline guard carries.
 */
export const myRequestHash = (key: string): string => `${MY_REQUESTS_HASH}&request=${key}`;

export function requestFromHash(hash: string): string | null {
  const queryStart = hash.indexOf('?');
  return queryStart < 0 ? null : new URLSearchParams(hash.slice(queryStart + 1)).get('request');
}
