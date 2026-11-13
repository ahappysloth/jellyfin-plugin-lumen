import { useEffect, useRef, useState } from 'preact/hooks';
import type { MediaSourceInfo } from '../../api/types';
import type { JellyfinApiClient } from '../../compat/jellyfin';
import { useVisible } from '../../components/useVisible';
import { newUuid } from '../../util/uuid';
import {
  detectBrowser,
  getTrailerSource,
  stopTrailerTranscode,
  trailerOptions,
  trailerUrl,
  type TrailerOption,
} from './trailerStream';
import { trailerFiles } from './trailerQuality';
import { type TrailerLogger, type TrailerStep, useTrailerLog } from './trailerLog';
import {
  TRAILER_FADE_MS,
  TRAILER_HOLD_MS,
  TRAILER_STARTED_SECONDS,
  TRAILER_START_TIMEOUT_MS,
} from './trailerTiming';

/** What the hero's pager reads of a playing trailer: a <video>, or the YouTube player's clock (youTubePlayer.ts). */
export interface TrailerClock {
  readonly currentTime: number;
  readonly duration: number;
  readonly isConnected: boolean;
}

export interface TrailerProps {
  /** A local trailer: Jellyfin's item, played as its file or remuxed or transcoded by the server (trailerStream.ts). */
  trailerId?: string | null;
  /**
   * Instead of a local trailer, an MP4 elsewhere: the title's trailer on IMDb's video CDN ("Use online trailers"), which
   * the browser loads straight from there, a range at a time, as it plays. The server checked its address.
   */
  src?: string | null;
  /**
   * The same trailer in 1080p, where IMDb has it: played instead where the box needs more than 720p (trailerQuality.ts),
   * and `src` should it fail or stall.
   */
  srcHd?: string | null;
  delaySeconds: number;
  client: JellyfinApiClient;
  /** Defaults to true; the details page offers an unmute toggle. */
  muted?: boolean;
  /**
   * The details page's Pause: the video stops where it is; one that (re)starts meanwhile (a retry, or one let go while
   * out of view, back) waits. Either plays when this turns false again.
   */
  paused?: boolean;
  class?: string;
  /**
   * Called when the video starts or stops showing (it shows once it's actually under way, not while it loads), so the
   * page can reveal or hide its controls.
   */
  onPlayingChange?: (playing: boolean) => void;
  /** Called as the video plays, once it's under way (TRAILER_STARTED_SECONDS): the hero's pager follows it. */
  onProgress?: (clock: TrailerClock) => void;
  /**
   * Called once the preview is over for good: it ended (as it starts fading back to the backdrop), or no way to play it
   * worked. Not when it merely stops because it's out of view (it carries on when it's back).
   */
  onFinish?: () => void;
  /**
   * Asked as each video loads: where to start it, in seconds. The hero puts a trailer it took off (a swipe that sprang
   * back, one out of view for long) back where it was. The file seeks with range requests, as an HLS stream does.
   */
  startAt?: () => number;
  /**
   * May the server remux or transcode the trailer when the browser can't play the file? The details page says yes.
   * The hero's slides show a preview for a few seconds each, not worth a server stream: the file or nothing.
   */
  allowTranscode?: boolean;
  /** The title's id, to note how its trailer went on this device (trailerLog.ts, read by its Media info). */
  logKey?: string | null;
  /** The attempt to note it in, when this is part of one already (OnlineTrailerPreview's). */
  log?: TrailerLogger | null;
}

export { TRAILER_FADE_MS, TRAILER_STARTED_SECONDS, TRAILER_START_TIMEOUT_MS };
// The YouTube preview is part of this file's download: lazyTrailer.tsx picks whichever the title has. So are a details
// page's lookup of its trailer online and the Pause and Mute buttons over it, which only matter once this file is in.
export { YouTubePreview } from './YouTubePreview';
export { OnlineTrailerPreview } from './OnlineTrailerPreview';
export { TrailerControls } from './TrailerControls';

