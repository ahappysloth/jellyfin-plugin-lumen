import type { BaseItem } from '../../api/types';

export interface EpisodeNeighbors {
  previous: BaseItem | null;
  next: BaseItem | null;
}

/**
 * The seasons the previous/next buttons may cross into: neighbours in the server's order. Specials (season 0) are
 * skipped unless the episode is a special itself, so S1E1's previous isn't a special and S2E1's previous is S1's last.
 */
export function adjacentSeasons(
  seasons: BaseItem[],
  seasonId: string,
): { before: BaseItem | null; after: BaseItem | null } {
  const current = seasons.find((s) => s.Id === seasonId);
  const inSpecials = current?.IndexNumber === 0;
  const eligible = seasons.filter((s) => s.Id === seasonId || inSpecials || s.IndexNumber !== 0);
  const at = eligible.findIndex((s) => s.Id === seasonId);
  if (at < 0) return { before: null, after: null };
  return { before: eligible[at - 1] ?? null, after: eligible[at + 1] ?? null };
}

/** Previous and next episode, crossing into the neighbouring seasons' episode lists when given. */
export function episodeNeighbors(
  episodeId: string,
  season: BaseItem[],
  seasonBefore: BaseItem[] = [],
  seasonAfter: BaseItem[] = [],
): EpisodeNeighbors {
  const at = season.findIndex((e) => e.Id === episodeId);
  if (at < 0) return { previous: null, next: null };
  return {
    previous: season[at - 1] ?? seasonBefore[seasonBefore.length - 1] ?? null,
    next: season[at + 1] ?? seasonAfter[0] ?? null,
  };
}
