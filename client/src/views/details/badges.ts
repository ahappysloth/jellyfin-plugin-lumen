import type { BaseItem, MediaStream } from '../../api/types';

const TICKS_PER_MINUTE = 600_000_000;

export function deriveBadges(streams: MediaStream[] | undefined): string[] {
  const badges: string[] = [];
  const video = streams?.find((s) => s.Type === 'Video');
  const audio = streams?.filter((s) => s.Type === 'Audio') ?? [];

  if ((video?.Width ?? 0) >= 3800 || (video?.Height ?? 0) >= 2100) badges.push('4K');
  else if ((video?.Width ?? 0) >= 1900 || (video?.Height ?? 0) >= 1000) badges.push('HD');

  const rangeType = video?.VideoRangeType ?? '';
  if (/^DOVI/i.test(rangeType)) badges.push('Dolby Vision');
  else if (video?.VideoRange === 'HDR' || /HDR10|HLG/i.test(rangeType)) badges.push('HDR');

  if (audio.some((a) => /atmos/i.test(`${a.Profile ?? ''} ${a.DisplayTitle ?? ''} ${a.Title ?? ''}`)))
    badges.push('Atmos');
  else if (audio.some((a) => (a.Channels ?? 0) >= 6)) badges.push('5.1');

  return badges;
}

export function formatRuntime(ticks: number | undefined): string | null {
  if (!ticks) return null;
  const minutes = Math.round(ticks / TICKS_PER_MINUTE);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

export function metaFor(item: BaseItem): string[] {
  return [
    item.ProductionYear?.toString(),
    item.OfficialRating,
    formatRuntime(item.RunTimeTicks) ?? undefined,
  ].filter((value): value is string => !!value);
}
