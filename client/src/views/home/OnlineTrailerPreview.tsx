import { useEffect, useRef, useState } from 'preact/hooks';
import type { OnlineTrailer } from '../../api/types';
import { getLayout } from '../../compat/jellyfin';
import { TrailerPreview, type TrailerProps } from './TrailerPreview';
import { YouTubePreview } from './YouTubePreview';

export type OnlineTrailerPreviewProps = Omit<TrailerProps, 'trailerId' | 'src'> & {
  /** The trailer online, where it's known already (the hero's slides carry theirs): IMDb's MP4, … */
  imdbUrl?: string | null;
  /** … else YouTube's video id. */
  youTubeId?: string | null;
  /** Else asks the server for it (GET …/Trailer), once, as this mounts. */
  lookup?: (() => Promise<OnlineTrailer>) | null;
  /** ClientConfig.YouTubeEmbedBase: where YouTube's player loads from in tests. */
  embedBase?: string | null;
};

/**
 * A title's trailer online ("Use online trailers"), for one without a local trailer: IMDb's MP4, played as a local
 * trailer is (TrailerPreview), else YouTube's (YouTubePreview; not on a TV: see Hero.tsx). Nothing when there's neither.
 * A details page has it look the trailer up (`lookup`): here rather than on the page, so that's part of the trailer's
 * lazy file, not the startup bundle; the time the answer takes counts towards the delay, as the file's download does
 * (lazyTrailer.tsx).
 */
export function OnlineTrailerPreview({
  imdbUrl,
  youTubeId,
  lookup,
  embedBase,
  ...props
}: OnlineTrailerPreviewProps) {
  const [found, setFound] = useState<{ trailer: OnlineTrailer; delaySeconds: number } | null>(null);
  const asked = useRef(Date.now());
  useEffect(() => {
    if (!lookup) return;
    let live = true;
    lookup().then(
      (trailer) => {
        if (live)
          setFound({
            trailer,
            delaySeconds: Math.max(0, props.delaySeconds - (Date.now() - asked.current) / 1000),
          });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  const trailer = lookup ? found?.trailer : { ImdbUrl: imdbUrl, YouTubeId: youTubeId };
  if (!trailer) return null;
  // Looked up, the wait for the answer was part of the delay; the hero's own (0 for a trailer put back) is used as is.
  const delaySeconds = lookup ? found!.delaySeconds : props.delaySeconds;
  if (trailer.ImdbUrl) return <TrailerPreview {...props} src={trailer.ImdbUrl} delaySeconds={delaySeconds} />;
  return trailer.YouTubeId && getLayout() !== 'tv' ? (
    <YouTubePreview
      {...props}
      youTubeId={trailer.YouTubeId}
      embedBase={embedBase}
      delaySeconds={delaySeconds}
    />
  ) : null;
}
