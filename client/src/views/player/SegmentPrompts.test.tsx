import { act, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient, routes } from '../../../test/fakeClient';
import { makeContext } from '../../../test/viewContext';
import type { PlaybackManager } from '../../compat/playbackManager';
import type { IconPath } from '../../components/icons';
import type { ViewContext } from '../context';
import { clearUserData } from '../userDataStore';
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
  /** The play queue after this episode (jellyfin-web queues the following ones, with autoplay or without). */
  queue?: object[];
  item?: Partial<NonNullable<PlayerSnapshot['item']>> & { Type: string };
  hasSegments?: boolean;
  /** A stream the server converts: one file (`http`), which seeks by starting again, or HLS, which seeks in place. */
  transcode?: 'http' | 'hls';
  repeatMode?: PlayerSnapshot['repeatMode'];
  layout?: ViewContext['layout'];
  busy?: boolean;
  /** The controls are hidden (as they are, playing, a few seconds after the last input). */
  idle?: boolean;
  /** In a Watch together group. */
  group?: boolean;
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
      // The next episode's own: none.
      'MediaSegments/src3': { Items: [] },
      'Users/user1': { Id: 'user1', Configuration: { EnableNextEpisodeAutoPlay: options.autoplay ?? true } },
      'UserPlayedItems/e2': {},
    }),
  );
  let positionMs = 0;
  let paused = false;
  /** What plays: this episode, or (after `nextBegins`) the next in the queue. */
  let playing = { item, index: 0, source: 'src1' };
  let state = { busy: options.busy ?? false, idle: options.idle ?? false };
  const queue = [item, ...(options.queue ?? [])];
  const manager = {
    getPlaylist: () => Promise.resolve(queue),
    nextTrack: vi.fn(),
  };
  const seek = vi.fn((ms: number) => void (positionMs = ms));
  const snap = (): PlayerSnapshot =>
    ({
      player: {},
      item: playing.item,
      mediaSourceId: playing.source,
      durationMs: HOUR,
      canSeek: true,
      paused,
      playlistIndex: playing.index,
      repeatMode: options.repeatMode ?? 'RepeatNone',
      playMethod: options.transcode ? 'Transcode' : 'DirectPlay',
      mediaSource: { HasSegments: options.hasSegments, TranscodingSubProtocol: options.transcode },
    }) as unknown as PlayerSnapshot;
  const ctx = makeContext({ ...client, serverId: () => 'server1' }, { layout: options.layout ?? 'desktop' });
  const element = () => (
    <div class="lmn-osd">
      <footer class="lmn-player__bottom">
        <input type="range" aria-label="Seek" />
        <div class="lmn-player__controls">
          <button type="button">Pause</button>
        </div>
      </footer>
      <SegmentPrompts
        ctx={ctx}
        manager={manager as unknown as PlaybackManager}
        snap={snap()}
        started
        position={() => positionMs}
        seek={seek}
        busy={state.busy}
        idle={state.idle}
        group={options.group ?? false}
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
    /** A menu or Playback info opens or closes, or the controls come up or go. */
    set: (change: Partial<typeof state>) => {
      state = { ...state, ...change };
      view.rerender(element());
    },
    /** The next episode in the queue begins. */
    nextBegins: async () => {
      playing = { item: queue[1] as typeof item, index: 1, source: 'src3' };
      positionMs = 0;
      view.rerender(element());
      await wait();
    },
    /** What Lumen asked the server to change. */
    posts: () => client.requests.filter((r) => r.type === 'POST').map((r) => new URL(r.url).pathname),
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
  clearUserData();
  document.querySelectorAll('.upNextContainer, .lmn-menu').forEach((el) => el.remove());
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
    it('takes the remote’s focus as it comes up with the controls hidden, and gives it back as it goes', async () => {
      const player = await setUp({ layout: 'tv', idle: true });
      const pause = screen.getByRole('button', { name: 'Pause' });
      pause.focus();

      await player.at(70_000);
      expect(skipButton()).toHaveFocus();
      // The press that brings the controls back leaves it there.
      player.set({ idle: false });
      expect(skipButton()).toHaveFocus();

      await player.at(148_000);
      expect(skipButton()).toBeNull();
      expect(pause).toHaveFocus();
    });

    it('takes it with the controls up when nothing in the player has focus', async () => {
      const player = await setUp({ layout: 'tv' });
      await player.at(70_000);
      expect(skipButton()).toHaveFocus();
    });

    it('leaves the focus on the seek bar or another control in use, and takes it once the controls have gone', async () => {
      const player = await setUp({ layout: 'tv' });
      const seekBar = screen.getByRole('slider', { name: 'Seek' });
      seekBar.focus();

      await player.at(70_000);
      expect(skipButton()).toBeInTheDocument();
      expect(seekBar).toHaveFocus();

      player.set({ idle: true });
      expect(skipButton()).toHaveFocus();
      // And back to the seek bar as the button goes.
      await player.at(148_000);
      expect(seekBar).toHaveFocus();
    });

    it('leaves the focus with an open panel or Playback info, with the controls hidden too', async () => {
      const player = await setUp({ layout: 'tv', busy: true, idle: true });
      const pause = screen.getByRole('button', { name: 'Pause' });
      pause.focus();

      await player.at(70_000);
      expect(skipButton()).toBeInTheDocument();
      expect(pause).toHaveFocus();

      player.set({ busy: false });
      expect(skipButton()).toHaveFocus();
    });

    it.each([
      [
        'Lumen’s (Watch together, the cast picker)',
        '<div class="lmn-menu" role="menu"><button>Chromecast</button></div>',
      ],
      ['a Lumen dialog', '<div class="lmn-dialog"><button>OK</button></div>'],
      [
        'jellyfin-web’s',
        '<div class="dialogContainer"><div class="dialog opened"><button>OK</button></div></div>',
      ],
    ])('leaves the focus in an open menu or dialog: %s', async (_name, html) => {
      const player = await setUp({ layout: 'tv', idle: true });
      document.body.insertAdjacentHTML('beforeend', html);
      const menu = document.body.lastElementChild!;
      const entry = menu.querySelector('button')!;
      entry.focus();
      try {
        await player.at(70_000);
        expect(skipButton()).toBeInTheDocument();
        expect(entry).toHaveFocus();
      } finally {
        menu.remove();
      }
    });

    it('puts focus on Play when there was nothing to give it back to', async () => {
      const player = await setUp({ layout: 'tv' });
      await player.at(70_000);
      expect(skipButton()).toHaveFocus();

      fireEvent.click(skipButton()!);

      expect(screen.getByRole('button', { name: 'Pause' })).toHaveFocus();
    });

    it('leaves the focus where the user moved it from the button', async () => {
      const player = await setUp({ layout: 'tv', idle: true });
      await player.at(70_000);
      expect(skipButton()).toHaveFocus();
      player.set({ idle: false });
      const seekBar = screen.getByRole('slider', { name: 'Seek' });
      seekBar.focus();

      await player.at(148_000);

      expect(skipButton()).toBeNull();
      expect(seekBar).toHaveFocus();
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

  it('gives jellyfin-web’s skip longer to land on a stream that restarts to seek, then makes it', async () => {
    const player = await setUp({ settings, hasSegments: true, transcode: 'http' });
    await player.at(59_800);
    await player.at(60_050);
    // The old stream plays on while jellyfin-web's request for the new one is out.
    await player.playFor(4000);
    expect(player.seek).not.toHaveBeenCalled();

    await player.playFor(4500);
    expect(player.seek).toHaveBeenCalledExactlyOnceWith(150_000);
  });

  it('waits no longer than usual on HLS, where a seek shows at once', async () => {
    const player = await setUp({ settings, hasSegments: true, transcode: 'hls' });
    await player.at(59_800);
    await player.at(60_050);
    await player.playFor(2000);
    expect(player.seek).toHaveBeenCalledExactlyOnceWith(150_000);
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
    // jellyfin-web queues the following episodes all the same (12.4); it only doesn't start them.
    const manual = { ...withCredits, autoplay: false };

    it('has no countdown, only the buttons', async () => {
      const player = await setUp(manual);
      await player.at(3_510_000);

      expect(card()).toHaveTextContent('S1 · E3 · The Long Night');
      expect(card()).not.toHaveTextContent('Playing in');
      await player.playFor(15_000);
      expect(card()).toBeInTheDocument();
      expect(player.manager.nextTrack).not.toHaveBeenCalled();
    });

    it('plays the queue’s next episode on Play now', async () => {
      const player = await setUp(manual);
      await player.at(3_510_000);

      fireEvent.click(screen.getByRole('button', { name: 'Play now' }));

      expect(player.manager.nextTrack).toHaveBeenCalledTimes(1);
    });
  });

  describe('leaving for the next episode before Jellyfin would count this one as watched', () => {
    it('marks it watched once the next has begun, after the countdown', async () => {
      const player = await setUp(withCredits);
      await player.at(3_510_000);
      await player.playFor(10_500);
      expect(player.manager.nextTrack).toHaveBeenCalledTimes(1);
      // Not before jellyfin-web has reported where this one stopped.
      expect(player.posts()).toEqual([]);

      await player.nextBegins();

      expect(player.posts()).toEqual(['/UserPlayedItems/e2']);
    });

    it('marks it watched after Play now', async () => {
      const player = await setUp(withCredits);
      await player.at(3_510_000);
      fireEvent.click(screen.getByRole('button', { name: 'Play now' }));

      await player.nextBegins();

      expect(player.posts()).toEqual(['/UserPlayedItems/e2']);
    });

    it('leaves an episode that played out, or was left another way, to Jellyfin', async () => {
      const player = await setUp(withCredits);
      await player.at(3_510_000);
      fireEvent.click(screen.getByRole('button', { name: 'Watch credits' }));
      await player.at(3_599_000);

      await player.nextBegins();

      expect(player.posts()).toEqual([]);
    });
  });

  it('shows no Skip Credits in its place once Play now has been pressed', async () => {
    const player = await setUp(withCredits);
    await player.at(3_510_000);

    fireEvent.click(screen.getByRole('button', { name: 'Play now' }));

    expect(card()).toBeNull();
    expect(skipButton('Skip Credits')).toBeNull();
    // Nor while the next episode loads.
    await player.playFor(1000);
    expect(skipButton('Skip Credits')).toBeNull();
  });

  it('isn’t shown with Repeat set to this episode, which is what would play next', async () => {
    const player = await setUp({ ...withCredits, repeatMode: 'RepeatOne' });
    await player.at(3_520_000);
    expect(card()).toBeNull();
    expect(skipButton('Skip Credits')).toBeInTheDocument();
    await player.playFor(11_000);
    expect(player.manager.nextTrack).not.toHaveBeenCalled();
  });

  it('isn’t shown for the last episode in the queue: its credits get the Skip button', async () => {
    const player = await setUp({ segments: { Items: [CREDITS] } });
    await player.at(3_520_000);
    expect(card()).toBeNull();
    expect(skipButton('Skip Credits')).toBeInTheDocument();
    // Only the queue is asked: Lumen never plays an episode that isn't in it.
    expect(player.client.requests.some((r) => r.url.includes('/Shows/'))).toBe(false);
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

describe('watching together', () => {
  const withCredits = { segments: { Items: [INTRO, CREDITS] }, queue: [NEXT], group: true };

  it('has no countdown and never starts the next episode by itself: only Play now and Watch credits', async () => {
    const player = await setUp(withCredits);
    await player.at(3_510_000);

    expect(card()).toHaveTextContent('S1 · E3 · The Long Night');
    expect(card()).not.toHaveTextContent('Playing in');
    expect(screen.getByRole('button', { name: 'Watch credits' })).toBeInTheDocument();
    await player.playFor(15_000);
    expect(player.manager.nextTrack).not.toHaveBeenCalled();
    expect(card()).toBeInTheDocument();

    // A press is the member's own doing, for the group.
    fireEvent.click(screen.getByRole('button', { name: 'Play now' }));
    expect(player.manager.nextTrack).toHaveBeenCalledTimes(1);
  });

  it('has no countdown to the end without credits either', async () => {
    const player = await setUp({ queue: [NEXT], group: true });
    await player.at(HOUR - 20_000);
    expect(card()).toBeInTheDocument();
    expect(card()).not.toHaveTextContent('Playing in');
  });

  it('doesn’t skip a segment set to skip itself: it gets the Skip button, for a member to press', async () => {
    const player = await setUp({ settings: { segmentTypeAction__Intro: 'Skip' }, group: true });
    await player.at(59_800);
    await player.at(60_050);
    await player.playFor(3000);

    expect(player.seek).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();

    fireEvent.click(skipButton()!);
    expect(player.seek).toHaveBeenCalledExactlyOnceWith(150_000);
  });

  it('makes no seek of its own where jellyfin-web was to skip and didn’t', async () => {
    const player = await setUp({
      settings: { segmentTypeAction__Intro: 'Skip' },
      hasSegments: true,
      group: true,
    });
    await player.at(59_800);
    await player.at(60_050);
    await player.playFor(3000);

    expect(player.seek).not.toHaveBeenCalled();
    expect(skipButton()).toBeInTheDocument();
  });

  it('still says what jellyfin-web skipped, with an Undo to press', async () => {
    const player = await setUp({
      settings: { segmentTypeAction__Intro: 'Skip' },
      hasSegments: true,
      group: true,
    });
    await player.at(59_800);
    await player.at(60_050);
    await player.at(150_000);

    expect(player.seek).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Skipped intro');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(player.seek).toHaveBeenCalledExactlyOnceWith(60_300);
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
