import { act, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient } from '../../../test/fakeClient';
import { pressRemoteBack, REMOTE_BACK_KEY_CODES } from '../../../test/remoteBack';
import { makeContext } from '../../../test/viewContext';
import * as compat from '../../compat/playbackManager';
import { qualityLabel, trackParts } from './PlayerPanels';
import { formatClock, PlayerView } from './PlayerView';
import type { PlayerSnapshot } from './playerState';
import { strings } from '../../strings';

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
    currentTime: vi.fn(() => 3_000),
    duration: () => 99_340_000_000, // 2:45:34 in ticks
    paused: () => paused,
    playPause: vi.fn(() => (paused = !paused)),
    seek: vi.fn(),
    rewind: vi.fn(),
    fastForward: vi.fn(),
    getVolume: vi.fn(() => 80),
    setVolume: vi.fn(),
    isMuted: vi.fn(() => false),
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
    getRepeatMode: vi.fn(() => 'RepeatNone' as const),
    setRepeatMode: vi.fn(),
  };
}

describe('PlayerView extras', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.querySelectorAll('video').forEach((v) => v.remove());
  });

  const start = async () => {
    const pm = fakeManager();
    vi.spyOn(compat, 'getPlaybackManager').mockReturnValue(pm as unknown as compat.PlaybackManager);
    render(<PlayerView ctx={makeContext(createFakeClient())} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    return pm;
  };

  it("doesn't show the loading screen again when the video was already playing as the player opened", async () => {
    // A fast server: jellyfin-web starts the video before it switches to the player page.
    const video = document.createElement('video');
    video.className = 'htmlvideoplayer';
    Object.defineProperty(video, 'paused', { value: false, configurable: true });
    Object.defineProperty(video, 'readyState', { value: 4, configurable: true });
    document.body.appendChild(video);
    await start();
    expect(screen.queryByRole('status', { name: 'Starting…' })).toBeNull();
  });

  it('shows a loading screen until the video plays, then a spinner only for a real stall', async () => {
    await start();
    expect(screen.getByRole('status', { name: 'Starting…' })).toHaveTextContent('Lumen Show');

    const video = document.createElement('video');
    document.body.appendChild(video);
    Object.defineProperty(video, 'paused', { value: false, configurable: true });
    act(() => void video.dispatchEvent(new Event('playing')));
    expect(screen.queryByRole('status', { name: 'Starting…' })).toBeNull();

    act(() => void video.dispatchEvent(new Event('waiting')));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(screen.queryByRole('status', { name: 'Loading' })).toBeNull(); // a blip: no spinner
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    act(() => void video.dispatchEvent(new Event('playing')));
    expect(screen.queryByRole('status', { name: 'Loading' })).toBeNull();
  });

  it('settings: Repeat this episode or all episodes, and Playback info', async () => {
    const pm = await start();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'All episodes' }));
    expect(pm.setRepeatMode).toHaveBeenCalledWith('RepeatAll', pm.player);

    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Playback info' }));
    const card = screen.getByRole('complementary', { name: 'Playback info' });
    expect(card).toHaveTextContent('Direct play');
    expect(card).toHaveTextContent('1080p');
    fireEvent.click(screen.getByRole('button', { name: 'Hide playback info' }));
    expect(screen.queryByRole('complementary', { name: 'Playback info' })).toBeNull();
  });

  it('says when the episode ends', async () => {
    await start();
    expect(screen.getByText(/^Ends at /)).toBeInTheDocument();
  });
});

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

  it('seeks with the arrow keys from where the video is, after the controls hid', async () => {
    const pm = fakeManager();
    vi.spyOn(compat, 'getPlaybackManager').mockReturnValue(pm as unknown as compat.PlaybackManager);
    const { container } = render(<PlayerView ctx={makeContext(createFakeClient())} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    const slider = screen.getByRole('slider', { name: strings.player.seek });
    slider.focus();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000); // controls hide; the seek bar keeps focus
    });
    expect(container.querySelector('.lmn-osd')).toHaveClass('is-idle');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000); // hidden polls: the position is no longer redrawn
    });
    pm.currentTime.mockReturnValue(600_000); // ten minutes on
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(pm.seek).toHaveBeenCalledWith(610_000 * 10_000, pm.player);

    // The seek arrives, and playback goes on, still hidden: the next press steps from there, not from 610 s.
    pm.currentTime.mockReturnValue(610_200);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    pm.currentTime.mockReturnValue(640_000);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(pm.seek).toHaveBeenLastCalledWith(650_000 * 10_000, pm.player);
  });

  it('keeps "Ends at" moving while paused', async () => {
    vi.setSystemTime(new Date(2026, 10, 10, 21, 0, 0));
    const pm = fakeManager();
    vi.spyOn(compat, 'getPlaybackManager').mockReturnValue(pm as unknown as compat.PlaybackManager);
    render(<PlayerView ctx={makeContext(createFakeClient())} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000); // and past the controls' idle timer
    });
    expect(pm.playPause).toHaveBeenCalled();
    const before = screen.getByText(/^Ends at /).textContent;
    // Twenty minutes on the clock, then one poll: running every timer through 20 minutes is slow enough under load
    // to time the test out.
    vi.setSystemTime(Date.now() + 20 * 60_000);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(screen.getByText(/^Ends at /).textContent).not.toBe(before);
  });

  it('shows a volume pill on a volume change without bringing back the controls', async () => {
    const pm = fakeManager();
    vi.spyOn(compat, 'getPlaybackManager').mockReturnValue(pm as unknown as compat.PlaybackManager);
    const { container } = render(<PlayerView ctx={makeContext(createFakeClient())} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000); // controls hide while playing
    });
    const osd = container.querySelector('.lmn-osd')!;
    expect(osd).toHaveClass('is-idle');

    // jellyfin-web changes the volume (its wheel or keyboard shortcuts); the <video> reports it.
    pm.getVolume.mockReturnValue(40);
    const video = document.createElement('video');
    document.body.appendChild(video);
    fireEvent.wheel(document);
    fireEvent(video, new Event('volumechange'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    const pill = screen.getByRole('status', { name: 'Volume' });
    expect(pill).toHaveTextContent('40%');
    expect(pill).toHaveClass('is-shown');
    expect(osd).toHaveClass('is-idle'); // the wheel didn't wake the controls

    pm.isMuted.mockReturnValue(true);
    fireEvent(video, new Event('volumechange'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(pill).toHaveTextContent('Muted');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(pill).not.toHaveClass('is-shown');
    video.remove();
  });

  it('shows no volume pill for the volume jellyfin-web sets as playback starts', async () => {
    const pm = fakeManager();
    vi.spyOn(compat, 'getPlaybackManager').mockReturnValue(pm as unknown as compat.PlaybackManager);
    render(<PlayerView ctx={makeContext(createFakeClient())} />);
    const video = document.createElement('video');
    document.body.appendChild(video);
    fireEvent(video, new Event('volumechange'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    fireEvent(video, new Event('volumechange')); // same volume as before: not a change
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(screen.queryByRole('status', { name: 'Volume' })?.classList.contains('is-shown') ?? false).toBe(
      false,
    );
    video.remove();
  });

  it.each(REMOTE_BACK_KEY_CODES)(
    "a TV remote's Back (keyCode %i) closes an open panel and stays in the player",
    async (keyCode) => {
      const pm = fakeManager();
      vi.spyOn(compat, 'getPlaybackManager').mockReturnValue(pm as unknown as compat.PlaybackManager);
      render(<PlayerView ctx={makeContext(createFakeClient())} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      const tracks = screen.getByRole('button', { name: /Audio & Subtitles/ });
      fireEvent.click(tracks);

      const option = screen.getByRole('menuitemradio', { name: /Spanish/ });
      expect(pressRemoteBack(option, keyCode).reachedJellyfin).toBe(false);
      expect(screen.queryByRole('menuitemradio')).toBeNull();
      expect(tracks).toHaveAttribute('aria-expanded', 'false');

      // With no panel open, Back is jellyfin-web's: it leaves the player.
      expect(pressRemoteBack(tracks, keyCode).reachedJellyfin).toBe(true);
    },
  );

  it('does nothing when the current quality, audio or subtitle track is picked again', async () => {
    const pm = fakeManager();
    vi.spyOn(compat, 'getPlaybackManager').mockReturnValue(pm as unknown as compat.PlaybackManager);
    render(<PlayerView ctx={makeContext(createFakeClient())} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    fireEvent.click(screen.getByRole('button', { name: /Quality/ }));
    fireEvent.click(screen.getAllByRole('menuitemradio', { name: /^Auto/ })[0]!); // Quality's (Aspect ratio has one too)
    expect(pm.setMaxStreamingBitrate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Audio & Subtitles/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^English/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^Off/ }));
    expect(pm.setAudioStreamIndex).not.toHaveBeenCalled();
    expect(pm.setSubtitleStreamIndex).not.toHaveBeenCalled();
  });

  it('holds the last frame with "Switching to …" while a change restarts the stream', async () => {
    const pm = fakeManager();
    vi.spyOn(compat, 'getPlaybackManager').mockReturnValue(pm as unknown as compat.PlaybackManager);
    render(<PlayerView ctx={makeContext(createFakeClient())} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    const video = document.createElement('video');
    document.body.appendChild(video);

    fireEvent.click(screen.getByRole('button', { name: /Audio & Subtitles/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Spanish/ }));
    expect(screen.queryByText('Switching to Spanish…')).toBeNull(); // nothing yet: it may switch in place

    fireEvent(video, new Event('emptied')); // jellyfin-web restarted the stream
    expect(await screen.findByText('Switching to Spanish…')).toBeInTheDocument();

    Object.defineProperty(video, 'paused', { value: false });
    Object.defineProperty(video, 'readyState', { value: 4 });
    fireEvent(video, new Event('timeupdate'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.queryByText('Switching to Spanish…')).toBeNull();
    video.remove();
  });

  it('shows nothing when a change is made in place', async () => {
    const pm = fakeManager();
    vi.spyOn(compat, 'getPlaybackManager').mockReturnValue(pm as unknown as compat.PlaybackManager);
    render(<PlayerView ctx={makeContext(createFakeClient())} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    fireEvent.click(screen.getByRole('button', { name: /Audio & Subtitles/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Spanish/ }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    const video = document.createElement('video');
    document.body.appendChild(video);
    fireEvent(video, new Event('emptied')); // much later: not from this change
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.queryByText(/Switching to/)).toBeNull();
    video.remove();
  });

  it('hands the page back to the stock player at once when there is no playback manager', async () => {
    vi.spyOn(compat, 'getPlaybackManager').mockReturnValue(null);
    const ctx = makeContext(createFakeClient());
    render(<PlayerView ctx={ctx} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(ctx.onFallback).toHaveBeenCalledTimes(1);
  });

  it('falls back after a while when the manager never has a player', async () => {
    const pm = fakeManager();
    pm.getCurrentPlayer.mockReturnValue(null as unknown as typeof pm.player);
    vi.spyOn(compat, 'getPlaybackManager').mockReturnValue(pm as unknown as compat.PlaybackManager);
    const ctx = makeContext(createFakeClient());
    render(<PlayerView ctx={ctx} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(ctx.onFallback).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500);
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
