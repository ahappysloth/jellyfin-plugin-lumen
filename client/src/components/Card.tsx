import { useEffect, useId, useRef } from 'preact/hooks';
import type { BadgeKey, BaseItem } from '../api/types';
import { infoHash, type JellyfinApiClient } from '../compat/jellyfin';
import { strings } from '../strings';
import { Icon } from './icons';
import { CARD_SIZES, type CardVariant, cardArt, imageUrl } from './images';
import { ProgressBar, playedPercent } from './ProgressBar';
import { boxAt, useImageWidth } from './useImageWidth';

interface CardProps {
  item: BaseItem;
  client: Pick<JellyfinApiClient, 'getUrl'>;
  variant: CardVariant;
  /** Replaces the default meta line (e.g. "S1:E2 · Pilot" for episodes) and is part of the link's name. */
  caption?: string;
  badge?: BadgeKey;
  /** A plain click or Enter on the card, which links to the item's page (infoHash): remember where it was, then go. */
  onSelect: (item: BaseItem) => void;
  /** The More button, right-click, the keyboard menu key, or a touch long-press: show actions for the item at that point. */
  onMenu?: MenuCallback;
  /** The page's own item in a row of its siblings (an episode among its season's). */
  current?: boolean;
  /** Shows this item's art instead of `item`'s (History's card for several episodes of a show: the latest's still). */
  artItem?: BaseItem;
}

const LONG_PRESS_MS = 550;
const LONG_PRESS_SLOP = 10;

/** Long-press for touch screens (iOS never fires contextmenu); the click that ends a long-press is swallowed. */
export function useLongPress(onLongPress: (point: { x: number; y: number }, el: HTMLElement) => void) {
  const press = useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null);
  const cancel = (): void => {
    if (press.current) clearTimeout(press.current.timer);
  };
  // A card that goes away mid-press must not open a menu for an item that's no longer on screen.
  useEffect(() => cancel, []);
  return {
    onPointerDown: (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      cancel();
      const el = e.currentTarget as HTMLElement;
      const point = { x: e.clientX, y: e.clientY };
      const state = { timer: 0, ...point, fired: false };
      state.timer = window.setTimeout(() => {
        state.fired = true;
        onLongPress(point, el);
      }, LONG_PRESS_MS);
      press.current = state;
    },
    onPointerMove: (e: PointerEvent) => {
      const p = press.current;
      if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > LONG_PRESS_SLOP) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    /** True (once) when the click should be ignored because a long-press just opened the menu. */
    consumeClick: (): boolean => {
      const fired = !!press.current?.fired;
      press.current = null;
      return fired;
    },
  };
}

const TYPE_LABELS: Record<string, string> = {
  Movie: strings.movie,
  Series: strings.show,
  Episode: strings.episode,
};

/** "★ 7.4 · 2021 · Movie": the dim line under a card title. */
export function cardMeta(item: BaseItem): string[] {
  return [
    item.CommunityRating ? item.CommunityRating.toFixed(1) : undefined,
    item.ProductionYear?.toString(),
    TYPE_LABELS[item.Type],
  ].filter((part): part is string => !!part);
}

type MenuCallback = (item: BaseItem, point: { x: number; y: number }, from: HTMLElement) => void;

/**
 * Event props that open an item's menu: right-click, the keyboard menu key, or a touch long-press. A hook (it holds
 * the long-press timer). `consumeClick` tells the click handler to ignore the click that ends a long-press.
 */
export function useMenuHandlers(item: BaseItem, onMenu: MenuCallback | undefined) {
  const longPress = useLongPress((point, el) => onMenu?.(item, point, el));
  if (!onMenu) return { consumeClick: () => false };
  const { consumeClick, ...press } = longPress;
  return {
    consumeClick,
    ...press,
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault();
      const el = e.currentTarget as HTMLElement;
      // The keyboard menu key reports (0, 0): anchor to the element instead.
      let point = { x: e.clientX, y: e.clientY };
      if (point.x === 0 && point.y === 0) {
        const rect = el.getBoundingClientRect();
        point = { x: rect.left + 16, y: rect.top + 16 };
      }
      onMenu(item, point, el);
    },
  };
}

