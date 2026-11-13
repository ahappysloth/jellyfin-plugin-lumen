import { describe, expect, it } from 'vitest';
import {
  autoSkip,
  BACKSTOP_MS,
  CARD_TAIL_MS,
  cardPlan,
  countDown,
  COUNTDOWN_MS,
  endCredits,
  parseSegments,
  PROMPT_END_MS,
  promptSegment,
  readActions,
  RESTART_BACKSTOP_MS,
  secondsLeft,
  SKIP_START,
  skipTo,
  undoTarget,
  type Segment,
  type SegmentAction,
  type SkipState,
} from './segments';

const TICKS = 10_000_000;
const intro: Segment = { type: 'Intro', startMs: 60_000, endMs: 150_000 };
const HOUR = 3_600_000;

describe('parseSegments', () => {
  it('reads the server’s segments, in ticks, into playing order', () => {
    const body = {
      Items: [
        { Id: 'b', ItemId: 'i', Type: 'Outro', StartTicks: 3000 * TICKS, EndTicks: 3600 * TICKS },
        { Id: 'a', ItemId: 'i', Type: 'Intro', StartTicks: 60 * TICKS, EndTicks: 150 * TICKS },
      ],
      TotalRecordCount: 2,
    };
    expect(parseSegments(body)).toEqual([intro, { type: 'Outro', startMs: 3_000_000, endMs: HOUR }]);
  });

  it('is an empty list for an item without segments', () => {
    expect(parseSegments({ Items: [], TotalRecordCount: 0, StartIndex: 0 })).toEqual([]);
  });

  it('leaves out types it has no button for and segments without a length', () => {
    const body = {
      Items: [
        { Type: 'Unknown', StartTicks: 0, EndTicks: 10 * TICKS },
        { Type: 'Intro', StartTicks: 10 * TICKS, EndTicks: 10 * TICKS },
        { Type: 'Recap', StartTicks: 10 * TICKS },
        null,
        { Type: 'Commercial', StartTicks: 20 * TICKS, EndTicks: 50 * TICKS },
      ],
    };
    expect(parseSegments(body)).toEqual([{ type: 'Commercial', startMs: 20_000, endMs: 50_000 }]);
  });

  it('is null for anything that isn’t the answer Lumen knows: the prompts stay jellyfin-web’s', () => {
    expect(parseSegments(null)).toBeNull();
    expect(parseSegments('<html>')).toBeNull();
    expect(parseSegments({ items: [] })).toBeNull();
    expect(parseSegments({ Items: {} })).toBeNull();
  });
});

describe('readActions', () => {
  const stored =
    (values: Record<string, string>) =>
    (name: string): string | null =>
      values[name] ?? null;

  it('uses jellyfin-web’s defaults for what was never set: intros and credits ask, the rest do nothing', () => {
    expect(readActions(stored({}))).toEqual({
      Intro: 'AskToSkip',
      Recap: 'None',
      Outro: 'AskToSkip',
      Preview: 'None',
      Commercial: 'None',
    });
  });

  it('reads each type’s setting under jellyfin-web’s name for it', () => {
    const actions = readActions(
      stored({
        segmentTypeAction__Intro: 'Skip',
        segmentTypeAction__Recap: 'AskToSkip',
        segmentTypeAction__Outro: 'None',
        segmentTypeAction__Commercial: 'Skip',
      }),
    );
    expect(actions).toEqual({
      Intro: 'Skip',
      Recap: 'AskToSkip',
      Outro: 'None',
      Preview: 'None',
      Commercial: 'Skip',
    });
  });

  it('treats an empty setting as unset', () => {
    expect(readActions(stored({ segmentTypeAction__Intro: '' }))?.Intro).toBe('AskToSkip');
  });

  it('is null for a value Lumen doesn’t know, which leaves the prompts to jellyfin-web', () => {
    expect(readActions(stored({ segmentTypeAction__Preview: 'SkipOnce' }))).toBeNull();
  });
});

