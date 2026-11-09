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

interface Props {
  state: BrowseState;
  client: Pick<JellyfinApiClient, 'getUrl'>;
  variant: CardVariant;
  label: string;
  onSelect: (item: BaseItem) => void;
  onMenu?: CardMenuHandler;
  /** Shown when the query has no results at all. */
  empty: ComponentChildren;
}

const SKELETONS = 18;

/** A responsive grid of cards that loads the next page as its end nears the viewport. */
export function BrowseGrid({ state, client, variant, label, onSelect, onMenu, empty }: Props) {
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

  return (
    <>
      <div
        class={`lmn-browse-grid lmn-browse-grid--${variant} focuscontainer`}
        role="list"
        aria-label={label}
        aria-busy={loading}
      >
        {items.map((item) => (
          <div role="listitem" key={item.Id} class="lmn-browse-grid__cell">
            <Card
              item={item}
              client={client}
              variant={variant}
              caption={captionFor(item)}
              onSelect={onSelect}
              onMenu={onMenu}
            />
          </div>
        ))}
        {loading &&
          Array.from({ length: items.length === 0 ? SKELETONS : 6 }, (_, i) => (
            <div key={`s${i}`} class="lmn-browse-grid__cell lmn-browse-grid__skeleton" aria-hidden="true">
              <span class="lmn-card__art" />
              <span class="lmn-skeleton-line" />
            </div>
          ))}
      </div>
      {error && <LoadError onRetry={state.retry} />}
      {hasMore && !error && <div ref={sentinel} class="lmn-browse-grid__sentinel" aria-hidden="true" />}
    </>
  );
}
