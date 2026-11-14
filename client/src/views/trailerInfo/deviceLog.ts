import type { TrailerAttempt } from '../home/trailerLog';

/**
 * views/home/trailerLog.ts's TRAILER_LOG_KEY, repeated rather than imported: that file is in the trailer preview's chunk,
 * and importing it here would split it into a third file both chunks load (trailerLog.test.ts checks they match).
 */
export const DEVICE_LOG_KEY = 'lumen-trailer-log';

/** The last trailer attempt for the title `key` in this browser session, or null. */
export function lastAttempt(key: string): TrailerAttempt | null {
  try {
    const log = JSON.parse(sessionStorage.getItem(DEVICE_LOG_KEY) ?? '{}') as Record<
      string,
      TrailerAttempt
    > | null;
    const attempt = log?.[key];
    return attempt && Array.isArray(attempt.steps) && attempt.steps.length ? attempt : null;
  } catch {
    return null;
  }
}
