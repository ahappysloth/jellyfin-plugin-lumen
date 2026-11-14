/**
 * What happened with a title's trailer on this device, for the Trailer section of its Media info
 * (views/trailerInfo/TrailerInfo.tsx): the last attempt per title in this browser session, in sessionStorage, as each
 * way of playing it was tried. Written by the trailer previews (this file is part of their chunk), read by the Trailer
 * section's chunk, which repeats the key (both are checked against each other in trailerLog.test.ts) rather than
 * import this file: that would make a third file both chunks share.
 */
import { useState } from 'preact/hooks';
import { getLayout } from '../../compat/jellyfin';

/** Where an attempt played from, or 'lookup' for asking the server which trailer a details page has. */
export type TrailerStepSource = 'local' | 'imdb' | 'youtube' | 'lookup';

/**
 * - pending: asked to play, not under way yet (still loading, or the page left before it got going)
 * - played: under way (`ms` after it was asked to play)
 * - error: the <video> or the YouTube player reported an error (`code`, `message`)
 * - timeout: not under way after TRAILER_START_TIMEOUT_MS
 * - blocked: the browser refused to start it (autoplay policy, Low Power Mode)
 * - unsupported: a local trailer this browser can't play, nor the server convert for it
 * - skipped: not tried (`message` says why: 'tv', YouTube's player isn't used in the TV layout)
 * - none: the server's answer had nothing to play
 */
export type TrailerStepOutcome =
  'pending' | 'played' | 'error' | 'timeout' | 'blocked' | 'unsupported' | 'skipped' | 'none';

export interface TrailerStep {
  source: TrailerStepSource;
  /**
   * IMDb: the file's quality as tried ('1080p' for its 1080p one; the first one's, '720p' or another, once its picture
   * has loaded; none for one that failed before that); a local trailer: 'direct', 'hls' or 'mp4' (trailerStream.ts).
   */
  quality?: string;
  outcome: TrailerStepOutcome;
  /** MediaError.code, or YouTube's player error (2, 5, 100, 101, 150…). */
  code?: number;
  message?: string;
  /** Milliseconds from being asked to play until under way. */
  ms?: number;
}

export interface TrailerAttempt {
  /** When it began (Date.now()). */
  at: number;
  tv?: boolean;
  steps: TrailerStep[];
}

export const TRAILER_LOG_KEY = 'lumen-trailer-log';
/** Titles remembered, the most recent kept. */
export const MAX_TITLES = 30;
/** Steps kept per attempt: a preview let go out of view and back starts a new one each time. */
export const MAX_STEPS = 8;

type Log = Record<string, TrailerAttempt>;

function read(): Log {
  try {
    const value = JSON.parse(sessionStorage.getItem(TRAILER_LOG_KEY) ?? '{}') as unknown;
    return value && typeof value === 'object' ? (value as Log) : {};
  } catch {
    return {};
  }
}

/** One title's attempt: steps are added, then changed in place and saved, as they play out. */
export interface TrailerLogger {
  add(step: TrailerStep): TrailerStep;
  /** Changes a step that hasn't ended yet (a pending one), and saves. */
  end(step: TrailerStep, change: Partial<TrailerStep>): void;
}

/**
 * A new attempt for the title `key` (a library item's id), or null without one. Nothing is stored until its first step:
 * a preview that never got as far as playing (a hero slide swiped past) leaves the last real attempt as it was.
 */
export function trailerLogger(key: string | null | undefined, tv: boolean): TrailerLogger | null {
  if (!key) return null;
  const attempt: TrailerAttempt = { at: Date.now(), tv: tv || undefined, steps: [] };
  const save = (): void => {
    try {
      // The other titles' latest, oldest first, then this one's.
      const log = read();
      const kept: Log = {};
      for (const other of Object.keys(log)
        .filter((k) => k !== key)
        .slice(1 - MAX_TITLES))
        kept[other] = log[other]!;
      kept[key] = attempt;
      sessionStorage.setItem(TRAILER_LOG_KEY, JSON.stringify(kept));
    } catch {
      // storage full or refused: the Trailer section says nothing was played here
    }
  };
  return {
    add(step) {
      attempt.steps.push(step);
      if (attempt.steps.length > MAX_STEPS) attempt.steps.shift();
      save();
      return step;
    },
    end(step, change) {
      if (step.outcome !== 'pending') return;
      Object.assign(step, change);
      if (step.message && step.message.length > 120) step.message = step.message.slice(0, 120);
      save();
    },
  };
}

/** The attempt a preview notes its steps in: the one it's given, else its own for `key`, made once. */
export function useTrailerLog(
  log: TrailerLogger | null | undefined,
  key: string | null | undefined,
): TrailerLogger | null {
  const [mine] = useState(() => log ?? trailerLogger(key, getLayout() === 'tv'));
  return mine;
}
