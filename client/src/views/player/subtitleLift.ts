import { STOCK_SELECTORS } from '../../compat/registry';

/**
 * Subtitles move up while the controls show, just clear of the bottom bar, and back down as it hides
 * (player-controls.css, which moves them by --lmn-subtitle-lift). jellyfin-web draws text subtitles one of two ways
 * (htmlVideoPlayer, subtitleStyles.ts useCustomSubtitles), set by its subtitle settings and the browser:
 * - its own element, .videoSubtitles (fixed to the foot of the screen, or the top) round .videoSubtitlesInner, whose
 *   margin is the user's vertical position: Firefox, Safari, Edge, webOS and Tizen by default, anywhere with "Custom";
 * - the browser's own, with each cue's `line` set to the user's position, counted in lines from the foot (negative) or
 *   the top: Chromium by default. A cue can't be moved itself; Chromium's box of them can (::-webkit-media-text-track-
 *   container). In Firefox or Safari set to "Native" they stay where they are.
 * Either way they move only as far as the bar needs, from where the user put them: up to the bar from the foot, not at
 * all from higher up or the top. ASS and PGS subtitles are drawn on a canvas over the whole picture, with their own
 * placement (signs and lyrics across the picture, not only lines at the foot), and stay where they are.
 */

/**
 * The height of a line of the browser's own cues, as a share of the video's height: Chromium sizes their text at 5% of
 * it (TextTrackContainer). A line is a little taller than its text; counting the text alone errs towards a few pixels
 * more lift, never towards the bar covering them.
 */
const NATIVE_LINE = 0.05;

/**
 * How far above the foot of the screen the subtitles rest, in px (their lowest line's foot), where the bar could cover
 * them; null with none showing, or none it could (placed from the top).
 */
export function restingSubtitles(doc: Document = document): number | null {
  const box = doc.querySelector<HTMLElement>(STOCK_SELECTORS.videoSubtitles.selector);
  const inner = box?.querySelector<HTMLElement>(STOCK_SELECTORS.videoSubtitlesInner.selector);
  // Laid out without the lift (offsetTop ignores transforms): its foot, from the foot of the screen.
  if (box && inner)
    return doc.documentElement.clientHeight - box.offsetTop - inner.offsetTop - inner.offsetHeight;
  const video = doc.querySelector<HTMLVideoElement>('video.htmlvideoplayer');
  const tracks = video?.textTracks;
  for (let i = 0; tracks && i < tracks.length; i++) {
    const track = tracks[i]!;
    if (track.mode !== 'showing' || !track.cues?.length) continue;
    const line = (track.cues[0] as VTTCue).line;
    if (line === 'auto') return 0;
    return typeof line === 'number' && line < 0 ? (-line - 1) * NATIVE_LINE * video!.clientHeight : null;
  }
  return null;
}

/** How far to move them: up to `barPx` (the bar's height, with a gap) from where they rest, never down. */
export function subtitleLift(barPx: number, resting: number | null): number {
  return resting === null ? 0 : Math.max(0, Math.round(barPx - resting));
}
