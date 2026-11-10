import { describe, expect, it } from 'vitest';
import type { MediaSourceInfo, MediaStream } from '../../api/types';
import { createFakeClient } from '../../../test/fakeClient';
import {
  audioCodecString,
  canDirectPlay,
  trailerOptions,
  trailerUrl,
  videoCodecString,
  type CanPlay,
} from './trailerStream';

/** A canPlayType stand-in that says yes to any type matching one of the patterns. */
const browser =
  (...supported: RegExp[]): CanPlay =>
  (type) =>
    supported.some((pattern) => pattern.test(type));

// Roughly what each browser says to the questions the preview asks: 8-bit H.264 profiles only, any level.
const safari = browser(
  /^video\/mp4; codecs="(avc1\.(42|4D|64)|hvc1\.)[^,]*(, mp4a\.40\.\d+)?"$/,
  /^application\/vnd\.apple\.mpegurl$/,
);
const firefox = browser(
  /^video\/mp4; codecs="(avc1\.(42|4D|64)|av01\.)[^,]*(, (mp4a\.40\.\d+|opus))?"$/,
  /^video\/webm; codecs="(vp09|vp8|av01)[^,]*(, (opus|vorbis))?"$/,
);
const nothing = browser();

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
    const canPlay = browser(/^video\/mp4; codecs="avc1\.640029, mp4a\.40\.2"$/);
    expect(canDirectPlay(source(MP4, h264, aac), canPlay)).toBe(true);
  });

  it('is false for Matroska where only MP4 plays (Safari)', () => {
    expect(canDirectPlay(source('mkv', h264, aac), safari)).toBe(false);
  });

  it('is false for HEVC where it is not decoded (Firefox), true where it is (Safari)', () => {
    expect(canDirectPlay(source(MP4, hevc10, aac), firefox)).toBe(false);
    expect(canDirectPlay(source(MP4, hevc10, aac), safari)).toBe(true);
  });

  it('is false for AV1 where it is not decoded (Safari), true where it is (Firefox)', () => {
    expect(canDirectPlay(source(MP4, av1, aac), safari)).toBe(false);
    expect(canDirectPlay(source(MP4, av1, aac), firefox)).toBe(true);
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
    const canPlay = browser(/.*/);
    expect(canDirectPlay(source('avi', { Type: 'Video', Codec: 'mpeg4' }, aac), canPlay)).toBe(false);
    expect(canDirectPlay(source('avi', h264, aac), canPlay)).toBe(false);
  });
});

describe('trailerOptions', () => {
  it('plays a playable file directly, with transcodes behind it', () => {
    expect(trailerOptions(source(MP4, h264, aac), safari)).toEqual([
      { kind: 'direct' },
      { kind: 'hls', copyVideo: true },
      { kind: 'mp4', copyVideo: true },
    ]);
  });

  it('transcodes HEVC in Matroska to HLS first where the browser plays HLS itself (Safari)', () => {
    expect(trailerOptions(source('mkv', hevc10, aac), safari)).toEqual([
      { kind: 'hls', copyVideo: false },
      { kind: 'mp4', copyVideo: false },
    ]);
  });

  it('transcodes HEVC to a progressive MP4 where it does not (Firefox)', () => {
    expect(trailerOptions(source(MP4, hevc10, aac), firefox)).toEqual([{ kind: 'mp4', copyVideo: false }]);
  });

  it('only remuxes H.264 the browser plays, when the container or audio is the problem', () => {
    expect(trailerOptions(source('mkv', h264, dts), firefox)).toEqual([{ kind: 'mp4', copyVideo: true }]);
    expect(trailerOptions(source('mkv', { ...h264, Profile: 'High 10' }, aac), firefox)).toEqual([
      { kind: 'mp4', copyVideo: false },
    ]);
  });

  it('tries the file as before when its streams are unknown', () => {
    expect(trailerOptions(null, nothing)).toEqual([{ kind: 'direct' }]);
    expect(trailerOptions({ Id: 'ms1' }, firefox)).toEqual([
      { kind: 'direct' },
      { kind: 'mp4', copyVideo: false },
    ]);
  });

  it('has nothing to offer when the browser plays neither the file nor H.264', () => {
    expect(trailerOptions(source('mkv', hevc10, aac), nothing)).toEqual([]);
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
