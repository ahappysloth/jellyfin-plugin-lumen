import type { TrailerClock } from './TrailerPreview';

/**
 * The home banner's current slide's clock (Hero.tsx): time counted while not paused, and since when it's been counting
 * (null while paused). With a trailer the fill follows (one the slide waits for, or one the viewer is watching), also
 * that trailer: its <video> (or the YouTube player's clock, which reads the same), the fill and the video's time when
 * the fill started following it, where it's got to, and the fill shown.
 */
export interface SlideRun {
  index: number;
  ms: number;
  since: number | null;
  video: TrailerClock | null;
  fill: number;
  time: number;
  position: number;
  duration: number;
  shown: number;
  /** Once the trailer is over or let go: the clock and the fill then, and when (on the clock) the slide changes. */
  over: { ms: number; fill: number; until: number } | null;
}

/**
 * Draws the pager's fill for a trailer it follows, at `ms` on the slide's clock: it grows with the clock, or with the
 * trailer when that will end later (whichever is behind), from where it was when it started following the trailer, so
 * it's full as the slide ends. Once the trailer is over (or let go) it eases to full by the time the slide changes.
 *
 * Here, in the trailer's lazy file rather than Hero.tsx, because it only ever runs once a trailer is under way.
 */
export function drawHeroFill(
  slide: SlideRun,
  ms: number,
  intervalMs: number,
  fill: HTMLElement | null,
): void {
  let shown = Math.min(1, ms / intervalMs);
  const video = slide.video;
  if (slide.over) {
    const { ms: from, fill: at, until } = slide.over;
    shown = at + (1 - at) * Math.min(1, Math.max(0, (ms - from) / (until - from)));
  } else if (video) {
    // A video that's been taken off has been reset: the trailer is where it was last heard of.
    if (video.isConnected) {
      slide.position = video.currentTime;
      if (video.duration < Infinity) slide.duration = video.duration;
    }
    if (slide.duration > slide.time) {
      const played = Math.min(1, Math.max(0, (slide.position - slide.time) / (slide.duration - slide.time)));
      shown = Math.min(shown, slide.fill + (1 - slide.fill) * played);
    }
  }
  slide.shown = shown;
  if (fill) fill.style.transform = `scaleX(${shown})`;
}

/** Notes how far the slide's trailer has got (TrailerPreview's onProgress); `clock` is the fill the clock shows now. */
export function followTrailer(slide: SlideRun, video: TrailerClock, clock: number): void {
  if (slide.video !== video) {
    if (!slide.video) {
      // Under way: the trailer's share of the fill starts from what the clock shows now.
      slide.fill = clock;
      slide.time = video.currentTime;
    } else if (video.currentTime + 1 < slide.position) {
      // Put back, but from the start (it couldn't seek): its share starts over from what the fill shows now.
      slide.fill = slide.shown;
      slide.time = video.currentTime;
    } // else put back where it was: it carries on as before
    slide.video = video;
  }
  slide.position = video.currentTime;
  if (video.duration < Infinity) slide.duration = video.duration;
}
