import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { BadgeKey, BaseItem, ClientConfig, HeroItem } from '../../api/types';
import type { JellyfinApiClient } from '../../compat/jellyfin';
import { cardMeta } from '../../components/Card';
import { Icon } from '../../components/icons';
import { backdropUrl, imageUrl, resolveImage, TITLE_LOGO } from '../../components/images';
import { usePrefersReducedMotion } from '../../components/usePrefersReducedMotion';
import { strings } from '../../strings';
import { TrailerPreview } from './TrailerPreview';

interface Props {
  items: HeroItem[];
  client: Pick<JellyfinApiClient, 'getUrl' | 'accessToken'>;
  config: ClientConfig;
  badges?: Record<string, BadgeKey>;
  onPlay: (item: BaseItem) => void;
  /** The item whose playback is starting (its Play shows "Starting…"). */
  startingId?: string | null;
  onInfo: (item: BaseItem) => void;
}

/** Horizontal travel (px) before a press counts as a swipe rather than a tap; and the share of width that flips. */
const DRAG_SLOP = 8;
const SWIPE_FRACTION = 0.15;
/** A quick flick flips even when short (px per ms). */
const FLICK_VELOCITY = 0.5;
const SLIDE_MS = 650;

type HeroPointerEvent = PointerEvent & { currentTarget: HTMLElement };

interface DragState {
  pointerId: number;
  x: number;
  y: number;
  dx: number;
  t: number;
  swiping: boolean;
}

const mod = (n: number, m: number): number => ((n % m) + m) % m;

/**
 * The home carousel. Slides sit side by side on a track: the previous, current and next. Dragging moves the track
 * exactly with the pointer; letting go past a threshold (or flicking) slides to the neighbour, otherwise it springs
 * back. Auto-advance uses the same slide.
 */
