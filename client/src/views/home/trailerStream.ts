/**
 * How a trailer preview gets a stream this browser can play. The raw file is the cheapest, but Safari can't open
 * Matroska and only some browsers decode HEVC or AV1, so each trailer's container and codecs are checked first.
 *
 * What the browser can't play goes through the server: remuxed when only the container or audio is the problem
 * (H.264 the browser plays is copied as it is, which costs next to nothing), else transcoded to H.264/AAC capped for a
 * preview, which only the details page asks for. It comes as HLS on Apple WebKit (Safari, and every iOS browser),
 * which plays HLS itself and can't play Jellyfin's progressive stream (served without byte ranges), and as a
 * progressive MP4 everywhere else (Chrome, Edge, Firefox, TVs). Neither needs hls.js.
 */
import { LumenApi } from '../../api/lumenApi';
import type { MediaSourceInfo, MediaStream } from '../../api/types';
import type { JellyfinApiClient } from '../../compat/jellyfin';
import { registerSessionCache } from '../../util/sessionCaches';

/** Whether this browser can play a MIME type, optionally with an RFC 6381 `codecs` parameter. */
export type CanPlay = (type: string) => boolean;

let probe: HTMLVideoElement | undefined;
/**
 * The <video> element's own answer. MediaSource.isTypeSupported answers for MSE players instead, and the preview plays
 * from `src`, where Safari, for one, decodes more than MSE does.
 */
export const browserCanPlay: CanPlay = (type) => {
  probe ??= document.createElement('video');
  return probe.canPlayType(type).replace('no', '') !== '';
};

/** What the preview needs to know about the browser it runs in. */
export interface Browser {
  canPlay: CanPlay;
  /** Safari, any iOS or iPadOS browser or web view (all WebKit), and nothing else: see isAppleWebKit. */
  appleWebKit: boolean;
  firefox: boolean;
  /** The user asked to save data (navigator.connection.saveData): no remuxes or transcodes, only the file. */
  saveData: boolean;
}

const HLS = 'application/vnd.apple.mpegurl';

/**
 * Apple's WebKit, from the user agent. Every browser built on another engine says so in it: Chrome, Edge, Opera and
 * Android web views say "Chrome/" (or "Chromium/"), Firefox says "Gecko/" without "AppleWebKit", and the TV engines
 * that pose as Safari say "Tizen", "Web0S" or "SMART-TV". On iOS and iPadOS every browser is Apple's WebKit, whatever
 * it calls itself (CriOS, FxiOS, EdgiOS), and so is an iPad asking for desktop sites ("Macintosh … Safari"). Feature
 * tests don't separate these: Chrome answers "maybe" for HLS too, and Safari on macOS has MediaSource. Linux's
 * WebKitGTK also matches, which is why detectBrowser also asks for native HLS.
 */
export function isAppleWebKit(userAgent: string): boolean {
  return (
    /AppleWebKit\//.test(userAgent) &&
    !/Chrome\/|Chromium\/|Android|Tizen|Web0S|webOS|SMART-TV|PlayStation|Nintendo/i.test(userAgent)
  );
}

export function detectBrowser(win: Window = window): Browser {
  const nav = win.navigator as Navigator & { connection?: { saveData?: boolean } };
  const userAgent = nav.userAgent;
  return {
    canPlay: browserCanPlay,
    appleWebKit: isAppleWebKit(userAgent) && browserCanPlay(HLS),
    // jellyfin-web's testCanPlayMkv names Firefox by the same token.
    firefox: /Firefox\//.test(userAgent),
    saveData: !!(nav.connection && nav.connection.saveData),
  };
}

/** One way to play a trailer: the file as it is, or transcoded and delivered as HLS or a progressive MP4. */
export type TrailerOption = { kind: 'direct' } | { kind: 'hls' | 'mp4'; copyVideo: boolean };

