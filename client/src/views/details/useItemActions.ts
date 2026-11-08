import { useEffect, useState } from 'preact/hooks';
import { HOME_HASH } from '../../compat/jellyfin';
import type { BaseItem } from '../../api/types';
import { playItem } from '../../playback/play';
import { strings } from '../../strings';
import type { ViewContext } from '../context';

/** Watched/favorite toggles (optimistic, reverted on failure) and playback with an inline error. */
export function useItemActions(item: BaseItem, ctx: ViewContext) {
  const [played, setPlayed] = useState(!!item.UserData?.Played);
  const [favorite, setFavorite] = useState(!!item.UserData?.IsFavorite);
  const [error, setError] = useState<string | null>(null);

  const toggleWatched = (): void => {
    const next = !played;
    setPlayed(next);
    ctx.api.setPlayed(item.Id, next).catch(() => setPlayed(!next));
  };
  const toggleFavorite = (): void => {
    const next = !favorite;
    setFavorite(next);
    ctx.api.setFavorite(item.Id, next).catch(() => setFavorite(!next));
  };
  const play = (itemId: string, startTicks?: number): void => {
    setError(null);
    playItem(ctx.api, ctx.client, itemId, startTicks).catch(() => setError(strings.playbackFailed));
  };

  return { played, favorite, error, toggleWatched, toggleFavorite, play };
}

/** The item's first local trailer, if it has one. */
export function useLocalTrailer(item: BaseItem, ctx: ViewContext): string | null {
  const [trailerId, setTrailerId] = useState<string | null>(null);
  useEffect(() => {
    if ((item.LocalTrailerCount ?? 0) === 0) return;
    let cancelled = false;
    ctx.api
      .getLocalTrailers(item.Id)
      .then((trailers) => {
        if (!cancelled) setTrailerId(trailers[0]?.Id ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [item.Id]);
  return trailerId;
}

/** Back to wherever the user came from; home when the details page was opened directly. */
export function goBack(ctx: ViewContext): void {
  if (window.history.length > 1) window.history.back();
  else ctx.navigate(HOME_HASH);
}
