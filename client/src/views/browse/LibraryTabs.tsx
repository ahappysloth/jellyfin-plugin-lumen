import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { BaseItem } from '../../api/types';
import { facetHash, libraryTabHash } from '../../compat/jellyfin';
import type { CardVariant } from '../../components/images';
import { imageUrl, resolveImage } from '../../components/images';
import { LoadError } from '../../components/LoadError';
import { useAutoFocus } from '../../components/useAutoFocus';
import { boxAt, useImageWidth } from '../../components/useImageWidth';
import { useVisible } from '../../components/useVisible';
import { LIBRARY_TABS } from '../../compat/registry';
import { strings } from '../../strings';
import type { LibraryTab } from '../../takeover/routes';
import type { ViewContext } from '../context';
import { BrowseGrid } from './BrowseGrid';
import { SuggestionsTab, UpcomingTab } from './SuggestionsTabs';
import { PageHeader } from './Toolbar';
import { useGridPage } from './useGridPage';

export type TabCollection = 'movies' | 'tvshows';

const TITLE_TYPE: Record<TabCollection, string> = { movies: 'Movie', tvshows: 'Series' };

/** The library's name, for page titles (the collection's own name until it loads). */
export function useLibraryName(id: string, ctx: ViewContext): string | null {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    ctx.api
      .getItem(id)
      .then((library) => !cancelled && setName(library.Name))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [id, ctx.userId]);
  return name;
}

/** Links to the library's tabs, in jellyfin-web's order, so `?tab=` URLs stay interchangeable. */
export function LibraryTabBar({
  id,
  collection,
  current,
}: {
  id: string;
  collection: TabCollection;
  current: LibraryTab;
}) {
  const tabs = Object.entries(LIBRARY_TABS[collection]) as [LibraryTab, number][];
  return (
    <nav class="lmn-segmented lmn-library-tabs focuscontainer-x" aria-label={strings.libraryTabs}>
      {tabs.map(([tab, index]) => (
        <a
          key={tab}
          href={libraryTabHash(id, collection, index)}
          class={`lmn-chip${tab === current ? ' is-active lmn-autofocus' : ''}`}
          aria-current={tab === current ? 'page' : undefined}
        >
          {tab === 'items'
            ? collection === 'movies'
              ? strings.movies
              : strings.shows
            : strings.libraryTabNames[tab]}
        </a>
      ))}
    </nav>
  );
}

/** A library tab other than its main grid. */
export function LibraryTabView({
  id,
  collection,
  tab,
  ctx,
}: {
  id: string;
  collection: TabCollection;
  tab: Exclude<LibraryTab, 'items'>;
  ctx: ViewContext;
}) {
  const name = useLibraryName(id, ctx);
  const title = name ?? (collection === 'movies' ? strings.movies : strings.shows);
  const tabs = <LibraryTabBar id={id} collection={collection} current={tab} />;
  if (tab === 'suggestions')
    return <SuggestionsTab id={id} collection={collection} title={title} tabs={tabs} ctx={ctx} />;
  if (tab === 'upcoming') return <UpcomingTab id={id} title={title} tabs={tabs} ctx={ctx} />;
  if (tab === 'genres' || tab === 'studios')
    return <FacetTab id={id} collection={collection} facet={tab} title={title} tabs={tabs} ctx={ctx} />;
  return <ItemsTab id={id} collection={collection} tab={tab} title={title} tabs={tabs} ctx={ctx} />;
}

const ITEMS_TABS: Record<
  'favorites' | 'collections' | 'episodes',
  {
    type: (c: TabCollection) => string;
    variant: CardVariant;
    empty: string;
    sort: string;
    order: 'Ascending' | 'Descending';
    filters?: string[];
  }
> = {
  favorites: {
    type: (c) => TITLE_TYPE[c],
    variant: 'poster',
    empty: strings.noLibraryFavorites,
    sort: 'SortName',
    order: 'Ascending',
    filters: ['IsFavorite'],
  },
  collections: {
    type: () => 'BoxSet',
    variant: 'poster',
    empty: strings.noCollections,
    sort: 'SortName',
    order: 'Ascending',
  },
  episodes: {
    type: () => 'Episode',
    variant: 'landscape',
    empty: strings.noEpisodes,
    sort: 'DateCreated,SortName',
    order: 'Descending',
  },
};

