import { formatNumber } from '../../util/locale';

/**
 * Strings only the pages in views/secondary's file show (see strings.ts): search, a person's and a collection's page, a
 * library's Suggestions and Upcoming tabs, the watch history and the Watch together menu. Only that file imports this
 * (lazySecondary.tsx), so they don't weigh on startup. The ones the core shows too (Watch together, SyncPlay, History,
 * a failed load's message) stay in strings.ts.
 */
export const secondaryStrings = {
  born: (date: string, place?: string) => (place ? `Born ${date} in ${place}` : `Born ${date}`),
  died: (date: string) => `Died ${date}`,
  knownFor: 'Known for',
  inCollection: 'In this collection',
  readMore: 'Read more',
  readLess: 'Show less',
  noPersonTitles: 'Nothing with this person in your library.',
  emptyCollection: 'This collection is empty.',
  newGroup: 'New group',
  leaveGroup: 'Leave group',
  startGroupPlayback: 'Start group playback',
  stopGroupPlayback: 'Stop group playback',
  noGroups: 'No groups yet',
  groupName: (user: string) => `${user}'s group`,
  syncPlayFailed: "Couldn't update the group. Try again.",
  noSuggestions: 'No suggestions yet. Watch something and check back.',
  noUpcoming: 'No upcoming episodes.',
  continueWatching: 'Continue watching',
  nextUp: 'Next up',
  latestMovies: 'Latest movies',
  latestEpisodes: 'Latest episodes',
  today: 'Today',
  tomorrow: 'Tomorrow',
  yesterday: 'Yesterday',
  recommendation: (type: string, name: string | undefined): string => {
    if (!name) return 'Recommended';
    if (type === 'SimilarToRecentlyPlayed') return `Because you watched ${name}`;
    if (type === 'SimilarToLikedItem') return `Because you liked ${name}`;
    if (type === 'HasDirectorFromRecentlyPlayed' || type === 'HasLikedDirector') return `Directed by ${name}`;
    if (type === 'HasActorFromRecentlyPlayed' || type === 'HasLikedActor') return `Starring ${name}`;
    return 'Recommended';
  },
  searchPlaceholder: 'Search movies, shows and people',
  clearSearch: 'Clear search',
  explore: 'Explore your library',
  people: 'People',
  noResults: (q: string) => `No results for “${q}”`,
  noResultsHint: 'Check the spelling, or try a title, an actor or a director.',
  searching: 'Searching…',
  searchFailed: "Couldn't search right now.",
  resultCount: (n: number) => (n === 1 ? '1 result' : `${formatNumber(n)} results`),
  noHistory: 'Nothing watched yet',
  noHistoryHint: 'Movies and episodes you play show up here, newest first.',
  episodeCount: (n: number) => `${formatNumber(n)} episodes`,
  moreToRequest: 'More to request',
} as const;
