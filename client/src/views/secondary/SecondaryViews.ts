// Pages most visits never open, one file loaded on demand and fetched once the browser is idle after the first page
// (lazySecondary.tsx): search, a person's and a collection's page, a library's Suggestions and Upcoming tabs, the
// watch history and the Watch together menu.
export { CollectionDetails } from '../details/CollectionDetails';
export { PersonDetails } from '../details/PersonDetails';
export { SuggestionsTab, UpcomingTab } from '../browse/SuggestionsTabs';
export { HistoryView } from '../history/HistoryView';
export { SearchView } from '../search/SearchView';
export { openWatchTogether } from '../syncplay/WatchTogether';
