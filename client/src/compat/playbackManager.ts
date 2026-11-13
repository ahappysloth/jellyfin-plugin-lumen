/**
 * jellyfin-web's playback manager. It isn't exported on `window`; Lumen gets it two ways:
 * 1. From jellyfin-web itself: it hands its plugins the manager, and Lumen registers one (compat/webPlugin.ts). This
 *    is jellyfin-web's supported interface, so it survives changes to how jellyfin-web is bundled.
 * 2. Failing that (the plugin wasn't loaded: config.json didn't list it, or jellyfin-web hasn't loaded its plugins
 *    yet), from its webpack bundle: Lumen asks the bundle's module registry for the module whose code defines
 *    `getCurrentPlayer` and mentions `setMaxStreamingBitrate`.
 * Either way the manager must have every method in PLAYBACK_MANAGER_METHODS.required (compat/registry.ts). No module
 * ids or minified names are assumed, so a jellyfin-web update either still matches or returns null, and Lumen keeps
 * the stock player (fail open) and reports what it couldn't find.
 * Verified against jellyfin-web 12.1–12.4 (see docs/reference).
 */
import type { BaseItem } from '../api/types';
import { PLAYBACK_MANAGER_METHODS, STOCK_ROUTES, WEBPACK_CHUNK_GLOBAL } from './registry';
import { webPluginSlot } from './webPlugin';

/** The subset of jellyfin-web's PlaybackManager Lumen's player uses. Times: ms for currentTime, ticks elsewhere. */
export interface PlaybackManager {
  getCurrentPlayer(): Player | null;
  getPlayerState(player: Player): PlayerState;
  currentTime(player: Player): number;
  duration(player: Player): number;
  paused(player: Player): boolean;
  playPause(player: Player): void;
  seek(ticks: number, player: Player): void;
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
  /**
   * Plays items in this tab's player (or the cast target the user picked). Loads the items by `ids` unless it is given
   * the `items` themselves, honours startPositionTicks and queues the following episodes when the user has
   * next-episode autoplay on.
   */
  play?(
    options: ({ ids: string[] } | { items: BaseItem[] }) & { startPositionTicks?: number; serverId?: string },
  ): Promise<unknown>;
  /** RepeatNone, RepeatOne or RepeatAll. */
  getRepeatMode?(player: Player): RepeatMode;
  setRepeatMode?(mode: RepeatMode, player: Player): void;
  /** Where playback could go: this browser, cast devices, other Jellyfin apps that take remote control. */
  getTargets?(): Promise<PlayTarget[]>;
  /** Stops playback (the player page closes itself). */
  stop?(player: Player): void;
  /** Makes a target the active player once it pairs (fires 'playerchange'); doesn't move what's playing. */
  trySetActivePlayer?(playerName: string, target: PlayTarget): void;
}

export type RepeatMode = 'RepeatNone' | 'RepeatOne' | 'RepeatAll';

/** A place to play (jellyfin-web's player targets). */
export interface PlayTarget {
  id: string;
  name: string;
  playerName: string;
  appName?: string;
  deviceType?: string;
  isLocalPlayer?: boolean;
}

export interface Player {
  name?: string;
  id?: string;
  isLocalPlayer?: boolean;
  /** Its position in ms, as of its media element's last `timeupdate` (jellyfin-web's HTML players); no stream offset. */
  currentTime?(): number;
}

/** A media source's stream, as Playback info shows it. */
export interface MediaStreamInfo {
  Type?: string;
  Codec?: string;
  Height?: number;
  Width?: number;
  BitRate?: number;
  Channels?: number;
  VideoRangeType?: string;
  Language?: string;
  Index?: number;
  AverageFrameRate?: number;
  RealFrameRate?: number;
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
    /** DirectPlay, DirectStream or Transcode. */
    PlayMethod?: string;
    PositionTicks?: number;
    BufferedRanges?: { start: number; end: number }[];
    CanSeek?: boolean;
  };
  NowPlayingItem?: {
    Id: string;
    Name?: string;
    Type?: string;
    SeriesName?: string;
    /** An episode's series: where the next-episode card looks for the episode after it. */
    SeriesId?: string;
    ParentIndexNumber?: number;
    IndexNumber?: number;
    RunTimeTicks?: number;
    ProductionYear?: number;
    UserData?: { IsFavorite?: boolean };
    /** The series (for an episode) or item with a backdrop, for the loading screen. */
    ParentBackdropItemId?: string;
    BackdropImageTags?: string[];
    ParentBackdropImageTags?: string[];
  };
  MediaSource?: {
    Id?: string;
    Container?: string;
    Bitrate?: number;
    MediaStreams?: MediaStreamInfo[];
    /** Whether the server has media segments for it (registry.ts MEDIA_SEGMENTS.hasSegments). */
    HasSegments?: boolean;
  };
}