function ItemsTab({
  id,
  collection,
  tab,
  title,
  tabs,
  ctx,
}: {
  id: string;
  collection: TabCollection;
  tab: 'favorites' | 'collections' | 'episodes';
  title: string;
  tabs: ComponentChildren;
  ctx: ViewContext;
}) {
  const spec = ITEMS_TABS[tab];
  const { state, select, onMenu } = useGridPage(
    ctx,
    `${ctx.userId}|library|${id}|${tab}`,
    (page) =>
      ctx.api.getBrowseItems({
        parentId: id,
        includeItemTypes: spec.type(collection),
        sortBy: spec.sort,
        sortOrder: spec.order,
        filters: spec.filters,
        ...page,
      }),
    spec.filters ? { dependsOn: ['IsFavorite'] } : {},
  );
  const rootRef = useRef<HTMLDivElement>(null);
  useAutoFocus(rootRef, true, ctx.layout, state.restoredSelectedId ?? undefined);
  return (
    <div ref={rootRef} class="lmn-browse">
      <PageHeader
        title={title}
        meta={state.total !== null ? strings.titleCount(state.total) : undefined}
        tabs={tabs}
      />
      <BrowseGrid
        state={state}
        client={ctx.client}
        variant={spec.variant}
        label={`${title}: ${strings.libraryTabNames[tab]}`}
        onSelect={select}
        onMenu={onMenu}
        empty={<p>{spec.empty}</p>}
      />
    </div>
  );
}

function FacetTab({
  id,
  collection,
  facet,
  title,
  tabs,
  ctx,
}: {
  id: string;
  collection: TabCollection;
  facet: 'genres' | 'studios';
  title: string;
  tabs: ComponentChildren;
  ctx: ViewContext;
}) {
  const [items, setItems] = useState<BaseItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  useAutoFocus(rootRef, items !== null || failed, ctx.layout);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    const load =
      facet === 'genres'
        ? ctx.api.getGenres(id, TITLE_TYPE[collection])
        : ctx.api.getStudios(id, TITLE_TYPE[collection]);
    load
      .then((result) => !cancelled && setItems(result.Items.filter((i) => i.Name?.trim())))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [id, facet, ctx.userId, attempt]);

  return (
    <div ref={rootRef} class="lmn-browse">
      <PageHeader
        title={title}
        meta={
          items ? (facet === 'genres' ? strings.genreCount : strings.studioCount)(items.length) : undefined
        }
        tabs={tabs}
      />
      {failed && <LoadError onRetry={() => setAttempt((n) => n + 1)} />}
      {items && items.length === 0 && (
        <div class="lmn-browse__empty">
          <p>{facet === 'genres' ? strings.noGenres : strings.noStudios}</p>
        </div>
      )}
      {items && items.length > 0 && (
        <div
          class="lmn-facet-grid focuscontainer"
          role="list"
          aria-label={`${title}: ${strings.libraryTabNames[facet]}`}
        >
          {items.map((item) => (
            <div role="listitem" key={item.Id}>
              <FacetTile
                item={item}
                facet={facet === 'genres' ? 'genre' : 'studio'}
                libraryId={id}
                itemType={TITLE_TYPE[collection]}
                ctx={ctx}
              />
            </div>
          ))}
        </div>
      )}
      {!items && !failed && <div class="lmn-browse__pending" aria-busy="true" />}
    </div>
  );
}

const TILE = { width: 320, height: 180 };

/**
 * A genre or studio: its name over art borrowed from its top-rated title in this library, and how many titles it
 * has. The art and count load when the tile scrolls into view (one small query per tile).
 */
function FacetTile({
  item,
  facet,
  libraryId,
  itemType,
  ctx,
}: {
  item: BaseItem;
  facet: 'genre' | 'studio';
  libraryId: string;
  itemType: string;
  ctx: ViewContext;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  const visible = useVisible(ref, 0);
  const [sample, setSample] = useState<{ art: BaseItem | null; count: number } | null>(null);

  useEffect(() => {
    if (!visible || sample) return;
    let cancelled = false;
    ctx.api
      .getBrowseItems({
        parentId: libraryId,
        includeItemTypes: itemType,
        ...(facet === 'genre' ? { genreIds: [item.Id] } : { studioIds: [item.Id] }),
        sortBy: 'CommunityRating,SortName',
        sortOrder: 'Descending',
        startIndex: 0,
        limit: 1,
      })
      .then(
        (r) =>
          !cancelled && setSample({ art: r.Items[0] ?? null, count: r.TotalRecordCount ?? r.Items.length }),
      )
      .catch(() => !cancelled && setSample({ art: null, count: -1 }));
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const art = sample?.art ? resolveImage(sample.art, ['Backdrop', 'Thumb', 'Primary']) : null;
  // The grid stretches tiles to fill its columns (minmax(240px, 1fr)): ask for the width they render at.
  const width = useImageWidth(ref, TILE.width);
  return (
    <a
      ref={ref}
      class="lmn-genre lmn-facet"
      href={facetHash(facet, item.Id, libraryId)}
      data-item-id={item.Id}
    >
      {art && width > 0 && (
        <img src={imageUrl(ctx.client, art, boxAt(TILE, width))} alt="" loading="lazy" decoding="async" />
      )}
      <span class="lmn-genre__label">
        {item.Name}
        {sample && sample.count >= 0 && (
          <span class="lmn-facet__count">{strings.titleCount(sample.count)}</span>
        )}
      </span>
    </a>
  );
}