/**
 * Caps for a transcoded preview. It plays behind the title and a scrim, usually muted, so 720p is plenty, and the cap
 * keeps the server's work small. A preview that only needs remuxing (H.264 the browser plays, in a container it
 * doesn't) keeps its video as it is, which costs the server next to nothing.
 */
export const PREVIEW_MAX_WIDTH = 1280;
export const PREVIEW_MAX_HEIGHT = 720;
export const PREVIEW_VIDEO_BITRATE = 3_000_000;

/** Jellyfin's container names (ffprobe's, normalized) to the MIME types browsers know them by. */
const CONTAINER_TYPES: Record<string, string[]> = {
  mp4: ['video/mp4'],
  m4v: ['video/mp4'],
  mov: ['video/mp4'],
  mkv: ['video/x-matroska', 'video/matroska'],
  webm: ['video/webm'],
  ogg: ['video/ogg'],
  ogv: ['video/ogg'],
  ts: ['video/mp2t'],
  m2ts: ['video/mp2t'],
};

/** ffprobe's H.264 profile names to profile_idc and constraint flags. */
const AVC_PROFILES: Record<string, string> = {
  baseline: '4200',
  'constrained baseline': '42E0',
  main: '4D40',
  extended: '5800',
  high: '6400',
  'high 10': '6E00',
  'high 4:2:2': '7A00',
  'high 4:4:4 predictive': 'F400',
};

/** Cover art travels as a video stream too. */
const IMAGE_CODECS = new Set(['mjpeg', 'png', 'bmp', 'gif', 'webp']);

const pad2 = (n: number | string): string => String(n).padStart(2, '0');

/** The video's codec string, or null where this browser can't decode it whatever it says. */
function videoCodecFor(stream: MediaStream, browser: Browser): string | null {
  const codec = videoCodecString(stream);
  // Apple WebKit may claim High 10 (avc1.6E…), but it decodes 8-bit H.264 only.
  const tenBitAvc =
    stream.Codec?.toLowerCase() === 'h264' && (/^avc1\.6E/.test(codec ?? '') || (stream.BitDepth ?? 8) > 8);
  return browser.appleWebKit && tenBitAvc ? null : codec;
}

/** RFC 6381 codec string for a video stream, or null for a codec no browser plays (MPEG-4 Part 2, VC-1, …). */
export function videoCodecString(stream: MediaStream): string | null {
  const profile = (stream.Profile ?? '').toLowerCase();
  const level = stream.Level && stream.Level > 0 ? stream.Level : undefined;
  const depth = stream.BitDepth ?? 8;
  // Dolby Vision without an HDR10 or SDR base layer needs a Dolby Vision decoder to show the right colours.
  if (stream.VideoRangeType === 'DOVI' || stream.VideoRangeType === 'DOVIInvalid') return null;
  switch (stream.Codec?.toLowerCase()) {
    case 'h264':
      return `avc1.${AVC_PROFILES[profile] ?? '6400'}${pad2((level ?? 40).toString(16)).toUpperCase()}`;
    case 'hevc': {
      // Safari plays HEVC in MP4 only when tagged hvc1; Matroska carries no tag, and hvc1 is the one to ask about.
      const tag = stream.CodecTag?.toLowerCase() === 'hev1' ? 'hev1' : 'hvc1';
      const main10 = profile === 'main 10' || depth > 8;
      return `${tag}.${main10 ? '2.4' : '1.6'}.L${level ?? 120}.B0`;
    }
    case 'av1': {
      const p = profile === 'high' ? 1 : profile === 'professional' ? 2 : 0;
      return `av01.${p}.${pad2(level ?? 8)}M.${pad2(depth)}`;
    }
    case 'vp9':
      // ffprobe rarely knows a VP9 level (it reports -99); 4.0 covers 1080p.
      return `vp09.${pad2(/profile (\d)/.exec(profile)?.[1] ?? 0)}.${pad2(level ?? 40)}.${pad2(depth)}`;
    case 'vp8':
    case 'theora':
      return stream.Codec.toLowerCase();
    default:
      return null;
  }
}

