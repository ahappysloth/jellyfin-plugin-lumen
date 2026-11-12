import type { RefObject } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../../components/icons';
import type { CardVariant } from '../../components/images';
import { LoadError } from '../../components/LoadError';
import { useAutoFocus } from '../../components/useAutoFocus';
import { strings } from '../../strings';
import type { ViewContext } from '../context';
import { BrowseGrid } from './BrowseGrid';
import { getChoice, saveChoice } from './browseStore';
import { PageHeader, Segmented } from './Toolbar';
import { useGridPage } from './useGridPage';

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
  const [attempt, setAttempt] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  useAutoFocus(rootRef, failed, ctx.layout); // TV: Try again (the grid focuses itself once it loads)
  const [tab, setTabState] = useState<FavoritesTab | null>(() =>
    getChoice<FavoritesTab | null>(choiceKey, null),
  );
  const setTab = (next: FavoritesTab): void => {
    saveChoice(choiceKey, next);
    setTabState(next);
  };

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
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
  }, [ctx.userId, attempt]);

  const total = counts ? ORDER.reduce((sum, k) => sum + counts[k], 0) : null;
  const visibleTabs = counts ? ORDER.filter((k) => counts[k] > 0) : [];

  return (
    <div ref={rootRef} class="lmn-browse">
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
      {failed && <LoadError onRetry={() => setAttempt((n) => n + 1)} />}
      {total === 0 && (
        <div class="lmn-browse__empty">
          <EmptyFavorites />
        </div>
      )}
      {counts && total !== 0 && tab && <FavoritesGrid key={tab} tab={tab} ctx={ctx} rootRef={rootRef} />}
      {!counts && !failed && <div class="lmn-browse__pending" aria-busy="true" />}
    </div>
  );
}

function FavoritesGrid({
  tab,
  ctx,
  rootRef,
}: {
  tab: FavoritesTab;
  ctx: ViewContext;
  rootRef: RefObject<HTMLDivElement | null>;
}) {
  const { itemType, variant, label } = TABS[tab];
  const { state, select, onMenu } = useGridPage(
    ctx,
    `${ctx.userId}|favorites|${tab}`,
    (page) =>
      ctx.api.getBrowseItems({
        includeItemTypes: itemType,
        filters: ['IsFavorite'],
        sortBy: 'SortName',
        sortOrder: 'Ascending',
        ...page,
      }),
    { dependsOn: ['IsFavorite'] },
  );
  // TV: once the first page is in, focus the tab chip (or the first card, or the card the user came back from).
  useAutoFocus(rootRef, state.total !== null, ctx.layout, state.restoredSelectedId ?? undefined);
  return (
    <BrowseGrid
      state={state}
      client={ctx.client}
      variant={variant}
      label={label}
      onSelect={select}
      onMenu={onMenu}
      empty={<EmptyFavorites />}
    />
  );
}

function EmptyFavorites() {
  return (
    <>
      <span class="lmn-browse__empty-icon">
        <Icon name="heart" size={32} />
      </span>
      <p class="lmn-browse__empty-title">{strings.noFavorites}</p>
      <p>{strings.noFavoritesHint}</p>
    </>
  );
}
