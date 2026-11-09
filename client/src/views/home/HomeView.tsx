import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { BaseItem, HomeResponse, HomeRow } from '../../api/types';
import { detailsHash } from '../../compat/jellyfin';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { showToast } from '../../components/Toast';
import { useAutoFocus } from '../../components/useAutoFocus';
import { startPlayback } from '../../playback/startPlayback';
import { VIEW_TIMEOUT_MS, withTimeout } from '../../util/withTimeout';
import { strings } from '../../strings';
import type { ViewContext } from '../context';
import { cardMenuHandler, infoHash } from '../cardMenu';
import { catalogHash, useCatalogImageToken } from '../catalog/catalog';
import { Hero } from './Hero';
import {
  clearCachedHome,
  fetchHome,
  getSelection,
  isEmptyHome,
  rememberSelection,
  restoreScrollTop,
  setCachedHome,
  usableCachedHome,
} from './homeStore';
import { liftVeil } from '../../veil/veil';
import { Row } from './Row';

export function HomeView({ ctx }: { ctx: ViewContext }) {
  const [home, setHome] = useState<HomeResponse | null>(() => usableCachedHome(ctx.userId) ?? null);
  const catalogImageToken = useCatalogImageToken(
    ctx,
    !!home?.Rows.some((row) => row.Entries?.some((entry) => entry.Catalog)),
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const previous = getSelection(ctx.userId);
  useAutoFocus(rootRef, home !== null, ctx.layout, previous?.itemId);
  // Restore on the first render (cached home) and once more when fresh data lands, then leave scrolling to the user.
  const restores = useRef(0);
  useLayoutEffect(() => {
    if (!home || !previous || !rootRef.current || restores.current >= 2) return;
    restores.current += 1;
    window.scrollTo({ top: restoreScrollTop(rootRef.current, previous, window.scrollY) });
  }, [home]);

  useEffect(() => {
    if (home) liftVeil();
  }, [home !== null]);

  useEffect(() => {
    let cancelled = false;
    withTimeout(fetchHome(ctx.api), VIEW_TIMEOUT_MS)
      .then((fresh) => {
        if (cancelled) return;
        if (isEmptyHome(fresh)) {
          clearCachedHome(ctx.userId);
          ctx.onFallback();
        } else {
          setCachedHome(ctx.userId, fresh);
          setHome(fresh);
        }
      })
      .catch(() => {
        if (!cancelled && !usableCachedHome(ctx.userId)) ctx.onFallback();
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.api, ctx.userId]);

  const open = (item: BaseItem): void => ctx.navigate(detailsHash(item.Id, item.ServerId));
  const play = (item: BaseItem): void => {
    startPlayback(ctx, item)
      .then((played) => played || open(item))
      .catch(() => showToast(strings.playbackFailed));
  };
  const onMenu = cardMenuHandler(ctx);
  const select = (item: BaseItem, row: HomeRow): void => {
    const card = rootRef.current?.querySelector(`[data-row-id="${row.Id}"] [data-item-id="${item.Id}"]`);
    rememberSelection(ctx.userId, {
      itemId: item.Id,
      rowId: row.Id,
      scrollY: window.scrollY,
      top: card?.getBoundingClientRect().top,
    });
    // A card always opens its page (an episode opens its season); playing is one click away there, or in the menu.
    ctx.navigate(infoHash(item));
  };

  if (!home) return <div class="lmn-home lmn-home--loading" aria-busy="true" />;

  return (
    <div ref={rootRef} class={`lmn-home${home.Hero.length === 0 ? ' lmn-home--no-hero' : ''}`}>
      {home.Hero.length > 0 && (
        <ErrorBoundary fallback={null}>
          <Hero
            items={home.Hero}
            client={ctx.client}
            config={ctx.config}
            badges={home.Badges}
            onPlay={play}
            onInfo={open}
          />
        </ErrorBoundary>
      )}
      {home.Rows.map((row) => (
        <ErrorBoundary key={row.Id} fallback={null}>
          <Row
            row={row}
            client={ctx.client}
            catalogImageToken={catalogImageToken}
            badges={home.Badges}
            onSelect={select}
            onMenu={onMenu}
            onSelectCatalog={(item) => ctx.navigate(catalogHash(item))}
          />
        </ErrorBoundary>
      ))}
    </div>
  );
}