/** RFC 6381 codec string for an audio stream, or null for one browsers don't decode (DTS, TrueHD, PCM). */
export function audioCodecString(stream: MediaStream): string | null {
  switch (stream.Codec?.toLowerCase()) {
    case 'aac': {
      const profile = (stream.Profile ?? '').toLowerCase();
      return profile === 'he-aacv2' ? 'mp4a.40.29' : profile === 'he-aac' ? 'mp4a.40.5' : 'mp4a.40.2';
    }
    case 'mp3':
      return 'mp4a.6B';
    case 'ac3':
      return 'ac-3';
    case 'eac3':
      return 'ec-3';
    case 'opus':
    case 'vorbis':
    case 'flac':
    case 'alac':
      return stream.Codec.toLowerCase();
    default:
      return null;
  }
}

function pickStreams(source: MediaSourceInfo): { video?: MediaStream; audio?: MediaStream } {
  const streams = source.MediaStreams ?? [];
  const video = streams.find((s) => s.Type === 'Video' && !IMAGE_CODECS.has(s.Codec?.toLowerCase() ?? ''));
  const audios = streams.filter((s) => s.Type === 'Audio');
  const audio = audios.find((s) => s.Index === source.DefaultAudioStreamIndex) ?? audios[0];
  return { video, audio };
}

/** Whether the browser can play this file as it is: its container, its video and its (default) audio. */
export function canDirectPlay(source: MediaSourceInfo, browser: Browser): boolean {
  const { video, audio } = pickStreams(source);
  if (!video) return false;
  const codecs = [videoCodecFor(video, browser), audio ? audioCodecString(audio) : ''];
  if (codecs.includes(null)) return false;
  const list = codecs.filter(Boolean).join(', ');
  for (const name of (source.Container ?? '').toLowerCase().split(',')) {
    // Like jellyfin-web 12.4 (testCanPlayMkv): Firefox would load a whole Matroska file before playing it
    // (jellyfin/jellyfin#15521). A remux to MP4 costs the server next to nothing.
    if (browser.firefox && name.trim() === 'mkv') continue;
    const types = CONTAINER_TYPES[name.trim()] ?? [];
    if (types.some((type) => browser.canPlay(`${type}; codecs="${list}"`))) return true;
  }
  return false;
}

/** How a transcode or remux reaches this browser: HLS on Apple WebKit only, a progressive MP4 elsewhere. */
function serverDelivery(browser: Browser): 'hls' | 'mp4' | null {
  // Apple WebKit can't play Jellyfin's progressive stream at all; offering it would only start an ffmpeg for nothing.
  if (browser.appleWebKit) return 'hls';
  if (browser.canPlay('video/mp4; codecs="avc1.64001F, mp4a.40.2"')) return 'mp4';
  // A TV engine with HLS of its own but no MP4 answer.
  return browser.canPlay(HLS) ? 'hls' : null;
}

/**
 * The ways to play a trailer, in the order to try them; the preview moves to the next when one fails. A file the
 * browser can play goes first, then (unless the user saves data) the server's copy of it: a remux when the video is
 * H.264 this browser plays, else a full transcode, only when `transcode` allows it (the details page; a hero slide
 * shows a preview for a few seconds, not worth an encode) and the user may transcode (the server reports
 * SupportsTranscoding false otherwise, and would copy the video anyway). With no stream details (the fetch failed),
 * the file is tried as it is, as before. An empty list means no preview.
 */
export function trailerOptions(
  source: MediaSourceInfo | null,
  browser: Browser,
  transcode: boolean,
): TrailerOption[] {
  const options: TrailerOption[] = [];
  if (!source?.MediaStreams?.length || canDirectPlay(source, browser)) options.push({ kind: 'direct' });
  if (browser.saveData) return options;
  const video = source ? pickStreams(source).video : undefined;
  const avc = video && video.Codec?.toLowerCase() === 'h264' ? videoCodecFor(video, browser) : null;
  const copyVideo = !!avc && browser.canPlay(`video/mp4; codecs="${avc}"`);
  if (!copyVideo && (!transcode || source?.SupportsTranscoding === false)) return options;
  const kind = serverDelivery(browser);
  if (kind) options.push({ kind, copyVideo });
  return options;
}

