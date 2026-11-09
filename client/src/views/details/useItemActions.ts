import { useEffect, useMemo, useState } from 'preact/hooks';
import { HOME_HASH } from '../../compat/jellyfin';
import type { BaseItem } from '../../api/types';
import { playItem } from '../../playback/play';
import { strings } from '../../strings';
import type { ViewContext } from '../context';
import { reconcileUserData, setUserData, useUserData } from '../userDataStore';

/**
 * Watched/favorite toggles and playback with an inline error. Toggles go through the shared user-data store, so the
 * card menus and the player agree with this page.
 */
export function useItemActions(item: BaseItem, ctx: ViewContext) {
  // This item was just fetched: its values are authoritative over older changes made elsewhere this session.
  useMemo(() => reconcileUserData(item), [item.Id]);
  const played = useUserData(item, 'Played');
  const favorite = useUserData(item, 'IsFavorite');
  const [error, setError] = useState<string | null>(null);

  const toggleWatched = (): void => void setUserData(ctx, item, 'Played', !played);
  const toggleFavorite = (): void => void setUserData(ctx, item, 'IsFavorite', !favorite);
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
