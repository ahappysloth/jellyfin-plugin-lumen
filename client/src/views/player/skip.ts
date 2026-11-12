/**
 * The player's skips: the 10-second buttons, a double tap at the picture's sides, and the arrow keys (J and L too).
 * jellyfin-web's own rewind and fastForward go by the user's skip lengths (10 s back and 30 s forward by default), which
 * Lumen leaves alone: they are the user's settings for every Jellyfin app. Lumen seeks to the position ± 10 s instead,
 * through the playback manager, which restarts a converted stream at the new position where the player can't seek in it.
 */

/** How far a skip goes, each way. */
export const SKIP_MS = 10_000;
/**
 * How far short of the end a skip forward stops: a seek to the very end ends the item at once, which a skip shouldn't
 * (the end credits and Up next still play out).
 */
export const END_MARGIN_MS = 1000;

/** Where a skip from `fromMs` lands: 10 s on or back, within the title (and never back, going forward). */
export function skipTarget(fromMs: number, durationMs: number, direction: 'back' | 'forward'): number {
  if (direction === 'back') return Math.max(0, fromMs - SKIP_MS);
  const to = fromMs + SKIP_MS;
  return durationMs > 0 ? Math.max(fromMs, Math.min(to, durationMs - END_MARGIN_MS)) : to;
}

/** The keys that skip (outside the TV layout, where the arrows move focus), as jellyfin-web's shortcuts have them. */
export const SKIP_KEYS: Readonly<Record<string, 'back' | 'forward'>> = {
  ArrowLeft: 'back',
  Left: 'back',
  j: 'back',
  ArrowRight: 'forward',
  Right: 'forward',
  l: 'forward',
};
