/**
 * Media segments: the parts of a video the server knows by name (intro, recap, credits, preview, ads), from whichever
 * segment provider it runs. The rules behind the player's Skip button and next-episode card (SegmentPrompts.tsx), kept apart
 * from the component so they can be tested on their own: what the user asked for each type of segment, when the button
 * shows, when a segment skips itself, and when the card comes up. jellyfin-web's names for all of it are in
 * compat/registry.ts MEDIA_SEGMENTS.
 */
import { MEDIA_SEGMENTS } from '../../compat/registry';

export type SegmentType = (typeof MEDIA_SEGMENTS.types)[number];
/** What jellyfin-web's Playback settings offer for each type: None, AskToSkip or Skip. */
export type SegmentAction = (typeof MEDIA_SEGMENTS.actions)[number];
export type SegmentActions = Record<SegmentType, SegmentAction>;

export interface Segment {
  type: SegmentType;
  startMs: number;
  endMs: number;
}

const TICKS_PER_MS = 10_000;
const known = (list: readonly string[], value: unknown): boolean => list.includes(value as string);

/**
 * The segments in GET /MediaSegments/{itemId}'s answer, in playing order; null when it isn't the answer Lumen knows
 * (then the prompts stay jellyfin-web's). Types Lumen has no button for ("Unknown") and segments without a length are
 * left out.
 */
export function parseSegments(body: unknown): Segment[] | null {
  const items = body && (body as { Items?: unknown }).Items;
  if (!Array.isArray(items)) return null;
  const segments: Segment[] = [];
  for (const item of items as ({ Type?: unknown; StartTicks?: unknown; EndTicks?: unknown } | null)[]) {
    const { Type, StartTicks, EndTicks } = item || {};
    if (typeof StartTicks === 'number' && typeof EndTicks === 'number' && EndTicks > StartTicks)
      if (known(MEDIA_SEGMENTS.types, Type))
        segments.push({
          type: Type as SegmentType,
          startMs: StartTicks / TICKS_PER_MS,
          endMs: EndTicks / TICKS_PER_MS,
        });
  }
  return segments.sort((a, b) => a.startMs - b.startMs);
}

/**
 * What the user chose for each type of segment, read with `read` from jellyfin-web's settings (by setting name), with
 * jellyfin-web's defaults for the ones never set: intros and credits ask, the rest do nothing. Null when a setting holds
 * something else: a jellyfin-web that has changed what the settings mean, which Lumen then leaves to it.
 */
export function readActions(read: (name: string) => string | null): SegmentActions | null {
  const actions = {} as SegmentActions;
  for (const type of MEDIA_SEGMENTS.types) {
    const action =
      read(MEDIA_SEGMENTS.settingPrefix + type) ||
      (known(MEDIA_SEGMENTS.askByDefault, type) ? 'AskToSkip' : 'None');
    if (!known(MEDIA_SEGMENTS.actions, action)) return null;
    actions[type] = action as SegmentAction;
  }
  return actions;
}

/** The Skip button goes this long before its segment ends: too late to be worth a press (and jellyfin-web's limit). */
export const PROMPT_END_MS = 3000;

/** The segment the Skip button is for at `posMs`, among those that ask: from its start until shortly before its end. */
export function promptSegment(
  segments: Segment[],
  asks: (segment: Segment) => boolean,
  posMs: number,
): Segment | null {
  return segments.find((s) => asks(s) && posMs >= s.startMs && posMs < s.endMs - PROMPT_END_MS) ?? null;
}

/** A segment isn't skipped with less than this left of it (jellyfin-web leaves segments under a second alone too). */
export const SKIP_END_MS = 1000;
/** A seek has landed on a segment's end when the position is this close to it. */
const LANDED_MS = 1000;
/** How close before a segment the position was for a jump to its end to count as jellyfin-web's skip. */
const NEAR_MS = 1500;
/**
 * How far playback may run into a segment jellyfin-web was expected to skip before Lumen skips it instead. By the
 * position, not the clock: while a converted stream restarts at the segment's end, the position stands still.
 */
export const BACKSTOP_MS = 1500;
/** How long Lumen waits to see jellyfin-web's skip land (a stream restart can take a while). */
const WAIT_MAX_MS = 15_000;

export interface SkipState {
  /** The position at the last look; -1 before the first. */
  prevMs: number;
  /** A segment jellyfin-web is expected to skip: where playback was when Lumen first saw it there, and when. */
  waiting: { segment: Segment; fromMs: number; since: number } | null;
}
export const SKIP_START: SkipState = { prevMs: -1, waiting: null };

export interface SkipStep {
  state: SkipState;
  /** Where to seek now: Lumen makes this skip itself. */
  seekMs?: number;
  /** A segment that has just been skipped, by this seek or by jellyfin-web, and where from (for Undo). */
  skipped?: { segment: Segment; fromMs: number };
  /** A segment the user seeked back into: left to play, with the Skip button from now on. */
  asks?: Segment;
}

/**
 * One look at the position (every poll) for the segments set to "Skip" that haven't been skipped yet (`skips`).
 *
 * jellyfin-web's own segment manager keeps running under Lumen's player and can't be switched off: where the media
 * source says it has segments (`stockSkips`), it seeks to the segment's end as the first `timeupdate` inside it
 * arrives, before Lumen's poll sees the position. So Lumen doesn't seek as well (two seeks restart a converted stream
 * twice): it watches for that skip to land and says "Skipped intro". It seeks itself where jellyfin-web won't (no
 * flag), or hasn't by the time playback is BACKSTOP_MS into the segment.
 *
 * As in jellyfin-web, a segment the user seeks back into isn't skipped again (it only asks), and one that playback
 * starts inside is.
 */
