import type { SegmentType } from './segments';

/**
 * The Skip button's, the "Skipped" notice's and the next-episode card's strings (see strings.ts). Only SegmentPrompts.tsx's
 * file imports this, so they download with it once a video plays.
 */
/** What each type of segment is called on its button; the notice says it in lower case ("Skipped intro"). */
const NAMES: Record<SegmentType, string> = {
  Intro: 'Intro',
  Recap: 'Recap',
  Outro: 'Credits',
  Preview: 'Preview',
  Commercial: 'Ad',
};

export const segmentStrings = {
  skip: (type: SegmentType) => `Skip ${NAMES[type]}`,
  skipped: (type: SegmentType) => `Skipped ${NAMES[type].toLowerCase()}`,
  undo: 'Undo',
  nextEpisode: 'Next episode',
  playingIn: (seconds: number) => `Playing in ${seconds}`,
  playNow: 'Play now',
  watchCredits: 'Watch credits',
  /** "S2 · E4 · Title"; the name alone for anything unnumbered. */
  episode: (item: { Name?: string; ParentIndexNumber?: number; IndexNumber?: number }) =>
    item.ParentIndexNumber == null || item.IndexNumber == null
      ? (item.Name ?? '')
      : `S${item.ParentIndexNumber} · E${item.IndexNumber} · ${item.Name ?? ''}`,
};
