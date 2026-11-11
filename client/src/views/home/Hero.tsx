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
  /**
   * The current slide's trailer, once it's under way (HeroWaitForTrailer only), for the rest of this visit to the slide.
   * It holds the slide until it's `over`, which happens once: when it ends, fails or stalls. Taken off meanwhile (a
   * swipe that springs back, a tab in the background, the hero scrolled away) it holds on, and is put back where it was.
   */
  const [trailer, setTrailer] = useState<TrailerState | null>(null);
  const started = trailer?.index === index ? trailer : null;
  const holding = waitForTrailer && !!started && !started.over;
  const canShowTrailer = !!trailerId && sliding === 0 && !dragging && (waitForTrailer || !stopped);
  // Once it's over the slide is on its way out: a trailer taken off then isn't put back to play again.
  const showTrailer = canShowTrailer && !started?.gone;
  useLayoutEffect(() => {
    if (started?.over && !started.gone && (!canShowTrailer || pageHidden))
      setTrailer((t) => t && { ...t, gone: true });
  }, [started?.over, canShowTrailer, pageHidden]);
  // A new slide, a new visit: a title shown again later starts its trailer over.
  useLayoutEffect(() => setTrailer(null), [index]);
  const trailerFill = !!started && sliding === 0;

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
  // a beat after that (or when the interval does, if that's later).
  const run = useRef<SlideRun>(newRun(index));
  const intervalMs = config.HeroIntervalSeconds * 1000;
  // A layout effect: its cleanup runs as the pager's is-paused class lands, so the time counted stops with the fill. (A
  // plain effect's cleanup waits for the next frame, which a background tab may not draw for seconds.)
  useLayoutEffect(() => {
    if (run.current.index !== index) run.current = newRun(index);
    const slide = run.current;
    if (started?.over && !slide.over) {
      // The fill eases from where the trailer left it to full by the time the slide changes.
      slide.over = {
        ms: slide.ms,
        fill: slide.shown,
        until: Math.max(slide.ms + TRAILER_BEAT_MS, intervalMs),
      };
    }
    if (count < 2 || paused) return;
    slide.since = performance.now();
    const timer = holding ? undefined : setTimeout(() => go(1), (slide.over?.until ?? intervalMs) - slide.ms);
    return () => {
      clearTimeout(timer);
      slide.ms += performance.now() - (slide.since ?? performance.now());
      slide.since = null;
    };
  }, [index, count, paused, holding, started?.over, intervalMs]);

  // The fill, once a trailer the slide waits for is under way: it grows with the clock, or with the trailer when that
  // will end later (whichever is behind), from where it was when the trailer got going, so it's full as the slide ends.
  // Drawn per frame from the clock and the video's own time: it stops when either does (Pause stops both), and holds
  // where it was while the trailer is off. Once the trailer is over it eases to full over what's left.
  const fill = useRef<HTMLSpanElement>(null);
  const lastProgress = useRef(0);
  const clockMs = (slide: SlideRun): number =>
    slide.ms + (slide.since === null ? 0 : performance.now() - slide.since);
  const drawFill = (): void => {
    const slide = run.current;
    const ms = clockMs(slide);
    let shown = Math.min(1, ms / intervalMs);
    const video = slide.video;
    if (slide.over) {
      const { ms: from, fill: at, until } = slide.over;
      shown = at + (1 - at) * Math.min(1, Math.max(0, (ms - from) / (until - from)));
    } else if (video) {
      // A video that's been taken off has been reset: the trailer is where it was last heard of.
      if (video.isConnected) {
        slide.position = video.currentTime;
        if (video.duration < Infinity) slide.duration = video.duration;
      }
      if (slide.duration > slide.time) {
        const played = Math.min(
          1,
          Math.max(0, (slide.position - slide.time) / (slide.duration - slide.time)),
        );
        shown = Math.min(shown, slide.fill + (1 - slide.fill) * played);
      }
    }
    slide.shown = shown;
    if (fill.current) fill.current.style.transform = `scaleX(${shown})`;
  };
  useEffect(() => {
    if (!trailerFill || paused || count < 2) return; // with one slide there's no pager to fill
    let frame = 0;
    const draw = (): void => {
      drawFill();
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [trailerFill, paused, count]);
  const onTrailerProgress = (video: HTMLVideoElement): void => {
    const slide = run.current;
    if (slide.index !== index || started?.over) return;
    lastProgress.current = performance.now();
    if (slide.video !== video) {
      if (!slide.video) {
        // Under way: the trailer's share of the fill starts from what the clock shows now.
        slide.fill = Math.min(1, clockMs(slide) / intervalMs);
        slide.time = video.currentTime;
      } else if (video.currentTime + 1 < slide.position) {
        // Put back, but from the start (it couldn't seek): its share starts over from what the fill shows now.
        slide.fill = slide.shown;
        slide.time = video.currentTime;
      } // else put back where it was: it carries on as before
      slide.video = video;
    }
    slide.position = video.currentTime;
    if (video.duration < Infinity) slide.duration = video.duration;
    drawFill(); // before the fill's own animation gives way to it (is-trailer)
    if (!started) setTrailer({ index, over: false, on: true, gone: false });
  };
  const endTrailer = (): void =>
    setTrailer((t) => (t && t.index === run.current.index && !t.over ? { ...t, over: true } : t));
  // Where a trailer that's put back starts: where it was, on this visit.
  const trailerStart = (): number =>
    run.current.index === index && run.current.video ? run.current.position : 0;
  // Taken off in its last second, it's as good as over: TrailerPreview won't seek that close to the end, so put back it
  // would play again from the start under an almost full pill.
  useLayoutEffect(() => {
    const slide = run.current;
    if (!holding || (canShowTrailer && !pageHidden) || slide.index !== index || !slide.video) return;
    if (slide.duration - slide.position < 1) endTrailer();
  }, [holding, canShowTrailer, pageHidden]);
  // A trailer that stopped getting anywhere without an error or an end would hold the slide for good. Only while it's
  // on: one being put back has TrailerPreview's own start watchdog, and one out of view waits to be seen.
  useEffect(() => {
    if (!holding || paused || !started?.on) return;
    lastProgress.current = performance.now();
    const check = setInterval(() => {
      if (performance.now() - lastProgress.current > TRAILER_STALL_MS) endTrailer();
    }, 1000);
    return () => clearInterval(check);
  }, [holding, paused, started?.on]);

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
                  // Put back after it got going, it carries on at once.
                  delaySeconds={started ? 0 : config.TrailerDelaySeconds}
                  client={client}
                  paused={stopped}
                  onProgress={waitForTrailer ? onTrailerProgress : undefined}
                  // A trailer that's just been put back says it isn't playing yet: that doesn't end anything.
                  onPlayingChange={
                    waitForTrailer
                      ? (on) => setTrailer((t) => (t && t.on !== on ? { ...t, on } : t))
                      : undefined
                  }
                  onFinish={waitForTrailer ? endTrailer : undefined}
                  startAt={waitForTrailer ? trailerStart : undefined}
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

/** The current slide's trailer (see `trailer` in Hero). */
interface TrailerState {
  index: number;
  /** Ended, failed or stalled: it no longer holds the slide. */
  over: boolean;
  /** TrailerPreview says it's playing (not off, out of view, or being put back). */
  on: boolean;
  /** Taken off after it was over: not put back. */
  gone: boolean;
}

/**
 * The current slide's clock: time counted while not paused, and since when it's been counting (null while paused).
 * With a trailer the slide waits for, also the trailer as the fill follows it: its <video>, the fill and the video's
 * time when it got going, where it's got to, and the fill shown.
 */
interface SlideRun {
  index: number;
  ms: number;
  since: number | null;
  video: HTMLVideoElement | null;
  fill: number;
  time: number;
  position: number;
  duration: number;
  shown: number;
  /** Once the trailer is over: the clock and the fill then, and when (on the clock) the slide changes. */
  over: { ms: number; fill: number; until: number } | null;
}

const newRun = (index: number): SlideRun => ({
  index,
  ms: 0,
  since: null,
  video: null,
  fill: 0,
  time: 0,
  position: 0,
  duration: 0,
  shown: 0,
  over: null,
});

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