export function Card({
  item,
  client,
  variant,
  caption,
  badge,
  onSelect,
  onMenu,
  current,
  artItem,
}: CardProps) {
  const { consumeClick, ...handlers } = useMenuHandlers(item, onMenu);
  const art = cardArt(artItem ?? item, variant);
  const size = CARD_SIZES[variant];
  // Rows give cards a fixed width; grids (browse, "You may like") stretch them to fill their columns.
  const artRef = useRef<HTMLSpanElement>(null);
  const width = useImageWidth(artRef, size.width);
  const progress = playedPercent(item);
  const inProgress = progress > 0 && progress < 100;
  const title = item.Type === 'Episode' && item.SeriesName ? item.SeriesName : item.Name;
  const meta = cardMeta(item);
  // The link's name is what it shows: the title, and an episode's caption. The rest is read as its description.
  const name = caption ? `${title} ${caption}` : title;
  // Preact's useId starts over in each top-level render() root, so two roots can hand out the same id. That's safe
  // while cards render only in the App's root (#lmn-root, one view at a time): the profile page's stock selects, the
  // only other roots on a page with it, have no cards.
  const descriptionId = useId();
  const description = [
    badge && strings.badges[badge],
    ...(caption
      ? []
      : meta.map((part, i) => (i === 0 && item.CommunityRating ? strings.ratedValue(part) : part))),
    inProgress && strings.percentWatched(Math.round(progress)),
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <div class="lmn-card-cell">
      <a
        href={infoHash(item)}
        class={`lmn-card lmn-card--${variant}${current ? ' is-current' : ''}`}
        aria-current={current ? 'page' : undefined}
        aria-describedby={description ? descriptionId : undefined}
        data-item-id={item.Id}
        onClick={(e) => {
          const longPress = consumeClick();
          // Ctrl/Cmd/Shift-click: the browser opens the link in a new tab or window. (Alt-click would download it.)
          if (!longPress && (e.button || e.ctrlKey || e.metaKey || e.shiftKey)) return;
          e.preventDefault();
          if (!longPress) onSelect(item);
        }}
        {...handlers}
      >
        <span class="lmn-card__art" ref={artRef}>
          {art.image ? (
            <img
              src={width ? imageUrl(client, art.image, boxAt(size, width)) : undefined}
              alt=""
              loading="lazy"
              decoding="async"
              width={size.width}
              height={size.height}
            />
          ) : (
            <span class="lmn-card__placeholder" aria-hidden="true">
              {title}
            </span>
          )}
          {art.logo && width > 0 && (
            <img
              class="lmn-card__logo"
              src={imageUrl(client, art.logo, { width: Math.round(width * 0.6) })}
              alt=""
              loading="lazy"
              decoding="async"
            />
          )}
          {badge && (
            <span class="lmn-card__badge" aria-hidden="true">
              {strings.badges[badge]}
            </span>
          )}
          {inProgress && <ProgressBar percent={progress} />}
        </span>
        <span class="lmn-card__title">{title}</span>
        <span class="lmn-card__meta" aria-hidden={caption ? undefined : 'true'}>
          {caption ? (
            <span>{caption}</span>
          ) : (
            meta.map((part, i) => (
              <span key={part}>
                {i === 0 && item.CommunityRating ? <Icon name="star" size={12} class="lmn-star" /> : null}
                {part}
              </span>
            ))
          )}
        </span>
        {description && (
          <span id={descriptionId} hidden>
            {description}
          </span>
        )}
      </a>
      {onMenu && (
        // Right-click, the menu key and long-press need a mouse, a full keyboard or a touch screen: this is the way in
        // for everyone else. (Hidden in the TV layout, where it would be a second D-pad stop per card.)
        <button
          type="button"
          class="lmn-card__more"
          aria-haspopup="menu"
          aria-label={strings.moreFor(name)}
          onClick={(e) => {
            const from = e.currentTarget;
            const box = from.getBoundingClientRect();
            onMenu(item, { x: box.left, y: box.bottom }, from);
          }}
        >
          <Icon name="more" size={20} />
        </button>
      )}
    </div>
  );
}