describe('promptSegment', () => {
  const recap: Segment = { type: 'Recap', startMs: 0, endMs: 50_000 };
  const asks = (): boolean => true;

  it('is the segment the position is in, from its first moment', () => {
    expect(promptSegment([recap, intro], asks, 59_999)).toBeNull();
    expect(promptSegment([recap, intro], asks, 60_000)).toBe(intro);
    expect(promptSegment([recap, intro], asks, 100_000)).toBe(intro);
    expect(promptSegment([recap, intro], asks, 10_000)).toBe(recap);
  });

  it('goes a few seconds before the segment ends', () => {
    expect(PROMPT_END_MS).toBe(3000);
    expect(promptSegment([intro], asks, 146_999)).toBe(intro);
    expect(promptSegment([intro], asks, 147_000)).toBeNull();
    expect(promptSegment([intro], asks, 150_000)).toBeNull();
  });

  it('never shows for a segment no longer than that', () => {
    const short: Segment = { type: 'Intro', startMs: 10_000, endMs: 13_000 };
    expect(promptSegment([short], asks, 10_000)).toBeNull();
  });

  it('only shows for segments that ask', () => {
    expect(promptSegment([recap, intro], (s) => s.type === 'Intro', 10_000)).toBeNull();
    expect(promptSegment([recap, intro], (s) => s.type === 'Intro', 70_000)).toBe(intro);
  });
});

describe('skipTo', () => {
  it('is the segment’s end', () => {
    expect(skipTo(intro, HOUR)).toBe(150_000);
  });

  it('stops short of the video’s end, which is left to finish by itself', () => {
    expect(skipTo({ type: 'Outro', startMs: 3_300_000, endMs: HOUR }, HOUR)).toBe(HOUR - 1000);
    expect(skipTo({ type: 'Outro', startMs: 3_300_000, endMs: HOUR + 400 }, HOUR)).toBe(HOUR - 1000);
  });
});

