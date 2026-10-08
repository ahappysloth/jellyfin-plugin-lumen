import type { BaseItem } from '../../api/types';
import { playedPercent } from '../../components/ProgressBar';

export interface SmartPlay {
  label: string;
  episodeId: string;
  startTicks?: number;
  progress?: number;
}

export const episodeCode = (episode: BaseItem): string =>
  `S${episode.ParentIndexNumber ?? 0}:E${episode.IndexNumber ?? 0}`;

/** Resume the in-progress episode, else play next up, else start from the first episode. */
export function computeSmartPlay(resume?: BaseItem, nextUp?: BaseItem, first?: BaseItem): SmartPlay | null {
  if (resume) {
    return {
      label: `Resume ${episodeCode(resume)}`,
      episodeId: resume.Id,
      startTicks: resume.UserData?.PlaybackPositionTicks,
      progress: playedPercent(resume),
    };
  }
  if (nextUp) return { label: `Play ${episodeCode(nextUp)}`, episodeId: nextUp.Id };
  if (first) return { label: `Play ${episodeCode(first)}`, episodeId: first.Id };
  return null;
}
