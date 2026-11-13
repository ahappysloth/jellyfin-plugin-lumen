import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useVisible } from '../../components/useVisible';
import { strings } from '../../strings';
import type { TrailerProps } from './TrailerPreview';
import { TRAILER_FADE_MS, TRAILER_START_TIMEOUT_MS } from './trailerTiming';
import {
  connectYouTubePlayer,
  embedBase,
  embedUrl,
  isYouTubeId,
  type PlayerStatus,
  type YouTubePlayer,
} from './youTubePlayer';

interface Props extends Omit<TrailerProps, 'trailerId' | 'client' | 'allowTranscode'> {
  /** The trailer's YouTube video id, checked by the server (and again here). */
  youTubeId: string;
  /** The server's override of where the player loads from (tests only); YouTube otherwise. */
  embedBase?: string | null;
}

/**
 * How long YouTube's player shows its own interface after it starts playing, resumes or seeks: the title top left, a
 * pause button in the middle, "More videos" and the logo along the bottom. Measured at 4.0 to 4.3 s on the real embed
 * (Chromium and WebKit, November 2026); no parameter or command turns it off, and the middle button can't be cropped
 * away. So the picture only shows once this has passed, and the backdrop stays until then.
 */
export const YOUTUBE_CHROME_MS = 4500;
/**
 * An ended player shows its end screen at once, so the fade back to the backdrop starts this long before the end
 * instead: the fade's length, and up to a second by which the player's rounded-up duration overstates the video.
 */
export const YOUTUBE_END_LEAD_SECONDS = 2.2;
/**
 * The player's frame is this much taller than the space it fills, top and bottom, on top of covering it at 16:9: its
 * title and bottom row sit there, out of sight, should they show while the picture does (a stall it recovers from).
 */
const CROP_PX = 60;

interface Size {
  width: number;
  height: number;
}

/** A 16:9 frame that covers `box` like object-fit: cover, with CROP_PX to spare above and below. */
export function coverSize(box: Size): Size & { left: number; top: number } {
  const height = Math.ceil(Math.max(box.height + 2 * CROP_PX, (box.width * 9) / 16));
  const width = Math.ceil((height * 16) / 9);
  return {
    width,
    height,
    left: Math.round((box.width - width) / 2),
    top: Math.round((box.height - height) / 2),
  };
}

/**
 * Muted preview of a trailer on YouTube, for a title without a local one ("Use YouTube trailers"). To the page it is
 * TrailerPreview: the same delay, Pause, callbacks and fades, and nothing on screen but the backdrop when the video
 * can't be embedded, was removed, or never starts.
 *
 * The player is YouTube's own, in a frame from youtube-nocookie.com, so it differs where YouTube makes it:
 * - Its interface shows for a few seconds after every start (YOUTUBE_CHROME_MS), so it loads and plays that much
 *   ahead of `delaySeconds`, unseen, and fades in when the interface has gone: about when a local trailer would,
 *   some seconds into the trailer (its studio logos, mostly).
 * - Pause fades it out to the backdrop and stops it; Play picks it up a few seconds back and fades it in at the
 *   moment it was paused at.
 * - The frame takes no pointer or keyboard input at all, so swipes and taps reach the page and nothing in it can be
 *   clicked. Removing the frame is what stops the video: there's nothing else to release.
 */
