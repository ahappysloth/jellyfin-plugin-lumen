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

interface Props {
  trailerId: string;
  delaySeconds: number;
  client: JellyfinApiClient;
  /** Defaults to true; the details page offers an unmute toggle. */
  muted?: boolean;
  class?: string;
  /** Called when the video starts or stops showing, so the page can reveal or hide its controls. */
  onPlayingChange?: (playing: boolean) => void;
  /**
   * May the server remux or transcode the trailer when the browser can't play the file? The details page says yes.
   * The hero's slides show a preview for a few seconds each, not worth a server stream: the file or nothing.
   */
  allowTranscode?: boolean;
}

/**
 * How long a preview may take to get going before the next way to play it is tried. Some failures never raise an
 * error: WebKit stalls on HEVC the server copied into HLS for a user who may not transcode, unpaused, with all the
 * data it wants, and its clock a few microseconds past zero.
 */
export const TRAILER_START_TIMEOUT_MS = 12_000;
/** How far a preview must have played to count as under way (see TRAILER_START_TIMEOUT_MS). */
export const TRAILER_STARTED_SECONDS = 0.25;

interface Plan {
  source: MediaSourceInfo | null;
  options: TrailerOption[];
}

/**
 * Muted local-trailer preview. It starts after a delay while visible, as the file itself when the browser can play it,
 * else (where `allowTranscode`) remuxed or transcoded by the server (trailerStream.ts). Unmounting the <video> stops and
 * releases it and ends any transcode; when every way to play it fails or stalls, the backdrop stays.
 */
export function TrailerPreview({
  trailerId,
  delaySeconds,
  client,
  muted = true,
  class: className,
  onPlayingChange,
  allowTranscode = false,
}: Props) {
  const wrapper = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const visible = useVisible(wrapper);
  const [plan, setPlan] = useState<Plan | null>(null);
  /** Which of the plan's options plays; it moves on when one fails, and stays there for the next play. */
  const [attempt, setAttempt] = useState(0);
  /** New for every play, so the server's transcode for it can be found and stopped. */
  const [session, setSession] = useState('');
  const [state, setState] = useState<'waiting' | 'playing' | 'done'>('waiting');
  /** Whether this session's video has got going (played past TRAILER_STARTED_SECONDS). */
  const started = useRef(false);

  // Look the trailer's container and codecs up once it's in view (most hero slides never get that far).
  useEffect(() => {
    if (!visible || plan) return;
    let live = true;
    void getTrailerSource(client, trailerId).then((source) => {
      if (live) setPlan({ source, options: trailerOptions(source, detectBrowser(), allowTranscode) });
    });
    return () => {
      live = false;
    };
  }, [visible, plan, trailerId]);

  useEffect(() => {
    if (plan && plan.options.length === 0) setState('done');
  }, [plan]);

  useEffect(() => {
    if (state !== 'waiting' || !visible || !plan?.options.length) return;
    const timer = setTimeout(() => {
      setSession(newUuid());
      setState('playing');
    }, delaySeconds * 1000);
    return () => clearTimeout(timer);
  }, [state, visible, plan, delaySeconds]);

  const option = state === 'playing' ? plan?.options[attempt] : undefined;

  // Removing a <video> from the DOM does not necessarily stop its download; release it explicitly. A transcode is
  // stopped on the server as well, including when the page itself goes (a reload, or the tab closing). The video is
  // keyed by session, so a retry gets a fresh element.
  useEffect(() => {
    if (!option) return;
    const element = video.current;
    const transcoding = option.kind !== 'direct';
    const onPageHide = (): void => stopTrailerTranscode(client, session, true);
    if (transcoding) window.addEventListener('pagehide', onPageHide);
    started.current = false;
    let live = true;
    // Started explicitly, not by the autoplay attribute, to hear a refusal (iOS in Low Power Mode, a browser's autoplay
    // policy): no other stream would be allowed either, so the backdrop stays. Other rejections come with an error
    // event or a stall, which move on to the next stream.
    try {
      const playing = element?.play();
      if (playing)
        playing.catch((e: unknown) => {
          if (live && (e as { name?: string } | null)?.name === 'NotAllowedError') setState('done');
        });
    } catch {
      // jsdom, or a browser whose play() returns nothing
    }
    // Not under way by now, error or not (a stall, a silent decode failure): move on to the next stream.
    const watchdog = setTimeout(() => {
      if (live && !started.current) onError();
    }, TRAILER_START_TIMEOUT_MS);
    return () => {
      live = false;
      clearTimeout(watchdog);
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

  useEffect(() => {
    if (!visible && state === 'playing') setState('waiting');
  }, [visible, state]);

  useEffect(() => {
    onPlayingChange?.(state === 'playing');
  }, [state === 'playing']);

  const markStarted = (e: { currentTarget: HTMLVideoElement }): void => {
    if (e.currentTarget.currentTime >= TRAILER_STARTED_SECONDS) started.current = true;
  };

  const onError = (): void => {
    if (plan && attempt + 1 < plan.options.length) {
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
          class="lmn-hero__video"
          src={trailerUrl(client, trailerId, plan.source, option, session)}
          muted={muted}
          playsInline
          preload="none"
          onPlaying={markStarted}
          onTimeUpdate={markStarted}
          onError={onError}
          onEnded={() => setState('done')}
        />
      )}
    </div>
  );
}
