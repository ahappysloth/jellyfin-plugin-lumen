/**
 * Strings only a catalog title's page and its request dialog show (see strings.ts). Only that page's chunk imports
 * this (views/catalog/lazyTitle.tsx), so they don't weigh on startup; the catalog cards' strings stay in strings.ts.
 */
export const titleStrings = {
  available: 'Available',
  requestMore: 'Request more seasons',
  notInLibrary: 'Not in your library yet',
  blocklisted: "This title can't be requested.",
  cannotRequest: "Your account can't request this. Ask the server owner.",
  requestTitle: (title: string) => `Request ${title}`,
  requestMovieConfirm: 'Ask the server to download this movie. You can watch it here once it’s ready.',
  chooseSeasons: 'Choose the seasons to request.',
  allSeasons: 'All seasons',
  seasonEpisodes: (n: number) => (n === 1 ? '1 episode' : `${n} episodes`),
  sendRequest: 'Request',
  sending: 'Requesting…',
  close: 'Close',
  done: 'Done',
  requestDone: 'Requested. It will appear in your library when it’s ready.',
  requestPending: 'Requested, waiting for approval.',
  requestFailed: "Couldn't send the request. Try again.",
  titleFailed: "Couldn't load this title from Seerr.",
  loadingTitle: 'Loading…',
  watchTrailer: 'Trailer',
  openInLibrary: 'Open in library',
  // Request progress: under the status on a title's page, where the row in My requests has no detail to show
  // (progressDetail: Queued and Processing always have one, Downloading has its percentage).
  progressNote: {
    Requested: 'Waiting for approval.',
    Queued: null,
    Downloading: null,
    Processing: null,
    Ready: 'Ready to watch.',
    Declined: 'Your request was declined.',
    // Seerr couldn't hand the request to Radarr or Sonarr (a failed download isn't this: they look for another).
    Failed: 'The request failed. Ask the server owner to look at it.',
  },
  noRequests: 'No requests yet',
  noRequestsHint: 'Search for a movie or show that isn’t here yet and request it.',
  requestsFailed: "Couldn't load your requests from Seerr.",
  noRequestFeatures: "Requests aren't available for your account.",
  requestedOn: (date: string) => `Requested ${date}`,
  // My requests' search, filter chips and "Everyone's requests" (MyRequestsView).
  searchRequests: 'Search requests',
  clearSearch: 'Clear search',
  filterLabel: 'Show',
  /** The first chip's name; the others are named by their rows' status (strings.progress). */
  filterAll: 'All',
  /** Under a chip with nothing to show (no search). */
  filterEmpty: {
    Requested: 'Nothing is waiting for approval',
    Queued: 'Nothing is waiting to download',
    Downloading: 'Nothing is downloading',
    Ready: 'Nothing is ready to watch yet',
    Declined: 'No requests were declined',
    Failed: 'No requests have failed',
  },
  showAll: 'Show all requests',
  noMatch: (query: string) => `No requests match “${query}”`,
  requestCount: (n: number) => (n === 1 ? '1 request' : `${n} requests`),
  everyone: 'Everyone’s requests',
  everyoneFailed: "Couldn't load everyone's requests from Seerr.",
  noRequestsEveryone: 'Nobody has requested anything yet.',
  requestedBy: 'Requested by ',
  unknownRequester: 'Someone not on this server',
  runtimeMinutes: (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`),
} as const;
