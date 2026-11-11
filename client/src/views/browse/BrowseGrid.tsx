import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import type { BaseItem } from '../../api/types';
import type { JellyfinApiClient } from '../../compat/jellyfin';
import { Card } from '../../components/Card';
import type { CardVariant } from '../../components/images';
import { LoadError } from '../../components/LoadError';
import { captionFor } from '../home/Row';
import type { CardMenuHandler } from '../cardMenu';
import type { BrowseState } from './useBrowseItems';

/** One card in the grid: an item, or several shown as one (History's run of a show's episodes). */
export interface GridCell {
  key: string;
  /** What the card links to and is named after. */
  item: BaseItem;
  caption?: string;
  /** Whose art the card shows, when not the item's own (the latest of the episodes). */
  artItem?: BaseItem;
  /** Without one, the card has no menu (a card standing for several titles). */
  menu?: boolean;
}

/** The grid's default: a card per item, episodes captioned "S1:E2 · Pilot". */
const itemCells = (items: BaseItem[]): GridCell[] =>
  items.map((item) => ({ key: item.Id, item, caption: captionFor(item), menu: true }));

interface Props {
  state: BrowseState;
  client: Pick<JellyfinApiClient, 'getUrl'>;
  variant: CardVariant;
  label: string;
  onSelect: (item: BaseItem) => void;
  onMenu?: CardMenuHandler;
  /** Shown when the query has no results at all. */
  empty: ComponentChildren;
  /**
   * Splits the cards into headed sections (History's days). Items arrive sorted, so a section is a run of items with
   * the same key.
   */
  groupBy?: (item: BaseItem) => { key: string; label: string };
  /** Turns each section's items into cards (by default one per item). */
  toCells?: (items: BaseItem[]) => GridCell[];
}

const SKELETONS = 18;

/** A responsive grid of cards that loads the next page as its end nears the viewport. */
export function BrowseGrid({
  state,
  client,
  variant,
  label,
  onSelect,
  onMenu,
  empty,
  groupBy,
  toCells = itemCells,
}: Props) {
  const sentinel = useRef<HTMLDivElement>(null);
  const { items, total, loading, error, hasMore, loadMore, restoredScrollY } = state;

  // Back from a details page: return to the same spot once the restored cards are on the page.
  const restored = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (restoredScrollY === null || restored.current === restoredScrollY || items.length === 0) return;
    restored.current = restoredScrollY;
    window.scrollTo({ top: restoredScrollY });
  }, [restoredScrollY, items.length]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore || error) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore();
      },
      { rootMargin: '1200px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, error, items.length, loading]);

  if (total === 0 && !loading) return <div class="lmn-browse__empty">{empty}</div>;

  // D-pad: Left and Right stay in the grid, Up and Down leave it (the toolbar and nav above, the next day's section
  // below). A plain focuscontainer is a wall in every direction for jellyfin-web's focusManager.
  const gridClass = `lmn-browse-grid lmn-browse-grid--${variant} focuscontainer-x`;
  const cells = (list: BaseItem[]) =>
    toCells(list).map((cell) => (
      <div role="listitem" key={cell.key} class="lmn-browse-grid__cell">
        <Card
          item={cell.item}
          artItem={cell.artItem}
          client={client}
          variant={variant}
          caption={cell.caption}
          onSelect={onSelect}
          onMenu={cell.menu ? onMenu : undefined}
        />
      </div>
    ));
  const skeletons =
    loading &&
    Array.from({ length: items.length === 0 ? SKELETONS : 6 }, (_, i) => (
      <div key={`s${i}`} class="lmn-browse-grid__cell lmn-browse-grid__skeleton" aria-hidden="true">
        <span class="lmn-card__art" />
        <span class="lmn-skeleton-line" />
      </div>
    ));

  return (
    <>
      {groupBy ? (
        <>
          {sections(items, groupBy).map((section) => (
            <section key={section.key} class="lmn-browse-section" aria-label={section.label}>
              <h2 class="lmn-row__title">{section.label}</h2>
              <div class={gridClass} role="list" aria-label={section.label}>
                {cells(section.items)}
              </div>
            </section>
          ))}
          {skeletons && (
            <div class={gridClass} aria-hidden="true">
              {skeletons}
            </div>
          )}
        </>
      ) : (
        <div class={gridClass} role="list" aria-label={label} aria-busy={loading}>
          {cells(items)}
          {skeletons}
        </div>
      )}
      {error && <LoadError onRetry={state.retry} />}
      {hasMore && !error && <div ref={sentinel} class="lmn-browse-grid__sentinel" aria-hidden="true" />}
    </>
  );
}

/** Runs of items with the same group key, in order. */
function sections(
  items: BaseItem[],
  groupBy: NonNullable<Props['groupBy']>,
): { key: string; label: string; items: BaseItem[] }[] {
  const out: { key: string; label: string; items: BaseItem[] }[] = [];
  for (const item of items) {
    const { key, label } = groupBy(item);
    const last = out[out.length - 1];
    if (last?.key === key) last.items.push(item);
    else out.push({ key, label, items: [item] });
  }
  return out;
}