type WebpackModule = { exports?: unknown };
export type WebpackRequire = ((id: string) => unknown) & {
  /** Module factories, by id. */
  m?: Record<string, unknown>;
  /** The module cache: only present when the build exposes it (jellyfin-web 12.1–12.4 production builds don't). */
  c?: Record<string, WebpackModule>;
};

/** What a search for the playback manager found; `failed` names what was missing, for Lumen's diagnostics. */
export interface PlaybackManagerLookup {
  manager: PlaybackManager | null;
  failed: string[];
}

let cached: PlaybackManager | null = null;

/** Required methods the value lacks (all of them when it isn't an object). */
function missingMethods(value: unknown): string[] {
  const v = value as Record<string, unknown> | null;
  if (!v || typeof v !== 'object') return [...PLAYBACK_MANAGER_METHODS.required];
  return PLAYBACK_MANAGER_METHODS.required.filter((k) => typeof v[k] !== 'function');
}

/**
 * True when the module's code defines (not just calls) getCurrentPlayer and mentions setMaxStreamingBitrate: Babel's
 * `key:"getCurrentPlayer"`, a class method `getCurrentPlayer(){` or an assignment `getCurrentPlayer=function`.
 */
const DEFINES_GET_CURRENT_PLAYER =
  /["']getCurrentPlayer["']|getCurrentPlayer\s*\(\s*\)\s*\{|getCurrentPlayer\s*=\s*(?:function|\()/;
function looksLikePlaybackManagerModule(source: string): boolean {
  return source.includes('setMaxStreamingBitrate') && DEFINES_GET_CURRENT_PLAYER.test(source);
}

const loaders = new WeakMap<Window, WebpackRequire>();

/** The loader behind one chunk array, via a chunk with a runtime callback (webpack's supported way to get it). */
function loaderOf(chunks: unknown[]): WebpackRequire | null {
  let require: WebpackRequire | null = null;
  chunks.push([[Symbol('lumen')], {}, (r: WebpackRequire) => (require = r)]);
  return require;
}

/**
 * jellyfin-web's webpack module loader. Its chunk array is `window.webpackChunk` (WEBPACK_CHUNK_GLOBAL) because its
 * build has no `uniqueName`; should it ever get one, the array becomes `webpackChunk<name>`. So: the exact name when
 * it's there, else every window key that starts with it and holds an array, and of those, the loader with the most
 * modules (another script on the page, a Jellyfin plugin's say, can bring a webpack bundle of its own; jellyfin-web's
 * has thousands of modules). Remembered per window once found: each push leaves an entry in the chunk array.
 */
export function webpackRequire(win: Window): WebpackRequire | null {
  const known = loaders.get(win);
  if (known) return known;
  const globals = win as unknown as Record<string, unknown>;
  const isChunks = (value: unknown): value is unknown[] =>
    Array.isArray(value) && typeof value.push === 'function';
  const exact = globals[WEBPACK_CHUNK_GLOBAL];
  const arrays = isChunks(exact)
    ? [exact]
    : Object.keys(globals)
        .filter((key) => key.startsWith(WEBPACK_CHUNK_GLOBAL))
        .map((key) => globals[key])
        .filter(isChunks);
  let best: WebpackRequire | null = null;
  let most = -1;
  for (const chunks of arrays) {
    const require = loaderOf(chunks);
    const count = require ? Object.keys(require.m ?? {}).length : -1;
    if (require && count > most) {
      best = require;
      most = count;
    }
  }
  if (best) loaders.set(win, best);
  return best;
}

/**
 * Finds jellyfin-web's playback manager and checks it has every method Lumen's player calls: the one jellyfin-web gave
 * Lumen's plugin first, else the one in its webpack bundle. A miss isn't cached, so a later call (the next time the
 * player opens) looks again. The slot's `via` records which way it was found.
 *
 * The plugin is asked first even when the bundle's manager is cached: a page opened straight onto the player can
 * look before jellyfin-web has loaded its plugins, and the plugin's answer should win from then on.
 */
export function findPlaybackManager(win: Window = window): PlaybackManagerLookup {
  const slot = webPluginSlot(win);
  let pluginFailed: string[] | null = null;
  const fromPlugin = slot?.deps?.playbackManager;
  if (fromPlugin !== undefined) {
    const missing = missingMethods(fromPlugin);
    if (missing.length === 0) {
      slot!.via = 'plugin';
      return { manager: (cached = fromPlugin as PlaybackManager), failed: [] };
    }
    if (missing.length < PLAYBACK_MANAGER_METHODS.required.length)
      pluginFailed = missing.map((m) => `playbackManager.${m}`);
  }
  if (cached) return { manager: cached, failed: [] };
  const found = findInWebpack(win);
  if (found.manager) {
    if (slot) slot.via = 'webpack';
    cached = found.manager;
    return found;
  }
  // jellyfin-web's own manager with some methods renamed says more than the bundle search does.
  return pluginFailed ? { manager: null, failed: pluginFailed } : found;
}

/**
 * The playback manager in jellyfin-web's webpack bundle.
 *
 * Only modules that have already run are read, so Lumen never runs jellyfin-web code out of order:
 * - When the build exposes webpack's module cache (`require.c`), only cached modules' exports are looked at.
 * - Otherwise (jellyfin-web's production builds) the cache is private, so `require(id)` is called only for the single
 *   module whose code defines the manager. jellyfin-web imports that module at startup, before it renders, so by the
 *   time a video plays it has run and `require` returns its cached exports. If more than one module matches, none is
 *   required.
 */
function findInWebpack(win: Window): PlaybackManagerLookup {
  try {
    const require = webpackRequire(win);
    if (!require?.m) return { manager: null, failed: ['playbackManager:webpack'] };
    const candidates = Object.keys(require.m).filter((id) =>
      looksLikePlaybackManagerModule(String(require.m![id])),
    );
    if (candidates.length === 0) return { manager: null, failed: ['playbackManager:module'] };

    let exports: unknown[];
    if (require.c) {
      exports = [];
      for (const id of candidates) {
        const cachedModule = require.c[id];
        if (cachedModule?.exports) exports.push(cachedModule.exports);
      }
      if (exports.length === 0) return { manager: null, failed: ['playbackManager:notLoaded'] };
    } else {
      if (candidates.length > 1) return { manager: null, failed: ['playbackManager:ambiguous'] };
      exports = [require(candidates[0]!)];
    }

    let closest: string[] | null = null;
    for (const moduleExports of exports) {
      for (const value of Object.values((moduleExports ?? {}) as Record<string, unknown>)) {
        const missing = missingMethods(value);
        if (missing.length === 0) return { manager: value as PlaybackManager, failed: [] };
        // An export that has some of the methods is the manager with something renamed: report what's missing.
        if (
          missing.length < PLAYBACK_MANAGER_METHODS.required.length &&
          (!closest || missing.length < closest.length)
        )
          closest = missing;
      }
    }
    return {
      manager: null,
      failed: closest ? closest.map((m) => `playbackManager.${m}`) : ['playbackManager:export'],
    };
  } catch {
    return { manager: null, failed: ['playbackManager:error'] };
  }
}

/** jellyfin-web's playback manager, or null when it can't be found (then Lumen leaves the stock player alone). */
export function getPlaybackManager(win: Window = window): PlaybackManager | null {
  return findPlaybackManager(win).manager;
}

/** For tests. */
export function resetPlaybackManagerCache(): void {
  cached = null;
}

export const PLAYER_HASH_PATH = STOCK_ROUTES.video;
