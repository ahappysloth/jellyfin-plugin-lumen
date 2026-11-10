import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MediaSourceInfo, MediaStream } from '../../api/types';
import { createFakeClient } from '../../../test/fakeClient';
import {
  audioCodecString,
  canDirectPlay,
  detectBrowser,
  isAppleWebKit,
  stopTrailerTranscode,
  trailerOptions,
  trailerUrl,
  videoCodecString,
  type Browser,
} from './trailerStream';

/** A browser whose canPlayType says yes to any type matching one of the patterns. */
const browser = (flags: Partial<Browser>, ...supported: RegExp[]): Browser => ({
  canPlay: (type) => supported.some((pattern) => pattern.test(type)),
  appleWebKit: false,
  firefox: false,
  saveData: false,
  ...flags,
});

// Roughly what each browser says to the questions the preview asks (any level). Safari claims High 10 too.
const safari = browser(
  { appleWebKit: true },
  /^video\/mp4; codecs="(avc1\.(42|4D|64|6E)|hvc1\.)[^,]*(, mp4a\.40\.\d+)?"$/,
  /^application\/vnd\.apple\.mpegurl$/,
);
// Chrome answers "maybe" for HLS, and plays HEVC where the hardware decodes it.
const chrome = browser(
  {},
  /^video\/mp4; codecs="(avc1\.(42|4D|64)|hvc1\.|av01\.)[^,]*(, (mp4a\.40\.\d+|opus))?"$/,
  /^video\/webm; codecs="(vp09|vp8|av01)[^,]*(, (opus|vorbis))?"$/,
  /^application\/vnd\.apple\.mpegurl$/,
);
// Firefox 145 plays Matroska, but jellyfin-web (and Lumen) don't use it there.
const firefox = browser(
  { firefox: true },
  /^video\/(mp4|x-matroska); codecs="(avc1\.(42|4D|64)|av01\.)[^,]*(, (mp4a\.40\.\d+|opus))?"$/,
  /^video\/webm; codecs="(vp09|vp8|av01)[^,]*(, (opus|vorbis))?"$/,
);
const nothing = browser({});

const h264: MediaStream = { Type: 'Video', Index: 0, Codec: 'h264', Profile: 'High', Level: 41, BitDepth: 8 };
const hevc10: MediaStream = {
  Type: 'Video',
  Index: 0,
  Codec: 'hevc',
  Profile: 'Main 10',
  Level: 150,
  BitDepth: 10,
};
const av1: MediaStream = { Type: 'Video', Index: 0, Codec: 'av1', Profile: 'Main', Level: 8, BitDepth: 10 };
const aac: MediaStream = { Type: 'Audio', Index: 1, Codec: 'aac', Profile: 'LC', Channels: 2 };
const dts: MediaStream = { Type: 'Audio', Index: 1, Codec: 'dts', Channels: 6 };
const MP4 = 'mov,mp4,m4a,3gp,3g2,mj2';

const source = (container: string, ...streams: MediaStream[]): MediaSourceInfo => ({
  Id: 'ms1',
  Container: container,
  MediaStreams: streams,
});

describe('videoCodecString', () => {
  it.each<[string, MediaStream, string | null]>([
    ['H.264 High 4.1', h264, 'avc1.640029'],
    ['H.264 Main 3.1', { Codec: 'h264', Profile: 'Main', Level: 31 }, 'avc1.4D401F'],
    [
      'H.264 Constrained Baseline',
      { Codec: 'h264', Profile: 'Constrained Baseline', Level: 30 },
      'avc1.42E01E',
    ],
    ['HEVC Main 10 in MKV (no tag)', hevc10, 'hvc1.2.4.L150.B0'],
    [
      'HEVC Main tagged hev1',
      { Codec: 'hevc', Profile: 'Main', Level: 123, CodecTag: 'hev1' },
      'hev1.1.6.L123.B0',
    ],
    ['AV1 Main 10-bit', av1, 'av01.0.08M.10'],
    ['VP9 with no level', { Codec: 'vp9', Profile: 'Profile 0', Level: -99, BitDepth: 8 }, 'vp09.00.40.08'],
    ['VP8', { Codec: 'vp8' }, 'vp8'],
    ['MPEG-4 Part 2', { Codec: 'mpeg4' }, null],
    ['Dolby Vision without a base layer', { ...hevc10, VideoRangeType: 'DOVI' }, null],
  ])('%s', (_, stream, expected) => {
    expect(videoCodecString(stream)).toBe(expected);
  });
});