interface Plan {
  source: MediaSourceInfo | null;
  options: TrailerOption[];
}

/** An MP4 elsewhere (`src`): the file itself, as any browser plays H.264 in MP4; nothing for the server to look up. */
const REMOTE_PLAN: Plan = { source: null, options: [{ kind: 'direct' }] };

/**
 * How long before the delay is up the <video> is put in place, paused, to load: a phone takes about a second to connect,
 * fetch and decode the start. Not from the moment a hero slide settles, so slides swiped past (and the first second of
 * every slide) cost nothing.
 */
const PRELOAD_LEAD_MS = 3000;

/**
 * Muted trailer preview. It starts after a delay while visible: a local trailer as the file itself when the browser can
 * play it, else (where `allowTranscode`) remuxed or transcoded by the server (trailerStream.ts); an online one (`src`)
 * as that MP4, in 1080p where the box needs it (`srcHd`). Its <video> is put in place paused up to PRELOAD_LEAD_MS
 * before the delay is up, to load meanwhile (`preload="auto"`), and played a moment before, so the picture shows as
 * the delay ends; nothing is fetched before that, so slides passed by cost nothing.
 *
 * Out of view (scrolled away, or the page in the background) it's paused, and carries on from there at once when it's
 * back: no delay, no new download. One away for TRAILER_HOLD_MS is let go, as is a transcode at once (the server would
 * keep its job going, or end it, meanwhile). Unmounting the <video> stops and releases it, its download included, and
 * ends any transcode; when every way to play it fails or stalls, the backdrop stays.
 */
