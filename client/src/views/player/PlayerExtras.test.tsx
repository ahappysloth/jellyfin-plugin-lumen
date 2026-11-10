import { describe, expect, it } from 'vitest';
import { endsAt, playbackInfoRows, reasonText, repeatOptions } from './PlayerExtras';

describe('player extras', () => {
  it('says when playback ends, at the current speed', () => {
    const now = new Date(2026, 10, 10, 21, 0, 0).getTime();
    const time = (minutes: number): string =>
      new Date(now + minutes * 60_000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    expect(endsAt({ positionMs: 10 * 60_000, durationMs: 52 * 60_000, rate: 1 }, now)).toBe(
      `Ends at ${time(42)}`,
    );
    expect(endsAt({ positionMs: 10 * 60_000, durationMs: 52 * 60_000, rate: 2 }, now)).toBe(
      `Ends at ${time(21)}`,
    );
    expect(endsAt({ positionMs: 0, durationMs: 0, rate: 1 }, now)).toBeNull();
  });

  it('offers Repeat for movies, and this episode or all episodes for shows', () => {
    expect(repeatOptions(false).map((o) => o.mode)).toEqual(['RepeatNone', 'RepeatOne']);
    expect(repeatOptions(true).map((o) => [o.mode, o.label])).toEqual([
      ['RepeatNone', 'Off'],
      ['RepeatOne', 'This episode'],
      ['RepeatAll', 'All episodes'],
    ]);
  });

  const source = {
    Container: 'mkv',
    Bitrate: 25_000_000,
    MediaStreams: [
      { Type: 'Video', Codec: 'hevc', Height: 2160, VideoRangeType: 'HDR10', RealFrameRate: 24 },
      { Type: 'Audio', Codec: 'eac3', Channels: 6, Language: 'eng' },
    ],
  };

  it('shows a direct play as the source', () => {
    const rows = playbackInfoRows({ playMethod: 'DirectPlay', mediaSource: source }, null);
    expect(Object.fromEntries(rows.map((r) => [r.label, r.value]))).toEqual({
      Playback: 'Direct play',
      Video: 'HEVC · 2160p · HDR10',
      Audio: 'EAC3 · 5.1 · eng',
      Container: 'MKV',
      Bitrate: '25.0 Mbps',
    });
  });

  it('shows what a transcode makes of the source, why, and how fast the server keeps up', () => {
    const rows = playbackInfoRows(
      { playMethod: 'Transcode', mediaSource: source },
      {
        VideoCodec: 'h264',
        Height: 1080,
        AudioCodec: 'aac',
        AudioChannels: 2,
        Container: 'mp4',
        Bitrate: 8_000_000,
        Framerate: 12,
        IsVideoDirect: false,
        IsAudioDirect: false,
        TranscodeReasons: ['VideoCodecNotSupported', 'AudioChannelsNotSupported'],
      },
    );
    expect(Object.fromEntries(rows.map((r) => [r.label, r.value]))).toEqual({
      Playback: 'Transcoding',
      Why: 'video codec not supported, audio channels not supported',
      Video: 'HEVC · 2160p · HDR10 → H264 · 1080p',
      Audio: 'EAC3 · 5.1 · eng → AAC · stereo',
      Container: 'MKV → MP4',
      Bitrate: '25.0 Mbps → 8.0 Mbps',
      Encoding: '12 fps (0.5×)',
    });
  });

  it('reads transcode reasons as words', () => {
    expect(reasonText('ContainerBitrateExceedsLimit')).toBe('container bitrate exceeds limit');
  });
});