describe('audioCodecString', () => {
  it.each<[string, MediaStream, string | null]>([
    ['AAC LC', aac, 'mp4a.40.2'],
    ['HE-AAC', { Codec: 'aac', Profile: 'HE-AAC' }, 'mp4a.40.5'],
    ['E-AC-3', { Codec: 'eac3' }, 'ec-3'],
    ['Opus', { Codec: 'opus' }, 'opus'],
    ['DTS', dts, null],
    ['TrueHD', { Codec: 'truehd' }, null],
  ])('%s', (_, stream, expected) => {
    expect(audioCodecString(stream)).toBe(expected);
  });
});

describe('canDirectPlay', () => {
  it('asks the browser about the container with both codecs', () => {
    const exact = browser({}, /^video\/mp4; codecs="avc1\.640029, mp4a\.40\.2"$/);
    expect(canDirectPlay(source(MP4, h264, aac), exact)).toBe(true);
  });

  it('is false for Matroska where only MP4 plays (Safari)', () => {
    expect(canDirectPlay(source('mkv', h264, aac), safari)).toBe(false);
  });

  it('is false for Matroska on Firefox even though it says it plays it, like jellyfin-web', () => {
    expect(canDirectPlay(source('mkv', h264, aac), firefox)).toBe(false);
    expect(canDirectPlay(source('mkv', h264, aac), { ...firefox, firefox: false })).toBe(true);
  });

  it('is false for HEVC where it is not decoded (Firefox), true where it is (Safari)', () => {
    expect(canDirectPlay(source(MP4, hevc10, aac), firefox)).toBe(false);
    expect(canDirectPlay(source(MP4, hevc10, aac), safari)).toBe(true);
  });

  it('is false for AV1 where it is not decoded (Safari), true where it is (Firefox)', () => {
    expect(canDirectPlay(source(MP4, av1, aac), safari)).toBe(false);
    expect(canDirectPlay(source(MP4, av1, aac), firefox)).toBe(true);
  });

  it('is false for 10-bit H.264 on Apple WebKit, which claims it but cannot decode it', () => {
    const high10: MediaStream = { ...h264, Profile: 'High 10', BitDepth: 10 };
    expect(canDirectPlay(source(MP4, high10, aac), safari)).toBe(false);
    expect(canDirectPlay(source(MP4, high10, aac), { ...safari, appleWebKit: false })).toBe(true);
  });

  it('is false when the audio is undecodable, even with playable video', () => {
    expect(canDirectPlay(source(MP4, h264, dts), safari)).toBe(false);
  });

  it('checks the default audio stream, not just the first', () => {
    const withDefault = { ...source(MP4, h264, dts, { ...aac, Index: 2 }), DefaultAudioStreamIndex: 2 };
    expect(canDirectPlay(withDefault, safari)).toBe(true);
  });

  it('accepts any of the container names ffprobe gave (Matroska that is also WebM)', () => {
    const vp9: MediaStream = { Type: 'Video', Codec: 'vp9', Profile: 'Profile 0', BitDepth: 8 };
    expect(canDirectPlay(source('mkv,webm', vp9, { Type: 'Audio', Codec: 'opus' }), firefox)).toBe(true);
  });

  it('skips cover art for the video stream', () => {
    const art: MediaStream = { Type: 'Video', Index: 0, Codec: 'mjpeg' };
    expect(canDirectPlay(source(MP4, art, { ...h264, Index: 1 }, aac), safari)).toBe(true);
  });

  it('is false for a codec or container no browser plays', () => {
    const everything = browser({}, /.*/);
    expect(canDirectPlay(source('avi', { Type: 'Video', Codec: 'mpeg4' }, aac), everything)).toBe(false);
    expect(canDirectPlay(source('avi', h264, aac), everything)).toBe(false);
  });
});

