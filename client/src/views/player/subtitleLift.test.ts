import { afterEach, describe, expect, it } from 'vitest';
import { restingSubtitles, subtitleLift } from './subtitleLift';

/** Pins an element's layout box (jsdom lays nothing out). */
function box(
  el: HTMLElement,
  layout: { offsetTop?: number; offsetHeight?: number; clientHeight?: number },
): void {
  for (const [key, value] of Object.entries(layout))
    Object.defineProperty(el, key, { value, configurable: true });
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('subtitleLift', () => {
  it('moves them up just as far as the bar reaches past where they rest, never down', () => {
    expect(subtitleLift(120, 90)).toBe(30);
    expect(subtitleLift(120.4, 90)).toBe(30);
    // Put higher up by the user, or at the top: they stay.
    expect(subtitleLift(120, 300)).toBe(0);
    // None showing (or drawn on a canvas): nothing to move.
    expect(subtitleLift(120, null)).toBe(0);
  });
});

describe('restingSubtitles', () => {
  it("measures jellyfin-web's own element from its layout, which the lift doesn't change", () => {
    box(document.documentElement, { clientHeight: 720 });
    document.body.innerHTML =
      '<div class="videoSubtitles"><div class="videoSubtitlesInner">Hello</div></div>';
    // Fixed to the foot of the screen, 139px tall, its line at the top with the user's margin (3 lines up) below it.
    box(document.querySelector('.videoSubtitles')!, { offsetTop: 581 });
    box(document.querySelector('.videoSubtitlesInner')!, { offsetTop: 0, offsetHeight: 46 });
    expect(restingSubtitles()).toBe(93);
  });

  const nativeTrack = (line: number | 'auto', mode = 'showing') => {
    const video = document.createElement('video');
    video.className = 'htmlvideoplayer';
    box(video, { clientHeight: 1000 });
    const track = { mode, cues: [{ line }], length: 1 };
    Object.defineProperty(video, 'textTracks', { value: Object.assign([track], { length: 1 }) });
    document.body.appendChild(video);
  };

  it("counts the browser's own cues from their line: the foot, lines up from it, or the top", () => {
    nativeTrack(-3); // jellyfin-web's default: two lines above the lowest
    expect(restingSubtitles()).toBe(100);
    document.body.innerHTML = '';
    nativeTrack(-1);
    expect(restingSubtitles()).toBe(0);
    document.body.innerHTML = '';
    nativeTrack('auto');
    expect(restingSubtitles()).toBe(0);
    document.body.innerHTML = '';
    nativeTrack(2); // from the top
    expect(restingSubtitles()).toBeNull();
  });

  it('has nothing to measure with no subtitles on', () => {
    expect(restingSubtitles()).toBeNull();
    nativeTrack(-3, 'disabled');
    expect(restingSubtitles()).toBeNull();
  });
});
