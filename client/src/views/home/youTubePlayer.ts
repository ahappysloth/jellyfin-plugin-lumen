/**
 * YouTube's embedded player, driven over postMessage: the protocol its own IFrame API script speaks, without loading
 * that script (a third-party file in Lumen's page, and 30 KB more than the few messages a preview needs). Checked
 * against the real embed (youtube-nocookie.com, November 2026), in Chromium and in WebKit as an iPhone:
 *
 * - The page sends `{"event":"listening","id":…,"channel":"widget"}` once the frame has loaded; the player answers
 *   with `initialDelivery` (everything it knows: playerState, currentTime, duration…) and `onReady`.
 * - From then on it sends `infoDelivery` about every 250 ms while it plays (currentTime), and at once when its state
 *   changes (playerState: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued). `duration` arrives exact at
 *   first (184.461) and rounded up later (185).
 * - `onStateChange` (info: the state) only once asked for with an `addEventListener` command; `onError` (info: 2, 5,
 *   100, 101 or 150) comes regardless. Both are read here, though the state in `infoDelivery` already says the same.
 * - Commands are `{"event":"command","func":"pauseVideo","args":[],…}`: playVideo, pauseVideo, seekTo, mute, unMute,
 *   and unloadModule (its captions).
 * - Every message is a JSON string from the embed's origin. Anything else is ignored: other frames, browser
 *   extensions and the page itself post messages to the same window.
 */
import type { TrailerClock } from './TrailerPreview';

export const YOUTUBE_EMBED_BASE = 'https://www.youtube-nocookie.com';

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
/** The server only sends ids it has checked (Home/YouTubeId.cs); checked again, as it becomes part of an address. */
export const isYouTubeId = (id: unknown): id is string => typeof id === 'string' && VIDEO_ID.test(id);

/**
 * Where the player loads from: YouTube, unless the server names another origin (LUMEN_YOUTUBE_EMBED_BASE, the E2E
 * tests' stub player). As on the server, only https, or http on this machine, and nothing but an origin.
 */
export function embedBase(override?: string | null): string {
  if (
    override &&
    (/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(override) ||
      /^http:\/\/(localhost|127\.0\.0\.1|host\.docker\.internal)(:\d+)?$/i.test(override))
  )
    return override;
  return YOUTUBE_EMBED_BASE;
}

export interface EmbedOptions {
  /** The page's origin: the player only talks to the page that says who it is. */
  origin: string;
  autoplay: boolean;
  /** Whole seconds in; 0 for the beginning. */
  start?: number;
}

/**
 * The player's address. Muted and inline so it may start by itself (also on iOS); no controls, keyboard, fullscreen or
 * annotations, and related videos from the trailer's own channel only: nothing of it is meant to be seen or used but
 * the picture.
 */
export function embedUrl(base: string, id: string, { origin, autoplay, start }: EmbedOptions): string {
  const params = [
    `autoplay=${autoplay ? 1 : 0}`,
    'mute=1',
    'controls=0',
    'playsinline=1',
    'rel=0',
    'iv_load_policy=3',
    'disablekb=1',
    'fs=0',
    'enablejsapi=1',
    `origin=${encodeURIComponent(origin)}`,
  ];
  if (start && start > 0) params.push(`start=${Math.floor(start)}`);
  return `${base}/embed/${id}?${params.join('&')}`;
}

/** What one message from the player says, as far as a preview cares. */
export interface YouTubeMessage {
  /** The player answered: commands will be heard from now on. */
  ready?: true;
  /** -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued. */
  state?: number;
  currentTime?: number;
  duration?: number;
  /** 2 or 5: can't be played; 100: removed or private; 101 or 150: its owner doesn't allow embedding. */
  error?: number;
}

const STATES = [-1, 0, 1, 2, 3, 5];
/** The real player's largest message (initialDelivery) is a few KB. */
const MAX_MESSAGE_LENGTH = 100_000;

const finite = (value: unknown): value is number => typeof value === 'number' && isFinite(value);

/**
 * Reads a message the window received; null for one that isn't the player's or says nothing a preview uses. It takes
 * nothing on trust: the caller has checked where the message came from, but what's in it is still someone else's.
 */
export function parseYouTubeMessage(data: unknown): YouTubeMessage | null {
  if (typeof data !== 'string' || data.length > MAX_MESSAGE_LENGTH || data.charAt(0) !== '{') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const { event, info } = parsed as { event?: unknown; info?: unknown };
  const message: YouTubeMessage = {};
  if (event === 'onReady') {
    message.ready = true;
  } else if (event === 'onStateChange') {
    if (!finite(info) || STATES.indexOf(info) < 0) return null;
    message.state = info;
  } else if (event === 'onError') {
    if (!finite(info)) return null;
    message.error = info;
  } else if (event === 'initialDelivery' || event === 'infoDelivery') {
    if (event === 'initialDelivery') message.ready = true;
    if (info && typeof info === 'object') {
      const { playerState, currentTime, duration } = info as Record<string, unknown>;
      if (finite(playerState) && STATES.indexOf(playerState) >= 0) message.state = playerState;
      if (finite(currentTime) && currentTime >= 0) message.currentTime = currentTime;
      if (finite(duration) && duration > 0) message.duration = duration;
    }
  } else {
    return null;
  }
  return Object.keys(message).length ? message : null;
}

const CHANNEL = { id: 'lumen', channel: 'widget' };
export const LISTENING = JSON.stringify({ event: 'listening', ...CHANNEL });
export const youTubeCommand = (func: string, args: unknown[] = []): string =>
  JSON.stringify({ event: 'command', func, args, ...CHANNEL });

/** The player's time, in the shape the hero's pager reads a <video>'s (Hero.tsx). */
export type PlayerClock = TrailerClock;

