import { useEffect, useRef, useState } from 'preact/hooks';
import type { BadgeKey, BaseItem, CatalogItem, HomeRow } from '../../api/types';
import type { JellyfinApiClient } from '../../compat/jellyfin';
import { Card, useMenuHandlers } from '../../components/Card';
import { Icon } from '../../components/icons';
import { useDragScroll } from '../../components/useDragScroll';
import { imageUrl, resolveImage } from '../../components/images';
import { strings } from '../../strings';
import type { CardMenuHandler } from '../cardMenu';
import { CatalogCard } from '../catalog/CatalogCard';
import { Top10Items, isTop10Row, isTraktRow } from './Top10Item';

export function captionFor(item: BaseItem): string | undefined {
  if (item.Type !== 'Episode') return undefined;
  return `S${item.ParentIndexNumber ?? 0}:E${item.IndexNumber ?? 0} · ${item.Name}`;
}

interface Props {
  row: HomeRow;
  client: Pick<JellyfinApiClient, 'getUrl' | 'accessToken'>;
  /** For catalog cards' art (useCatalogImageToken). */
  catalogImageToken?: string | null;
  badges?: Record<string, BadgeKey>;
  onSelect: (item: BaseItem, row: HomeRow) => void;
  onMenu?: CardMenuHandler;
  /** A title from Seerr's catalog (only in catalog rows). */
  onSelectCatalog?: (item: CatalogItem) => void;
  /** Whether the user may request this catalog title; Top 10 rows then show a Request button that calls onRequest. */
  canRequest?: (item: CatalogItem) => boolean;
  onRequest?: (item: CatalogItem) => void;
  /** Where the title links, with "See all" beside it (a Top 10 row's Top charts, when there's a Trakt key). */
  seeAll?: string;
}

export function Row(props: Props) {
  const { row, client, catalogImageToken, badges, onSelect, onMenu, onSelectCatalog, seeAll } = props;
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  useDragScroll(scroller);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    // Only re-render when an edge flag actually flips, not on every scroll event.
    const update = (): void => {
      const start = el.scrollLeft <= 2;
      const end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
      setEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [row.Items.length, row.Entries?.length]);
  const scroll = (direction: 1 | -1): void => {
    const el = scroller.current;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el?.scrollBy({ left: direction * el.clientWidth * 0.85, behavior: reduced ? 'auto' : 'smooth' });
  };
  const genres = row.Type === 'Genres';
  // Top 10 rows rank their cards (Top10Item), and Trakt's other rows have the same poster cards without ranks; the
  // other rows' cards below are left out for them.
  const top10 = isTop10Row(row);
  const posters = top10 || isTraktRow(row);
  const entries = posters ? null : row.Entries;
  return (
    <section
      class={`lmn-row${genres ? ' lmn-row--genres' : ''}${top10 ? ' lmn-row--top10' : posters ? ' lmn-row--trakt' : ''}`}
      aria-label={row.Title}
      data-row-id={row.Id}
    >
      <h2 class="lmn-row__title">
        {seeAll ? (
          <a class="lmn-row__link" href={seeAll} aria-label={strings.seeAllNamed(row.Title)}>
            {row.Title}
            <span class="lmn-row__see-all" aria-hidden="true">
              {strings.seeAll}
              <Icon name="chevronRight" size={18} />
            </span>
          </a>
        ) : (
          row.Title
        )}
      </h2>
      <div class="lmn-row__viewport">
        <button
          type="button"
          class="lmn-row__arrow lmn-row__arrow--left"
          tabIndex={-1}
          hidden={edges.start}
          aria-label={strings.scrollLeft}
          onClick={() => scroll(-1)}
        >
          <span class="lmn-row__disc">
            <Icon name="chevronLeft" size={24} />
          </span>
        </button>
        <div ref={scroller} class="lmn-row__scroller focuscontainer-x">
          {posters && <Top10Items {...props} />}
          {entries
            ? entries.map((entry) =>
                entry.Catalog ? (
                  <CatalogCard
                    key={entry.Catalog.Key}
                    item={entry.Catalog}
                    client={client}
                    imageToken={catalogImageToken}
                    variant="landscape"
                    onSelect={(c) => onSelectCatalog?.(c)}
                  />
                ) : entry.Item ? (
                  <Card
                    key={entry.Item.Id}
                    item={entry.Item}
                    client={client}
                    variant="landscape"
                    caption={captionFor(entry.Item)}
                    badge={badges?.[entry.Item.Id]}
                    onSelect={(selected) => onSelect(selected, row)}
                    onMenu={onMenu}
                  />
                ) : null,
              )
            : (posters ? [] : row.Items).map((item) =>
                genres ? (
                  <GenreTile
                    key={item.Id}
                    item={item}
                    client={client}
                    onSelect={(g) => onSelect(g, row)}
                    onMenu={onMenu}
                  />
                ) : (
                  <Card
                    key={item.Id}
                    item={item}
                    client={client}
                    variant="landscape"
                    caption={captionFor(item)}
                    badge={badges?.[item.Id]}
                    onSelect={(selected) => onSelect(selected, row)}
                    onMenu={onMenu}
                  />
                ),
              )}
        </div>
        <button
          type="button"
          class="lmn-row__arrow lmn-row__arrow--right"
          tabIndex={-1}
          hidden={edges.end}
          aria-label={strings.scrollRight}
          onClick={() => scroll(1)}
        >
          <span class="lmn-row__disc">
            <Icon name="chevronRight" size={24} />
          </span>
        </button>
      </div>
    </section>
  );
}

const TILE = { width: 268, height: 151 };

/** A genre: its name over artwork borrowed from a title in it (the server sets ParentBackdrop*). */
export function GenreTile({
  item,
  client,
  onSelect,
  onMenu,
}: {
  item: BaseItem;
  client: Pick<JellyfinApiClient, 'getUrl'>;
  onSelect: (item: BaseItem) => void;
  onMenu?: CardMenuHandler;
}) {
  const { consumeClick, ...handlers } = useMenuHandlers(item, onMenu);
  const art = resolveImage(item, ['Backdrop', 'Thumb', 'Primary']);
  return (
    <button
      type="button"
      class="lmn-genre"
      data-item-id={item.Id}
      aria-label={item.Name}
      onClick={() => {
        if (!consumeClick()) onSelect(item);
      }}
      {...handlers}
    >
      {art && <img src={imageUrl(client, art, TILE)} alt="" loading="lazy" decoding="async" />}
      <span class="lmn-genre__label">{item.Name}</span>
    </button>
  );
}
