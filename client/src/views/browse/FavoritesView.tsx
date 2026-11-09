import { useEffect, useState } from 'preact/hooks';
import type { BaseItem } from '../../api/types';
import { Icon } from '../../components/icons';
import type { CardVariant } from '../../components/images';
import { strings } from '../../strings';
import type { ViewContext } from '../context';
import { cardMenuHandler, infoHash } from '../cardMenu';
import { BrowseGrid } from './BrowseGrid';
import { getChoice, saveChoice, saveSnapshot } from './browseStore';
import { PageHeader, Segmented } from './Toolbar';
import { useBrowseItems } from './useBrowseItems';

export type FavoritesTab = 'movies' | 'shows' | 'episodes';

const TABS: Record<FavoritesTab, { label: string; itemType: string; variant: CardVariant }> = {
  movies: { label: strings.movies, itemType: 'Movie', variant: 'poster' },
  shows: { label: strings.shows, itemType: 'Series', variant: 'poster' },
  episodes: { label: strings.episodesTab, itemType: 'Episode', variant: 'landscape' },
};
const ORDER: readonly FavoritesTab[] = ['movies', 'shows', 'episodes'];

type Counts = Record<FavoritesTab, number>;

/** The user's favorites, one tab per kind (only kinds that have any), A to Z. */
export function FavoritesView({ ctx }: { ctx: ViewContext }) {
  const choiceKey = `${ctx.userId}|favorites`;
  const [counts, setCounts] = useState<Counts | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTabState] = useState<FavoritesTab | null>(() =>
    getChoice<FavoritesTab | null>(choiceKey, null),
  );
  const setTab = (next: FavoritesTab): void => {
    saveChoice(choiceKey, next);
    setTabState(next);
  };

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      ORDER.map((key) =>
        ctx.api
          .getBrowseItems({
            includeItemTypes: TABS[key].itemType,
            filters: ['IsFavorite'],
            sortBy: 'SortName',
            sortOrder: 'Ascending',
            startIndex: 0,
            limit: 0,
          })
          .then((r) => r.TotalRecordCount ?? 0),
      ),
    )
      .then(([movies = 0, shows = 0, episodes = 0]) => {
        if (cancelled) return;
        const next = { movies, shows, episodes };
        setCounts(next);
        // Keep the remembered tab if it still has favorites; otherwise the first kind that does.
        setTabState((current) =>
          current && next[current] > 0 ? current : (ORDER.find((k) => next[k] > 0) ?? 'movies'),
        );
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [ctx.userId]);

  const total = counts ? ORDER.reduce((sum, k) => sum + counts[k], 0) : null;
  const visibleTabs = counts ? ORDER.filter((k) => counts[k] > 0) : [];

  return (
    <div class="lmn-browse">
      <PageHeader title={strings.favorites} meta={total ? strings.titleCount(total) : undefined}>
        {visibleTabs.length > 1 && tab && (
          <Segmented
            label={strings.favorites}
            value={tab}
            options={visibleTabs.map((k) => ({ value: k, label: TABS[k].label, count: counts![k] }))}
            onChange={setTab}
          />
        )}
      </PageHeader>
      {failed && (
        <div class="lmn-browse__error" role="alert">
          <p>{strings.loadFailed}</p>
        </div>
      )}
      {total === 0 && (
        <div class="lmn-browse__empty">
          <EmptyFavorites />
        </div>
      )}
      {counts && total !== 0 && tab && <FavoritesGrid key={tab} tab={tab} ctx={ctx} />}
      {!counts && !failed && <div class="lmn-browse__pending" aria-busy="true" />}
    </div>
  );
}

function FavoritesGrid({ tab, ctx }: { tab: FavoritesTab; ctx: ViewContext }) {
  const { itemType, variant, label } = TABS[tab];
  const queryKey = `${ctx.userId}|favorites|${tab}`;
  const state = useBrowseItems(queryKey, (page) =>
    ctx.api.getBrowseItems({
      includeItemTypes: itemType,
      filters: ['IsFavorite'],
      sortBy: 'SortName',
      sortOrder: 'Ascending',
      ...page,
    }),
  );
  const select = (item: BaseItem): void => {
    if (state.total !== null)
      saveSnapshot(queryKey, { items: state.items, total: state.total, scrollY: window.scrollY });
    ctx.navigate(infoHash(item));
  };
  return (
    <BrowseGrid
      state={state}
      client={ctx.client}
      variant={variant}
      label={label}
      onSelect={select}
      onMenu={cardMenuHandler(ctx)}
      empty={<EmptyFavorites />}
    />
  );
}

function EmptyFavorites() {
  return (
    <>
      <span class="lmn-browse__empty-icon">
        <Icon name="heart" size={28} />
      </span>
      <p class="lmn-browse__empty-title">{strings.noFavorites}</p>
      <p>{strings.noFavoritesHint}</p>
    </>
  );
}
