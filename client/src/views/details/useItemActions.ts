import { useState } from 'preact/hooks';
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
