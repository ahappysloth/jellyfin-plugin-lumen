import type { BaseItem } from '../api/types';
import { detailsHash, genreHash } from '../compat/jellyfin';
import { type MenuEntry, openContextMenu } from '../components/ContextMenu';
import { strings } from '../strings';
import { startPlayback } from '../playback/startPlayback';
import type { ViewContext } from './context';

/** Favorite/watched changes made from menus this session, so a reopened menu shows the new state. */
const overrides = new Map<string, { IsFavorite?: boolean; Played?: boolean }>();

export const isFavorite = (item: BaseItem): boolean =>
  overrides.get(item.Id)?.IsFavorite ?? !!item.UserData?.IsFavorite;
export const isPlayed = (item: BaseItem): boolean =>
  overrides.get(item.Id)?.Played ?? !!item.UserData?.Played;

function remember(id: string, patch: { IsFavorite?: boolean; Played?: boolean }): void {
  overrides.set(id, { ...overrides.get(id), ...patch });
}

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
  onError?: (message: string) => void;
}

/** The right-click / long-press menu for a card. */
export function cardMenuEntries(
  item: BaseItem,
  ctx: ViewContext,
  options: CardMenuOptions = {},
): MenuEntry[] {
  const open = infoHash(item);
  const newTab: MenuEntry = {
    label: strings.openNewTab,
    icon: 'external',
    onSelect: () => window.open(hashUrl(open), '_blank', 'noopener'),
  };
  if (item.Type === 'Genre') {
    return [{ label: strings.open, icon: 'chevronRight', onSelect: () => ctx.navigate(open) }, newTab];
  }

  const favorite = isFavorite(item);
  const played = isPlayed(item);
  const resumable = (item.UserData?.PlaybackPositionTicks ?? 0) > 0;
  return [
    {
      label: resumable ? strings.resume : strings.play,
      icon: 'play',
      onSelect: () => {
        startPlayback(ctx, item)
          .then((played) => played || ctx.navigate(open))
          .catch(() => options.onError?.(strings.playbackFailed));
      },
    },
    { label: strings.moreInfo, icon: 'info', onSelect: () => ctx.navigate(open) },
    newTab,
    {
      label: favorite ? strings.removeFavorite : strings.addFavorite,
      icon: favorite ? 'heart' : 'heartOutline',
      onSelect: () => {
        remember(item.Id, { IsFavorite: !favorite });
        ctx.api.setFavorite(item.Id, !favorite).catch(() => remember(item.Id, { IsFavorite: favorite }));
      },
    },
    {
      label: played ? strings.markUnwatched : strings.markWatched,
      icon: played ? 'eye' : 'check',
      onSelect: () => {
        remember(item.Id, { Played: !played });
        ctx.api.setPlayed(item.Id, !played).catch(() => remember(item.Id, { Played: played }));
      },
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

export function clearCardOverrides(): void {
  overrides.clear();
}