describe('trailerOptions', () => {
  it('plays a playable file directly, with a remux behind it', () => {
    expect(trailerOptions(source(MP4, h264, aac), safari, true)).toEqual([
      { kind: 'direct' },
      { kind: 'hls', copyVideo: true },
    ]);
  });

  it('transcodes HEVC in Matroska to HLS, and never to MP4, on Apple WebKit', () => {
    expect(trailerOptions(source('mkv', hevc10, aac), safari, true)).toEqual([
      { kind: 'hls', copyVideo: false },
    ]);
    // Whatever it says about MP4: Jellyfin's progressive stream has no byte ranges, which WebKit needs.
    const mp4Too = { ...safari, canPlay: (type: string) => type.startsWith('video/mp4') };
    expect(trailerOptions(source('mkv', hevc10, aac), mp4Too, true)).toEqual([
      { kind: 'hls', copyVideo: false },
    ]);
  });

  it('prefers a progressive MP4 everywhere else, though Chrome answers "maybe" for HLS', () => {
    expect(trailerOptions(source('mkv', hevc10, aac), chrome, true)).toEqual([
      { kind: 'mp4', copyVideo: false },
    ]);
    expect(trailerOptions(source(MP4, hevc10, aac), firefox, true)).toEqual([
      { kind: 'mp4', copyVideo: false },
    ]);
  });

  it('uses HLS off Apple WebKit only when the browser plays no MP4 (a TV engine)', () => {
    const tv = browser({}, /^application\/vnd\.apple\.mpegurl$/);
    expect(trailerOptions(source('mkv', hevc10, aac), tv, true)).toEqual([{ kind: 'hls', copyVideo: false }]);
  });

  it('only remuxes H.264 the browser plays, when the container or audio is the problem', () => {
    expect(trailerOptions(source('mkv', h264, dts), firefox, true)).toEqual([
      { kind: 'mp4', copyVideo: true },
    ]);
    expect(trailerOptions(source('mkv', { ...h264, Profile: 'High 10' }, aac), firefox, true)).toEqual([
      { kind: 'mp4', copyVideo: false },
    ]);
  });

  it('gives the hero (no server streams) the file or nothing: no transcode, and no remux either', () => {
    expect(trailerOptions(source('mkv', hevc10, aac), safari, false)).toEqual([]);
    expect(trailerOptions(source('mkv', hevc10, aac), chrome, false)).toEqual([]);
    expect(trailerOptions(source('mkv', h264, aac), safari, false)).toEqual([]);
    expect(trailerOptions(source('mkv', h264, dts), firefox, false)).toEqual([]);
    expect(trailerOptions(source(MP4, h264, aac), safari, false)).toEqual([{ kind: 'direct' }]);
    expect(trailerOptions({ Id: 'ms1' }, chrome, false)).toEqual([{ kind: 'direct' }]);
  });

  it('never fully transcodes for a user the server will not transcode for, but still remuxes', () => {
    const denied = (s: MediaSourceInfo): MediaSourceInfo => ({ ...s, SupportsTranscoding: false });
    expect(trailerOptions(denied(source('mkv', hevc10, aac)), safari, true)).toEqual([]);
    expect(trailerOptions(denied(source('mkv', h264, dts)), safari, true)).toEqual([
      { kind: 'hls', copyVideo: true },
    ]);
  });

  it('offers only the file when the user saves data', () => {
    const saving = { ...chrome, saveData: true };
    expect(trailerOptions(source('mkv', hevc10, aac), saving, true)).toEqual([]);
    expect(trailerOptions(source('mkv', h264, aac), saving, true)).toEqual([]);
    expect(trailerOptions(source(MP4, h264, aac), saving, true)).toEqual([{ kind: 'direct' }]);
  });

  it('tries the file as before when its streams are unknown', () => {
    expect(trailerOptions(null, nothing, true)).toEqual([{ kind: 'direct' }]);
    expect(trailerOptions({ Id: 'ms1' }, firefox, true)).toEqual([
      { kind: 'direct' },
      { kind: 'mp4', copyVideo: false },
    ]);
  });

  it('has nothing to offer when the browser plays neither the file nor H.264', () => {
    expect(trailerOptions(source('mkv', hevc10, aac), nothing, true)).toEqual([]);
  });
});

