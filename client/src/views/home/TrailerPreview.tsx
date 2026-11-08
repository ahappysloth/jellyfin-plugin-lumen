import { useEffect, useRef, useState } from 'preact/hooks';
import type { JellyfinApiClient } from '../../compat/jellyfin';
import { useVisible } from '../../components/useVisible';

interface Props {
  trailerId: string;
  delaySeconds: number;
  client: Pick<JellyfinApiClient, 'getUrl' | 'accessToken'>;
  /** Defaults to true; the details page offers an unmute toggle. */
  muted?: boolean;
  class?: string;
  /** Called when the video starts or stops showing, so the page can reveal or hide its controls. */
  onPlayingChange?: (playing: boolean) => void;
}

/**
 * Muted local-trailer preview. It starts after a delay while visible. Unmounting the <video> stops and releases it,
 * and any playback error leaves the backdrop showing.
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
  const [state, setState] = useState<'waiting' | 'playing' | 'done'>('waiting');

  useEffect(() => {
    if (state !== 'waiting' || !visible) return;
    const timer = setTimeout(() => setState('playing'), delaySeconds * 1000);
    return () => clearTimeout(timer);
  }, [state, visible, delaySeconds]);

  // Removing a <video> from the DOM does not necessarily stop its download; release it explicitly.
  useEffect(() => {
    if (state !== 'playing') return;
    const element = video.current;
    return () => {
      if (!element) return;
      element.pause();
      element.removeAttribute('src');
      element.load();
    };
  }, [state]);

  useEffect(() => {
    if (!visible && state === 'playing') setState('waiting');
  }, [visible, state]);

  useEffect(() => {
    onPlayingChange?.(state === 'playing');
  }, [state === 'playing']);

  const src = client.getUrl(`Videos/${trailerId}/stream`, {
    static: true,
    ApiKey: client.accessToken() ?? undefined,
  });
  return (
    <div ref={wrapper} class={`lmn-hero__trailer${className ? ` ${className}` : ''}`} aria-hidden="true">
      {state === 'playing' && (
        <video
          ref={video}
          class="lmn-hero__video"
          src={src}
          muted={muted}
          autoPlay
          playsInline
          preload="none"
          onError={() => setState('done')}
          onEnded={() => setState('done')}
        />
      )}
    </div>
  );
}
