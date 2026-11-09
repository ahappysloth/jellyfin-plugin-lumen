import type { PlaybackManager, Player, PlayerState, Stream } from '../../compat/playbackManager';

/** Everything the controls show, read from jellyfin-web's playback manager in one pass. */
export interface PlayerSnapshot {
  player: Player;
  item: PlayerState['NowPlayingItem'];
  /** The playing media source (for trickplay). */
  mediaSourceId: string | undefined;
  positionMs: number;
  durationMs: number;
  /** End of the buffered range that contains the playhead. */
  bufferedMs: number;
  paused: boolean;
  canSeek: boolean;
  volume: number;
  muted: boolean;
  audioTracks: Stream[];
  audioIndex: number;
  subtitleTracks: Stream[];
  subtitleIndex: number;
  autoQuality: boolean;
  maxBitrate: number;
  /** The playing video's height, for the quality label (e.g. "1080p"). */
  videoHeight: number | null;
  rates: number[];
  rate: number;
  aspectRatios: { name: string; id: string }[];
  aspectRatio: string;
  subtitleOffset: number | null;
  /** Position in jellyfin-web's play queue (episodes queued by "play"), -1 if unknown. */
  playlistIndex: number;
}

const TICKS_PER_MS = 10_000;

function attempt<T>(fn: () => T, fallback: T): T {
  try {
    return fn() ?? fallback;
  } catch {
    return fallback;
  }
}

export function readPlayerState(pm: PlaybackManager, player: Player): PlayerSnapshot {
  const state = attempt(() => pm.getPlayerState(player), {} as PlayerState);
  const positionMs = attempt(() => pm.currentTime(player), 0);
  const durationMs = attempt(() => pm.duration(player), 0) / TICKS_PER_MS;
  const ranges = state.PlayState?.BufferedRanges ?? [];
  const positionTicks = positionMs * TICKS_PER_MS;
  const buffered = ranges.find((r) => r.start <= positionTicks + 1 && r.end >= positionTicks);
  const video = state.MediaSource?.MediaStreams?.find((s) => s.Type === 'Video');
  const playlistIndex = attempt(() => pm.getCurrentPlaylistIndex(player), -1);
  return {
    player,
    item: state.NowPlayingItem,
    mediaSourceId: state.MediaSource?.Id,
    positionMs,
    durationMs,
    bufferedMs: buffered ? buffered.end / TICKS_PER_MS : positionMs,
    paused: attempt(() => pm.paused(player), false),
    canSeek: state.PlayState?.CanSeek !== false && durationMs > 0,
    volume: attempt(() => pm.getVolume(player), 100),
    muted: attempt(() => pm.isMuted(player), false),
    audioTracks: attempt(() => pm.audioTracks(player), []),
    audioIndex: attempt(() => pm.getAudioStreamIndex(player), -1),
    subtitleTracks: attempt(() => pm.subtitleTracks(player), []),
    subtitleIndex: attempt(() => pm.getSubtitleStreamIndex(player), -1),
    autoQuality: attempt(() => pm.enableAutomaticBitrateDetection(player), true),
    maxBitrate: attempt(() => pm.getMaxStreamingBitrate(player), 0),
    videoHeight: video?.Height ?? null,
    rates: attempt(() => pm.getSupportedPlaybackRates(player).map((r) => r.id), [] as number[]),
    rate: attempt(() => pm.getPlaybackRate(player), 1),
    aspectRatios: attempt(() => pm.getSupportedAspectRatios(player), []),
    aspectRatio: attempt(() => pm.getAspectRatio(player), 'auto'),
    subtitleOffset: attempt(
      () => (pm.supportSubtitleOffset?.(player) ? (pm.getPlayerSubtitleOffset?.(player) ?? 0) : null),
      null,
    ),
    playlistIndex,
  };
}
