import type { LumenApi } from '../../api/lumenApi';
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

export interface SeriesPlayTarget {
  episodeId: string;
  startTicks?: number;
}

/** The episode a "Play" on a whole series should start: resumable, else next up, else the first regular episode. */
export async function resolveSeriesPlayTarget(
  api: LumenApi,
  seriesId: string,
): Promise<SeriesPlayTarget | null> {
  const empty = { Items: [] as BaseItem[] };
  const [resume, nextUp] = await Promise.all([
    api.getResumeForSeries(seriesId).catch(() => empty),
    api.getNextUp(seriesId).catch(() => empty),
  ]);
  const resumable = resume.Items[0];
  if (resumable) return { episodeId: resumable.Id, startTicks: resumable.UserData?.PlaybackPositionTicks };
  const next = nextUp.Items[0];
  if (next) return { episodeId: next.Id };

  const seasons = (await api.getSeasons(seriesId)).Items;
  const season = seasons.find((s) => (s.IndexNumber ?? 0) > 0) ?? seasons[0];
  if (!season) return null;
  const first = (await api.getEpisodes(seriesId, season.Id)).Items[0];
  return first ? { episodeId: first.Id } : null;
}
