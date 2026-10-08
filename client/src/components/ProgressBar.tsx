import type { BaseItem } from '../api/types';

export function playedPercent(item: BaseItem): number {
  if (item.UserData?.PlayedPercentage !== undefined) return item.UserData.PlayedPercentage;
  const position = item.UserData?.PlaybackPositionTicks ?? 0;
  return item.RunTimeTicks ? (position / item.RunTimeTicks) * 100 : 0;
}

export function ProgressBar({ percent }: { percent: number }) {
  const value = Math.max(0, Math.min(100, percent));
  return (
    <span
      class="lmn-progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
    >
      <span class="lmn-progress__fill" style={{ width: `${value}%` }} />
    </span>
  );
}
