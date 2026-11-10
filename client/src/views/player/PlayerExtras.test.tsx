import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { useRef, useState } from 'preact/hooks';
import { describe, expect, it } from 'vitest';
import { createFakeClient, routes } from '../../../test/fakeClient';
import { makeContext } from '../../../test/viewContext';
import type { PlaybackManager } from '../../compat/playbackManager';
import { ContextMenuHost } from '../../components/ContextMenu';
import { NO_SYNCPLAY } from '../syncplay/syncPlayState';
import { endsAt, playbackInfoRows, reasonText, repeatOptions, SettingsPanel } from './PlayerExtras';
import type { PlayerSnapshot } from './playerState';

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

/** The settings pill and its panel, which closes the way PlayerView closes it. */
function Settings() {
  const pill = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(true);
  const [info, setInfo] = useState(false);
  const ctx = makeContext(createFakeClient(routes({ 'SyncPlay/List': [] })));
  return (
    <>
      <div class="lmn-player__pills">
        <button ref={pill} type="button" aria-label="Settings" onClick={() => setOpen(true)} />
        {open && (
          <SettingsPanel
            ctx={ctx}
            syncPlay={{ ...NO_SYNCPLAY, available: true, canCreate: true, self: 'Alex' }}
            manager={{} as PlaybackManager}
            snap={{ repeatMode: null } as PlayerSnapshot}
            isEpisode={false}
            info={info}
            onInfo={setInfo}
            pill={pill}
            onClose={() => setOpen(false)}
          />
        )}
      </div>
      <ContextMenuHost />
    </>
  );
}

describe('player settings panel focus', () => {
  it('gives focus back to the settings pill when Playback info closes the panel', () => {
    render(<Settings />);
    const entry = screen.getByRole('menuitemcheckbox', { name: 'Playback info' });
    entry.focus();

    fireEvent.click(entry);

    expect(screen.queryByRole('menuitemcheckbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveFocus();
  });

  it('hands focus from Watch together to its menu, and back to the settings pill when that closes', async () => {
    render(<Settings />);
    const entry = screen.getByRole('menuitem', { name: 'Watch together' });
    entry.focus();

    fireEvent.click(entry);
    const pill = screen.getByRole('button', { name: 'Settings' });
    expect(pill).toHaveFocus(); // while the groups load

    const newGroup = await screen.findByRole('menuitem', { name: 'New group' });
    await waitFor(() => expect(newGroup).toHaveFocus());
    fireEvent.keyDown(newGroup, { key: 'Escape' });
    expect(pill).toHaveFocus();
  });
});