describe('autoSkip', () => {
  /** Looks at each position in turn, 250 ms apart, and collects what happened. */
  const run = (
    positions: number[],
    /** jellyfin-web skips too (how far Lumen lets playback run into the segment first), or doesn't. */
    stock: boolean | number,
    start: SkipState = SKIP_START,
    skips = [intro],
  ) => {
    const backstopMs = stock === true ? BACKSTOP_MS : Number(stock);
    let state = start;
    const seeks: number[] = [];
    const skipped: { segment: Segment; fromMs: number }[] = [];
    const asks: Segment[] = [];
    positions.forEach((pos, i) => {
      const step = autoSkip(
        state,
        pos,
        i * 250,
        skips.filter((s) => !asks.includes(s) && !skipped.some((k) => k.segment === s)),
        backstopMs,
      );
      state = step.state;
      if (step.seekMs !== undefined) seeks.push(step.seekMs);
      if (step.skipped) skipped.push(step.skipped);
      if (step.asks) asks.push(step.asks);
    });
    return { state, seeks, skipped, asks };
  };

  it('does nothing outside the segment', () => {
    expect(run([10_000, 10_250, 59_900], false)).toMatchObject({ seeks: [], skipped: [], asks: [] });
    expect(run([150_000, 150_250, 200_000], false)).toMatchObject({ seeks: [], skipped: [], asks: [] });
  });

  it('skips to the segment’s end as playback enters it, once', () => {
    const result = run([59_800, 60_050, 150_000, 150_250], false);
    expect(result.seeks).toEqual([150_000]);
    expect(result.skipped).toEqual([{ segment: intro, fromMs: 60_050 }]);
  });

  it('skips a segment playback starts inside (a resume), and one seeked forward into', () => {
    expect(run([75_000], false).seeks).toEqual([150_000]);
    expect(run([10_000, 10_250, 90_000], false).seeks).toEqual([150_000]);
  });

  it('leaves a segment the user seeked back into, which asks from then on', () => {
    const result = run([200_000, 200_250, 80_000, 80_250, 80_500], false);
    expect(result.seeks).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.asks).toEqual([intro]);
  });

  it('leaves the last second of a segment alone', () => {
    expect(run([149_100, 149_350], false)).toMatchObject({ seeks: [], skipped: [] });
  });

  describe('with jellyfin-web’s own segment manager skipping too', () => {
    it('doesn’t seek as well: it reports the skip jellyfin-web made', () => {
      // A direct play: the seek shows at once, as where the video is going.
      const direct = run([59_800, 150_000, 150_000, 150_250], true);
      expect(direct.seeks).toEqual([]);
      expect(direct.skipped).toEqual([{ segment: intro, fromMs: 60_000 }]);
      // A converted stream: the position stands still inside the segment until the stream restarts at its end.
      const converted = run([59_800, 60_050, 60_050, 60_050, 60_050, 150_100, 150_350], true);
      expect(converted.seeks).toEqual([]);
      expect(converted.skipped).toEqual([{ segment: intro, fromMs: 60_050 }]);
    });

    it('reports a skip from inside the segment (a resume there)', () => {
      const result = run([75_000, 75_000, 150_200], true);
      expect(result.seeks).toEqual([]);
      expect(result.skipped).toEqual([{ segment: intro, fromMs: 75_000 }]);
    });

    it('skips itself once playback has run on into the segment without jellyfin-web skipping it', () => {
      const positions = [59_800, 60_050, 60_300, 60_550, 60_800, 61_050, 61_300, 61_550, 61_800];
      const result = run(positions, true);
      expect(result.seeks).toEqual([150_000]);
      expect(result.skipped).toEqual([{ segment: intro, fromMs: 60_050 }]);
      // Not before BACKSTOP_MS of the segment have played.
      const before = positions.filter((p) => p < 60_050 + BACKSTOP_MS);
      expect(run(before, true).seeks).toEqual([]);
    });

    it('waits longer where a seek restarts the stream: the old one plays on while jellyfin-web’s is on its way', () => {
      // jellyfin-web asked for the stream from the segment's end as playback entered it; 3 s on, it starts there.
      const playedOn = Array.from({ length: 12 }, (_, i) => 60_050 + i * 250);
      const result = run([59_800, ...playedOn, 150_000, 150_250], RESTART_BACKSTOP_MS);
      expect(result.seeks).toEqual([]);
      expect(result.skipped).toEqual([{ segment: intro, fromMs: 60_050 }]);
      // The shorter wait would have seeked as well, and restarted the stream a second time.
      expect(run([59_800, ...playedOn], true).seeks).toEqual([150_000]);
      // jellyfin-web never skips it: Lumen still does.
      const ignored = Array.from({ length: 34 }, (_, i) => 60_050 + i * 250);
      expect(run([59_800, ...ignored], RESTART_BACKSTOP_MS).seeks).toEqual([150_000]);
    });

    it('doesn’t take playing up to a segment’s end for a skip', () => {
      // A segment that asks isn’t among `skips`; one too short to be "inside" of, played through, is.
      const short: Segment = { type: 'Recap', startMs: 10_000, endMs: 10_800 };
      const result = run([9_500, 9_750, 10_000, 10_250, 10_500, 10_750, 11_000], true, SKIP_START, [short]);
      expect(result).toMatchObject({ seeks: [], skipped: [] });
    });

    it('gives up waiting for a skip that never lands', () => {
      let state = autoSkip(SKIP_START, 60_050, 0, [intro], BACKSTOP_MS).state;
      expect(state.waiting?.segment).toBe(intro);
      // The user went elsewhere; much later the position passes the segment's end by chance.
      state = autoSkip(state, 300_000, 1000, [intro], BACKSTOP_MS).state;
      const late = autoSkip(state, 150_100, 20_000, [intro], BACKSTOP_MS);
      expect(late.skipped).toBeUndefined();
      expect(late.state.waiting).toBeNull();
    });
  });

  it('undoes to where the skip began, a little inside the segment', () => {
    expect(undoTarget({ segment: intro, fromMs: 60_050 })).toBe(60_300);
    expect(undoTarget({ segment: intro, fromMs: 60_000 })).toBe(60_300);
    expect(undoTarget({ segment: intro, fromMs: 75_000 })).toBe(75_000);
  });
});

