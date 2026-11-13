import { act, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient, routes } from '../../../test/fakeClient';
import { makeContext } from '../../../test/viewContext';
import type { PlaybackManager } from '../../compat/playbackManager';
import type { IconPath } from '../../components/icons';
import type { ViewContext } from '../context';
import type { PlayerSnapshot } from './playerState';
import { SegmentPrompts, SEGMENTS_CLASS, SKIPPED_MS } from './SegmentPrompts';

const TICKS = 10_000_000;
const HOUR = 3_600_000;
const segment = (Type: string, start: number, end: number) => ({
  Type,
  StartTicks: start * TICKS,
  EndTicks: end * TICKS,
});
const INTRO = segment('Intro', 60, 150);
/** Credits that run to the end of an hour-long episode. */
const CREDITS = segment('Outro', 3510, 3600);

interface Options {
  segments?: unknown;
  /** jellyfin-web's "Media segment actions", as it stores them. */
  settings?: Record<string, string>;
  autoplay?: boolean;
  /** The play queue after this episode (jellyfin-web queues the following ones with autoplay on). */
  queue?: object[];
  /** What the server lists from this episode on. */
  following?: object[];
  item?: Partial<NonNullable<PlayerSnapshot['item']>> & { Type: string };
  hasSegments?: boolean;
  layout?: ViewContext['layout'];
  busy?: boolean;
  /** Return as soon as it's rendered, before the segments and the rest have loaded. */
  loading?: boolean;
}

const NEXT = { Id: 'e3', Name: 'The Long Night', Type: 'Episode', ParentIndexNumber: 1, IndexNumber: 3 };

async function setUp(options: Options = {}) {
  const item = { Id: 'e2', Name: 'Pilot', Type: 'Episode', SeriesId: 's1', ...options.item };
  for (const [name, value] of Object.entries(options.settings ?? {}))
    localStorage.setItem(`user1-${name}`, value);
  const client = createFakeClient(
    routes({
      'MediaSegments/src1': () =>
        options.segments instanceof Error
          ? Promise.reject(options.segments)
          : (options.segments ?? { Items: [INTRO] }),
      'Users/user1': { Id: 'user1', Configuration: { EnableNextEpisodeAutoPlay: options.autoplay ?? true } },
      'Shows/s1/Episodes': { Items: [item, ...(options.following ?? [])] },
    }),
  );
  let positionMs = 0;
  let paused = false;
  const manager = {
    getPlaylist: () => Promise.resolve([item, ...(options.queue ?? [])]),
    nextTrack: vi.fn(),
    play: vi.fn(() => Promise.resolve()),
  };
  const seek = vi.fn((ms: number) => void (positionMs = ms));
  const snap = (): PlayerSnapshot =>
    ({
      player: {},
      item,
      mediaSourceId: 'src1',
      durationMs: HOUR,
      canSeek: true,
      paused,
      playlistIndex: 0,
      mediaSource: { HasSegments: options.hasSegments },
    }) as unknown as PlayerSnapshot;
  const ctx = makeContext({ ...client, serverId: () => 'server1' }, { layout: options.layout ?? 'desktop' });
  const element = (busy = options.busy ?? false) => (
    <div class="lmn-osd">
      <div class="lmn-player__controls">
        <button type="button">Pause</button>
      </div>
      <SegmentPrompts
        ctx={ctx}
        manager={manager as unknown as PlaybackManager}
        snap={snap()}
        started
        position={() => positionMs}
        seek={seek}
        busy={busy}
        icon={'M0 0' as IconPath}
      />
    </div>
  );
  const view = render(element());
  /** Lets `ms` pass, with the player's position looked at every 250 ms as it does. */
  const wait = (ms = 300) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  // The segments, the user's settings and the next episode arrive (the video is at its start: nothing shows yet).
  if (!options.loading) await wait(1000);
  return {
    client,
    manager,
    seek,
    wait,
    /** The video is at `ms`, as the next look finds it. */
    at: async (ms: number) => {
      positionMs = ms;
      await wait();
    },
    /** Playback runs on for `ms`, a look at a time. */
    playFor: async (ms: number) => {
      for (let t = 0; t < ms; t += 250) {
        if (!paused) positionMs += 250;
        await wait(250);
      }
    },
    position: () => positionMs,
    pause: (on: boolean) => {
      paused = on;
      view.rerender(element());
    },
    setBusy: (busy: boolean) => view.rerender(element(busy)),
    unmount: view.unmount,
  };
}

const skipButton = (name = 'Skip Intro') => screen.queryByRole('button', { name });
const card = () => screen.queryByRole('region', { name: 'Next episode' });