export function Hero({ items, client, config, badges, onPlay, onInfo, startingId }: Props) {
  const [index, setIndex] = useState(0);
  const [stopped, setStopped] = useState(false);
  // Only keyboard navigation inside the hero pauses it; hovering or the initial autofocus must not.
  const [keyboardInside, setKeyboardInside] = useState(false);
  const [dragX, setDragX] = useState(0);
  /** -1/1 while sliding to the previous/next slide; 0 at rest. */
  const [sliding, setSliding] = useState<-1 | 0 | 1>(0);
  /** One frame with transitions off, while the track re-centres on the new slide after a slide. */
  const [snap, setSnap] = useState(false);
  const drag = useRef<DragState | null>(null);
  const suppressClick = useRef(false);
  const slideTimer = useRef<number | undefined>(undefined);
  const reducedMotion = usePrefersReducedMotion();
  const count = items.length;
  const dragging = drag.current?.swiping ?? false;
  const paused = stopped || keyboardInside || dragging || sliding !== 0;

  const track = useRef<HTMLDivElement>(null);
  /** The button (by position) focused on the slide that's leaving, to focus on the one arriving. */
  const followFocus = useRef<number | null>(null);
  const currentButtons = (): HTMLElement[] => [
    ...(track.current?.querySelectorAll<HTMLElement>('.lmn-hero__slide.is-current button') ?? []),
  ];

  const settle = (delta: -1 | 1): void => {
    clearTimeout(slideTimer.current);
    // The leaving slide's buttons are disabled once it's off screen; focus on one would drop to the page (stranding a
    // TV remote), so it moves to the same button on the new slide.
    const focused = currentButtons().indexOf(document.activeElement as HTMLElement);
    followFocus.current = focused >= 0 ? focused : null;
    setSnap(true);
    setSliding(0);
    setDragX(0);
    setIndex((i) => mod(i + delta, count));
  };
  useLayoutEffect(() => {
    const button = followFocus.current;
    if (button === null) return;
    followFocus.current = null;
    currentButtons()[button]?.focus({ preventScroll: true });
  }, [index]);
  useEffect(() => {
    if (!snap) return;
    const frame = requestAnimationFrame(() => setSnap(false));
    return () => cancelAnimationFrame(frame);
  }, [snap]);
  const go = (delta: -1 | 1): void => {
    if (count < 2) return;
    if (reducedMotion) return settle(delta);
    setSliding(delta);
    // transitionend can be missed (hidden tab, interrupted transition): settle on a timer as well.
    clearTimeout(slideTimer.current);
    slideTimer.current = window.setTimeout(() => settle(delta), SLIDE_MS + 80);
  };
  useEffect(() => () => clearTimeout(slideTimer.current), []);

  // A fresh timer per slide, so a manual swipe or dot click gets a full interval before the next auto-advance.
  useEffect(() => {
    if (count < 2 || paused) return;
    const timer = setTimeout(() => go(1), config.HeroIntervalSeconds * 1000);
    return () => clearTimeout(timer);
  }, [index, count, paused, config.HeroIntervalSeconds]);

  const onPointerDown = (e: HeroPointerEvent): void => {
    if (count < 2 || sliding !== 0 || (e.pointerType === 'mouse' && e.button !== 0)) return;
    drag.current = {
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      dx: 0,
      t: e.timeStamp,
      swiping: false,
    };
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
    if (!d.swiping) return;
    suppressClick.current = true; // the click that follows a drag must not press Play or More info
    setTimeout(() => (suppressClick.current = false), 0);
    const width = e.currentTarget.clientWidth || window.innerWidth;
    const velocity = Math.abs(d.dx) / Math.max(1, e.timeStamp - d.t);
    const far = Math.abs(d.dx) > width * SWIPE_FRACTION || (velocity > FLICK_VELOCITY && Math.abs(d.dx) > 30);
    if (!cancelled && far) {
      go(d.dx < 0 ? 1 : -1); // the track animates from where the finger left it
    } else {
      setDragX(0); // spring back
    }
  };

  const current = items[mod(index, count)];
  if (!current) return null;
  const trailerId = config.TrailerPreview && !reducedMotion ? current.TrailerItemId : null;

  // Previous, current, next. With two items the neighbours are the same item: key them apart.
  const slides = count < 2 ? [0] : [-1, 0, 1];
  const offset = sliding !== 0 ? `${-sliding * 100}%` : '0%';
  const trackStyle = {
    transform: `translateX(calc(${offset} + ${sliding !== 0 ? 0 : dragX}px))`,
  };

  return (
    <section
      aria-roledescription="carousel"
      aria-label={strings.featured}
      class={`lmn-hero${dragging ? ' is-dragging' : ''}`}
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
      <div
        ref={track}
        class={`lmn-hero__track${!snap && (sliding !== 0 || !dragging) ? ' is-animated' : ''}`}
        style={trackStyle}
        onTransitionEnd={(e) => {
          if (e.target === e.currentTarget && sliding !== 0) settle(sliding);
        }}
      >
        {slides.map((rel) => {
          const i = mod(index + rel, count);
          const hero = items[i]!;
          const key = rel === -1 && count === 2 ? `p${i}` : String(i);
          return (
            <Slide
              key={key}
              rel={rel}
              item={hero.Item}
              client={client}
              badge={badges?.[hero.Item.Id]}
              current={rel === 0}
              onPlay={onPlay}
              onInfo={onInfo}
              starting={startingId === hero.Item.Id}
            >
              {rel === 0 && trailerId && sliding === 0 && !dragging && (
                <TrailerPreview
                  key={trailerId}
                  trailerId={trailerId}
                  delaySeconds={config.TrailerDelaySeconds}
                  client={client}
                />
              )}
            </Slide>
          );
        })}
      </div>
      {count > 1 && (
        <div class="lmn-hero__controls">
          {/* Tabs with roving focus: Tab reaches the current one, arrows pick another (and pause rotation). */}
          <div
            class="lmn-hero__pager"
            role="tablist"
            aria-label={strings.featuredTitles}
            onKeyDown={(e) => {
              const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
              if (!step || sliding !== 0) return;
              e.preventDefault();
              const next = mod(index + step, count);
              setIndex(next);
              const tabs = e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]');
              requestAnimationFrame(() => tabs[next]?.focus());
            }}
          >
            {items.map((h, i) => {
              const active = i === mod(index + sliding, count);
              return (
                <button
                  key={h.Item.Id}
                  type="button"
                  role="tab"
                  tabIndex={active ? 0 : -1}
                  aria-selected={active}
                  aria-label={strings.showFeatured(h.Item.Name)}
                  class={`lmn-hero__dash${active ? ' is-active' : ''}`}
                  onClick={() => sliding === 0 && setIndex(i)}
                />
              );
            })}
          </div>
          <button
            type="button"
            class="lmn-icon-button"
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

function Slide({
  rel,
  item,
  client,
  badge,
  current,
  onPlay,
  onInfo,
  starting = false,
  children,
}: {
  rel: number;
  item: BaseItem;
  client: Pick<JellyfinApiClient, 'getUrl'>;
  badge?: BadgeKey;
  current: boolean;
  onPlay: (item: BaseItem) => void;
  onInfo: (item: BaseItem) => void;
  starting?: boolean;
  children?: ComponentChildren;
}) {
  const backdrop = resolveImage(item, ['Backdrop']);
  const logo = resolveImage(item, ['Logo']);
  const meta = [...cardMeta(item), ...(item.Genres ?? []).slice(0, 2)];
  // A slide off to the side is `inert`, but browsers without inert (webOS TVs' Chrome before 102, Safari before 15.5)
  // would still let Tab and jellyfin-web's D-pad (its focusable query skips [tabindex="-1"] and :disabled) reach it.
  const offscreen = current ? {} : { tabIndex: -1, disabled: true };
  return (
    <div
      class={`lmn-hero__slide${current ? ' is-current' : ''}`}
      style={{ transform: `translateX(${rel * 100}%)` }}
      aria-hidden={current ? undefined : 'true'}
      inert={!current}
    >
      {backdrop && (
        <img class="lmn-hero__backdrop" src={backdropUrl(client, backdrop)} alt="" draggable={false} />
      )}
      {children}
      <div class="lmn-hero__scrim" />
      <div class="lmn-hero__content">
        {logo ? (
          <img
            class="lmn-hero__logo"
            src={imageUrl(client, logo, TITLE_LOGO)}
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
            class={`lmn-button lmn-button--primary${current ? ' lmn-autofocus' : ''}${starting ? ' is-busy' : ''}`}
            disabled={starting}
            aria-busy={starting ? 'true' : undefined}
            onClick={() => onPlay(item)}
            {...offscreen}
          >
            {starting ? <span class="lmn-spinner" aria-hidden="true" /> : <Icon name="play" />}
            {starting ? strings.starting : strings.play}
          </button>
          <button
            type="button"
            class="lmn-button lmn-button--secondary"
            aria-label={strings.moreInfo}
            onClick={() => onInfo(item)}
            {...offscreen}
          >
            <Icon name="info" />
            <span class="lmn-button__label">{strings.moreInfo}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