describe('the next-episode card', () => {
  const by =
    (actions: Partial<Record<Segment['type'], SegmentAction>>) =>
    (s: Segment): SegmentAction =>
      actions[s.type] ?? 'None';
  const credits: Segment = { type: 'Outro', startMs: HOUR - 90_000, endMs: HOUR - 500 };

  it('comes up as the credits start, when they run to the end', () => {
    expect(endCredits([intro, credits], by({ Outro: 'AskToSkip' }), HOUR)).toBe(credits);
    expect(cardPlan([intro, credits], by({ Outro: 'AskToSkip' }), HOUR)).toEqual({
      fromMs: HOUR - 90_000,
      credits: true,
    });
  });

  it('comes up for the last 30 s without credits to go by', () => {
    expect(CARD_TAIL_MS).toBe(30_000);
    expect(cardPlan([intro], by({ Intro: 'AskToSkip' }), HOUR)).toEqual({
      fromMs: HOUR - 30_000,
      credits: false,
    });
    expect(cardPlan([], by({}), HOUR)).toEqual({ fromMs: HOUR - 30_000, credits: false });
  });

  it('goes by the clock when the user has credits set to do nothing', () => {
    expect(endCredits([credits], by({ Outro: 'None' }), HOUR)).toBeNull();
    expect(cardPlan([credits], by({ Outro: 'None' }), HOUR)).toEqual({
      fromMs: HOUR - 30_000,
      credits: false,
    });
  });

  it('stays away while the credits are set to skip themselves', () => {
    expect(cardPlan([credits], by({ Outro: 'Skip' }), HOUR)).toBeNull();
  });

  it('waits for credits that stop short of the end (a scene after them) to pass', () => {
    const early: Segment = { type: 'Outro', startMs: HOUR - 300_000, endMs: HOUR - 120_000 };
    expect(endCredits([early], by({ Outro: 'AskToSkip' }), HOUR)).toBeNull();
    expect(cardPlan([early], by({ Outro: 'AskToSkip' }), HOUR)).toEqual({
      fromMs: HOUR - 30_000,
      credits: false,
    });
    const late: Segment = { type: 'Outro', startMs: HOUR - 120_000, endMs: HOUR - 10_000 };
    expect(cardPlan([late], by({ Outro: 'AskToSkip' }), HOUR)).toEqual({
      fromMs: HOUR - 10_000,
      credits: false,
    });
  });

  it('comes up for the second half of something under a minute, and never without a length', () => {
    expect(cardPlan([], by({}), 15_000)).toEqual({ fromMs: 7_500, credits: false });
    expect(cardPlan([], by({}), 0)).toBeNull();
  });

  describe('its countdown', () => {
    it('starts at 10 s as the card comes up and runs down with the clock', () => {
      expect(COUNTDOWN_MS).toBe(10_000);
      let left = countDown(null, 123_456, false);
      expect(left).toBe(10_000);
      expect(secondsLeft(left, HOUR - 90_000, HOUR)).toBe(10);
      left = countDown(left, 250, false);
      expect(left).toBe(9_750);
      expect(secondsLeft(left, HOUR - 89_750, HOUR)).toBe(10);
      for (let i = 0; i < 39; i++) left = countDown(left, 250, false);
      expect(left).toBe(0);
      expect(secondsLeft(left, HOUR - 80_000, HOUR)).toBe(0);
    });

    it('stands still while the video is paused', () => {
      expect(countDown(6_000, 250, true)).toBe(6_000);
    });

    it('counts a look that comes late as a second at most', () => {
      expect(countDown(6_000, 60_000, false)).toBe(5_000);
    });

    it('shows what is left of the video when that is less, or there is no countdown', () => {
      // Credits shorter than the countdown: the episode ends first.
      expect(secondsLeft(10_000, HOUR - 4_200, HOUR)).toBe(5);
      // No credits to go by: the card counts down to the end, where jellyfin-web starts the next episode.
      expect(secondsLeft(null, HOUR - 28_400, HOUR)).toBe(29);
      expect(secondsLeft(null, HOUR + 200, HOUR)).toBe(0);
    });
  });
});
