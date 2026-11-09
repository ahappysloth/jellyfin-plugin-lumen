import { act, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient } from '../../../test/fakeClient';
import { makeContext } from '../../../test/viewContext';
import * as compat from '../../compat/playbackManager';
import { qualityLabel, trackParts } from './PlayerPanels';
import { formatClock, PlayerView } from './PlayerView';
import type { PlayerSnapshot } from './playerState';

function fakeManager() {
  const player = { id: 'htmlvideoplayer' };
  let paused = false;
  let subtitle = -1;
  return {
    player,
    getCurrentPlayer: vi.fn(() => player),
    getPlayerState: () => ({
      PlayState: { CanSeek: true, BufferedRanges: [{ start: 0, end: 300_000_000 }] },
      NowPlayingItem: {
        Id: 'e1',
        Name: 'Pilot',
        Type: 'Episode',
        SeriesName: 'Lumen Show',
        ParentIndexNumber: 1,
        IndexNumber: 2,
      },
      MediaSource: { MediaStreams: [{ Type: 'Video', Height: 1080 }] },
    }),
    currentTime: () => 3_000,
    duration: () => 99_340_000_000, // 2:45:34 in ticks
    paused: () => paused,
    playPause: vi.fn(() => (paused = !paused)),
    seek: vi.fn(),
    rewind: vi.fn(),
    fastForward: vi.fn(),
    getVolume: () => 80,
    setVolume: vi.fn(),
    isMuted: () => false,
    toggleMute: vi.fn(),
    audioTracks: () => [{ Index: 1, DisplayTitle: 'English - AAC - 5.1 - Default' }],
    getAudioStreamIndex: () => 1,
    setAudioStreamIndex: vi.fn(),
    subtitleTracks: () => [{ Index: 3, DisplayTitle: 'Spanish - SUBRIP - External', IsExternal: true }],
    getSubtitleStreamIndex: () => subtitle,
    setSubtitleStreamIndex: vi.fn((i: number) => (subtitle = i)),
    getMaxStreamingBitrate: () => 2147483647,
    enableAutomaticBitrateDetection: () => true,
    setMaxStreamingBitrate: vi.fn(),
    getSupportedPlaybackRates: () => [0.5, 1, 2].map((id) => ({ name: `${id}x`, id })),
    getPlaybackRate: () => 1,
    setPlaybackRate: vi.fn(),
    getSupportedAspectRatios: () => [
      { name: 'Auto', id: 'auto' },
      { name: 'Zoom', id: 'cover' },
    ],
    getAspectRatio: () => 'auto',
    setAspectRatio: vi.fn(),
    toggleFullscreen: vi.fn(),
    nextTrack: vi.fn(),
    previousTrack: vi.fn(),
    getCurrentPlaylistIndex: () => 0,
    getPlaylist: () => Promise.resolve([{}, {}]),
  };
}

describe('PlayerView', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows the episode, drives jellyfin-web, and offers the next episode', async () => {
    const pm = fakeManager();
    vi.spyOn(compat, 'getPlaybackManager').mockReturnValue(pm as unknown as compat.PlaybackManager);
    render(<PlayerView ctx={makeContext(createFakeClient())} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(screen.getByRole('heading', { name: 'Lumen Show' })).toBeInTheDocument();
    expect(screen.getByText('S1:E2 · Pilot')).toBeInTheDocument();
    expect(screen.getByText('0:00:03 / 2:45:34')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Quality/ })).toHaveTextContent('1080p');

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(pm.playPause).toHaveBeenCalledWith(pm.player);
    fireEvent.click(screen.getByRole('button', { name: 'Back 10 seconds' }));
    expect(pm.rewind).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Next episode' }));
    expect(pm.nextTrack).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Audio & Subtitles/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Spanish/ }));
    expect(pm.setSubtitleStreamIndex).toHaveBeenCalledWith(3, pm.player);
  });

  it('hands the page back to the stock player when there is no playback manager', async () => {
    vi.spyOn(compat, 'getPlaybackManager').mockReturnValue(null);
    const ctx = makeContext(createFakeClient());
    render(<PlayerView ctx={ctx} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4500);
    });
    expect(ctx.onFallback).toHaveBeenCalled();
  });
});

describe('player helpers', () => {
  it('formats times to match the total', () => {
    expect(formatClock(3_000, 20_000)).toBe('0:03');
    expect(formatClock(3_000, 9_934_000)).toBe('0:00:03');
    expect(formatClock(9_934_000, 9_934_000)).toBe('2:45:34');
  });

  it('splits track titles into a language label and a technical detail', () => {
    expect(trackParts({ Index: 1, DisplayTitle: 'English - AAC - 5.1 - Default' })).toEqual({
      label: 'English',
      detail: 'AAC · 5.1',
    });
    expect(trackParts({ Index: 2, DisplayTitle: 'Spanish - SUBRIP - External' })).toEqual({
      label: 'Spanish',
      detail: 'SUBRIP',
    });
  });

  it('labels quality by playing resolution on Auto, else by preset', () => {
    const base = { autoQuality: true, videoHeight: 1080, maxBitrate: 0 } as PlayerSnapshot;
    expect(qualityLabel(base)).toBe('1080p');
    expect(qualityLabel({ ...base, autoQuality: false, maxBitrate: 6_000_000 })).toBe('720p');
  });
});