export function autoSkip(
  state: SkipState,
  posMs: number,
  now: number,
  skips: Segment[],
  stockSkips: boolean,
): SkipStep {
  const { prevMs } = state;
  const waiting = state.waiting && now - state.waiting.since < WAIT_MAX_MS ? state.waiting : null;
  const settled: SkipState = { prevMs: posMs, waiting: null };
  for (const segment of skips) {
    if (Math.abs(posMs - segment.endMs) >= LANDED_MS) continue;
    if (waiting?.segment === segment) return { state: settled, skipped: { segment, fromMs: waiting.fromMs } };
    // Not played up to: a jump from just before the segment, or from inside it.
    const jumped = posMs - prevMs > SKIP_END_MS;
    if (jumped && prevMs >= segment.startMs - NEAR_MS && prevMs < segment.endMs - SKIP_END_MS)
      return { state: settled, skipped: { segment, fromMs: Math.max(prevMs, segment.startMs) } };
  }
  const segment = skips.find((s) => posMs >= s.startMs && posMs < s.endMs - SKIP_END_MS);
  if (!segment) return { state: { prevMs: posMs, waiting } };
  let fromMs = posMs;
  if (waiting?.segment === segment) {
    if (posMs - waiting.fromMs < BACKSTOP_MS) return { state: { prevMs: posMs, waiting } };
    fromMs = waiting.fromMs;
  } else {
    if (prevMs > segment.startMs) return { state: settled, asks: segment };
    if (stockSkips) return { state: { prevMs: posMs, waiting: { segment, fromMs: posMs, since: now } } };
  }
  return { state: settled, seekMs: segment.endMs, skipped: { segment, fromMs } };
}

/**
 * Undo goes back to where the skip began, but never to the segment's very start: a position that reads a hair before
 * it would have jellyfin-web's segment manager skip it again as it plays in.
 */
export const UNDO_INTO_MS = 300;
export const undoTarget = (skipped: { segment: Segment; fromMs: number }): number =>
  Math.max(skipped.fromMs, skipped.segment.startMs + UNDO_INTO_MS);

/** Without credits to go by, the next-episode card comes up for the last 30 s (jellyfin-web's: 30 to 40 s). */
export const CARD_TAIL_MS = 30_000;
/** From the start of the credits, the next episode starts after this long. */
export const COUNTDOWN_MS = 10_000;
/** Credits count as running to the end when they stop this close to it (a few black frames, a logo). */
export const CREDITS_END_MS = 3000;
/** As a skip (skip.ts END_MARGIN_MS): how close to the end the video is left to finish by itself. */
const END_MARGIN_MS = 1000;

/** The credits that run to the end of the video, unless the user has credits set to do nothing. */
export function endCredits(
  segments: Segment[],
  action: (segment: Segment) => SegmentAction,
  durationMs: number,
): Segment | null {
  return (
    segments.find(
      (s) => s.type === 'Outro' && action(s) !== 'None' && s.endMs >= durationMs - CREDITS_END_MS,
    ) ?? null
  );
}

export interface CardPlan {
  /** The card is up from here on. */
  fromMs: number;
  /** It came up with the credits: with autoplay, the next episode starts in their place after COUNTDOWN_MS. */
  credits: boolean;
}

/**
 * When the next-episode card shows for a video `durationMs` long:
 * - from the start of the credits that run to its end. Not while those credits are set to "Skip": they skip themselves.
 * - with no such credits, for the last 30 s (the second half of anything under a minute), or what is left after
 *   credits that stop short of the end (those get the Skip button).
 * `action` is what each segment does now: the user's setting, or AskToSkip for one that was seeked back into.
 */
export function cardPlan(
  segments: Segment[],
  action: (segment: Segment) => SegmentAction,
  durationMs: number,
): CardPlan | null {
  if (!(durationMs > 0)) return null;
  const credits = endCredits(segments, action, durationMs);
  if (credits) return action(credits) === 'Skip' ? null : { fromMs: credits.startMs, credits: true };
  let fromMs = Math.max(durationMs - CARD_TAIL_MS, durationMs / 2);
  for (const s of segments)
    if (s.type === 'Outro' && action(s) !== 'None') fromMs = Math.max(fromMs, s.endMs);
  return { fromMs, credits: false };
}

/**
 * The credits card's countdown, one look on: what is left of it (`leftMs`; null as the card comes up, which starts it
 * at COUNTDOWN_MS) less the time since the last look. By the clock, not the position: a skip forward in the credits
 * doesn't cut it short. It stands still while the video is paused, and a look that comes late (a background tab's
 * timers) counts as a second at most.
 */
export function countDown(leftMs: number | null, elapsedMs: number, paused: boolean): number {
  return (leftMs ?? COUNTDOWN_MS) - (leftMs === null || paused ? 0 : Math.min(Math.max(elapsedMs, 0), 1000));
}

/**
 * The seconds the card shows, "Playing in 7": what is left of the credits' countdown (`leftMs`), or of the video where
 * that is less or there is no countdown (null: this episode plays out, and jellyfin-web starts the next).
 */
export function secondsLeft(leftMs: number | null, posMs: number, durationMs: number): number {
  const toEnd = durationMs - posMs;
  return Math.max(0, Math.ceil((leftMs === null ? toEnd : Math.min(leftMs, toEnd)) / 1000));
}

/**
 * Where a press on Skip (or a segment skipping itself) seeks: the segment's end, or just short of the video's, which
 * is left to finish by itself (it then counts as watched, and the next episode follows as after any other).
 */
export function skipTo(segment: Segment, durationMs: number): number {
  return durationMs > 0 ? Math.min(segment.endMs, durationMs - END_MARGIN_MS) : segment.endMs;
}
