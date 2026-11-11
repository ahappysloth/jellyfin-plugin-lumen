import { useEffect, useRef, useState } from 'preact/hooks';
import type { BaseItem } from '../../api/types';
import { Dropdown } from '../../components/Dropdown';
import { strings } from '../../strings';
import type { ViewContext } from '../context';
import { useAutoFocus } from '../../components/useAutoFocus';
import { VIEW_TIMEOUT_MS, withTimeout } from '../../util/withTimeout';
import { liftVeil } from '../../veil/veil';
import { BrowseGrid } from './BrowseGrid';
import { getChoice, saveChoice } from './browseStore';
import { sortParams, type SortKey } from './LibraryView';
import { type Option, PageHeader, Segmented } from './Toolbar';
import { useGridPage } from './useGridPage';

export type GenreKind = 'all' | 'movies' | 'shows';

const KINDS: readonly Option<GenreKind>[] = [
  { value: 'all', label: strings.all },
  { value: 'movies', label: strings.movies },
  { value: 'shows', label: strings.shows },
];
const ITEM_TYPES: Record<GenreKind, string> = { all: 'Movie,Series', movies: 'Movie', shows: 'Series' };
const SORTS: readonly Option<SortKey>[] = (['added', 'title', 'release', 'rating'] as const).map((value) => ({
  value,
  label: strings.sorts[value],
}));

interface Choice {
  kind: GenreKind;
  sort: SortKey;
}
const DEFAULT_CHOICE: Choice = { kind: 'all', sort: 'added' };

/** Libraries whose genres and studios Lumen's grid (movies and shows) can show. */
const VIDEO_LIBRARIES: readonly (string | undefined)[] = [undefined, 'movies', 'tvshows', 'boxsets'];

/**
 * Whether Lumen's page fits this genre or studio: not a music genre, nor one opened from a music, music video, books,
 * photos or other library, whose titles its grid of movies and shows wouldn't list. jellyfin-web has the page for those.
 */
export function isVideoFacet(facet: BaseItem, library: BaseItem | null): boolean {
  return facet.Type !== 'MusicGenre' && (!library || VIDEO_LIBRARIES.includes(library.CollectionType));
}

/**
 * One genre's movies and shows (jellyfin-web's `#/list?genreId=…`, which the home genre tiles open), optionally inside
 * one library. Same grid, chips and sort menu as the library pages.
 */
export function GenreView({
  id,
  parentId,
  facet = 'genre',
  ctx,
}: {
  id: string;
  parentId?: string;
  /** A studio's titles instead of a genre's (`#/list?studioId=`). */
  facet?: 'genre' | 'studio';
  ctx: ViewContext;
}) {
  const choiceKey = `${ctx.userId}|genre`;
  const [choice, setChoiceState] = useState<Choice>(() => getChoice(choiceKey, DEFAULT_CHOICE));
  const setChoice = (patch: Partial<Choice>): void => {
    const next = { ...choice, ...patch };
    saveChoice(choiceKey, next);
    setChoiceState(next);
  };
  // Until the genre is known to be Lumen's, nothing of Lumen's page shows (and the veil stays up on a cold load): a
  // music genre goes back to jellyfin-web, and a flash of an empty grid first would look broken.
  // Once known, it's remembered for the session (with the page's choices), so Back to it draws the grid at once.
  const knownKey = `${ctx.userId}|lumen-facet|${id}|${parentId ?? ''}`;
  const known = getChoice<string | undefined>(knownKey, undefined);
  const [name, setName] = useState<string | null>(known ?? null);
  const [decided, setDecided] = useState(known !== undefined);

  useEffect(() => {
    let cancelled = false;
    // A library that may not be there (or not this user's) shouldn't cost the page: only a known type counts.
    const parent = parentId ? ctx.api.getItem(parentId).catch(() => null) : Promise.resolve(null);
    withTimeout(Promise.all([ctx.api.getItem(id), parent]), VIEW_TIMEOUT_MS)
      .then(([genre, library]) => {
        if (cancelled) return;
        if (isVideoFacet(genre, library)) {
          saveChoice(knownKey, genre.Name);
          setName(genre.Name);
          setDecided(true);
        } else {
          ctx.onFallback();
        }
      })
      // Couldn't look it up: Lumen's grid, under a generic title (its own errors show there).
      .catch(() => {
        if (!cancelled) setDecided(true);
      });
    return () => {
      cancelled = true;
    };
  }, [id, parentId, ctx.userId]);

  useEffect(() => {
    if (decided) liftVeil();
  }, [decided]);

  const queryKey = `${ctx.userId}|${facet}|${id}|${parentId ?? ''}|${choice.kind}|${choice.sort}`;
  const { state, select, onMenu } = useGridPage(ctx, queryKey, (page) =>
    ctx.api.getBrowseItems({
      parentId,
      includeItemTypes: ITEM_TYPES[choice.kind],
      ...sortParams(choice.sort, choice.kind === 'shows' ? 'tvshows' : 'movies'),
      ...(facet === 'studio' ? { studioIds: [id] } : { genreIds: [id] }),
      ...page,
    }),
  );

  const rootRef = useRef<HTMLDivElement>(null);
  useAutoFocus(rootRef, decided, ctx.layout, state.restoredSelectedId ?? undefined);
  const title = name ?? (facet === 'studio' ? strings.studioPage : strings.genrePage);

  if (!decided) return <div ref={rootRef} class="lmn-browse lmn-genre-page" aria-busy="true" />;
  return (
    <div ref={rootRef} class="lmn-browse lmn-genre-page">
      <PageHeader title={title} meta={state.total !== null ? strings.titleCount(state.total) : undefined}>
        <Segmented
          label={strings.filter}
          value={choice.kind}
          options={KINDS}
          onChange={(kind) => setChoice({ kind })}
        />
        <div class="lmn-browse__selects">
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
        label={title}
        onSelect={select}
        onMenu={onMenu}
        empty={<p>{facet === 'studio' ? strings.emptyStudio : strings.emptyGenre}</p>}
      />
    </div>
  );
}