/** ApiClient.deviceId() is URL-encoded; the server stores and matches the decoded form. */
function deviceId(client: Pick<JellyfinApiClient, 'deviceId'>): string {
  const raw = client.deviceId();
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * The stream URL for one option. A <video> can't send headers, so the access token goes in the URL, as for stock
 * Jellyfin media; the server repeats an HLS playlist's query on the playlists and segments it lists.
 */
export function trailerUrl(
  client: Pick<JellyfinApiClient, 'getUrl' | 'accessToken' | 'deviceId'>,
  trailerId: string,
  source: MediaSourceInfo | null,
  option: TrailerOption,
  playSessionId: string,
): string {
  const ApiKey = client.accessToken() ?? undefined;
  if (option.kind === 'direct') return client.getUrl(`Videos/${trailerId}/stream`, { static: true, ApiKey });
  const video = source && pickStreams(source).video;
  const limits = option.copyVideo
    ? // A bitrate the source exceeds would stop the server copying it; without one it copies whatever it is.
      { VideoBitRate: video?.BitRate }
    : { MaxWidth: PREVIEW_MAX_WIDTH, MaxHeight: PREVIEW_MAX_HEIGHT, VideoBitRate: PREVIEW_VIDEO_BITRATE };
  const hls = option.kind === 'hls';
  return client.getUrl(hls ? `Videos/${trailerId}/master.m3u8` : `Videos/${trailerId}/stream.mp4`, {
    MediaSourceId: source?.Id ?? trailerId,
    DeviceId: deviceId(client),
    PlaySessionId: playSessionId,
    VideoCodec: 'h264',
    AudioCodec: 'aac',
    MaxAudioChannels: 2,
    ...limits,
    SegmentContainer: hls ? 'ts' : undefined,
    ApiKey,
  });
}

/**
 * Ends a transcode now; the server would otherwise run it on for 10 s (progressive) or 60 s (HLS) after the last
 * request. When the page is going away (`pageHiding`: a reload, or the tab closing) an ordinary request would be
 * cancelled with it, so a keepalive fetch goes instead, authorized by header like Lumen's other fetches.
 */
export function stopTrailerTranscode(
  client: JellyfinApiClient,
  playSessionId: string,
  pageHiding = false,
): void {
  // With no session the server would stop every transcode of this device, a film playing in another tab included.
  if (!playSessionId) return;
  if (!pageHiding) {
    new LumenApi(client).stopTranscoding(deviceId(client), playSessionId).catch(() => undefined);
    return;
  }
  if (typeof fetch !== 'function') return;
  const url = client.getUrl('Videos/ActiveEncodings', { deviceId: deviceId(client), playSessionId });
  fetch(url, {
    method: 'DELETE',
    keepalive: true,
    headers: { Authorization: `MediaBrowser Token="${client.accessToken() ?? ''}"` },
  }).catch(() => undefined);
}

/** Each trailer's first media source, fetched once per session. */
const sources = new Map<string, Promise<MediaSourceInfo | null>>();
registerSessionCache(() => sources.clear());

/** The trailer's first media source (the one a static stream serves), or null when it couldn't be fetched. */
export function getTrailerSource(
  client: JellyfinApiClient,
  trailerId: string,
): Promise<MediaSourceInfo | null> {
  let source = sources.get(trailerId);
  if (!source) {
    source = new LumenApi(client).getItem(trailerId).then(
      (item) => item.MediaSources?.[0] ?? null,
      () => {
        sources.delete(trailerId); // ask again next time
        return null;
      },
    );
    sources.set(trailerId, source);
  }
  return source;
}
