import type { ComponentProps } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { OnlineTrailer } from '../../api/types';

type TrailerModule = typeof import('./TrailerPreview');

let loading: Promise<TrailerModule> | null = null;
let loaded: TrailerModule | null = null;

/**
 * The trailer preview's code is a separate file, loaded the first time a preview is about to play (as the hero or the
 * details header shows a title with a trailer, which then waits a few seconds before playing anyway), so pages
 * without one, and users who turned previews off or prefer reduced motion, never download or parse it. A failed load
 * is asked for again next time, though a browser may remember the failure until the page reloads (as it will for a
 * page left open across a Lumen update, whose old trailer file is gone); either way the backdrop stays meanwhile.
 */
export function loadTrailer(): Promise<TrailerModule> {
  loading ??= import('./TrailerPreview').then(
    (module) => (loaded = module),
    (error: unknown) => {
      loading = null;
      throw error;
    },
  );
  return loading;
}

/** The trailer's code if it's in, else null: for what only ever runs once a trailer is under way (Hero's fill). */
export const trailerModule = (): TrailerModule | null => loaded;

type LocalProps = ComponentProps<TrailerModule['TrailerPreview']>;

/**
 * TrailerPreview's props. Without a local trailer (`trailerId`), the title's trailer online plays instead ("Use online
 * trailers"): IMDb's MP4 in the same <video> as a local one, else YouTube's player.
 */
export type LazyTrailerProps = Omit<LocalProps, 'trailerId' | 'src' | 'srcHd'> & {
  trailerId?: string | null;
  /** The trailer's MP4 on IMDb's video CDN: only used when there's no local trailer. */
  imdbUrl?: string | null;
  /** The same in 1080p, where IMDb has it: played instead where the box needs it. */
  imdbUrlHd?: string | null;
  /** The trailer's YouTube video id: only used when there's neither a local trailer nor IMDb's. */
  youTubeId?: string | null;
  /**
   * A details page's way to its trailer online, asked once the code is in, when none of the above is given
   * (OnlineTrailerPreview).
   */
  lookup?: (() => Promise<OnlineTrailer>) | null;
  /** ClientConfig.YouTubeEmbedBase: where the player loads from in tests. */
  embedBase?: string | null;
};

/**
 * TrailerPreview for a local trailer, or OnlineTrailerPreview (IMDb's, else YouTube's) without one, once their code is
 * in; until then, or if it can't load, nothing (the backdrop shows). The delay counts from here, not from when the code
 * arrived: the download is part of the wait, not added to it.
 */
export function LazyTrailer(props: LazyTrailerProps) {
  const [module, setModule] = useState<TrailerModule | null>(loaded);
  const mountedAt = useRef(Date.now());
  /** Seconds spent waiting for the code. */
  const [loadSeconds, setLoadSeconds] = useState(0);
  useEffect(() => {
    if (module) return;
    let live = true;
    loadTrailer().then(
      (m) => {
        if (!live) return;
        setLoadSeconds((Date.now() - mountedAt.current) / 1000);
        setModule(m);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  if (!module) return null;
  const delaySeconds = Math.max(0, props.delaySeconds - loadSeconds);
  if (props.trailerId) return <module.TrailerPreview {...props} delaySeconds={delaySeconds} />;
  return props.imdbUrl || props.youTubeId || props.lookup ? (
    <module.OnlineTrailerPreview {...props} delaySeconds={delaySeconds} />
  ) : null;
}

/** The state a details header's background trailer shares with its Pause and Mute buttons (useTrailerControls). */
export interface TrailerControlState {
  muted: boolean;
  paused: boolean;
  /** The trailer shows (TrailerPreview's onPlayingChange): the buttons are there only then. */
  playing: boolean;
  setMuted: (muted: boolean) => void;
  setPaused: (paused: boolean) => void;
  setPlaying: (playing: boolean) => void;
}

/** A details header's trailer state: muted and playing to begin with, and not yet showing. */
export function useTrailerControls(): TrailerControlState {
  const [muted, setMuted] = useState(true);
  const [paused, setPaused] = useState(false);
  const [playing, setPlaying] = useState(false);
  return { muted, paused, playing, setMuted, setPaused, setPlaying };
}

/**
 * The home banner's Mute button (TrailerControls.tsx), beside its Pause while the trailer shows: by then the trailer's
 * code is in, so the button and its names cost the startup file nothing.
 */
export function LazyMuteButton(props: { muted: boolean; onChange: (muted: boolean) => void }) {
  return loaded ? <loaded.MuteButton {...props} /> : null;
}

/**
 * Pause and Mute for a details header's trailer (TrailerControls, in the trailer's file), once it shows: by then its
 * code is in, so there's nothing to wait for.
 */
export function LazyTrailerControls({ state }: { state: TrailerControlState }) {
  return state.playing && loaded ? <loaded.TrailerControls state={state} /> : null;
}