beforeEach(() => {
  vi.useFakeTimers();
  // jellyfin-web's video page, with the box its own up-next card goes in.
  document.body.insertAdjacentHTML('beforeend', '<div class="upNextContainer hide"></div>');
});
afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  document.querySelectorAll('.upNextContainer').forEach((el) => el.remove());
});

describe('the Skip button', () => {
  it('shows while the video is inside a segment, and goes a few seconds before it ends', async () => {
    const player = await setUp();
    await player.wait();
    expect(skipButton()).toBeNull();

    await player.at(60_000);
    expect(skipButton()).toBeInTheDocument();
    await player.at(146_900);
    expect(skipButton()).toBeInTheDocument();
    await player.at(147_000);
    expect(skipButton()).toBeNull();
    await player.at(151_000);
    expect(skipButton()).toBeNull();
  });

  it('seeks to the end of the segment through the player’s own seek, and goes', async () => {
    const player = await setUp();
    await player.at(70_000);

    fireEvent.click(skipButton()!);

    expect(player.seek).toHaveBeenCalledExactlyOnceWith(150_000);
    expect(skipButton()).toBeNull();
  });

  it('is named for the type of segment', async () => {
    const player = await setUp({
      segments: {
        Items: [
          segment('Recap', 0, 30),
          INTRO,
          segment('Commercial', 600, 660),
          segment('Preview', 3400, 3500),
          // The last episode in the queue: no next-episode card stands in for the credits.
          CREDITS,
        ],
      },
      settings: {
        segmentTypeAction__Recap: 'AskToSkip',
        segmentTypeAction__Preview: 'AskToSkip',
        segmentTypeAction__Commercial: 'AskToSkip',
      },
    });
    for (const [at, name] of [
      [10_000, 'Skip Recap'],
      [70_000, 'Skip Intro'],
      [610_000, 'Skip Ad'],
      [3_410_000, 'Skip Preview'],
      [3_520_000, 'Skip Credits'],
    ] as const) {
      await player.at(at);
      expect(skipButton(name)).toBeInTheDocument();
      expect(screen.getAllByRole('button')).toHaveLength(2); // and Pause
    }
  });

  it('skips credits to just short of the end, which the video then reaches by itself', async () => {
    const player = await setUp({ segments: { Items: [CREDITS] } });
    await player.at(3_520_000);

    fireEvent.click(skipButton('Skip Credits')!);

    expect(player.seek).toHaveBeenCalledExactlyOnceWith(HOUR - 1000);
  });

  it('follows the user’s setting for each type: "None" has no button, and unset types use jellyfin-web’s defaults', async () => {
    const player = await setUp({
      segments: { Items: [segment('Recap', 0, 30), INTRO] },
      settings: { segmentTypeAction__Intro: 'None' },
    });
    await player.at(10_000);
    expect(screen.getAllByRole('button')).toHaveLength(1); // a recap does nothing unless asked to
    await player.at(70_000);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(player.seek).not.toHaveBeenCalled();
  });

  it('has no button for an item without segments', async () => {
    const player = await setUp({ segments: { Items: [] } });
    await player.at(70_000);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    // Lumen still draws the prompts (there are none): jellyfin-web's stay hidden.
    expect(document.documentElement).toHaveClass(SEGMENTS_CLASS);
  });

  it('asks for the playing media source’s segments', async () => {
    const player = await setUp();
    await player.wait();
    expect(player.client.requests.map((r) => r.url)).toContain('http://jf/MediaSegments/src1');
  });

  it('hides jellyfin-web’s own prompts only while it is up', async () => {
    const player = await setUp({ loading: true });
    expect(document.documentElement).not.toHaveClass(SEGMENTS_CLASS);
    await player.wait(1000);
    expect(document.documentElement).toHaveClass(SEGMENTS_CLASS);
    player.unmount();
    expect(document.documentElement).not.toHaveClass(SEGMENTS_CLASS);
  });

  describe('in the TV layout', () => {
    it('takes the remote’s focus as it comes up, and gives it back as it goes', async () => {
      const player = await setUp({ layout: 'tv' });
      const pause = screen.getByRole('button', { name: 'Pause' });
      pause.focus();

      await player.at(70_000);
      expect(skipButton()).toHaveFocus();

      await player.at(148_000);
      expect(skipButton()).toBeNull();
      expect(pause).toHaveFocus();
    });

    it('leaves the focus with an open menu, and takes it once the menu has closed', async () => {
      const player = await setUp({ layout: 'tv', busy: true });
      const pause = screen.getByRole('button', { name: 'Pause' });
      pause.focus();

      await player.at(70_000);
      expect(skipButton()).toBeInTheDocument();
      expect(pause).toHaveFocus();

      player.setBusy(false);
      expect(skipButton()).toHaveFocus();
    });

    it('puts focus on Play when there was nothing to give it back to', async () => {
      const player = await setUp({ layout: 'tv' });
      await player.at(70_000);
      expect(skipButton()).toHaveFocus();

      fireEvent.click(skipButton()!);

      expect(screen.getByRole('button', { name: 'Pause' })).toHaveFocus();
    });
  });

  it('doesn’t take focus outside the TV layout', async () => {
    const player = await setUp();
    await player.at(70_000);
    expect(skipButton()).not.toHaveFocus();
  });
});