describe('isAppleWebKit', () => {
  it.each<[string, string, boolean]>([
    [
      'Safari on macOS',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
      true,
    ],
    [
      'Safari on iPhone',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
      true,
    ],
    [
      'Chrome on iPhone',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.7339.122 Mobile/15E148 Safari/604.1',
      true,
    ],
    [
      'Firefox on iPhone',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/143.0 Mobile/15E148 Safari/605.1.15',
      true,
    ],
    [
      'the Jellyfin iOS app',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
      true,
    ],
    [
      'Chrome on macOS',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      false,
    ],
    [
      'Chrome on Android',
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
      false,
    ],
    [
      'Edge',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
      false,
    ],
    ['Firefox', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0', false],
    [
      'Samsung Tizen',
      'Mozilla/5.0 (SMART-TV; LINUX; Tizen 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Version/5.0 TV Safari/537.36',
      false,
    ],
    [
      'LG webOS',
      'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/68.0.3440.106 Safari/537.36 WebAppManager',
      false,
    ],
  ])('%s', (_, userAgent, expected) => {
    expect(isAppleWebKit(userAgent)).toBe(expected);
  });
});

describe('detectBrowser', () => {
  afterEach(() => vi.restoreAllMocks());
  const SAFARI_UA =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15';

  it('calls it Apple WebKit only with HLS of its own as well (not WebKitGTK without it)', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(SAFARI_UA);
    const canPlayType = vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('maybe');
    expect(detectBrowser().appleWebKit).toBe(true);
    canPlayType.mockReturnValue('');
    expect(detectBrowser().appleWebKit).toBe(false);
  });

  it('reads Save-Data and Firefox', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (X11; rv:145.0) Gecko/20100101 Firefox/145.0',
    );
    Object.defineProperty(navigator, 'connection', { configurable: true, value: { saveData: true } });
    try {
      expect(detectBrowser()).toMatchObject({ firefox: true, saveData: true, appleWebKit: false });
    } finally {
      delete (navigator as { connection?: unknown }).connection;
    }
  });
});

describe('stopTrailerTranscode', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('never asks without a session, which would stop every transcode of the device', () => {
    const client = createFakeClient();
    const fetch = vi.fn(() => Promise.resolve(new Response()));
    vi.stubGlobal('fetch', fetch);
    stopTrailerTranscode(client, '');
    stopTrailerTranscode(client, '', true);
    expect(client.requests).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends a keepalive request, authorized by header, as the page goes', () => {
    const client = createFakeClient();
    const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(new Response()),
    );
    vi.stubGlobal('fetch', fetch);
    stopTrailerTranscode(client, 'ps1', true);
    expect(fetch).toHaveBeenCalledWith(
      'http://jf/Videos/ActiveEncodings?deviceId=dev%2Bice&playSessionId=ps1',
      {
        method: 'DELETE',
        keepalive: true,
        headers: { Authorization: 'MediaBrowser Token="token1"' },
      },
    );
    expect(client.requests).toEqual([]);
  });
});

describe('trailerUrl', () => {
  const client = createFakeClient();
  const params = (url: string) => Object.fromEntries(new URL(url).searchParams);

  it('streams the file as it is for direct play', () => {
    expect(trailerUrl(client, 't1', source(MP4, h264, aac), { kind: 'direct' }, 'ps1')).toBe(
      'http://jf/Videos/t1/stream?static=true&ApiKey=token1',
    );
  });

  it('asks for a capped H.264/AAC HLS transcode of this session', () => {
    const url = trailerUrl(
      client,
      't1',
      source('mkv', hevc10, aac),
      { kind: 'hls', copyVideo: false },
      'ps1',
    );
    expect(url.split('?')[0]).toBe('http://jf/Videos/t1/master.m3u8');
    expect(params(url)).toEqual({
      MediaSourceId: 'ms1',
      DeviceId: 'dev+ice',
      PlaySessionId: 'ps1',
      VideoCodec: 'h264',
      AudioCodec: 'aac',
      MaxAudioChannels: '2',
      MaxWidth: '1280',
      MaxHeight: '720',
      VideoBitRate: '3000000',
      SegmentContainer: 'ts',
      ApiKey: 'token1',
    });
  });

  it('asks for a progressive MP4 that copies the video, without caps the copy would fail', () => {
    const url = trailerUrl(
      client,
      't1',
      source('mkv', { ...h264, BitRate: 8_000_000, Width: 1920 }, dts),
      { kind: 'mp4', copyVideo: true },
      'ps1',
    );
    expect(url.split('?')[0]).toBe('http://jf/Videos/t1/stream.mp4');
    const query = params(url);
    expect(query).toMatchObject({ VideoCodec: 'h264', AudioCodec: 'aac', VideoBitRate: '8000000' });
    expect(query).not.toHaveProperty('MaxWidth');
    expect(query).not.toHaveProperty('SegmentContainer');
  });
});
