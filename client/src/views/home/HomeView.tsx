import { useEffect, useState } from 'preact/hooks';
import type { BaseItem, HomeResponse, HomeRow } from '../../api/types';
import { detailsHash } from '../../compat/jellyfin';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { playItem, resumeTicks } from '../../playback/play';
import { strings } from '../../strings';
import type { ViewContext } from '../context';
import { Hero } from './Hero';
import { fetchHome, getCachedHome, isEmptyHome, setCachedHome } from './homeStore';
import { Row } from './Row';

export function HomeView({ ctx }: { ctx: ViewContext }) {
  const [home, setHome] = useState<HomeResponse | null>(() => getCachedHome(ctx.userId) ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchHome(ctx.api)
      .then((fresh) => {
        if (cancelled) return;
        setCachedHome(ctx.userId, fresh);
        if (isEmptyHome(fresh)) ctx.onFallback();
        else setHome(fresh);
      })
      .catch(() => {
        if (!cancelled && !getCachedHome(ctx.userId)) ctx.onFallback();
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.api, ctx.userId]);

  const play = (item: BaseItem): void => {
    setError(null);
    playItem(ctx.api, ctx.client, item.Id, resumeTicks(item)).catch(() => setError(strings.playbackFailed));
  };
  const open = (item: BaseItem): void => ctx.navigate(detailsHash(item.Id, item.ServerId));
  const select = (item: BaseItem, row: HomeRow): void => {
    if (item.Type === 'Episode' || row.Type === 'ContinueWatching') play(item);
    else open(item);
  };

  if (!home) return <div class="lmn-home lmn-home--loading" aria-busy="true" />;

  return (
    <div class={`lmn-home${home.Hero.length === 0 ? ' lmn-home--no-hero' : ''}`}>
      {home.Hero.length > 0 && (
        <ErrorBoundary fallback={null}>
          <Hero items={home.Hero} client={ctx.client} config={ctx.config} onPlay={play} onInfo={open} />
        </ErrorBoundary>
      )}
      {error && (
        <p class="lmn-toast" role="alert">
          {error}
        </p>
      )}
      {home.Rows.map((row) => (
        <ErrorBoundary key={row.Id} fallback={null}>
          <Row row={row} client={ctx.client} onSelect={select} />
        </ErrorBoundary>
      ))}
    </div>
  );
}
