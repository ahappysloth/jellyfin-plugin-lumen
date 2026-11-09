import type { BaseItem } from '../api/types';
import { detailsHash, genreHash } from '../compat/jellyfin';
import { type MenuEntry, openContextMenu } from '../components/ContextMenu';
import { showToast } from '../components/Toast';
import { strings } from '../strings';
import { startPlayback } from '../playback/startPlayback';
import type { ViewContext } from './context';
import { toggleUserData, userDataValue } from './userDataStore';

/** Where a card's "More info" goes: an episode opens its season on the series page. */
export function infoHash(item: BaseItem): string {
  if (item.Type === 'Genre') return genreHash(item.Id, item.ServerId);
  if (item.Type === 'Episode') return detailsHash(item.SeasonId ?? item.SeriesId ?? item.Id, item.ServerId);
  return detailsHash(item.Id, item.ServerId);
}

/** An absolute URL for a jellyfin-web hash, for "Open in new tab". */
export function hashUrl(hash: string, loc: Location = window.location): string {
  return `${loc.origin}${loc.pathname}${loc.search}${hash}`;
}

export interface CardMenuOptions {
  /** Where failures go; the shared toast by default. */
  onError?: (message: string) => void;
  /** Called before the menu leaves the page (Play, More info, Open), e.g. so a grid can save its scroll position. */
  beforeNavigate?: (item: BaseItem) => void;
}

/** The right-click / long-press menu for a card. */
export function cardMenuEntries(
  item: BaseItem,
  ctx: ViewContext,
  options: CardMenuOptions = {},
): MenuEntry[] {
  const open = infoHash(item);
  const onError = options.onError ?? showToast;
  const go = (): void => {
    options.beforeNavigate?.(item);
    ctx.navigate(open);
  };
  const newTab: MenuEntry = {
    label: strings.openNewTab,
    icon: 'external',
    onSelect: () => window.open(hashUrl(open), '_blank', 'noopener'),
  };
  if (item.Type === 'Genre') {
    return [{ label: strings.open, icon: 'chevronRight', onSelect: go }, newTab];
  }

  const favorite = userDataValue(item, 'IsFavorite');
  const played = userDataValue(item, 'Played');
  const resumable = (item.UserData?.PlaybackPositionTicks ?? 0) > 0;
  return [
    {
      label: resumable ? strings.resume : strings.play,
      icon: 'play',
      onSelect: () => {
        options.beforeNavigate?.(item); // Back from the player returns to the same spot
        startPlayback(ctx, item)
          .then((played) => played || ctx.navigate(open))
          .catch(() => onError(strings.playbackFailed));
      },
    },
    { label: strings.moreInfo, icon: 'info', onSelect: go },
    newTab,
    {
      label: favorite ? strings.removeFavorite : strings.addFavorite,
      icon: favorite ? 'heart' : 'heartOutline',
      onSelect: () => toggleUserData(ctx, item, 'IsFavorite', !favorite, onError),
    },
    {
      label: played ? strings.markUnwatched : strings.markWatched,
      icon: played ? 'eye' : 'check',
      onSelect: () => toggleUserData(ctx, item, 'Played', !played, onError),
    },
  ];
}

export type CardMenuHandler = (item: BaseItem, point: { x: number; y: number }, from: HTMLElement) => void;

/** A Card `onMenu` handler that opens the card menu. */
export function cardMenuHandler(ctx: ViewContext, options: CardMenuOptions = {}): CardMenuHandler {
  return (item, point, from) =>
    openContextMenu({
      entries: cardMenuEntries(item, ctx, options),
      x: point.x,
      y: point.y,
      returnFocus: from,
      label: strings.actionsFor(item.Name),
    });
}
