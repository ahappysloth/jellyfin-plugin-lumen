import { useEffect, useRef, useState } from 'preact/hooks';
import type { JellyfinApiClient } from '../../compat/jellyfin';
import { useVisible } from '../../components/useVisible';

interface Props {
  trailerId: string;
  delaySeconds: number;
  client: Pick<JellyfinApiClient, 'getUrl' | 'accessToken'>;
}

/**
 * Muted local-trailer preview. It starts after a delay while visible. Unmounting the <video> stops and releases it,
 * and any playback error leaves the backdrop showing.
 */
export function TrailerPreview({ trailerId, delaySeconds, client }: Props) {
  const wrapper = useRef<HTMLDivElement>(null);
  const visible = useVisible(wrapper);
  const [state, setState] = useState<'waiting' | 'playing' | 'done'>('waiting');

  useEffect(() => {
    if (state !== 'waiting' || !visible) return;
    const timer = setTimeout(() => setState('playing'), delaySeconds * 1000);
    return () => clearTimeout(timer);
  }, [state, visible, delaySeconds]);

  useEffect(() => {
    if (!visible && state === 'playing') setState('waiting');
  }, [visible, state]);

  const src = client.getUrl(`Videos/${trailerId}/stream`, {
    static: true,
    ApiKey: client.accessToken() ?? undefined,
  });
  return (
    <div ref={wrapper} class="lmn-hero__trailer" aria-hidden="true">
      {state === 'playing' && (
        <video
          class="lmn-hero__video"
          src={src}
          muted
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