describe('a segment set to skip itself', () => {
  const settings = { segmentTypeAction__Intro: 'Skip' };

  it('skips as playback reaches it and says so, with an Undo', async () => {
    const player = await setUp({ settings });
    await player.at(59_800);
    expect(player.seek).not.toHaveBeenCalled();

    await player.at(60_050);

    expect(player.seek).toHaveBeenCalledExactlyOnceWith(150_000);
    expect(screen.getByRole('status')).toHaveTextContent('Skipped intro');
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    expect(skipButton()).toBeNull();
  });

  it('goes back into the segment on Undo, which then plays, with the Skip button', async () => {
    const player = await setUp({ settings });
    await player.at(59_800);
    await player.at(60_050);

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    expect(player.seek).toHaveBeenLastCalledWith(60_300);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    await player.playFor(2000);
    expect(player.seek).toHaveBeenCalledTimes(2); // not skipped again
    expect(skipButton()).toBeInTheDocument();
  });

  it('takes the notice away after a few seconds', async () => {
    const player = await setUp({ settings });
    await player.at(60_050);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();

    await player.wait(SKIPPED_MS);

    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('leaves the seek to jellyfin-web where it skips too, and still says so', async () => {
    const player = await setUp({ settings, hasSegments: true });
    await player.at(59_800);
    await player.at(60_050);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();

    // jellyfin-web's seek lands.
    await player.at(150_000);

    expect(player.seek).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Skipped intro');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(player.seek).toHaveBeenCalledExactlyOnceWith(60_300);
  });

  it('says nothing after credits skipped to the end: there is nothing left to go back to', async () => {
    const player = await setUp({
      segments: { Items: [CREDITS] },
      settings: { segmentTypeAction__Outro: 'Skip' },
      queue: [NEXT],
    });
    await player.at(3_509_800);
    await player.at(3_510_050);

    expect(player.seek).toHaveBeenCalledExactlyOnceWith(HOUR - 1000);
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(card()).toBeNull();
  });
});

describe('the next-episode card', () => {
  const withCredits = { segments: { Items: [INTRO, CREDITS] }, queue: [NEXT] };

  it('comes up as the credits start, with the next episode and a countdown, in place of Skip Credits', async () => {
    const player = await setUp(withCredits);
    await player.at(3_509_000);
    expect(card()).toBeNull();

    await player.at(3_510_000);

    expect(card()).toHaveTextContent('S1 · E3 · The Long Night');
    expect(card()).toHaveTextContent('Playing in 10');
    expect(screen.getByRole('button', { name: 'Play now' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Watch credits' })).toBeInTheDocument();
    expect(skipButton('Skip Credits')).toBeNull();
  });

  it('counts down and then starts the next episode in the credits’ place', async () => {
    const player = await setUp(withCredits);
    await player.at(3_510_000);

    await player.playFor(5000);
    expect(card()).toHaveTextContent('Playing in 5');
    expect(player.manager.nextTrack).not.toHaveBeenCalled();

    await player.playFor(5500);
    expect(player.manager.nextTrack).toHaveBeenCalledTimes(1);
    expect(card()).toBeNull();
    await player.playFor(2000);
    expect(player.manager.nextTrack).toHaveBeenCalledTimes(1);
  });

  it('holds the countdown while the video is paused', async () => {
    const player = await setUp(withCredits);
    await player.at(3_510_000);
    await player.playFor(3000);
    player.pause(true);

    await player.playFor(20_000);

    expect(player.manager.nextTrack).not.toHaveBeenCalled();
    expect(card()).toHaveTextContent('Playing in 7');
  });

  it('starts the next episode at once on Play now', async () => {
    const player = await setUp(withCredits);
    await player.at(3_510_000);

    fireEvent.click(screen.getByRole('button', { name: 'Play now' }));

    expect(player.manager.nextTrack).toHaveBeenCalledTimes(1);
    expect(card()).toBeNull();
  });

  it('goes for good on Watch credits, and nothing plays in their place', async () => {
    const player = await setUp(withCredits);
    await player.at(3_510_000);

    fireEvent.click(screen.getByRole('button', { name: 'Watch credits' }));

    expect(card()).toBeNull();
    await player.playFor(15_000);
    expect(card()).toBeNull();
    expect(skipButton('Skip Credits')).toBeNull();
    expect(player.manager.nextTrack).not.toHaveBeenCalled();
  });

  it('comes up for the last 30 s without credits, counting down to the end, and leaves the rest to jellyfin-web', async () => {
    const player = await setUp({ queue: [NEXT] });
    await player.at(HOUR - 31_000);
    expect(card()).toBeNull();

    await player.at(HOUR - 30_000);
    expect(card()).toHaveTextContent('Playing in 30');
    await player.playFor(20_000);
    expect(card()).toHaveTextContent('Playing in 10');
    await player.playFor(9_500);

    expect(player.manager.nextTrack).not.toHaveBeenCalled();
  });

  describe('with next-episode autoplay off', () => {
    // jellyfin-web then queues nothing after the episode: the next one is the server's.
    const manual = { segments: { Items: [CREDITS] }, autoplay: false, following: [NEXT] };

    it('has no countdown, only the buttons', async () => {
      const player = await setUp(manual);
      await player.at(3_510_000);

      expect(card()).toHaveTextContent('S1 · E3 · The Long Night');
      expect(card()).not.toHaveTextContent('Playing in');
      await player.playFor(15_000);
      expect(card()).toBeInTheDocument();
      expect(player.manager.nextTrack).not.toHaveBeenCalled();
      expect(player.manager.play).not.toHaveBeenCalled();
    });

    it('plays the next episode on Play now', async () => {
      const player = await setUp(manual);
      await player.at(3_510_000);

      fireEvent.click(screen.getByRole('button', { name: 'Play now' }));

      expect(player.manager.play).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ ids: ['e3'] }));
      expect(player.manager.nextTrack).not.toHaveBeenCalled();
    });

    it('looks the next episode up from this one on, into the next season', async () => {
      const player = await setUp(manual);
      await player.wait();
      const request = player.client.requests.find((r) => r.url.includes('Shows/s1/Episodes'));
      expect(new URL(request!.url).searchParams.get('startItemId')).toBe('e2');
    });
  });

  it('isn’t shown for the last episode: its credits get the Skip button', async () => {
    const player = await setUp({ segments: { Items: [CREDITS] } });
    await player.at(3_520_000);
    expect(card()).toBeNull();
    expect(skipButton('Skip Credits')).toBeInTheDocument();
  });

  it('isn’t shown for a movie', async () => {
    const player = await setUp({ item: { Type: 'Movie' }, segments: { Items: [CREDITS] }, queue: [NEXT] });
    await player.at(3_520_000);
    expect(card()).toBeNull();
  });

  it('isn’t shown when the user has switched off next video info', async () => {
    const player = await setUp({ ...withCredits, settings: { enableNextVideoInfoOverlay: 'false' } });
    await player.at(3_520_000);
    expect(card()).toBeNull();
    expect(skipButton('Skip Credits')).toBeInTheDocument();
  });

  it('isn’t shown where jellyfin-web’s own card can’t be hidden (its box isn’t there)', async () => {
    document.querySelectorAll('.upNextContainer').forEach((el) => el.remove());
    const player = await setUp(withCredits);
    await player.at(3_520_000);
    expect(card()).toBeNull();
    expect(skipButton('Skip Credits')).toBeInTheDocument();
  });

  it('takes the remote’s focus on Play now in the TV layout', async () => {
    const player = await setUp({ ...withCredits, layout: 'tv' });
    await player.at(3_510_000);
    expect(screen.getByRole('button', { name: 'Play now' })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Watch credits' }));

    expect(screen.getByRole('button', { name: 'Pause' })).toHaveFocus();
  });
});

describe('falling back to jellyfin-web’s prompts', () => {
  const nothingDrawn = async (player: Awaited<ReturnType<typeof setUp>>): Promise<void> => {
    await player.at(70_000);
    await player.at(3_520_000);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(card()).toBeNull();
    expect(player.seek).not.toHaveBeenCalled();
    expect(document.documentElement).not.toHaveClass(SEGMENTS_CLASS);
  };

  it('draws nothing, and hides nothing, when the segments can’t be fetched', async () => {
    await nothingDrawn(await setUp({ segments: new Error('500'), queue: [NEXT] }));
  });

  it('draws nothing when the answer isn’t the one Lumen knows', async () => {
    await nothingDrawn(await setUp({ segments: { segments: [] }, queue: [NEXT] }));
  });

  it('draws nothing, and asks for nothing, when a setting holds a value Lumen doesn’t know', async () => {
    const player = await setUp({ settings: { segmentTypeAction__Intro: 'SkipAlways' }, queue: [NEXT] });
    await nothingDrawn(player);
    expect(player.client.requests.some((r) => r.url.includes('MediaSegments'))).toBe(false);
  });

  it('draws nothing when jellyfin-web’s settings can’t be read', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      await nothingDrawn(await setUp({ queue: [NEXT] }));
    } finally {
      getItem.mockRestore();
    }
  });
});
