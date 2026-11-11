import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { HOME_HASH } from '../../compat/jellyfin';
import type { BaseItem } from '../../api/types';
import { playItem } from '../../playback/play';
import { clearStarting, showStarting, startingFor, useStartingButton } from '../../playback/starting';
import { strings } from '../../strings';
import type { ViewContext } from '../context';
import { showToast } from '../../components/Toast';
import { reconcileUserData, togglePlayed, toggleUserData, useUserData } from '../userDataStore';

/**
 * Watched/favorite toggles (a refused change rolls back with a toast; Mark as unwatched asks first) and playback with an
 * inline error. Toggles go through the shared user-data store, so the card menus and the player agree with this page.
 */
export function useItemActions(item: BaseItem, ctx: ViewContext) {
  // This item was just fetched: its values are authoritative over older changes made elsewhere this session.
  useMemo(() => reconcileUserData(item), [item.Id]);
  const played = useUserData(item, 'Played');
  const favorite = useUserData(item, 'IsFavorite');
  const [error, setError] = useState<string | null>(null);
  // jellyfin-web can take seconds to open the player (its bitrate test runs on the first play of a page load) and
  // Lumen hides its spinner, so the page shows its own "Starting…" until the player is up or playback fails.
  const [busy, runStarting] = useStartingButton<true>();
  const starting = busy !== null;
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  /** Marking unwatched asks first; focus comes back to `from` (the button: Safari doesn't focus a clicked one). */
  const toggleWatched = (from?: HTMLElement): void => togglePlayed(ctx, item, !played, showToast, from);
  const toggleFavorite = (): void => toggleUserData(ctx, item, 'IsFavorite', !favorite, showToast);
  /** Plays an item (handed to the player as is when it's fully loaded, as this page's own item is) or an id. */
  const play = (target: BaseItem | string, startTicks?: number): void => {
    if (starting) return;
    setError(null);
    showStarting(startingFor(ctx.client, item));
    runStarting(true, () =>
      playItem(ctx.api, ctx.client, target, startTicks).catch(() => {
        clearStarting();
        if (mounted.current) setError(strings.playbackFailed);
      }),
    );
  };

  return { played, favorite, error, starting, toggleWatched, toggleFavorite, play };
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
