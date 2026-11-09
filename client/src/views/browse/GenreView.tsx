import { useEffect, useState } from 'preact/hooks';
import type { BaseItem } from '../../api/types';
import { Dropdown } from '../../components/Dropdown';
import { strings } from '../../strings';
import type { ViewContext } from '../context';
import { cardMenuHandler, infoHash } from '../cardMenu';
import { BrowseGrid } from './BrowseGrid';
import { getChoice, saveChoice, saveSnapshot } from './browseStore';
import { sortParams, type SortKey } from './LibraryView';
import { type Option, PageHeader, Segmented } from './Toolbar';
import { useBrowseItems } from './useBrowseItems';

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

/**
 * One genre's movies and shows (jellyfin-web's `#/list?genreId=…`, which the home genre tiles open), optionally inside
 * one library. Same grid, chips and sort menu as the library pages.
 */
export function GenreView({ id, parentId, ctx }: { id: string; parentId?: string; ctx: ViewContext }) {
  const choiceKey = `${ctx.userId}|genre`;
  const [choice, setChoiceState] = useState<Choice>(() => getChoice(choiceKey, DEFAULT_CHOICE));
  const setChoice = (patch: Partial<Choice>): void => {
    const next = { ...choice, ...patch };
    saveChoice(choiceKey, next);
    setChoiceState(next);
  };
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    ctx.api
      .getItem(id)
      .then((genre) => !cancelled && setName(genre.Name))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [id, ctx.userId]);

  const queryKey = `${ctx.userId}|genre|${id}|${parentId ?? ''}|${choice.kind}|${choice.sort}`;
  const state = useBrowseItems(queryKey, (page) =>
    ctx.api.getBrowseItems({
      parentId,
      includeItemTypes: ITEM_TYPES[choice.kind],
      ...sortParams(choice.sort, choice.kind === 'shows' ? 'tvshows' : 'movies'),
      genreIds: [id],
      ...page,
    }),
  );

  const save = (): void => {
    if (state.total !== null)
      saveSnapshot(queryKey, {
        items: state.items,
        total: state.total,
        scrollY: window.scrollY,
        offset: state.offset,
      });
  };
  const select = (item: BaseItem): void => {
    save();
    ctx.navigate(infoHash(item));
  };
  const title = name ?? strings.genrePage;

  return (
    <div class="lmn-browse lmn-genre-page">
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
        onMenu={cardMenuHandler(ctx, { beforeNavigate: save })}
        empty={<p>{strings.emptyGenre}</p>}
      />
    </div>
  );
}
