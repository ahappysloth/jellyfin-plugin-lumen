import { useEffect, useRef, useState } from 'preact/hooks';
import type { OnlineTrailer } from '../../api/types';
import { getLayout } from '../../compat/jellyfin';
import { TrailerPreview, type TrailerProps } from './TrailerPreview';
import { useTrailerLog } from './trailerLog';
import { YouTubePreview } from './YouTubePreview';

export type OnlineTrailerPreviewProps = Omit<TrailerProps, 'trailerId' | 'src' | 'srcHd'> & {
  /** The trailer online, where it's known already (the hero's slides carry theirs): IMDb's MP4 (and its 1080p one), … */
  imdbUrl?: string | null;
  imdbUrlHd?: string | null;
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
  imdbUrlHd,
  youTubeId,
  lookup,
  embedBase,
  logKey,
  ...props
}: OnlineTrailerPreviewProps) {
  // One attempt for both: IMDb's file, then YouTube's should it fail.
  const log = useTrailerLog(null, logKey);
  const [found, setFound] = useState<{ trailer: OnlineTrailer; delaySeconds: number } | null>(null);
  /** IMDb's file never got under way here (a proxy's policy, an ad blocker, IMDb refusing it): YouTube's instead. */
  const [imdbFailed, setImdbFailed] = useState(false);
  const imdbPlayed = useRef(false);
  const asked = useRef(Date.now());
  useEffect(() => {
    if (!lookup) return;
    let live = true;
    lookup().then(
      (trailer) => {
        if (!trailer.ImdbUrl && !trailer.YouTubeId) log?.add({ source: 'lookup', outcome: 'none' });
        if (live)
          setFound({
            trailer,
            delaySeconds: Math.max(0, props.delaySeconds - (Date.now() - asked.current) / 1000),
          });
      },
      (error: unknown) =>
        log?.add({
          source: 'lookup',
          outcome: 'error',
          code: (error as { status?: number } | null)?.status,
        }),
    );
    return () => {
      live = false;
    };
  }, []);
  const trailer = lookup ? found?.trailer : { ImdbUrl: imdbUrl, ImdbUrlHd: imdbUrlHd, YouTubeId: youTubeId };
  if (!trailer) return null;
  // Looked up, the wait for the answer was part of the delay; the hero's own (0 for a trailer put back) is used as is.
  const delaySeconds = lookup ? found!.delaySeconds : props.delaySeconds;
  const tv = getLayout() === 'tv';
  const fallback = !tv ? trailer.YouTubeId : null;
  if (trailer.ImdbUrl && !imdbFailed)
    return (
      <TrailerPreview
        {...props}
        src={trailer.ImdbUrl}
        srcHd={trailer.ImdbUrlHd}
        delaySeconds={delaySeconds}
        log={log}
        onPlayingChange={(on) => {
          if (on) imdbPlayed.current = true;
          props.onPlayingChange?.(on);
        }}
        onFinish={() => {
          if (!imdbPlayed.current && fallback) setImdbFailed(true);
          else props.onFinish?.();
        }}
      />
    );
  if (fallback)
    return (
      <YouTubePreview
        {...props}
        youTubeId={fallback}
        embedBase={embedBase}
        delaySeconds={delaySeconds}
        log={log}
      />
    );
  return trailer.YouTubeId ? <SkippedOnTv log={log} /> : null;
}

/** Notes, once, that YouTube's trailer wasn't tried: the TV layout never uses its player (Hero.tsx). */
function SkippedOnTv({ log }: { log: ReturnType<typeof useTrailerLog> }) {
  useEffect(() => {
    log?.add({ source: 'youtube', outcome: 'skipped', message: 'tv' });
  }, []);
  return null;
}
