import { useEffect, useRef, useState } from 'preact/hooks';
import type { BadgeKey, BaseItem, ClientConfig, HeroItem } from '../../api/types';
import type { JellyfinApiClient } from '../../compat/jellyfin';
import { cardMeta } from '../../components/Card';
import { Icon } from '../../components/icons';
import { imageUrl, resolveImage } from '../../components/images';
import { usePrefersReducedMotion } from '../../components/usePrefersReducedMotion';
import { strings } from '../../strings';
import { TrailerPreview } from './TrailerPreview';

interface Props {
  items: HeroItem[];
  client: Pick<JellyfinApiClient, 'getUrl' | 'accessToken'>;
  config: ClientConfig;
  badges?: Record<string, BadgeKey>;
  onPlay: (item: BaseItem) => void;
  onInfo: (item: BaseItem) => void;
}

/** Horizontal travel (px) before a press counts as a swipe rather than a tap; and the share of width that flips. */
const DRAG_SLOP = 8;
const SWIPE_FRACTION = 0.12;

type HeroPointerEvent = PointerEvent & { currentTarget: HTMLElement };

interface DragState {
  pointerId: number;
  x: number;
  y: number;
  dx: number;
  swiping: boolean;
}

export function Hero({ items, client, config, badges, onPlay, onInfo }: Props) {
  const [index, setIndex] = useState(0);
  const [stopped, setStopped] = useState(false);
  // Only keyboard navigation inside the hero pauses it; hovering or the initial autofocus must not.
  const [keyboardInside, setKeyboardInside] = useState(false);
  const [dragX, setDragX] = useState(0);
  const drag = useRef<DragState | null>(null);
  const suppressClick = useRef(false);
  const reducedMotion = usePrefersReducedMotion();
  const count = items.length;
  const paused = stopped || keyboardInside || dragX !== 0;

  const go = (delta: number): void => setIndex((i) => (((i + delta) % count) + count) % count);

  // A fresh timer per slide, so a manual swipe or dot click gets a full interval before the next auto-advance.
  useEffect(() => {
    if (count < 2 || paused) return;
    const timer = setTimeout(() => setIndex((i) => (i + 1) % count), config.HeroIntervalSeconds * 1000);
    return () => clearTimeout(timer);
  }, [index, count, paused, config.HeroIntervalSeconds]);

  const onPointerDown = (e: HeroPointerEvent): void => {
    if (count < 2 || (e.pointerType === 'mouse' && e.button !== 0)) return;
    drag.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, swiping: false };
  };
  const onPointerMove = (e: HeroPointerEvent): void => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.swiping) {
      if (Math.abs(dx) < DRAG_SLOP && Math.abs(dy) < DRAG_SLOP) return;
      if (Math.abs(dy) > Math.abs(dx)) {
        drag.current = null; // a vertical scroll, not a swipe
        return;
      }
      d.swiping = true;
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    d.dx = dx;
    setDragX(dx);
  };
  const endDrag = (e: HeroPointerEvent, cancelled: boolean): void => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    setDragX(0);
    if (!d.swiping) return;
    suppressClick.current = true; // the click that follows a drag must not press Play or More info
    setTimeout(() => (suppressClick.current = false), 0);
    const width = e.currentTarget.clientWidth || window.innerWidth;
    if (!cancelled && Math.abs(d.dx) > Math.max(40, width * SWIPE_FRACTION)) go(d.dx < 0 ? 1 : -1);
  };

  const current = items[index % items.length];
  if (!current) return null;
  const item = current.Item;
  const backdrop = resolveImage(item, ['Backdrop']);
  const logo = resolveImage(item, ['Logo']);
  const trailerId = config.TrailerPreview && !reducedMotion ? current.TrailerItemId : null;
  const badge = badges?.[item.Id];
  const meta = [...cardMeta(item), ...(item.Genres ?? []).slice(0, 2)];

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Featured"
      class={`lmn-hero${dragX !== 0 ? ' is-dragging' : ''}`}
      style={dragX !== 0 ? { '--lmn-drag': `${dragX}px` } : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endDrag(e, false)}
      onPointerCancel={(e) => endDrag(e, true)}
      onClickCapture={(e) => {
        if (!suppressClick.current) return;
        e.preventDefault();
        e.stopPropagation();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Tab' || e.key.startsWith('Arrow')) setKeyboardInside(true);
      }}
      onFocusOut={(e) => {
        const next = e.relatedTarget as Node | null;
        if (!next || !e.currentTarget.contains(next)) setKeyboardInside(false);
      }}
    >
      {backdrop && (
        <img
          key={item.Id}
          class="lmn-hero__backdrop"
          src={imageUrl(client, backdrop, { width: 1920 })}
          alt=""
          draggable={false}
        />
      )}
      {trailerId && (
        <TrailerPreview
          key={trailerId}
          trailerId={trailerId}
          delaySeconds={config.TrailerDelaySeconds}
          client={client}
        />
      )}
      <div class="lmn-hero__scrim" />
      <div class="lmn-hero__content" key={`content-${item.Id}`}>
        {logo ? (
          <img
            class="lmn-hero__logo"
            src={imageUrl(client, logo, { width: 840 })}
            alt={item.Name}
            draggable={false}
          />
        ) : (
          <h2 class="lmn-hero__title">{item.Name}</h2>
        )}
        {badge && <p class="lmn-hero__badge">{strings.badges[badge]}</p>}
        {meta.length > 0 && (
          <p class="lmn-meta lmn-hero__meta">
            {meta.map((part, i) => (
              <span key={part}>
                {i === 0 && item.CommunityRating ? <Icon name="star" size={13} class="lmn-star" /> : null}
                {part}
              </span>
            ))}
          </p>
        )}
        {item.Overview && <p class="lmn-hero__overview">{item.Overview}</p>}
        <div class="lmn-actions">
          <button
            type="button"
            class="lmn-button lmn-button--primary lmn-autofocus"
            onClick={() => onPlay(item)}
          >
            <Icon name="play" />
            {strings.play}
          </button>
          <button
            type="button"
            class="lmn-button lmn-button--secondary"
            aria-label={strings.moreInfo}
            onClick={() => onInfo(item)}
          >
            <Icon name="info" />
            <span class="lmn-button__label">{strings.moreInfo}</span>
          </button>
        </div>
      </div>
      {items.length > 1 && (
        <div class="lmn-hero__controls">
          <div class="lmn-hero__pager" role="tablist">
            {items.map((h, i) => (
              <button
                key={h.Item.Id}
                type="button"
                role="tab"
                tabIndex={-1}
                aria-selected={i === index}
                aria-label={`Show ${h.Item.Name}`}
                class={`lmn-hero__dash${i === index ? ' is-active' : ''}`}
                onClick={() => setIndex(i)}
              />
            ))}
          </div>
          <button
            type="button"
            class="lmn-icon-button"
            tabIndex={-1}
            aria-label={stopped ? strings.resumeRotation : strings.pauseRotation}
            onClick={() => setStopped((s) => !s)}
          >
            <Icon name={stopped ? 'play' : 'pause'} size={14} />
          </button>
        </div>
      )}
    </section>
  );
}