export function YouTubePreview({
  youTubeId,
  embedBase: baseOverride,
  delaySeconds,
  muted = true,
  paused = false,
  class: className,
  onPlayingChange,
  onProgress,
  onFinish,
  startAt,
}: Props) {
  const wrapper = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const player = useRef<YouTubePlayer | null>(null);
  const visible = useVisible(wrapper);
  const [state, setState] = useState<'waiting' | 'playing' | 'done'>(
    isYouTubeId(youTubeId) ? 'waiting' : 'done',
  );
  /** The frame's address, new for every play: a retry gets a fresh player. */
  const [src, setSrc] = useState('');
  const [shown, setShown] = useState(false);
  const [ending, setEnding] = useState(false);
  const [box, setBox] = useState<Size | null>(null);
  /** Whether this play's video has got going at all (it takes Mute then), and whether it has shown yet. */
  const started = useRef(false);
  const everShown = useRef(false);
  /** Whether this play's frame has fired its load event: it may, before the effect below connects to it. */
  const loaded = useRef(false);
  const base = embedBase(baseOverride);
  // The callbacks and flags as they are now, for the player's events (it's connected once per play).
  const latest = useRef({ paused, muted, onProgress });
  latest.current = { paused, muted, onProgress };

  // The frame is sized in pixels: nothing in CSS covers a box with a fixed-ratio frame on Chromium 68 or Safari 13.
  useLayoutEffect(() => {
    const measure = (): void => {
      const element = wrapper.current;
      if (element) setBox({ width: element.clientWidth, height: element.clientHeight });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // The player's interface shows for YOUTUBE_CHROME_MS once it plays: that wait is part of the delay, not added to it.
  useEffect(() => {
    if (state !== 'waiting' || !visible) return;
    const timer = setTimeout(
      () => {
        // Put back where it was (the hero's startAt), less what plays unseen before it shows again.
        const at = (startAt?.() ?? 0) - YOUTUBE_CHROME_MS / 1000;
        loaded.current = false;
        setSrc(
          embedUrl(base, youTubeId, {
            origin: window.location.origin,
            autoplay: !latest.current.paused,
            start: Math.max(0, at),
          }),
        );
        setState('playing');
      },
      Math.max(0, delaySeconds * 1000 - YOUTUBE_CHROME_MS),
    );
    return () => clearTimeout(timer);
  }, [state, visible, delaySeconds]);

  const playing = state === 'playing';
  useEffect(() => {
    const element = frame.current;
    if (!playing || !element) return;
    started.current = false;
    everShown.current = false;
    let reveal: ReturnType<typeof setTimeout> | undefined;
    const onStatus = (status: PlayerStatus): void => {
      clearTimeout(reveal);
      if (status === 'error') return setState('done');
      if (status === 'ended') return everShown.current ? setEnding(true) : setState('done');
      if (status === 'playing') {
        started.current = true;
        if (latest.current.paused) return player.current?.pause(); // told to wait (autoplay off), and didn't
        // Again once it plays: the captions module may have loaded with the video.
        player.current?.hideCaptions();
        if (!latest.current.muted) player.current?.setMuted(false);
        reveal = setTimeout(() => {
          everShown.current = true;
          setShown(true);
        }, YOUTUBE_CHROME_MS);
        return;
      }
      // Paused, or stalled: the interface comes back with the picture, so the backdrop takes over meanwhile.
      setShown(false);
    };
    const connected = connectYouTubePlayer(
      element,
      base,
      {
        // Autoplay usually has it going by now; one that hasn't begun is told to (it's muted, so it may).
        onReady: () => {
          connected.hideCaptions();
          if (connected.status === 'loading' && !latest.current.paused) connected.play();
        },
        onStatus,
        onTime: (clock) => {
          // From when it plays, not from when it shows: a hero slide that waits for its trailer holds on through the
          // seconds the player's interface takes, which may be more than the slide had left.
          latest.current.onProgress?.(clock);
          if (clock.duration - clock.currentTime <= YOUTUBE_END_LEAD_SECONDS) setEnding(true);
        },
      },
      loaded.current,
    );
    player.current = connected;
    return () => {
      clearTimeout(reveal);
      connected.destroy();
      player.current = null;
      setShown(false);
    };
  }, [playing, src]);

  useEffect(() => {
    if (!visible && state === 'playing') setState('waiting');
  }, [visible, state]);

  // Fades back to the backdrop before it goes, as a local trailer does.
  useEffect(() => {
    if (!ending) return;
    const timer = setTimeout(() => {
      setEnding(false);
      setState('done');
    }, TRAILER_FADE_MS);
    return () => clearTimeout(timer);
  }, [ending]);

  // Not showing after this long, though it should be: it never started (blocked, a network that can't reach YouTube),
  // or it stalled and didn't recover. The backdrop stays, and a hero slide waiting for it moves on.
  useEffect(() => {
    if (!playing || paused || shown || ending) return;
    const watchdog = setTimeout(() => setState('done'), TRAILER_START_TIMEOUT_MS);
    return () => clearTimeout(watchdog);
  }, [playing, src, paused, shown, ending]);

  // Pause stops it where it is. Play goes back as far as plays unseen before the picture returns.
  const pausedBefore = useRef(paused);
  useEffect(() => {
    if (pausedBefore.current === paused) return;
    pausedBefore.current = paused;
    const connected = player.current;
    if (!connected) return;
    if (paused) return connected.pause();
    if (everShown.current) connected.rewind(YOUTUBE_CHROME_MS / 1000);
    connected.play();
  }, [paused]);

  useEffect(() => {
    if (started.current) player.current?.setMuted(muted);
  }, [muted]);

  // As TrailerPreview: the page's controls show once the picture has, and stay through Pause and Play.
  const controlled = useRef(false);
  if (!playing || ending) controlled.current = false;
  const under = playing && !ending && (shown || (paused && everShown.current) || controlled.current);
  if (under) controlled.current = true;
  useEffect(() => {
    onPlayingChange?.(under);
  }, [under]);

  const finished = ending || state === 'done';
  useEffect(() => {
    if (finished) onFinish?.();
  }, [finished]);

  const size = box && coverSize(box);
  return (
    <div ref={wrapper} class={`lmn-hero__trailer${className ? ` ${className}` : ''}`} aria-hidden="true">
      {playing && size && (
        <iframe
          key={src}
          ref={frame}
          class={`lmn-hero__video${shown && !ending ? ' is-shown' : ''}`}
          src={src}
          onLoad={() => (loaded.current = true)}
          title={strings.trailer}
          // Sizes and position in pixels (coverSize); nothing in the frame takes a click, a tap or the focus.
          style={{
            width: `${size.width}px`,
            height: `${size.height}px`,
            left: `${size.left}px`,
            top: `${size.top}px`,
            border: 0,
            pointerEvents: 'none',
          }}
          tabIndex={-1}
          inert
          allow="autoplay; encrypted-media"
          // YouTube refuses to play for a page that doesn't say where it's from (its error 153).
          referrerpolicy="strict-origin-when-cross-origin"
          // Scripts and its own origin's storage are all the player needs: no pop-ups, no navigating Lumen's page.
          sandbox="allow-scripts allow-same-origin"
        />
      )}
    </div>
  );
}