export function TrailerPreview({
  trailerId,
  src,
  srcHd,
  delaySeconds,
  client,
  muted = true,
  paused = false,
  class: className,
  onPlayingChange,
  onProgress,
  onFinish,
  startAt,
  allowTranscode = false,
  logKey,
  log: given,
}: TrailerProps) {
  const log = useTrailerLog(given, logKey);
  /** This session's step in the log, and when it was asked to play. */
  const step = useRef<{ session: string; step: TrailerStep; asked: number } | null>(null);
  const end = (change: Partial<TrailerStep>): void => {
    if (step.current) log?.end(step.current.step, change);
  };
  const wrapper = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const visible = useVisible(wrapper);
  const [plan, setPlan] = useState<Plan | null>(src ? REMOTE_PLAN : null);
  /** Which of the plan's options (or the online trailer's files) plays; it moves on when one fails, and stays there. */
  const [attempt, setAttempt] = useState(0);
  /**
   * The <video>'s, new for each one (a retry, or one let go and back), and '' while there's none: its transcode is found
   * and stopped by it.
   */
  const [session, setSession] = useState('');
  /** 'waiting' for the delay (its video, once there's one, loads meanwhile), 'playing' once it's up, 'done' for good. */
  const [state, setState] = useState<'waiting' | 'playing' | 'done'>('waiting');
  /** Whether this session's video has got going (played past TRAILER_STARTED_SECONDS). */
  const started = useRef(false);
  /** Whether this session's video was told to play, and not to pause since: the one to pause. */
  const asked = useRef(false);
  /**
   * The session whose video shows. It fades in over the backdrop only once it's under way: a video that's still
   * loading (or being transcoded) would otherwise fade in as an empty, or black, box. Kept by session, so a retry's
   * new video starts hidden on its first render.
   */
  const [shownSession, setShownSession] = useState('');
  const [ending, setEnding] = useState(false);
  /** The online trailer's files, best first, chosen for the box as its first video is put in place (trailerQuality.ts). */
  const files = useRef<string[]>([]);
  if (src && session && !files.current.length) files.current = trailerFiles(src, srcHd, wrapper.current);

  // Look the trailer's container and codecs up once it's in view (most hero slides never get that far).
  useEffect(() => {
    if (!visible || plan || !trailerId) return;
    let live = true;
    void getTrailerSource(client, trailerId).then((source) => {
      if (live) setPlan({ source, options: trailerOptions(source, detectBrowser(), allowTranscode) });
    });
    return () => {
      live = false;
    };
  }, [visible, plan, trailerId]);

  useEffect(() => {
    if (plan && plan.options.length === 0) {
      log?.add({ source: 'local', outcome: 'unsupported' });
      setState('done');
    }
  }, [plan]);

  // In view, the delay runs: the video is put in place to load PRELOAD_LEAD_MS before it's up, and played as much
  // before as it takes to get under way, so it shows as the delay ends. A video already in place (one that went out of
  // view during the delay) is kept.
  useEffect(() => {
    if (state !== 'waiting' || !visible || !plan?.options.length) return;
    const ms = delaySeconds * 1000;
    const place = (): void => setSession((s) => s || newUuid());
    const load = setTimeout(place, Math.max(0, ms - PRELOAD_LEAD_MS));
    const play = setTimeout(
      () => {
        place();
        setState('playing');
      },
      Math.max(0, ms - TRAILER_STARTED_SECONDS * 1000),
    );
    return () => {
      clearTimeout(load);
      clearTimeout(play);
    };
  }, [state, visible, plan, delaySeconds]);

  const option = session && state !== 'done' && plan ? plan.options[src ? 0 : attempt] : undefined;
  /** Due to play: past the delay. It plays while in view and not paused. */
  const live = !!option && state === 'playing';
  const run = live && visible && !paused;
  const shown = !!option && shownSession === session && !ending;

  // Removing a <video> from the DOM does not necessarily stop its download; release it explicitly. A transcode is
  // stopped on the server as well, including when the page itself goes (a reload, or the tab closing). The video is
  // keyed by session, so a retry gets a fresh element.
  const recheck = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (!option) return;
    const element = video.current;
    const transcoding = option.kind !== 'direct';
    const onPageHide = (): void => stopTrailerTranscode(client, session, true);
    if (transcoding) window.addEventListener('pagehide', onPageHide);
    started.current = false;
    asked.current = false;
    return () => {
      clearTimeout(recheck.current);
      if (transcoding) {
        window.removeEventListener('pagehide', onPageHide);
        stopTrailerTranscode(client, session);
      }
      if (!element) return;
      element.pause();
      element.removeAttribute('src');
      element.load();
    };
  }, [option, session]);

  // Played, and paused in place: by the page's Pause, or out of view. Started explicitly, not by the autoplay attribute,
  // to hear a refusal (iOS in Low Power Mode, a browser's autoplay policy): no other stream would be allowed either, so
  // the backdrop stays. Other rejections come with an error event or a stall, which move on to the next stream.
  useEffect(() => {
    const element = video.current;
    if (!element || !option) return;
    if (!run) {
      if (asked.current) element.pause();
      asked.current = false;
      return;
    }
    asked.current = true;
    if (log && step.current?.session !== session) {
      const file = files.current[attempt];
      step.current = {
        session,
        asked: Date.now(),
        step: log.add({
          source: src ? 'imdb' : 'local',
          quality: src ? (file && file === srcHd ? 'hd' : 'main') : option.kind,
          outcome: 'pending',
        }),
      };
    }
    let current = true;
    try {
      const playing = element.play();
      if (playing)
        playing.catch((e: unknown) => {
          if (current && (e as { name?: string } | null)?.name === 'NotAllowedError') {
            end({ outcome: 'blocked' });
            setState('done');
          }
        });
    } catch {
      // jsdom, or a browser whose play() returns nothing
    }
    return () => {
      current = false;
    };
  }, [run, session]);

  // Out of view it's kept, paused (above), to carry on at once; let go after TRAILER_HOLD_MS, a transcode at once.
  const away = !!option && !visible;
  useEffect(() => {
    if (!away) return;
    const timer = setTimeout(
      () => {
        setSession('');
        setState((s) => (s === 'playing' ? 'waiting' : s));
      },
      option.kind === 'direct' ? TRAILER_HOLD_MS : 0,
    );
    return () => clearTimeout(timer);
  }, [away]);

  // An ended preview fades back to the backdrop before it goes, rather than cutting to it.
  useEffect(() => {
    if (!ending) return;
    const timer = setTimeout(() => {
      setEnding(false);
      setState('done');
    }, TRAILER_FADE_MS);
    return () => clearTimeout(timer);
  }, [ending]);

  // Not under way by now, error or not (a stall, a silent decode failure): move on to the next stream. Paused or out of
  // view, it isn't expected to be; the wait starts over when it plays again.
  useEffect(() => {
    if (!run) return;
    const watchdog = setTimeout(() => {
      if (started.current) return;
      end({ outcome: 'timeout' });
      onError();
    }, TRAILER_START_TIMEOUT_MS);
    return () => clearTimeout(watchdog);
  }, [run, session]);

  // A video that (re)started while paused (one let go while out of view, back) waits hidden for Play, so the controls
  // stay: it can only be paused once it has shown. Once they're up they stay until the preview stops or ends, through
  // Play on such a video (not shown again until it's under way) and a retry's new stream: the control with keyboard or
  // remote focus mustn't vanish from under it. Out of view it says it isn't playing (the hero doesn't take it for a
  // stall), and is again as it's back.
  const controlled = useRef(false);
  if (!live || ending) controlled.current = false;
  const playing = live && !ending && (shown || paused || controlled.current);
  if (playing) controlled.current = true;
  const on = playing && visible;
  useEffect(() => {
    onPlayingChange?.(on);
  }, [on]);

  // Once, as it ends (the fade starts) or every way to play it has failed.
  const finished = ending || state === 'done';
  useEffect(() => {
    if (finished) onFinish?.();
  }, [finished]);

  const seekToStart = (e: { currentTarget: HTMLVideoElement }): void => {
    const at = startAt?.() ?? 0;
    const element = e.currentTarget;
    // Not past the end: a video put back that close to it would just end again.
    if (at > 0 && !(element.duration - at < 1)) element.currentTime = at;
  };

  const markStarted = (e: { currentTarget: HTMLVideoElement; type: string }): void => {
    const element = e.currentTarget;
    const left = TRAILER_STARTED_SECONDS - element.currentTime;
    if (left > 0) {
      // timeupdate comes every quarter second or so, which may be well after it's under way: look again just then, so
      // it shows as soon as it is.
      if (e.type) {
        clearTimeout(recheck.current);
        recheck.current = setTimeout(
          () => latest.current({ currentTarget: element, type: '' }),
          left * 1000 + 20,
        );
      }
      return;
    }
    started.current = true;
    if (step.current?.session === session) end({ outcome: 'played', ms: Date.now() - step.current.asked });
    if (shownSession !== session) setShownSession(session);
    onProgress?.(element);
  };
  const latest = useRef(markStarted);
  latest.current = markStarted;

  const onError = (): void => {
    const count = src ? files.current.length : (plan?.options.length ?? 0);
    if (attempt + 1 < count) {
      setAttempt(attempt + 1);
      setSession(newUuid());
    } else {
      setState('done');
    }
  };

  return (
    <div ref={wrapper} class={`lmn-hero__trailer${className ? ` ${className}` : ''}`} aria-hidden="true">
      {option && plan && (
        <video
          key={session}
          ref={video}
          class={`lmn-hero__video${shown ? ' is-shown' : ''}`}
          src={
            src
              ? (files.current[attempt] ?? src)
              : trailerUrl(client, trailerId!, plan.source, option, session)
          }
          muted={muted}
          playsInline
          preload="auto"
          onLoadedMetadata={startAt ? seekToStart : undefined}
          onPlaying={markStarted}
          onTimeUpdate={markStarted}
          onError={(e) => {
            const error = e.currentTarget.error;
            end({ outcome: 'error', code: error?.code, message: error?.message || undefined });
            onError();
          }}
          onEnded={() => setEnding(true)}
        />
      )}
    </div>
  );
}
