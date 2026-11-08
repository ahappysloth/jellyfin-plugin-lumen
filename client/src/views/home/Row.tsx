import { useEffect, useRef, useState } from 'preact/hooks';
import type { BadgeKey, BaseItem, HomeRow } from '../../api/types';
import type { JellyfinApiClient } from '../../compat/jellyfin';
import { Card } from '../../components/Card';
import { Icon } from '../../components/icons';
import { imageUrl, resolveImage } from '../../components/images';
import { strings } from '../../strings';

export function captionFor(item: BaseItem): string | undefined {
  if (item.Type !== 'Episode') return undefined;
  return `S${item.ParentIndexNumber ?? 0}:E${item.IndexNumber ?? 0} · ${item.Name}`;
}

interface Props {
  row: HomeRow;
  client: Pick<JellyfinApiClient, 'getUrl'>;
  badges?: Record<string, BadgeKey>;
  onSelect: (item: BaseItem, row: HomeRow) => void;
}

export function Row({ row, client, badges, onSelect }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const update = (): void =>
      setEdges({ start: el.scrollLeft <= 2, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 });
    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [row.Items.length]);
  const scroll = (direction: 1 | -1): void => {
    const el = scroller.current;
    el?.scrollBy({ left: direction * el.clientWidth * 0.85, behavior: 'smooth' });
  };
  const genres = row.Type === 'Genres';
  return (
    <section class={`lmn-row${genres ? ' lmn-row--genres' : ''}`} aria-label={row.Title}>
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
          <Icon name="chevronLeft" size={28} />
        </button>
        <div ref={scroller} class="lmn-row__scroller focuscontainer-x">
          {row.Items.map((item) =>
            genres ? (
              <GenreTile key={item.Id} item={item} client={client} onSelect={(g) => onSelect(g, row)} />
            ) : (
              <Card
                key={item.Id}
                item={item}
                client={client}
                variant="landscape"
                caption={captionFor(item)}
                badge={badges?.[item.Id]}
                onSelect={(selected) => onSelect(selected, row)}
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
          <Icon name="chevronRight" size={28} />
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
}: {
  item: BaseItem;
  client: Pick<JellyfinApiClient, 'getUrl'>;
  onSelect: (item: BaseItem) => void;
}) {
  const art = resolveImage(item, ['Backdrop', 'Thumb', 'Primary']);
  return (
    <button
      type="button"
      class="lmn-genre"
      data-item-id={item.Id}
      aria-label={item.Name}
      onClick={() => onSelect(item)}
    >
      {art && <img src={imageUrl(client, art, TILE)} alt="" loading="lazy" decoding="async" />}
      <span class="lmn-genre__label">{item.Name}</span>
    </button>
  );
}
