import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { BaseItem, HomeResponse, HomeRow } from '../../api/types';
import { detailsHash, genreHash } from '../../compat/jellyfin';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { useAutoFocus } from '../../components/useAutoFocus';
import { playItem, resumeTicks } from '../../playback/play';
import { VIEW_TIMEOUT_MS, withTimeout } from '../../util/withTimeout';
import { strings } from '../../strings';
import type { ViewContext } from '../context';
import { resolveSeriesPlayTarget } from '../details/smartPlay';
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
import { Row } from './Row';

export function HomeView({ ctx }: { ctx: ViewContext }) {
  const [home, setHome] = useState<HomeResponse | null>(() => usableCachedHome(ctx.userId) ?? null);
  const [error, setError] = useState<string | null>(null);
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
    setError(null);
    const started =
      item.Type === 'Series'
        ? resolveSeriesPlayTarget(ctx.api, item.Id).then((target) => {
            if (!target) return open(item);
            return playItem(ctx.api, ctx.client, target.episodeId, target.startTicks);
          })
        : playItem(ctx.api, ctx.client, item.Id, resumeTicks(item));
    started.catch(() => setError(strings.playbackFailed));
  };
  const select = (item: BaseItem, row: HomeRow): void => {
    const card = rootRef.current?.querySelector(`[data-row-id="${row.Id}"] [data-item-id="${item.Id}"]`);
    rememberSelection(ctx.userId, {
      itemId: item.Id,
      rowId: row.Id,
      scrollY: window.scrollY,
      top: card?.getBoundingClientRect().top,
    });
    if (item.Type === 'Genre') return ctx.navigate(genreHash(item.Id, item.ServerId));
    if (item.Type === 'Episode' || row.Type === 'ContinueWatching') play(item);
    else open(item);
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
      {error && (
        <p class="lmn-toast" role="alert">
          {error}
        </p>
      )}
      {home.Rows.map((row) => (
        <ErrorBoundary key={row.Id} fallback={null}>
          <Row row={row} client={ctx.client} badges={home.Badges} onSelect={select} />
        </ErrorBoundary>
      ))}
    </div>
  );
}
