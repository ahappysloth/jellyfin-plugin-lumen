import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { BaseItem } from '../../api/types';
import { strings } from '../../strings';
import type { LibraryCollection, LibraryTab } from '../../takeover/routes';
import { LibraryTabBar, LibraryTabView } from './LibraryTabs';
import type { ViewContext } from '../context';
import { BrowseGrid } from './BrowseGrid';
import { getChoice, saveChoice } from './browseStore';
import { Dropdown } from '../../components/Dropdown';
import { useAutoFocus } from '../../components/useAutoFocus';
import { type Option, PageHeader, Segmented } from './Toolbar';
import { useGridPage } from './useGridPage';

export type SortKey = 'added' | 'title' | 'release' | 'rating';
export type FilterKey = 'all' | 'unwatched' | 'watched';

const SORTS: readonly Option<SortKey>[] = (['added', 'title', 'release', 'rating'] as const).map((value) => ({
  value,
  label: strings.sorts[value],
}));
const FILTERS: readonly Option<FilterKey>[] = (['all', 'unwatched', 'watched'] as const).map((value) => ({
  value,
  label: strings.filters[value],
}));
const ITEM_TYPES: Record<LibraryCollection, string> = {
  movies: 'Movie',
  tvshows: 'Series',
  boxsets: 'BoxSet',
};
const TITLES: Record<LibraryCollection, string> = {
  movies: strings.movies,
  tvshows: strings.shows,
  boxsets: strings.collections,
};
/** The user-data field a filter depends on: changing it makes a saved grid stale. */
const FILTER_FIELDS = { all: [], unwatched: ['Played'], watched: ['Played'] } as const;
const FILTER_PARAMS: Record<FilterKey, string[]> = {
  all: [],
  unwatched: ['IsUnplayed'],
  watched: ['IsPlayed'],
};

/** Jellyfin sort fields per choice; shows sort "recently added" by their newest episode. */
export function sortParams(sort: SortKey, collection: LibraryCollection) {
  switch (sort) {
    case 'title':
      return { sortBy: 'SortName', sortOrder: 'Ascending' as const };
    case 'release':
      return { sortBy: 'PremiereDate,ProductionYear,SortName', sortOrder: 'Descending' as const };
    case 'rating':
      return { sortBy: 'CommunityRating,SortName', sortOrder: 'Descending' as const };
    default:
      return {
        sortBy: collection === 'tvshows' ? 'DateLastContentAdded,SortName' : 'DateCreated,SortName',
        sortOrder: 'Descending' as const,
      };
  }
}

interface Choice {
  sort: SortKey;
  filter: FilterKey;
  genre: string;
}
const DEFAULT_CHOICE: Choice = { sort: 'added', filter: 'all', genre: '' };

/** A Movies or Shows library: title, sort/filter/genre controls and an endless poster grid. */
export function LibraryView({
  id,
  collection,
  tab = 'items',
  ctx,
}: {
  id: string;
  collection: LibraryCollection;
  tab?: LibraryTab;
  ctx: ViewContext;
}) {
  if (collection !== 'boxsets' && tab !== 'items')
    return <LibraryTabView id={id} collection={collection} tab={tab} ctx={ctx} />;
  return <LibraryGrid id={id} collection={collection} ctx={ctx} />;
}

/** A library's main tab: every title, with filter, genre and sort controls. */
function LibraryGrid({
  id,
  collection,
  ctx,
}: {
  id: string;
  collection: LibraryCollection;
  ctx: ViewContext;
}) {
  const choiceKey = `${ctx.userId}|library|${id}`;
  const [choice, setChoiceState] = useState<Choice>(() => getChoice(choiceKey, DEFAULT_CHOICE));
  const setChoice = (patch: Partial<Choice>): void => {
    const next = { ...choice, ...patch };
    saveChoice(choiceKey, next);
    setChoiceState(next);
  };
  const [name, setName] = useState<string | null>(null);
  const [genres, setGenres] = useState<BaseItem[]>([]);
  const itemType = ITEM_TYPES[collection];

  useEffect(() => {
    let cancelled = false;
    ctx.api
      .getItem(id)
      .then((library) => !cancelled && setName(library.Name))
      .catch(() => undefined);
    // Collections have no genres of their own.
    if (collection !== 'boxsets')
      ctx.api
        .getGenres(id, itemType)
        .then((result) => !cancelled && setGenres(result.Items))
        .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [id, ctx.userId]);

  const queryKey = `${ctx.userId}|library|${id}|${choice.sort}|${choice.filter}|${choice.genre}`;
  const { state, select, onMenu } = useGridPage(
    ctx,
    queryKey,
    (page) =>
      ctx.api.getBrowseItems({
        parentId: id,
        includeItemTypes: itemType,
        ...sortParams(choice.sort, collection),
        filters: FILTER_PARAMS[choice.filter],
        genreIds: choice.genre ? [choice.genre] : undefined,
        ...page,
      }),
    { dependsOn: FILTER_FIELDS[choice.filter] },
  );
  const rootRef = useRef<HTMLDivElement>(null);
  useAutoFocus(rootRef, true, ctx.layout, state.restoredSelectedId ?? undefined);

  const genreOptions = useMemo<Option<string>[]>(
    () => [{ value: '', label: strings.allGenres }, ...genres.map((g) => ({ value: g.Id, label: g.Name }))],
    [genres],
  );
  const filtered = choice.filter !== 'all' || choice.genre !== '';
  const fallbackTitle = TITLES[collection];

  return (
    <div ref={rootRef} class="lmn-browse">
      <PageHeader
        title={name ?? fallbackTitle}
        meta={state.total !== null ? strings.titleCount(state.total) : undefined}
        tabs={
          collection !== 'boxsets' ? (
            <LibraryTabBar id={id} collection={collection} current="items" />
          ) : undefined
        }
      >
        <Segmented
          label={strings.filter}
          value={choice.filter}
          options={FILTERS}
          onChange={(filter) => setChoice({ filter })}
        />
        <div class="lmn-browse__selects">
          {genres.length > 0 && (
            <Dropdown
              label={strings.genre}
              value={choice.genre}
              options={genreOptions}
              onChange={(genre) => setChoice({ genre })}
            />
          )}
          <Dropdown
            label={strings.sortBy}
            value={choice.sort}
            options={SORTS}
            onChange={(sort) => setChoice({ sort })}
          />
        </div>
      </PageHeader>
      <BrowseGrid
        state={state}
        client={ctx.client}
        variant="poster"
        label={name ?? fallbackTitle}
        onSelect={select}
        onMenu={onMenu}
        empty={
          filtered ? (
            <>
              <p>{strings.noMatches}</p>
              <button
                type="button"
                class="lmn-button lmn-button--secondary"
                onClick={() => setChoice({ filter: 'all', genre: '' })}
              >
                {strings.clearFilters}
              </button>
            </>
          ) : (
            <p>{strings.emptyLibrary}</p>
          )
        }
      />
    </div>
  );
}
