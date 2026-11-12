import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { BaseItem, CatalogItem, HomeResponse, HomeRow, RequestStatus } from '../../api/types';
import { detailsHash } from '../../compat/jellyfin';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { showToast } from '../../components/Toast';
import { useAutoFocus } from '../../components/useAutoFocus';
import { startPlayback } from '../../playback/startPlayback';
import { useStartingButton } from '../../playback/starting';
import { VIEW_TIMEOUT_MS, withTimeout } from '../../util/withTimeout';
import { strings } from '../../strings';
import type { ViewContext } from '../context';
import { cardMenuHandler, infoHash } from '../cardMenu';
import { catalogHash, loadRequestStatus, useCatalogImageToken } from '../catalog/catalog';
import { LazyQuickRequest } from '../catalog/lazyTitle';
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
import { withLocalChanges } from '../itemChanges';
import { liftVeil } from '../../veil/veil';
import { Row } from './Row';

export function HomeView({ ctx }: { ctx: ViewContext }) {
  const [home, setHome] = useState<HomeResponse | null>(() => usableCachedHome(ctx.userId) ?? null);
  const hasCatalog = !!home?.Rows.some((row) => row.Entries?.some((entry) => entry.Catalog));
  const catalogImageToken = useCatalogImageToken(ctx, hasCatalog);
  // What the user may request decides whether Top 10 cards offer Request (the status is loaded once per user anyway).
  const [requests, setRequests] = useState<RequestStatus | null>(null);
  useEffect(() => {
    if (!hasCatalog) return undefined;
    let cancelled = false;
    void loadRequestStatus(ctx).then((status) => !cancelled && setRequests(status));
    return () => {
      cancelled = true;
    };
  }, [ctx.userId, hasCatalog]);
  const canRequest = (item: CatalogItem): boolean =>
    !!requests?.Enabled && (item.MediaType === 'movie' ? requests.CanRequestMovies : requests.CanRequestTv);
  const [requesting, setRequesting] = useState<CatalogItem | null>(null);
  const closeRequest = (): void => {
    const key = requesting?.Key;
    setRequesting(null);
    // Back to the card's Request button, or to the card if the request took it away.
    const root = rootRef.current;
    if (!key || !root) return;
    const back =
      root.querySelector<HTMLElement>(`[data-request-key="${key}"]`) ??
      root.querySelector<HTMLElement>(`.lmn-row--top10 [data-catalog-key="${key}"]`);
    window.setTimeout(() => {
      if (!document.activeElement || document.activeElement === document.body)
        back?.focus({ preventScroll: true });
    });
  };
  const rootRef = useRef<HTMLDivElement>(null);
  const previous = getSelection(ctx.userId);
  useAutoFocus(rootRef, home !== null, ctx.layout, previous?.itemId, previous?.rowId);
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

  // Fetched again after a title is edited from its card's "More actions…".
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    withTimeout(fetchHome(ctx.api), VIEW_TIMEOUT_MS)
      .then((fresh) => {
        if (cancelled) return;
        // The server's home can lag a delete or an edit made here by up to 30 s (itemChanges.ts).
        const shown = withLocalChanges(ctx.userId, fresh);
        if (isEmptyHome(shown)) {
          clearCachedHome(ctx.userId);
          ctx.onFallback();
        } else {
          setCachedHome(ctx.userId, shown);
          setHome(shown);
        }
      })
      .catch(() => {
        if (!cancelled && version === 0 && !usableCachedHome(ctx.userId)) ctx.onFallback();
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.api, ctx.userId, version]);

  const open = (item: BaseItem): void => ctx.navigate(detailsHash(item.Id, item.ServerId));
  // The hero's Play shows "Starting…" while jellyfin-web opens the player (Lumen hides jellyfin-web's spinner).
  const [startingId, runStarting] = useStartingButton<string>();
  const play = (item: BaseItem): void => {
    if (startingId) return;
    runStarting(item.Id, () =>
      startPlayback(ctx, item)
        .then((played) => played || open(item))
        .catch(() => showToast(strings.playbackFailed)),
    );
  };
  const onMenu = cardMenuHandler(ctx, {
    onDeleted: () => setHome((current) => current && withLocalChanges(ctx.userId, current)),
    onChanged: () => setVersion((v) => v + 1),
  });
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
      <h1 class="lmn-visually-hidden">{strings.home}</h1>
      {home.Hero.length > 0 && (
        <ErrorBoundary fallback={null}>
          <Hero
            items={home.Hero}
            client={ctx.client}
            config={ctx.config}
            badges={home.Badges}
            onPlay={play}
            onInfo={open}
            startingId={startingId}
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
            canRequest={canRequest}
            onRequest={setRequesting}
          />
        </ErrorBoundary>
      ))}
      {requesting && <LazyQuickRequest item={requesting} ctx={ctx} onClose={closeRequest} />}
    </div>
  );
}
