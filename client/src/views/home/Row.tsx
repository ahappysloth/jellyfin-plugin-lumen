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

export function captionFor(item: BaseItem): string | undefined {
  if (item.Type !== 'Episode') return undefined;
  return `S${item.ParentIndexNumber ?? 0}:E${item.IndexNumber ?? 0} · ${item.Name}`;
}

interface Props {
  row: HomeRow;
  client: Pick<JellyfinApiClient, 'getUrl' | 'accessToken'>;
  badges?: Record<string, BadgeKey>;
  onSelect: (item: BaseItem, row: HomeRow) => void;
  onMenu?: CardMenuHandler;
  /** A title from Seerr's catalog (only in catalog rows). */
  onSelectCatalog?: (item: CatalogItem) => void;
}

export function Row({ row, client, badges, onSelect, onMenu, onSelectCatalog }: Props) {
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
    el?.scrollBy({ left: direction * el.clientWidth * 0.85, behavior: 'smooth' });
  };
  const genres = row.Type === 'Genres';
  return (
    <section class={`lmn-row${genres ? ' lmn-row--genres' : ''}`} aria-label={row.Title} data-row-id={row.Id}>
      <h2 class="lmn-row__title">{row.Title}</h2>
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
            <Icon name="chevronLeft" size={22} />
          </span>
        </button>
        <div ref={scroller} class="lmn-row__scroller focuscontainer-x">
          {row.Entries
            ? row.Entries.map((entry) =>
                entry.Catalog ? (
                  <CatalogCard
                    key={entry.Catalog.Key}
                    item={entry.Catalog}
                    client={client}
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
            : row.Items.map((item) =>
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
            <Icon name="chevronRight" size={22} />
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
