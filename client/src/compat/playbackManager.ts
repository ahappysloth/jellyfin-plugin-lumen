/**
 * jellyfin-web's playback manager, found inside its webpack bundle. It isn't exported on `window`, so Lumen asks the
 * bundle's module registry for the module whose code defines both `setMaxStreamingBitrate` and `getCurrentPlayer`, and
 * picks the export with that shape. No module ids or minified names are assumed, so a jellyfin-web update either
 * still matches or returns null, and Lumen keeps the stock player (fail open).
 * Verified against jellyfin-web 12.1–12.4 (see docs/reference).
 */

/** The subset of jellyfin-web's PlaybackManager Lumen's player uses. Times: ms for currentTime, ticks elsewhere. */
export interface PlaybackManager {
  getCurrentPlayer(): Player | null;
  getPlayerState(player: Player): PlayerState;
  currentTime(player: Player): number;
  duration(player: Player): number;
  paused(player: Player): boolean;
  playPause(player: Player): void;
  seek(ticks: number, player: Player): void;
  rewind(player: Player): void;
  fastForward(player: Player): void;
  getVolume(player: Player): number;
  setVolume(volume: number, player: Player): void;
  isMuted(player: Player): boolean;
  toggleMute(player: Player): void;
  audioTracks(player: Player): Stream[];
  getAudioStreamIndex(player: Player): number;
  setAudioStreamIndex(index: number, player: Player): void;
  subtitleTracks(player: Player): Stream[];
  getSubtitleStreamIndex(player: Player): number;
  setSubtitleStreamIndex(index: number, player: Player): void;
  getMaxStreamingBitrate(player: Player): number;
  enableAutomaticBitrateDetection(player: Player): boolean;
  setMaxStreamingBitrate(
    options: { enableAutomaticBitrateDetection: boolean; maxBitrate: number },
    player: Player,
  ): void;
  getSupportedPlaybackRates(player: Player): { name: string; id: number }[];
  getPlaybackRate(player: Player): number;
  setPlaybackRate(rate: number, player: Player): void;
  getSupportedAspectRatios(player: Player): { name: string; id: string }[];
  getAspectRatio(player: Player): string;
  setAspectRatio(id: string, player: Player): void;
  supportSubtitleOffset?(player: Player): boolean;
  getPlayerSubtitleOffset?(player: Player): number;
  setSubtitleOffset?(offset: number, player: Player): void;
  toggleFullscreen(player: Player): void;
  togglePictureInPicture?(player: Player): void;
  toggleAirPlay?(player: Player): void;
  nextTrack(player: Player): void;
  previousTrack(player: Player): void;
  getCurrentPlaylistIndex(player: Player): number;
  getPlaylist(player: Player): Promise<unknown[]>;
}

export interface Player {
  name?: string;
  id?: string;
  isLocalPlayer?: boolean;
}

export interface Stream {
  Index: number;
  DisplayTitle?: string;
  Title?: string;
  Language?: string;
  Codec?: string;
  IsExternal?: boolean;
  IsDefault?: boolean;
}

export interface PlayerState {
  PlayState?: {
    PositionTicks?: number;
    BufferedRanges?: { start: number; end: number }[];
    CanSeek?: boolean;
  };
  NowPlayingItem?: {
    Id: string;
    Name?: string;
    Type?: string;
    SeriesName?: string;
    ParentIndexNumber?: number;
    IndexNumber?: number;
    RunTimeTicks?: number;
    ProductionYear?: number;
    UserData?: { IsFavorite?: boolean };
  };
  MediaSource?: { MediaStreams?: { Type?: string; Height?: number; Width?: number }[] };
}

type WebpackRequire = ((id: string) => Record<string, unknown>) & { m?: Record<string, unknown> };
type ChunkWindow = Window & { webpackChunk?: unknown[] };

let cached: PlaybackManager | null | undefined;

function isPlaybackManager(value: unknown): value is PlaybackManager {
  const v = value as Record<string, unknown> | null;
  return (
    !!v &&
    typeof v === 'object' &&
    [
      'getCurrentPlayer',
      'setMaxStreamingBitrate',
      'getPlayerState',
      'seek',
      'playPause',
      'audioTracks',
    ].every((k) => typeof v[k] === 'function')
  );
}

/** jellyfin-web's playback manager, or null when it can't be found (then Lumen leaves the stock player alone). */
export function getPlaybackManager(win: Window = window): PlaybackManager | null {
  if (cached !== undefined) return cached;
  cached = null;
  try {
    const chunks = (win as ChunkWindow).webpackChunk;
    if (!Array.isArray(chunks)) return null;
    let require: WebpackRequire | undefined;
    // Pushing a chunk with a runtime callback is webpack's supported way for a chunk to get the module loader.
    chunks.push([[Symbol('lumen')], {}, (r: WebpackRequire) => (require = r)]);
    if (!require?.m) return null;
    for (const id of Object.keys(require.m)) {
      const source = String(require.m[id]);
      if (!source.includes('setMaxStreamingBitrate') || !source.includes('getCurrentPlayer')) continue;
      const found = Object.values(require(id) ?? {}).find(isPlaybackManager);
      if (found) return (cached = found);
    }
  } catch {
    // any surprise: stock player
  }
  return null;
}

/** For tests. */
export function resetPlaybackManagerCache(): void {
  cached = undefined;
}

export const PLAYER_HASH_PATH = '/video';
