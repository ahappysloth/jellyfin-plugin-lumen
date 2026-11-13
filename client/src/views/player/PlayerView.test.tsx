import { act, fireEvent, render, screen, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient } from '../../../test/fakeClient';
import { pressRemoteBack, REMOTE_BACK_KEY_CODES } from '../../../test/remoteBack';
import { makeContext } from '../../../test/viewContext';
import * as compat from '../../compat/playbackManager';
import { qualityLabel, trackParts } from './PlayerPanels';
import { formatClock, PlayerView } from './PlayerView';
import type { PlayerSnapshot } from './playerState';
import { ContextMenuHost } from '../../components/ContextMenu';
import * as syncPlayState from '../syncplay/syncPlayState';
import { NO_SYNCPLAY } from '../syncplay/syncPlayState';
import { openWatchTogether } from '../syncplay/WatchTogether';
import { playerStrings } from './playerStrings';
import { loadSegments } from './lazySegments';

const watchTogether = {
  ...NO_SYNCPLAY,
  available: true,
  group: { GroupId: 'g1', GroupName: "Alex's group", Participants: ['Alex', 'Sam'] },
};

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

    fireEvent.click(screen.getByRole('button', { name: 'Playback info' }));
    const card = screen.getByRole('complementary', { name: 'Playback info' });
    expect(card).toHaveTextContent('Direct play');
    expect(card).toHaveTextContent('1080p');
    fireEvent.click(screen.getByRole('button', { name: 'Hide playback info' }));
    expect(screen.queryByRole('complementary', { name: 'Playback info' })).toBeNull();
  });

  it("gives focus to the settings pill as Playback info's own close button goes", async () => {
    await start();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Playback info' }));
    const close = screen.getByRole('button', { name: 'Hide playback info' });
    close.focus();

    fireEvent.click(close);

    expect(screen.getByRole('button', { name: 'Settings' })).toHaveFocus();
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
    expect(pm.seek).toHaveBeenCalledWith(0, pm.player); // from 0:03, as far back as there is
    fireEvent.click(screen.getByRole('button', { name: 'Next episode' }));
    expect(pm.nextTrack).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Audio & Subtitles/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Spanish/ }));
    expect(pm.setSubtitleStreamIndex).toHaveBeenCalledWith(3, pm.player);
  });

  it('seeks with the arrow keys from where the video is, after the controls hid', async () => {
    const pm = fakeManager();
    vi.spyOn(compat, 'getPlaybackManager').mockReturnValue(pm as unknown as compat.PlaybackManager);
    // The TV layout: there the controls hide with focus on them (elsewhere they stay up for keyboard focus).
    const { container } = render(<PlayerView ctx={makeContext(createFakeClient(), { layout: 'tv' })} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    const slider = screen.getByRole('slider', { name: playerStrings.seek });
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

  describe('skips', () => {
    let reachedJellyfin: string[] = [];
    const stock = (e: KeyboardEvent): void => void reachedJellyfin.push(e.key);
    beforeEach(() => {
      reachedJellyfin = [];
      document.addEventListener('keydown', stock);
    });
    afterEach(() => document.removeEventListener('keydown', stock));

    const open = async (layout: 'tv' | 'desktop' = 'desktop', client = createFakeClient()) => {
      const pm = fakeManager();
      let at = 600_000;
      pm.currentTime.mockImplementation(() => at);
      pm.seek.mockImplementation((ticks: number) => void (at = ticks / 10_000));
      Object.assign(pm.player, { currentTime: () => at }); // a stream with no offset
      vi.spyOn(compat, 'getPlaybackManager').mockReturnValue(pm as unknown as compat.PlaybackManager);
      render(<PlayerView ctx={makeContext(client, { layout })} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      return { pm, setAt: (ms: number) => void (at = ms) };
    };
    const seconds = (pm: ReturnType<typeof fakeManager>) =>
      pm.seek.mock.calls.map(([ticks]) => ticks / 10_000_000);
    /**
     * A seek reaching the <video>, at `s` into its stream. jellyfin-web's position is its player's as of the video's
     * last `timeupdate`: it still has the one from before the seek until the video plays on.
     */
    const videoSeeks = (s: number): void => {
      const video = document.body.appendChild(document.createElement('video'));
      Object.defineProperty(video, 'currentTime', { value: s });
      video.dispatchEvent(new Event('seeking'));
      video.remove();
    };

    it("go 10 s each way, whatever jellyfin-web's skip lengths", async () => {
      const { pm } = await open();
      fireEvent.click(screen.getByRole('button', { name: 'Forward 10 seconds' }));
      fireEvent.click(screen.getByRole('button', { name: 'Back 10 seconds' }));
      fireEvent.click(screen.getByRole('button', { name: 'Back 10 seconds' }));
      expect(seconds(pm)).toEqual([610, 600, 590]);
      expect(pm.seek).toHaveBeenCalledWith(590 * 10_000_000, pm.player);
    });

    it('add up while a seek is still on its way (a converted stream restarting), and go on from the video after', async () => {
      const { pm, setAt } = await open();
      pm.seek.mockImplementation(() => undefined); // the position stays where it was for now
      const forward = screen.getByRole('button', { name: 'Forward 10 seconds' });
      fireEvent.click(forward);
      fireEvent.click(forward);
      expect(seconds(pm)).toEqual([610, 620]);
      setAt(621_000); // arrived, and played on a little
      fireEvent.click(forward);
      expect(seconds(pm)).toEqual([610, 620, 631]);
    });

    it('go on from the video once a skip has arrived and played on, not from where it landed', async () => {
      const { pm, setAt } = await open();
      const forward = screen.getByRole('button', { name: 'Forward 10 seconds' });
      fireEvent.click(forward); // 10:00 to 10:10, which arrives at once
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      setAt(615_000); // five seconds on
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      fireEvent.click(forward);
      expect(seconds(pm)).toEqual([610, 625]);
    });

    it('go from where the seek bar went, even with a skip still on its way', async () => {
      const { pm, setAt } = await open();
      pm.seek.mockImplementation(() => undefined); // a converted stream: the skip to 10:10 is still on its way
      fireEvent.click(screen.getByRole('button', { name: 'Forward 10 seconds' }));
      const bar = screen.getByRole('slider', { name: playerStrings.seek });
      bar.getBoundingClientRect = () => ({ left: 0, width: 9_934 }) as DOMRect; // a pixel a second
      fireEvent.pointerDown(bar, { button: 0, clientX: 400 });
      fireEvent.pointerUp(bar, { clientX: 400 });
      expect(seconds(pm)).toEqual([610, 400]);
      setAt(400_000);
      fireEvent.click(screen.getByRole('button', { name: 'Back 10 seconds' }));
      expect(seconds(pm)).toEqual([610, 400, 390]);
    });

    it("go from where another seek went (jellyfin-web's own keys, Watch together), even with a skip on its way", async () => {
      const { pm } = await open();
      pm.seek.mockImplementation(() => undefined); // jellyfin-web's position stays at 10:00 throughout
      const forward = screen.getByRole('button', { name: 'Forward 10 seconds' });
      fireEvent.click(forward);
      videoSeeks(0); // Home
      fireEvent.click(forward);
      expect(seconds(pm)).toEqual([610, 10]);
      // A skip's own seek is where the skip went: quick presses still add up.
      videoSeeks(10);
      fireEvent.click(forward);
      expect(seconds(pm)).toEqual([610, 10, 20]);
    });

    it('go from where the last skip went once the video has it, though jellyfin-web still has the position from before', async () => {
      const { pm } = await open();
      pm.seek.mockImplementation(() => undefined);
      // A converted stream that started at 5:00: jellyfin-web adds that to the player's position, and the video's.
      Object.assign(pm.player, { currentTime: () => 300_000 });
      fireEvent.click(screen.getByRole('button', { name: 'Forward 10 seconds' }));
      videoSeeks(310); // the skip to 10:10 reaches the video; jellyfin-web still says 10:00
      fireEvent.click(screen.getByRole('button', { name: 'Back 10 seconds' }));
      videoSeeks(300);
      fireEvent.click(screen.getByRole('button', { name: 'Back 10 seconds' }));
      // From 10:00 again, the second would go to 9:50, and the third to 9:40.
      expect(seconds(pm)).toEqual([610, 600, 590]);
    });

    it("go on from where a segment's Skip button went, which seeks the same way", async () => {
      await loadSegments();
      // Playing already, inside an intro from 9:50 to 11:40.
      const video = document.body.appendChild(document.createElement('video'));
      video.className = 'htmlvideoplayer';
      Object.defineProperty(video, 'paused', { value: false });
      Object.defineProperty(video, 'readyState', { value: 4 });
      const intro = { Type: 'Intro', StartTicks: 590 * 10_000_000, EndTicks: 700 * 10_000_000 };
      const { pm } = await open(
        'desktop',
        createFakeClient((request) => (request.url.includes('MediaSegments/e1') ? { Items: [intro] } : {})),
      );
      pm.seek.mockImplementation(() => undefined); // a converted stream: jellyfin-web's position stays at 10:00

      fireEvent.click(screen.getByRole('button', { name: 'Skip Intro' }));
      expect(seconds(pm)).toEqual([700]);
      expect(pm.seek).toHaveBeenCalledWith(700 * 10_000_000, pm.player);
      expect(screen.queryByRole('button', { name: 'Skip Intro' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Forward 10 seconds' }));
      expect(seconds(pm)).toEqual([700, 710]);
    });

    it("go from the video in the next episode, not from where the last episode's skip went", async () => {
      const { pm, setAt } = await open();
      pm.seek.mockImplementation(() => undefined); // a skip near the end of the episode, still on its way as it ends
      const forward = screen.getByRole('button', { name: 'Forward 10 seconds' });
      fireEvent.click(forward);
      expect(seconds(pm)).toEqual([610]);

      const state = pm.getPlayerState();
      pm.getPlayerState = () => ({ ...state, NowPlayingItem: { ...state.NowPlayingItem, Id: 'e2' } });
      setAt(5_000);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      fireEvent.click(forward);
      expect(seconds(pm)).toEqual([610, 15]);
    });

    it('add up three quick presses while the first is still on its way', async () => {
      const { pm } = await open();
      pm.seek.mockImplementation(() => undefined);
      const forward = screen.getByRole('button', { name: 'Forward 10 seconds' });
      fireEvent.click(forward);
      fireEvent.click(forward);
      fireEvent.click(forward);
      expect(seconds(pm)).toEqual([610, 620, 630]); // +30 s
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300); // a reading from before any arrived changes nothing
      });
      fireEvent.click(forward);
      expect(seconds(pm)).toEqual([610, 620, 630, 640]);
    });

    it("are off for a stream that can't seek (Live TV)", async () => {
      const pm = fakeManager();
      const state = pm.getPlayerState();
      pm.getPlayerState = () => ({ ...state, PlayState: { ...state.PlayState, CanSeek: false } });
      vi.spyOn(compat, 'getPlaybackManager').mockReturnValue(pm as unknown as compat.PlaybackManager);
      render(<PlayerView ctx={makeContext(createFakeClient())} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(screen.getByRole('button', { name: 'Back 10 seconds' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Forward 10 seconds' })).toBeDisabled();
      fireEvent.keyDown(document.body, { key: 'ArrowRight' });
      expect(pm.seek).not.toHaveBeenCalled();
    });

    it('go on while an arrow key is held, at most every 250 ms', async () => {
      const { pm } = await open();
      fireEvent.keyDown(document.body, { key: 'ArrowRight' });
      for (let i = 0; i < 10; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(50); // a key repeat
        });
        fireEvent.keyDown(document.body, { key: 'ArrowRight', repeat: true });
      }
      expect(seconds(pm)).toEqual([610, 620, 630]); // the press, then at 250 and 500 ms
      expect(reachedJellyfin).toEqual([]); // the rest are kept from jellyfin-web too
    });

    it('skip once per press of a held arrow key in Watch together, where each seek pauses the group', async () => {
      vi.spyOn(syncPlayState, 'useSyncPlayState').mockReturnValue(watchTogether);
      const { pm } = await open();
      fireEvent.keyDown(document.body, { key: 'ArrowRight' });
      for (let i = 0; i < 10; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(300);
        });
        fireEvent.keyDown(document.body, { key: 'ArrowRight', repeat: true });
      }
      expect(seconds(pm)).toEqual([610]);
      expect(reachedJellyfin).toEqual([]);
      fireEvent.keyDown(document.body, { key: 'ArrowRight' }); // let go and pressed again
      expect(seconds(pm)).toEqual([610, 620]);
    });

    it('stop short of the end going forward, and at the start going back', async () => {
      const { pm, setAt } = await open();
      setAt(9_934_000_000 / 1000 - 4_000); // 4 s before the end of 2:45:34
      fireEvent.click(screen.getByRole('button', { name: 'Forward 10 seconds' }));
      expect(pm.seek).toHaveBeenLastCalledWith(9_934_000_000 * 10 - 10_000_000, pm.player); // 1 s before it
      await act(async () => {
        await vi.advanceTimersByTimeAsync(16_000); // long enough that the next skip isn't taken as on from that one
      });
      setAt(3_000);
      fireEvent.click(screen.getByRole('button', { name: 'Back 10 seconds' }));
      expect(pm.seek).toHaveBeenLastCalledWith(0, pm.player);
    });

    it('come from the arrow keys (and J and L) too, kept from jellyfin-web, on a button or on nothing', async () => {
      const { pm } = await open();
      const play = screen.getByRole('button', { name: 'Pause' });
      fireEvent.keyDown(play, { key: 'ArrowRight' });
      fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
      fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
      fireEvent.keyDown(play, { key: 'l' });
      fireEvent.keyDown(play, { key: 'j' });
      expect(seconds(pm)).toEqual([610, 600, 590, 600, 590]);
      expect(reachedJellyfin).toEqual([]);
      // With a modifier, they're jellyfin-web's (or the browser's).
      fireEvent.keyDown(play, { key: 'ArrowRight', shiftKey: true });
      expect(pm.seek).toHaveBeenCalledTimes(5);
      expect(reachedJellyfin).toEqual(['ArrowRight']);
    });

    it("leave the arrow keys to jellyfin-web's D-pad navigation in the TV layout", async () => {
      const { pm } = await open('tv');
      fireEvent.keyDown(screen.getByRole('button', { name: 'Pause' }), { key: 'ArrowRight' });
      expect(pm.seek).not.toHaveBeenCalled();
      expect(reachedJellyfin).toEqual(['ArrowRight']);
    });
  });

  describe('the volume slider', () => {
    // jellyfin-web's keyboard shortcuts listen on `document`: arrows left and right seek, up and down change the
    // volume, Home and End seek, Page Up and Down skip chapters.
    let reachedJellyfin: string[] = [];
    const stock = (e: KeyboardEvent): void => void reachedJellyfin.push(e.key);
    beforeEach(() => {
      reachedJellyfin = [];
      document.addEventListener('keydown', stock);
    });
    afterEach(() => document.removeEventListener('keydown', stock));

    let pm: ReturnType<typeof fakeManager>;
    const open = async (layout: 'tv' | 'desktop') => {
      pm = fakeManager();
      vi.spyOn(compat, 'getPlaybackManager').mockReturnValue(pm as unknown as compat.PlaybackManager);
      render(<PlayerView ctx={makeContext(createFakeClient(), { layout })} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      return screen.getByRole<HTMLInputElement>('slider', { name: playerStrings.volume });
    };
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'];

    const volumeButton = () => screen.getByRole('button', { name: /^(Mute|Unmute)$/ });
    /** Which of the volume icons the mute button shows, by its number of sound waves (-1: struck through). */
    const waves = () => {
      const d = volumeButton().querySelector('path')!.getAttribute('d')!;
      return /l6 6M22 9l-6 6$/.test(d) ? -1 : (d.match(/a[\d.]+ [\d.]+ 0 0 1 0/g) ?? []).length;
    };

    it('follows a mouse drag smoothly, though the controls redraw with an older reading', async () => {
      const slider = await open('desktop');
      fireEvent.pointerDown(slider, { pointerId: 1, pointerType: 'mouse' });
      for (const value of [70, 60, 50, 40]) {
        fireEvent.input(slider, { target: { value: String(value) } });
        // A redraw from the poll, which still reads 80 (the player hasn't caught up).
        await act(async () => {
          await vi.advanceTimersByTimeAsync(10);
        });
        expect(slider.value).toBe(String(value));
      }
      // Sent at once, then at most every 50 ms (the rest of these came sooner), and the last as the button comes up.
      expect(pm.setVolume.mock.calls.map(([v]) => v)).toEqual([70]);
      fireEvent.pointerUp(document.body, { pointerId: 1, pointerType: 'mouse' });
      expect(pm.setVolume.mock.calls.map(([v]) => v)).toEqual([70, 40]);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(slider.value).toBe('40'); // until the player reports it, or a second passes
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(slider.value).toBe('80'); // it never took: the player's reading again
    });

    it("lets go as soon as the player reports the value, and shows the level's waves as it moves", async () => {
      const slider = await open('desktop');
      let volume = 80;
      pm.getVolume.mockImplementation(() => volume);
      pm.setVolume.mockImplementation((v: number) => void (volume = v));
      expect(waves()).toBe(3);
      fireEvent.pointerDown(slider, { pointerId: 1, pointerType: 'touch' });
      fireEvent.input(slider, { target: { value: '50' } });
      expect(waves()).toBe(2);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60);
      });
      fireEvent.input(slider, { target: { value: '20' } });
      expect(waves()).toBe(1);
      fireEvent.input(slider, { target: { value: '0' } });
      expect(waves()).toBe(-1);
      fireEvent.pointerCancel(document.body, { pointerId: 1, pointerType: 'touch' });
      expect(volume).toBe(0);
      volume = 33; // changed elsewhere (jellyfin-web's wheel): shown at the next reading
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(slider.value).toBe('33');
      expect(waves()).toBe(1);
    });

    for (const [how, lose] of [
      ['the window loses focus', () => window.dispatchEvent(new Event('blur'))],
      ['the pointer is lost', () => fireEvent(document.body, new Event('lostpointercapture'))],
    ] as const)
      it(`ends a drag when ${how} with no pointerup, and follows the player again`, async () => {
        const slider = await open('desktop');
        fireEvent.pointerDown(slider, { pointerId: 1, pointerType: 'mouse' });
        fireEvent.input(slider, { target: { value: '50' } });
        fireEvent.input(slider, { target: { value: '40' } }); // waits its turn
        lose();
        expect(pm.setVolume.mock.calls.map(([v]) => v)).toEqual([50, 40]);
        pm.getVolume.mockReturnValue(65); // changed elsewhere
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1300);
        });
        expect(slider.value).toBe('65');
      });

    it('sends the last value and stops listening for the drag when the player closes mid-drag', async () => {
      pm = fakeManager();
      vi.spyOn(compat, 'getPlaybackManager').mockReturnValue(pm as unknown as compat.PlaybackManager);
      const { unmount } = render(<PlayerView ctx={makeContext(createFakeClient())} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      const slider = screen.getByRole<HTMLInputElement>('slider', { name: playerStrings.volume });
      const added = vi.spyOn(document, 'addEventListener');
      fireEvent.pointerDown(slider, { pointerId: 1, pointerType: 'mouse' });
      const endDrag = added.mock.calls.find(([type]) => type === 'lostpointercapture')![1];
      fireEvent.input(slider, { target: { value: '50' } });
      fireEvent.input(slider, { target: { value: '40' } });
      const removed = vi.spyOn(document, 'removeEventListener');
      const removedFromWindow = vi.spyOn(window, 'removeEventListener');
      act(() => unmount());
      expect(pm.setVolume.mock.calls.map(([v]) => v)).toEqual([50, 40]);
      expect(removed.mock.calls.filter(([, fn]) => fn === endDrag).map(([type]) => type)).toEqual([
        'pointerup',
        'pointercancel',
        'lostpointercapture',
      ]);
      expect(removedFromWindow).toHaveBeenCalledWith('blur', endDrag);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(pm.setVolume).toHaveBeenCalledTimes(2); // no timer left behind
    });

    it('changes the volume with its arrow keys, one input at a time, and unmutes once going up from muted', async () => {
      const slider = await open('desktop');
      let muted = true;
      pm.isMuted.mockImplementation(() => muted);
      pm.toggleMute.mockImplementation(() => void (muted = !muted));
      // The browser moves a focused range by its arrow keys and fires an input for each.
      fireEvent.input(slider, { target: { value: '81' } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60);
      });
      fireEvent.input(slider, { target: { value: '82' } });
      expect(pm.toggleMute).toHaveBeenCalledTimes(1);
      expect(pm.setVolume.mock.calls.map(([v]) => v)).toEqual([81, 82]);
      expect(slider.value).toBe('82');
    });

    it("keeps its keys from jellyfin-web's shortcuts, so they only change the volume", async () => {
      const slider = await open('desktop');
      for (const key of keys) fireEvent.keyDown(slider, { key });
      expect(reachedJellyfin).toEqual([]);
      fireEvent.keyDown(slider, { key: 'k' }); // other shortcuts still work from it
      expect(reachedJellyfin).toEqual(['k']);
    });

    it('leaves up and down to D-pad navigation in the TV layout', async () => {
      const slider = await open('tv');
      for (const key of keys) fireEvent.keyDown(slider, { key });
      expect(reachedJellyfin).toEqual(['ArrowUp', 'ArrowDown']);
    });
  });

  describe('keyboard', () => {
    let reachedJellyfin: string[] = [];
    const stock = (e: KeyboardEvent): void => void reachedJellyfin.push(e.key);
    beforeEach(() => {
      reachedJellyfin = [];
      document.addEventListener('keydown', stock);
    });
    afterEach(() => document.removeEventListener('keydown', stock));

    const open = async (layout: 'tv' | 'desktop' = 'desktop') => {
      const pm = fakeManager();
      vi.spyOn(compat, 'getPlaybackManager').mockReturnValue(pm as unknown as compat.PlaybackManager);
      const { container } = render(<PlayerView ctx={makeContext(createFakeClient(), { layout })} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      return { pm, osd: container.querySelector('.lmn-osd')! };
    };
    const idle = () =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(7000); // past the controls' idle timeout, twice
      });

    /** Focus by keyboard: a key, then the focus it moves (Tab, Enter on a pill). */
    const keyboardFocus = (el: HTMLElement): void => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Tab', keyCode: 9 });
      el.focus();
    };
    /** Focus from a click: pointerdown, then focus. */
    const clickFocus = (el: HTMLElement): void => {
      fireEvent.pointerDown(el);
      el.focus();
    };
    // Chromium and WebKit count a clicked button as :focus-visible once any key is pressed; jsdom guesses otherwise.
    const focusVisibleAfterAKey = () => {
      const matches = Element.prototype.matches;
      vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
        return selector === ':focus-visible' ? this === document.activeElement : matches.call(this, selector);
      });
    };
    /** jellyfin-web plays or pauses on keyCode 32 (and keeps the press from a button): where it would. */
    const stockPlayPause = (): { targets: Element[]; stop: () => void } => {
      const targets: Element[] = [];
      const listener = (e: KeyboardEvent): void =>
        void (e.keyCode === 32 && targets.push(e.target as Element));
      document.addEventListener('keydown', listener);
      return { targets, stop: () => document.removeEventListener('keydown', listener) };
    };
    const space = (el: Element) => fireEvent.keyDown(el, { key: ' ', code: 'Space', keyCode: 32 });

    it("Space presses a button the keyboard is on, instead of jellyfin-web's play/pause shortcut", async () => {
      await open();
      const playPause = stockPlayPause();
      try {
        const mute = screen.getByRole('button', { name: 'Mute' });
        keyboardFocus(mute);
        expect(space(mute)).toBe(true); // not prevented: the button gets it
        expect(playPause.targets).toEqual([]);
        expect(reachedJellyfin).toContain(' '); // as a key it ignores: it still learns where the keyboard is
        // Elsewhere it is still jellyfin-web's.
        const seek = screen.getByRole('slider', { name: playerStrings.seek });
        keyboardFocus(seek);
        space(seek);
        expect(playPause.targets).toEqual([seek]);
      } finally {
        playPause.stop();
      }
    });

    it('leaves Space to play/pause after a click on a button', async () => {
      await open();
      focusVisibleAfterAKey();
      const playPause = stockPlayPause();
      try {
        const next = screen.getByRole('button', { name: 'Next episode' });
        clickFocus(next);
        fireEvent.keyDown(next, { key: 'Shift', keyCode: 16 }); // any key: Chromium now calls it :focus-visible
        space(next);
        expect(playPause.targets).toEqual([next]);
      } finally {
        playPause.stop();
      }
    });

    it('keeps the controls up while a control has keyboard focus', async () => {
      const { osd } = await open();
      keyboardFocus(screen.getByRole('button', { name: 'Back 10 seconds' }));
      await idle();
      expect(osd).not.toHaveClass('is-idle');
    });

    it("doesn't keep them up for focus from a click, even after a key (Space to play again)", async () => {
      const { osd } = await open();
      focusVisibleAfterAKey();
      const pause = screen.getByRole('button', { name: 'Pause' });
      clickFocus(pause);
      space(pause);
      await idle();
      expect(osd).toHaveClass('is-idle');
    });

    it('lets go of keyboard focus on a click elsewhere, even one that leaves focus where it was', async () => {
      const { pm, osd } = await open();
      const playPause = stockPlayPause();
      try {
        const mute = screen.getByRole('button', { name: 'Mute' });
        keyboardFocus(mute);
        // A click on another button: WebKit doesn't move focus to a clicked button, so Mute keeps it.
        const rewind = screen.getByRole('button', { name: 'Back 10 seconds' });
        fireEvent.pointerDown(rewind);
        fireEvent.click(rewind);
        expect(pm.seek).toHaveBeenCalled();
        expect(mute).toHaveFocus();
        await idle();
        expect(osd).toHaveClass('is-idle');
        space(mute);
        expect(playPause.targets).toEqual([mute]); // play/pause, as after any click
      } finally {
        playPause.stop();
      }
    });

    it('puts the controls away on Escape from a control, leaving focus on the picture', async () => {
      const { osd } = await open();
      vi.spyOn(window.history, 'length', 'get').mockReturnValue(2);
      const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
      const rewind = screen.getByRole('button', { name: 'Back 10 seconds' });
      keyboardFocus(rewind);
      reachedJellyfin = [];
      fireEvent.keyDown(rewind, { key: 'Escape', keyCode: 27 });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(osd).toHaveClass('is-idle');
      // Not <body>: from there WebKit's next Tab starts at the top of the page.
      expect(document.querySelector('.lmn-player__surface')).toHaveFocus();
      expect(back).not.toHaveBeenCalled();
      expect(reachedJellyfin).toEqual([]);
      // The picture's focus doesn't hold the controls.
      fireEvent.keyDown(document.activeElement!, { key: 'Shift', keyCode: 16 });
      await idle();
      expect(osd).toHaveClass('is-idle');
    });

    it('brings the controls back, and keeps them up, for focus a screen reader moves to a control', async () => {
      const { osd } = await open();
      await idle();
      expect(osd).toHaveClass('is-idle');
      // VoiceOver moves focus with no key and no press.
      screen.getByRole('button', { name: 'Back 10 seconds' }).focus();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(osd).not.toHaveClass('is-idle');
      await idle();
      expect(osd).not.toHaveClass('is-idle');
    });

    it('brings the controls back for focus on a control in the TV layout too, and still hides them after a pause', async () => {
      const { osd } = await open('tv');
      await idle();
      expect(osd).toHaveClass('is-idle');
      screen.getByRole('button', { name: 'Back 10 seconds' }).focus();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(osd).not.toHaveClass('is-idle');
      await idle();
      expect(osd).toHaveClass('is-idle');
    });

    it('hides the controls after a pause in the TV layout, focus or not, and brings them back on a key', async () => {
      const { osd } = await open('tv');
      const volume = screen.getByRole('slider', { name: playerStrings.volume });
      keyboardFocus(volume);
      reachedJellyfin = [];
      await idle();
      expect(osd).toHaveClass('is-idle');
      // Even a key the slider keeps to itself.
      fireEvent.keyDown(volume, { key: 'ArrowLeft' });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(osd).not.toHaveClass('is-idle');
      expect(reachedJellyfin).toEqual([]);
    });
  });

  describe('the picture', () => {
    const open = async () => {
      const pm = fakeManager();
      vi.spyOn(compat, 'getPlaybackManager').mockReturnValue(pm as unknown as compat.PlaybackManager);
      const { container } = render(<PlayerView ctx={makeContext(createFakeClient())} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      const surface = container.querySelector<HTMLElement>('.lmn-player__surface')!;
      vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 900, 500));
      return { pm, osd: container.querySelector('.lmn-osd')!, surface };
    };
    /** A press, a lift and the click they make, as a browser sends them for a tap or a click. */
    const press = (el: Element, pointerType: string, clientX = 450) => {
      const at = { pointerType, pointerId: 1, clientX, clientY: 250 };
      fireEvent.pointerDown(el, at);
      fireEvent.pointerUp(el, at);
      fireEvent.click(el, { clientX, clientY: 250, detail: 1 });
    };
    const idle = async () =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(4000);
      });

    it('shows the controls on a tap, and hides them on the next, without playing or pausing', async () => {
      const { pm, osd, surface } = await open();
      await idle();
      expect(osd).toHaveClass('is-idle');

      press(surface, 'touch');
      expect(osd).not.toHaveClass('is-idle');
      press(surface, 'touch');
      expect(osd).toHaveClass('is-idle'); // at once, not after the idle delay
      press(surface, 'pen');
      expect(osd).not.toHaveClass('is-idle');
      expect(pm.playPause).not.toHaveBeenCalled();
      expect(pm.toggleFullscreen).not.toHaveBeenCalled();
    });

    it("takes a click that WebKit moves to the picture from a tap on a bar's shading as the tap it was", async () => {
      const { pm, osd, surface } = await open();
      // WebKit's click is a MouseEvent, pointerType or not, and lands on the clickable picture under the bar.
      fireEvent.pointerDown(osd.querySelector('.lmn-player__bottom')!, {
        pointerType: 'touch',
        pointerId: 1,
      });
      fireEvent.click(surface, { clientX: 450, clientY: 250, detail: 1 });
      expect(osd).toHaveClass('is-idle');
      expect(pm.playPause).not.toHaveBeenCalled();
    });

    it('hides the controls on a tap while paused too, and brings them back on the next', async () => {
      const { osd, surface } = await open();
      fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
      await idle();
      expect(osd).not.toHaveClass('is-idle'); // paused: they stay up

      press(surface, 'touch');
      expect(osd).toHaveClass('is-idle');
      press(surface, 'touch');
      expect(osd).not.toHaveClass('is-idle');
    });

    it('still plays and pauses on a mouse click, and goes full screen on a double click', async () => {
      const { pm, surface } = await open();
      await idle();
      press(surface, 'mouse');
      expect(pm.playPause).toHaveBeenCalledTimes(1);
      fireEvent.dblClick(surface);
      expect(pm.toggleFullscreen).toHaveBeenCalledTimes(1);
      // A click without a press before it (a script's) counts as a mouse's.
      fireEvent.click(surface);
      expect(pm.playPause).toHaveBeenCalledTimes(2);
    });

    it('skips 10 s on a double tap at either side, not going full screen', async () => {
      const { pm, osd, surface } = await open();
      let at = 60_000;
      pm.currentTime.mockImplementation(() => at);
      pm.seek.mockImplementation((ticks: number) => void (at = ticks / 10_000));
      await idle();
      press(surface, 'touch', 100);
      press(surface, 'touch', 100);
      fireEvent.dblClick(surface); // Chrome on Android sends one
      expect(pm.seek).toHaveBeenCalledTimes(1);
      expect(pm.seek).toHaveBeenLastCalledWith(50_000 * 10_000, pm.player);
      expect(osd).not.toHaveClass('is-idle'); // showing where it went
      expect(osd.querySelector('.lmn-player-skipped')).toHaveTextContent('−10 s');
      press(surface, 'touch', 100); // a third tap on goes back again, and adds up
      expect(pm.seek).toHaveBeenLastCalledWith(40_000 * 10_000, pm.player);
      expect(osd.querySelector('.lmn-player-skipped')).toHaveTextContent('−20 s');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(osd.querySelector('.lmn-player-skipped')).toBeNull();
      press(surface, 'touch', 800);
      press(surface, 'touch', 800);
      expect(pm.seek).toHaveBeenLastCalledWith(50_000 * 10_000, pm.player);
      expect(osd.querySelector('.lmn-player-skipped.is-forward')).toHaveTextContent('+10 s');
      expect(pm.toggleFullscreen).not.toHaveBeenCalled();
      expect(pm.playPause).not.toHaveBeenCalled();
    });

    it('says how far a double tap really went, near the start', async () => {
      const { pm, osd, surface } = await open();
      pm.currentTime.mockReturnValue(4_000);
      await idle();
      press(surface, 'touch', 100);
      press(surface, 'touch', 100);
      expect(pm.seek).toHaveBeenLastCalledWith(0, pm.player);
      expect(osd.querySelector('.lmn-player-skipped')).toHaveTextContent('−4 s');
    });

    it("takes a double tap's first tap away slowly, so the second brings the controls back without a flash", async () => {
      const { pm, osd, surface } = await open();
      press(surface, 'touch', 100);
      expect(osd).toHaveClass('is-idle');
      expect(osd).toHaveClass('is-tapped'); // player.css: a fade that starts slowly
      press(surface, 'touch', 100);
      expect(pm.seek).toHaveBeenCalledTimes(1);
      expect(osd).not.toHaveClass('is-idle');
      expect(osd).not.toHaveClass('is-tapped');
    });

    it('brings the hidden controls back on a tap, without pressing the control under the finger', async () => {
      const { pm, osd, surface } = await open();
      vi.spyOn(window.history, 'length', 'get').mockReturnValue(2);
      const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
      for (const name of ['Pause', 'Back', /Quality/]) {
        await idle();
        // Hidden, the bars let the press through to the picture; it wakes them, and its click comes to the control.
        fireEvent.pointerDown(surface, { pointerType: 'touch', pointerId: 1 });
        fireEvent.pointerUp(surface, { pointerType: 'touch', pointerId: 1 });
        fireEvent.click(screen.getByRole('button', { name }), { detail: 1 });
        expect(osd).not.toHaveClass('is-idle');
      }
      expect(pm.playPause).not.toHaveBeenCalled();
      expect(back).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog', { name: 'Quality' })).toBeNull();
      // Shown, a tap presses it.
      press(screen.getByRole('button', { name: 'Pause' }), 'touch');
      expect(pm.playPause).toHaveBeenCalledTimes(1);
    });

    it("doesn't take a key's click for a waking tap's, even straight after one", async () => {
      const { pm, surface } = await open();
      await idle();
      // A press while they're hidden whose click lands off the picture and the bars stays on record for a moment.
      fireEvent.pointerDown(surface, { pointerType: 'touch', pointerId: 1 });
      fireEvent.pointerUp(surface, { pointerType: 'touch', pointerId: 1 });
      fireEvent.click(document.body, { detail: 1 });
      // Enter on Pause: a click with no press in it (detail 0), as a D-pad's OK and a screen reader's are too.
      fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
      expect(pm.playPause).toHaveBeenCalledTimes(1);
    });

    it('forgets a press that a swipe or a pinch cancelled', async () => {
      const { pm, surface } = await open();
      await idle();
      fireEvent.pointerDown(surface, { pointerType: 'touch', pointerId: 1 });
      fireEvent.pointerCancel(surface, { pointerType: 'touch', pointerId: 1 });
      // A click that brings no press of its own comes after it.
      fireEvent.click(screen.getByRole('button', { name: 'Pause' }), { detail: 1 });
      expect(pm.playPause).toHaveBeenCalledTimes(1);
    });

    it('takes a long press on the picture as a tap, not a click', async () => {
      const { pm, osd, surface } = await open();
      await idle();
      fireEvent.pointerDown(surface, { pointerType: 'touch', pointerId: 1, clientX: 450 });
      vi.advanceTimersByTime(1500);
      fireEvent.pointerUp(surface, { pointerType: 'touch', pointerId: 1, clientX: 450 });
      fireEvent.click(surface, { clientX: 450, clientY: 250, detail: 1 });
      expect(pm.playPause).not.toHaveBeenCalled();
      expect(osd).not.toHaveClass('is-idle');
      // A click long after its press counts as the last pointer's.
      fireEvent.pointerDown(surface, { pointerType: 'touch', pointerId: 1, clientX: 450 });
      vi.advanceTimersByTime(1500);
      fireEvent.click(surface, { clientX: 450, clientY: 250, detail: 1 });
      expect(pm.playPause).not.toHaveBeenCalled();
    });

    it('brings the controls back when playback is paused from elsewhere after a tap put them away', async () => {
      const { pm, osd, surface } = await open();
      press(surface, 'touch');
      expect(osd).toHaveClass('is-idle');
      pm.playPause(); // a Watch together member, headphones, the lock screen
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(osd).not.toHaveClass('is-idle');
      // Put away while paused, they stay away.
      press(surface, 'touch');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(osd).toHaveClass('is-idle');
    });

    it('closes an open panel and does nothing else, by mouse or by finger', async () => {
      const { pm, osd, surface } = await open();
      for (const pointerType of ['mouse', 'touch']) {
        fireEvent.click(screen.getByRole('button', { name: /Quality/ }));
        expect(screen.getByRole('dialog', { name: 'Quality' })).toBeInTheDocument();
        press(surface, pointerType);
        expect(screen.queryByRole('dialog', { name: 'Quality' })).toBeNull();
        expect(osd).not.toHaveClass('is-idle');
      }
      expect(pm.playPause).not.toHaveBeenCalled();
    });

    it('keeps a panel open while a finger scrolls it, or scrolls from outside it', async () => {
      const { surface } = await open();
      fireEvent.click(screen.getByRole('button', { name: /Quality/ }));
      const dialog = screen.getByRole('dialog', { name: 'Quality' });
      const option = within(dialog).getAllByRole('radio')[1]!;
      // A scroll inside: the browser cancels the touch.
      fireEvent.pointerDown(option, { pointerType: 'touch', pointerId: 1, clientX: 50, clientY: 300 });
      fireEvent.pointerCancel(option, { pointerType: 'touch', pointerId: 1 });
      // A drag that starts on the picture, or on the bottom bar.
      for (const from of [surface, screen.getByRole('slider', { name: playerStrings.seek })]) {
        fireEvent.pointerDown(from, { pointerType: 'touch', pointerId: 2, clientX: 50, clientY: 300 });
        fireEvent.pointerMove(from, { pointerType: 'touch', pointerId: 2, clientX: 50, clientY: 200 });
        fireEvent.pointerUp(from, { pointerType: 'touch', pointerId: 2, clientX: 50, clientY: 200 });
      }
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000); // nor do the controls hide under it
      });
      expect(screen.getByRole('dialog', { name: 'Quality' })).toBeInTheDocument();
      // A tap inside picks without closing; a tap outside closes.
      press(option, 'touch');
      expect(screen.getByRole('dialog', { name: 'Quality' })).toBeInTheDocument();
      press(screen.getByRole('button', { name: 'Back 10 seconds' }), 'touch');
      expect(screen.queryByRole('dialog', { name: 'Quality' })).toBeNull();
    });

    it('turns to landscape in full screen where the browser can, and back on the way out', async () => {
      const lock = vi.fn(() => Promise.reject(new Error('NotSupportedError'))); // as iOS and desktops answer
      const unlock = vi.fn();
      const original = Object.getOwnPropertyDescriptor(window.screen, 'orientation');
      Object.defineProperty(window.screen, 'orientation', { value: { lock, unlock }, configurable: true });
      let element: Element | null = null;
      Object.defineProperty(document, 'fullscreenElement', { get: () => element, configurable: true });
      try {
        await open();
        element = document.documentElement;
        act(() => void document.dispatchEvent(new Event('fullscreenchange')));
        expect(lock).toHaveBeenCalledWith('landscape');
        element = null;
        act(() => void document.dispatchEvent(new Event('fullscreenchange')));
        expect(unlock).toHaveBeenCalledTimes(1);
        // Without the API (Safari before 16.4) there's nothing to call, and nothing throws.
        Object.defineProperty(window.screen, 'orientation', { value: undefined, configurable: true });
        element = document.documentElement;
        act(() => void document.dispatchEvent(new Event('fullscreenchange')));
        expect(screen.getByRole('button', { name: 'Exit full screen' })).toBeInTheDocument();
      } finally {
        if (original) Object.defineProperty(window.screen, 'orientation', original);
        else delete (window.screen as { orientation?: unknown }).orientation;
        delete (document as { fullscreenElement?: unknown }).fullscreenElement;
      }
    });
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

      const option = screen.getByRole('radio', { name: /Spanish/ });
      expect(pressRemoteBack(option, keyCode).reachedJellyfin).toBe(false);
      expect(screen.queryByRole('radio')).toBeNull();
      expect(tracks).toHaveAttribute('aria-expanded', 'false');
      // Focus goes back to the pill that opened it (not to nothing), and the controls stay up.
      expect(tracks).toHaveFocus();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2800); // past the idle timeout counted from when the player opened
      });
      expect(document.querySelector('.lmn-osd')).not.toHaveClass('is-idle');

      // With no panel open, Back leaves the player.
      vi.spyOn(window.history, 'length', 'get').mockReturnValue(2);
      const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
      pressRemoteBack(tracks, keyCode);
      expect(back).toHaveBeenCalledTimes(1);
    },
  );

  describe('Back with no panel open', () => {
    let osdTookBack = false;
    // jellyfin-web's video OSD while it counts its (hidden) controls as shown: hides them and stops the Back.
    const stockOsd = (e: KeyboardEvent): void => {
      if (e.keyCode === 27 || e.keyCode === 461 || e.keyCode === 10009) {
        osdTookBack = true;
        e.stopPropagation();
      }
    };
    beforeEach(() => {
      osdTookBack = false;
      document.addEventListener('keydown', stockOsd);
    });
    afterEach(() => document.removeEventListener('keydown', stockOsd));

    const open = async (layout: 'tv' | 'desktop' = 'tv') => {
      const pm = fakeManager();
      vi.spyOn(compat, 'getPlaybackManager').mockReturnValue(pm as unknown as compat.PlaybackManager);
      render(<PlayerView ctx={makeContext(createFakeClient(), { layout })} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      vi.spyOn(window.history, 'length', 'get').mockReturnValue(2); // came from a page
      return vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    };

    it.each(REMOTE_BACK_KEY_CODES)(
      "leaves the player on a TV remote's first Back (keyCode %i), before jellyfin-web's hidden OSD takes it",
      async (keyCode) => {
        const back = await open();
        // Focus on nothing, as after the controls hid: the key comes from <body>.
        expect(pressRemoteBack(document.body, keyCode).reachedJellyfin).toBe(false);
        expect(back).toHaveBeenCalledTimes(1);
        expect(osdTookBack).toBe(false);

        // From a focused control too.
        pressRemoteBack(screen.getByRole('button', { name: 'Settings' }), keyCode);
        expect(back).toHaveBeenCalledTimes(2);
      },
    );

    it('leaves on Escape in the TV layout only, as jellyfin-web does', async () => {
      const back = await open('desktop');
      fireEvent.keyDown(document.body, { key: 'Escape', keyCode: 27 });
      expect(back).not.toHaveBeenCalled();
      expect(osdTookBack).toBe(true);
    });

    it('leaves on Escape in the TV layout', async () => {
      const back = await open('tv');
      fireEvent.keyDown(document.body, { key: 'Escape', keyCode: 27 });
      expect(back).toHaveBeenCalledTimes(1);
      expect(osdTookBack).toBe(false);
    });

    it('leaves Back to jellyfin-web when there is nothing to go back to (it exits the app)', async () => {
      const back = await open();
      vi.spyOn(window.history, 'length', 'get').mockReturnValue(1);
      expect(pressRemoteBack(document.body, 461).reachedJellyfin).toBe(false); // the stock OSD's, as before
      expect(osdTookBack).toBe(true);
      expect(back).not.toHaveBeenCalled();
    });

    it('acts on a held Back once, and keeps its repeats from jellyfin-web', async () => {
      const back = await open();
      pressRemoteBack(document.body, 461);
      let reachedJellyfin = false;
      const stock = (e: KeyboardEvent): void => void (reachedJellyfin = !e.defaultPrevented);
      window.addEventListener('keydown', stock);
      fireEvent.keyDown(document.body, { key: 'Unidentified', keyCode: 461, repeat: true });
      window.removeEventListener('keydown', stock);
      expect(back).toHaveBeenCalledTimes(1);
      expect(reachedJellyfin).toBe(false);
      expect(osdTookBack).toBe(false);
    });

    it('closes Playback info first, and gives focus to the settings pill', async () => {
      const back = await open();
      fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
      fireEvent.click(screen.getByRole('button', { name: 'Playback info' }));
      expect(screen.getByRole('complementary', { name: 'Playback info' })).toBeInTheDocument();

      pressRemoteBack(document.body, 461);

      expect(screen.queryByRole('complementary', { name: 'Playback info' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Settings' })).toHaveFocus();
      expect(back).not.toHaveBeenCalled();
      pressRemoteBack(document.body, 461);
      expect(back).toHaveBeenCalledTimes(1);
    });

    it('closes an open Watch together menu and stays in the player', async () => {
      const back = await open();
      render(<ContextMenuHost />);
      const pill = screen.getByRole('button', { name: 'Settings' });
      await act(() => openWatchTogether(makeContext(createFakeClient()), watchTogether, pill));
      const leave = screen.getByRole('menuitem', { name: 'Leave group' });

      expect(pressRemoteBack(leave, 461).reachedJellyfin).toBe(false);

      expect(screen.queryByRole('menuitem')).toBeNull();
      expect(pill).toHaveFocus();
      expect(back).not.toHaveBeenCalled();
      expect(osdTookBack).toBe(false);
    });

    it("goes home from the Back button when there's nothing to go back to", async () => {
      const pm = fakeManager();
      vi.spyOn(compat, 'getPlaybackManager').mockReturnValue(pm as unknown as compat.PlaybackManager);
      const ctx = makeContext(createFakeClient(), { layout: 'tv' });
      render(<PlayerView ctx={ctx} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
      vi.spyOn(window.history, 'length', 'get').mockReturnValue(1);

      fireEvent.click(document.querySelector('.lmn-player__back')!);

      expect(back).not.toHaveBeenCalled();
      expect(ctx.navigate).toHaveBeenCalledWith('#/home');
    });

    it('leaves Back to an open jellyfin-web dialog', async () => {
      const back = await open();
      const dialog = document.createElement('div');
      dialog.className = 'dialogContainer';
      dialog.innerHTML = '<div class="dialog opened"></div>';
      document.body.appendChild(dialog);
      try {
        pressRemoteBack(document.body, 461);
        expect(back).not.toHaveBeenCalled();
      } finally {
        dialog.remove();
      }
    });

    it('closes a panel open while focus is on nothing', async () => {
      const back = await open();
      fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
      expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();

      pressRemoteBack(document.body, 461);

      expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull();
      expect(back).not.toHaveBeenCalled();
    });
  });

  describe('panels', () => {
    let reachedJellyfin: string[] = [];
    const stock = (e: KeyboardEvent): void => void reachedJellyfin.push(e.key);
    beforeEach(() => {
      reachedJellyfin = [];
      document.addEventListener('keydown', stock);
    });
    afterEach(() => document.removeEventListener('keydown', stock));

    const open = async (layout: 'tv' | 'desktop' = 'desktop') => {
      const pm = fakeManager();
      vi.spyOn(compat, 'getPlaybackManager').mockReturnValue(pm as unknown as compat.PlaybackManager);
      render(<PlayerView ctx={makeContext(createFakeClient(), { layout })} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      return pm;
    };

    it('are labelled dialogs of radio groups, and focus the current choice as they open', async () => {
      await open();
      const quality = screen.getByRole('button', { name: /Quality/ });
      expect(quality).toHaveAttribute('aria-haspopup', 'dialog');
      fireEvent.click(quality);
      const dialog = screen.getByRole('dialog', { name: 'Quality' });
      expect(dialog).not.toHaveAttribute('aria-modal');
      const presets = screen.getByRole('radiogroup', { name: 'Quality' });
      expect(within(presets).getByRole('radio', { name: /^Auto/ })).toHaveAttribute('aria-checked', 'true');
      expect(within(presets).getByRole('radio', { name: /^720p/ })).toHaveAttribute('aria-checked', 'false');
      expect(within(presets).getByRole('radio', { name: /^Auto/ })).toHaveFocus();
      const ratios = screen.getByRole('radiogroup', { name: 'Aspect ratio' });
      expect(within(ratios).getByRole('radio', { name: 'Zoom' })).toHaveAttribute('aria-checked', 'false');
      expect(screen.queryByRole('menu')).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: /Audio & Subtitles/ }));
      expect(screen.getByRole('dialog', { name: 'Audio & Subtitles' })).toBeInTheDocument();
      const audio = screen.getByRole('radiogroup', { name: 'Audio' });
      expect(within(audio).getByRole('radio', { name: /^English/ })).toHaveFocus();
      const subtitles = screen.getByRole('radiogroup', { name: 'Subtitles' });
      expect(within(subtitles).getByRole('radio', { name: 'Off' })).toHaveAttribute('aria-checked', 'true');
      expect(within(subtitles).getByRole('radio', { name: /^Spanish/ })).toHaveAttribute(
        'aria-checked',
        'false',
      );

      fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
      expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Off' })).toHaveFocus(); // Repeat's current choice
    });

    it('close on Escape and give focus back to their pill', async () => {
      await open();
      const tracks = screen.getByRole('button', { name: /Audio & Subtitles/ });
      fireEvent.click(tracks);
      fireEvent.keyDown(screen.getByRole('radio', { name: /^Spanish/ }), { key: 'Escape', keyCode: 27 });
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(tracks).toHaveFocus();
      expect(reachedJellyfin).toEqual([]);
    });

    it('move between choices with the arrow keys, without picking one or reaching jellyfin-web', async () => {
      const pm = await open();
      fireEvent.click(screen.getByRole('button', { name: /Audio & Subtitles/ }));
      const off = screen.getByRole('radio', { name: 'Off' });
      const spanish = screen.getByRole('radio', { name: /^Spanish/ });
      off.focus();
      fireEvent.keyDown(off, { key: 'ArrowDown' });
      expect(spanish).toHaveFocus();
      fireEvent.keyDown(spanish, { key: 'ArrowRight' });
      expect(off).toHaveFocus(); // round to the first
      fireEvent.keyDown(off, { key: 'ArrowUp' });
      expect(spanish).toHaveFocus();
      fireEvent.keyDown(spanish, { key: 'ArrowLeft' });
      expect(off).toHaveFocus();
      expect(pm.setSubtitleStreamIndex).not.toHaveBeenCalled();
      expect(reachedJellyfin).toEqual([]);
    });

    it('name the subtitle timing steps after what they show', async () => {
      const setSubtitleOffset = vi.fn();
      const pm = Object.assign(await open(), {
        supportSubtitleOffset: () => true,
        getPlayerSubtitleOffset: () => 0,
        setSubtitleOffset,
      });
      fireEvent.click(screen.getByRole('button', { name: /Audio & Subtitles/ }));
      fireEvent.click(screen.getByRole('radio', { name: /^Spanish/ }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      const timing = screen.getByRole('group', { name: 'Subtitle timing' });
      const earlier = within(timing).getByRole('button', { name: '−0.1s, earlier' });
      const later = within(timing).getByRole('button', { name: '+0.1s, later' });
      // The accessible name contains the visible text (WCAG 2.5.3, Label in Name).
      expect(earlier.getAttribute('aria-label')).toContain(earlier.textContent!.trim());
      expect(later.getAttribute('aria-label')).toContain(later.textContent!.trim());
      fireEvent.click(later);
      expect(setSubtitleOffset).toHaveBeenCalledWith(0.1, pm.player);
    });

    it("keep their other keys from jellyfin-web's seek and volume shortcuts", async () => {
      const pm = Object.assign(await open(), {
        supportSubtitleOffset: () => true,
        getPlayerSubtitleOffset: () => 0,
        setSubtitleOffset: vi.fn(),
      });
      fireEvent.click(screen.getByRole('button', { name: /Quality/ }));
      const auto = screen.getAllByRole('radio', { name: /^Auto/ })[0]!;
      for (const key of ['Home', 'End', 'PageUp', 'PageDown']) fireEvent.keyDown(auto, { key });
      const speed = screen.getByRole('button', { name: '2x' });
      for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'])
        fireEvent.keyDown(speed, { key });

      fireEvent.click(screen.getByRole('button', { name: /Audio & Subtitles/ }));
      fireEvent.click(screen.getByRole('radio', { name: /^Spanish/ }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      const later = screen.getByRole('button', { name: '+0.1s, later' });
      for (const key of ['ArrowLeft', 'ArrowRight', 'End']) fireEvent.keyDown(later, { key });

      fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
      const repeat = screen.getByRole('button', { name: 'All episodes' });
      for (const key of ['ArrowRight', 'ArrowDown', 'PageDown']) fireEvent.keyDown(repeat, { key });

      expect(reachedJellyfin).toEqual([]);
      expect(pm.seek).not.toHaveBeenCalled();
    });

    it('stop Tab at the checked choice of each group', async () => {
      await open();
      fireEvent.click(screen.getByRole('button', { name: /Audio & Subtitles/ }));
      const subtitles = within(screen.getByRole('radiogroup', { name: 'Subtitles' })).getAllByRole('radio');
      expect(subtitles.map((r) => r.tabIndex)).toEqual([0, -1]); // Off is checked
      fireEvent.click(subtitles[1]!);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(subtitles.map((r) => r.tabIndex)).toEqual([-1, 0]);
    });

    it("keep every choice focusable in the TV layout, for jellyfin-web's D-pad (it skips tabindex -1)", async () => {
      await open('tv');
      fireEvent.click(screen.getByRole('button', { name: /Audio & Subtitles/ }));
      const off = screen.getByRole('radio', { name: 'Off' });
      expect(screen.getAllByRole('radio').every((r) => r.getAttribute('tabindex') !== '-1')).toBe(true);
      fireEvent.keyDown(off, { key: 'Home' });
      expect(reachedJellyfin).toEqual([]); // jellyfin-web seeks to the start on Home in every layout
    });

    it("leave the arrow keys to jellyfin-web's D-pad navigation in the TV layout", async () => {
      await open('tv');
      fireEvent.click(screen.getByRole('button', { name: /Audio & Subtitles/ }));
      const off = screen.getByRole('radio', { name: 'Off' });
      off.focus();
      fireEvent.keyDown(off, { key: 'ArrowDown' });
      expect(off).toHaveFocus();
      expect(reachedJellyfin).toEqual(['ArrowDown']);
    });
  });

  it('does nothing when the current quality, audio or subtitle track is picked again', async () => {
    const pm = fakeManager();
    vi.spyOn(compat, 'getPlaybackManager').mockReturnValue(pm as unknown as compat.PlaybackManager);
    render(<PlayerView ctx={makeContext(createFakeClient())} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    fireEvent.click(screen.getByRole('button', { name: /Quality/ }));
    fireEvent.click(screen.getAllByRole('radio', { name: /^Auto/ })[0]!); // Quality's (Aspect ratio has one too)
    expect(pm.setMaxStreamingBitrate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Audio & Subtitles/ }));
    fireEvent.click(screen.getByRole('radio', { name: /^English/ }));
    fireEvent.click(screen.getByRole('radio', { name: /^Off/ }));
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
    fireEvent.click(screen.getByRole('radio', { name: /Spanish/ }));
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
    fireEvent.click(screen.getByRole('radio', { name: /Spanish/ }));
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