export type PlayerStatus = 'loading' | 'playing' | 'paused' | 'buffering' | 'ended' | 'error';

export interface PlayerEvents {
  /** The player answered for the first time. */
  onReady?: () => void;
  /** The player's state changed. 'error' and 'ended' are final. */
  onStatus: (status: PlayerStatus) => void;
  /** It's playing and has said where it is: about four times a second. */
  onTime: (clock: PlayerClock) => void;
}

export interface YouTubePlayer {
  readonly clock: PlayerClock;
  readonly status: PlayerStatus;
  play(): void;
  pause(): void;
  /** Goes back `seconds` (not past the start); the clock stays where it was until the player is there again. */
  rewind(seconds: number): void;
  setMuted(muted: boolean): void;
  /**
   * Takes the player's captions off: it turns them on by itself while muted, over a picture that's a backdrop here.
   * (`cc_load_policy=0` doesn't; unloading its captions module does, as checked on the real embed.)
   */
  hideCaptions(): void;
  /** Stops listening. Removing the frame is the caller's: that's what stops the video. */
  destroy(): void;
}

/** How often, and how many times, the player is told the page is listening before it answers. */
const LISTEN_EVERY_MS = 250;
const LISTEN_TRIES = 40;

const STATUS: Record<number, PlayerStatus> = { 0: 'ended', 1: 'playing', 2: 'paused', 3: 'buffering' };

/**
 * Connects to the player in `frame`, loaded from `base`. Messages count only if they come from that frame and that
 * origin. Unstarted and cued (-1, 5) stay 'loading': the player hasn't begun, whatever it was told.
 *
 * `loaded` says the frame's load event has fired already: it can, before the caller gets here (a cached player, or
 * one on this machine, loads within the frame an effect waits for), and nothing else tells.
 */
export function connectYouTubePlayer(
  frame: HTMLIFrameElement,
  base: string,
  events: PlayerEvents,
  loaded = false,
  win: Window = window,
): YouTubePlayer {
  let origin = base;
  try {
    origin = new URL(base).origin;
  } catch {
    // embedBase() only lets an origin through
  }
  let status: PlayerStatus = 'loading';
  let heard = false;
  let destroyed = false;
  let tries = 0;
  // Where the player last said it was, and when: between its messages the clock runs on by itself while it plays.
  let time = 0;
  let at = 0;
  let duration = 0;
  /** After rewind(): where the clock holds until the player has caught up. */
  let floor = 0;

  const now = (): number => win.performance.now();
  const clock: PlayerClock = {
    get currentTime() {
      const running = status === 'playing' ? time + (now() - at) / 1000 : time;
      const current = Math.max(floor, running);
      return duration > 0 ? Math.min(duration, current) : current;
    },
    get duration() {
      return duration > 0 ? duration : NaN;
    },
    get isConnected() {
      return !destroyed && frame.isConnected;
    },
  };

  const post = (message: string): void => {
    try {
      frame.contentWindow?.postMessage(message, origin);
    } catch {
      // the frame is gone
    }
  };
  const command = (func: string, args?: unknown[]): void => post(youTubeCommand(func, args));

  const setStatus = (next: PlayerStatus): void => {
    if (status === next || status === 'error' || status === 'ended') return;
    // The clock runs from when the player said it was playing.
    at = now();
    status = next;
    events.onStatus(next);
  };

  const onMessage = (e: MessageEvent): void => {
    // A frame taken out of the page is over, even before destroy(): Preact runs an unmounted component's effect
    // cleanups a frame later, and a removed frame has no window (null, as a message without a source has).
    if (destroyed || !frame.isConnected || e.origin !== origin || e.source !== frame.contentWindow) return;
    const message = parseYouTubeMessage(e.data);
    if (!message) return;
    const first = !heard;
    if (first) {
      heard = true;
      clearInterval(listening);
      // As YouTube's own script does once the player answers; errors come without asking.
      command('addEventListener', ['onStateChange']);
      command('addEventListener', ['onError']);
    }
    if (message.error !== undefined) return setStatus('error');
    // The exact length comes first and a rounded-up one later: the shortest is the one the video ends at.
    if (message.duration !== undefined && (duration === 0 || message.duration < duration))
      duration = message.duration;
    if (message.currentTime !== undefined) {
      time = message.currentTime;
      at = now();
    }
    if (message.state !== undefined) setStatus(STATUS[message.state] ?? 'loading');
    if (message.currentTime !== undefined && status === 'playing') events.onTime(clock);
    if (first) events.onReady?.();
  };

  // The player may not be listening yet when the frame's load event fires: keep saying so until it answers.
  let listening: ReturnType<typeof setInterval> | undefined;
  const listen = (): void => {
    if (heard || destroyed) return;
    clearInterval(listening);
    tries = 0;
    post(LISTENING);
    listening = setInterval(() => {
      if (++tries >= LISTEN_TRIES) clearInterval(listening);
      else post(LISTENING);
    }, LISTEN_EVERY_MS);
  };

  win.addEventListener('message', onMessage);
  frame.addEventListener('load', listen);
  if (loaded) listen();

  return {
    clock,
    get status() {
      return status;
    },
    play: () => command('playVideo'),
    pause: () => command('pauseVideo'),
    rewind(seconds) {
      const current = clock.currentTime;
      floor = current;
      command('seekTo', [Math.max(0, current - seconds), true]);
    },
    setMuted: (muted) => command(muted ? 'mute' : 'unMute'),
    hideCaptions: () => command('unloadModule', ['captions']),
    destroy() {
      destroyed = true;
      clearInterval(listening);
      win.removeEventListener('message', onMessage);
      frame.removeEventListener('load', listen);
    },
  };
}
