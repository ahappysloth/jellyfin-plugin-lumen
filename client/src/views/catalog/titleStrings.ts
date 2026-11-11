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
  watchTrailer: 'Trailer',
  openInLibrary: 'Open in library',
  runtimeMinutes: (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`),
} as const;
