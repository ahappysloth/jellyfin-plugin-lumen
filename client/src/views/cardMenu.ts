import type { BaseItem } from '../api/types';
import { infoHash } from '../compat/jellyfin';
import { type MenuEntry, openContextMenu } from '../components/ContextMenu';
import { showToast } from '../components/Toast';
import { strings } from '../strings';
import { startPlayback } from '../playback/startPlayback';
import { loadItemMenu } from './itemMenu/lazyItemMenu';
import type { ViewContext } from './context';
import { togglePlayed, toggleUserData, userDataValue } from './userDataStore';

export { infoHash };

/** An absolute URL for a jellyfin-web hash, for "Open in new tab". */
export function hashUrl(hash: string, loc: Location = window.location): string {
  return `${loc.origin}${loc.pathname}${loc.search}${hash}`;
}

/** Titles whose card menu ends in "More actions…" (jellyfin-web's ⋯ actions, views/itemMenu). */
const MORE_ACTION_TYPES = ['Movie', 'Series', 'Season', 'Episode', 'BoxSet', 'Video', 'MusicVideo'];

export interface CardMenuOptions {
  /** Where failures go; the shared toast by default. */
  onError?: (message: string) => void;
  /** Called before the menu leaves the page (Play, More info, Open), e.g. so a grid can save its scroll position. */
  beforeNavigate?: (item: BaseItem) => void;
}

/**
 * The right-click / long-press menu for a card. Given where it opened (`at`), it ends in "More actions…", which opens
 * the title's item menu in its place.
 */
export function cardMenuEntries(
  item: BaseItem,
  ctx: ViewContext,
  options: CardMenuOptions = {},
  at?: { x: number; y: number; returnFocus: HTMLElement | null },
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
  const more: MenuEntry[] =
    at && MORE_ACTION_TYPES.includes(item.Type)
      ? [
          {
            label: strings.moreActions,
            icon: 'more',
            separated: true,
            onSelect: () =>
              void loadItemMenu()
                .then((menu) => menu.openItemMenuAt(ctx, item, at))
                .catch(() => onError(strings.itemMenuFailed)),
          },
        ]
      : [];
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
      // Unwatched asks first; focus is back on the card by then (the menu returned it), and comes back there after.
      onSelect: () => togglePlayed(ctx, item, !played, onError),
    },
    ...more,
  ];
}

export type CardMenuHandler = (item: BaseItem, point: { x: number; y: number }, from: HTMLElement) => void;

/** A Card `onMenu` handler that opens the card menu. */
export function cardMenuHandler(ctx: ViewContext, options: CardMenuOptions = {}): CardMenuHandler {
  return (item, point, from) =>
    openContextMenu({
      entries: cardMenuEntries(item, ctx, options, { x: point.x, y: point.y, returnFocus: from }),
      x: point.x,
      y: point.y,
      returnFocus: from,
      label: strings.actionsFor(item.Name),
    });
}
