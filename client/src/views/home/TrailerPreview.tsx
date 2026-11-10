import { useEffect, useRef, useState } from 'preact/hooks';
import type { MediaSourceInfo } from '../../api/types';
import type { JellyfinApiClient } from '../../compat/jellyfin';
import { useVisible } from '../../components/useVisible';
import { newUuid } from '../../util/uuid';
import {
  browserCanPlay,
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
}

interface Plan {
  source: MediaSourceInfo | null;
  options: TrailerOption[];
}

/**
 * Muted local-trailer preview. It starts after a delay while visible, as the file itself when the browser can play it
 * and transcoded when it can't (trailerStream.ts). Unmounting the <video> stops and releases it and ends any transcode;
 * when every way to play it fails, the backdrop stays.
 */
export function TrailerPreview({
  trailerId,
  delaySeconds,
  client,
  muted = true,
  class: className,
  onPlayingChange,
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

  // Look the trailer's container and codecs up once it's in view (most hero slides never get that far).
  useEffect(() => {
    if (!visible || plan) return;
    let live = true;
    void getTrailerSource(client, trailerId).then((source) => {
      if (live) setPlan({ source, options: trailerOptions(source, browserCanPlay) });
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
  // stopped on the server as well. The video is keyed by session, so a retry gets a fresh element.
  useEffect(() => {
    if (!option) return;
    const element = video.current;
    return () => {
      if (option.kind !== 'direct') stopTrailerTranscode(client, session);
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
          autoPlay
          playsInline
          preload="none"
          onError={onError}
          onEnded={() => setState('done')}
        />
      )}
    </div>
  );
}
