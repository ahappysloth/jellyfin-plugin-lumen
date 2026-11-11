import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { BadgeKey, BaseItem, ClientConfig, HeroItem } from '../../api/types';
import { getLayout, type JellyfinApiClient } from '../../compat/jellyfin';
import { cardMeta } from '../../components/Card';
import { Icon } from '../../components/icons';
import { backdropUrl, imageUrl, resolveImage, TITLE_LOGO } from '../../components/images';
import { usePrefersReducedMotion } from '../../components/usePrefersReducedMotion';
import { strings } from '../../strings';
import { LazyTrailer } from './lazyTrailer';

interface Props {
  items: HeroItem[];
  client: JellyfinApiClient;
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
/** After a trailer the slide waited for (HeroWaitForTrailer), the backdrop shows this long before the next slide. */
const TRAILER_BEAT_MS = 1500;
/** A trailer the slide waits for that stops getting anywhere for this long (a stall that raises no error) is given up. */
const TRAILER_STALL_MS = 10_000;

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
  const pageHidden = usePageHidden();
  const count = items.length;
  const dragging = drag.current?.swiping ?? false;
  // The pager's fill (hero.css) pauses on the same flag, so it always shows how far the slide's timer has run.
  const paused = stopped || keyboardInside || dragging || sliding !== 0 || pageHidden;

  const current = items[mod(index, count)];
  const trailerId = current && config.TrailerPreview && !reducedMotion ? current.TrailerItemId : null;
  // With HeroWaitForTrailer a slide stays up while its trailer plays. Pause then stops the trailer where it is, to go on
  // with the slideshow; otherwise Pause removes it (a trailer the timer would cut short anyway).
  const waitForTrailer = config.HeroWaitForTrailer && !!trailerId;
  const showTrailer = !!trailerId && sliding === 0 && !dragging && (waitForTrailer || !stopped);
  /**
   * Set once the current slide's trailer is under way (HeroWaitForTrailer only): from then on the pager's fill follows
   * the trailer as well as the clock. `playing` until it ends, fails, stalls or is taken off.
   */
  const [trailerRun, setTrailerRun] = useState<{ index: number; playing: boolean } | null>(null);
  const trailerFill = trailerRun?.index === index && sliding === 0;
  const holding = waitForTrailer && showTrailer && trailerFill && trailerRun.playing;

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

  // A fresh interval per slide, so a manual swipe or dot click gets all of it before the next auto-advance. A pause
  // keeps what has run (as the pager's fill does) and resuming waits only for the rest, so the fill and the change of
  // slide stay together.
  //
  // A trailer the slide waits for holds it: the clock keeps running, but the slide changes only once the trailer is over,
  // a beat after it ends (or when the interval does, if that's later).
  const run = useRef<SlideRun>({ index, ms: 0, since: null, held: false });
  const intervalMs = config.HeroIntervalSeconds * 1000;
  // A layout effect: its cleanup runs as the pager's is-paused class lands, so the time counted stops with the fill. (A
  // plain effect's cleanup waits for the next frame, which a background tab may not draw for seconds.)
  useLayoutEffect(() => {
    if (run.current.index !== index) run.current = { index, ms: 0, since: null, held: false };
    if (count < 2 || paused) return;
    const slide = run.current;
    slide.since = performance.now();
    if (holding) slide.held = true;
    const timer = holding
      ? undefined
      : setTimeout(() => go(1), Math.max(slide.held ? TRAILER_BEAT_MS : 0, intervalMs - slide.ms));
    return () => {
      clearTimeout(timer);
      slide.ms += performance.now() - (slide.since ?? performance.now());
      slide.since = null;
    };
  }, [index, count, paused, holding, intervalMs]);

  // The fill, while a trailer the slide waits for has a say: it grows with the clock, or with the trailer when that
  // will end later (whichever is behind), from where it was when the trailer got going, so it's full as the slide ends.
  // Drawn per frame from the clock and the video's own time: it stops when either does (Pause stops both).
  const fill = useRef<HTMLSpanElement>(null);
  const trailerFrom = useRef<TrailerFrom>({ video: null, fill: 0, time: 0, shown: 0 });
  const lastProgress = useRef(0);
  const clockFill = (): number => {
    const slide = run.current;
    const ms = slide.ms + (slide.since === null ? 0 : performance.now() - slide.since);
    return Math.min(1, ms / intervalMs);
  };
  const drawFill = (): void => {
    const from = trailerFrom.current;
    let shown = clockFill();
    const video = from.video;
    if (video && video.duration > from.time && video.duration < Infinity) {
      const played = Math.min(1, Math.max(0, (video.currentTime - from.time) / (video.duration - from.time)));
      shown = Math.min(shown, from.fill + (1 - from.fill) * played);
    }
    from.shown = shown;
    if (fill.current) fill.current.style.transform = `scaleX(${shown})`;
  };
  useEffect(() => {
    if (!trailerFill || paused) return;
    let frame = 0;
    const draw = (): void => {
      drawFill();
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [trailerFill, paused]);
  const onTrailerProgress = (video: HTMLVideoElement): void => {
    lastProgress.current = performance.now();
    const from = trailerFrom.current;
    if (from.video === video) return;
    // Under way (a retry or a restart is a new <video>): the trailer's share of the fill starts from what it shows now.
    trailerFrom.current = {
      video,
      fill: trailerFill ? from.shown : clockFill(),
      time: video.currentTime,
      shown: from.shown,
    };
    drawFill(); // before the fill's own animation gives way to it (is-trailer)
    setTrailerRun({ index, playing: true });
  };
  const endTrailer = (): void => {
    trailerFrom.current.video = null;
    setTrailerRun((r) => (r?.playing ? { ...r, playing: false } : r));
  };
  // A trailer that stopped getting anywhere without an error or an end would hold the slide for good.
  useEffect(() => {
    if (!holding || paused) return;
    lastProgress.current = performance.now();
    const check = setInterval(() => {
      if (performance.now() - lastProgress.current > TRAILER_STALL_MS) endTrailer();
    }, 1000);
    return () => clearInterval(check);
  }, [holding, paused]);

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

  if (!current) return null;

  // Previous, current, next. With two items the neighbours are the same item: key them apart.
  const slides = count < 2 ? [0] : [-1, 0, 1];
  const offset = sliding !== 0 ? `${-sliding * 100}%` : '0%';
  const trackStyle = {
    transform: `translateX(calc(${offset} + ${sliding !== 0 ? 0 : dragX}px))`,
  };

  return (
    // A row to jellyfin-web's D-pad (focuscontainer-x, as Lumen's rows are): Right from the slide's buttons goes to its
    // controls rather than down to whichever card is nearest, and Left from the controls comes back.
    <section
      aria-roledescription="carousel"
      aria-label={strings.featured}
      class={`lmn-hero focuscontainer-x${dragging ? ' is-dragging' : ''}`}
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
              {/* Pause stops the trailer too: no moving picture the user can't stop (WCAG 2.2.2). */}
              {rel === 0 && trailerId && showTrailer && (
                <LazyTrailer
                  key={trailerId}
                  trailerId={trailerId}
                  delaySeconds={config.TrailerDelaySeconds}
                  client={client}
                  paused={stopped}
                  onProgress={waitForTrailer ? onTrailerProgress : undefined}
                  onPlayingChange={waitForTrailer ? (playing) => playing || endTrailer() : undefined}
                />
              )}
            </Slide>
          );
        })}
      </div>
      {/* Pause stops the slideshow and the trailer; one title alone still gets it while a trailer can play. */}
      {(count > 1 || trailerId) && (
        <div class="lmn-hero__controls">
          {/* First, so the D-pad reaches it in one press from the slide's buttons, before the titles' pills. */}
          <button
            type="button"
            class="lmn-icon-button"
            aria-label={
              count > 1
                ? stopped
                  ? strings.resumeRotation
                  : strings.pauseRotation
                : stopped
                  ? strings.playTrailer
                  : strings.pauseTrailer
            }
            onClick={() => setStopped((s) => !s)}
          >
            <Icon name={stopped ? 'play' : 'pause'} size={14} />
          </button>
          {/* Tabs with roving focus: Tab reaches the current one, arrows pick another (and pause rotation). On a TV
              they're a row like any other: past either end the D-pad moves on (Left from the first pill to Pause)
              rather than wrapping round, which would keep a remote in here for good. */}
          {count > 1 && (
            <div
              class={`lmn-hero__pager${paused ? ' is-paused' : ''}`}
              role="tablist"
              aria-label={strings.featuredTitles}
              onKeyDown={(e) => {
                const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
                if (!step) return;
                if (getLayout() === 'tv' && (index + step < 0 || index + step >= count)) return;
                e.preventDefault();
                if (sliding !== 0) return;
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
                  >
                    <span class="lmn-hero__pill">
                      {/* Grows across the pill over the slide's interval; keyed by slide so each one starts it
                          over. It sits still while the track slides in: the new slide's interval starts once it's
                          there. */}
                      {active && (
                        <span
                          key={index}
                          ref={fill}
                          class={`lmn-hero__fill${trailerFill ? ' is-trailer' : ''}`}
                          style={{ animationDuration: `${config.HeroIntervalSeconds}s` }}
                        />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** The current slide's clock: time counted while not paused, and since when it's been counting (null while paused). */
interface SlideRun {
  index: number;
  ms: number;
  since: number | null;
  /** A trailer has held the slide: the next one comes no sooner than a beat after it's over. */
  held: boolean;
}

/** The trailer the fill follows: its <video>, the fill and the video's time when it got going, and the fill shown. */
interface TrailerFrom {
  video: HTMLVideoElement | null;
  fill: number;
  time: number;
  shown: number;
}

/** True while the page is in the background: no slide changes there, and the fill's clock stops with the timer's. */
function usePageHidden(): boolean {
  const [hidden, setHidden] = useState(() => document.hidden);
  useEffect(() => {
    const onChange = (): void => setHidden(document.hidden);
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return hidden;
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
          <h2 class="lmn-logo-heading">
            <img
              class="lmn-hero__logo"
              src={imageUrl(client, logo, TITLE_LOGO)}
              alt={item.Name}
              draggable={false}
            />
          </h2>
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
