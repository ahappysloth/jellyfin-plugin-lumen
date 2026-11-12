import { formatNumber } from '../util/locale';
import type { StorageBucket } from './adminApi';

/** How the Storage card writes sizes, bitrates and bucket names. */

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

/** Decimal units, as drives are sold and as `df -H` counts: "412 GB", "1.2 TB", "45.3 GB". */
export function formatBytes(bytes: number, win: Window = window): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1000 && unit < SIZE_UNITS.length - 1) {
    value /= 1000;
    unit++;
  }
  // One decimal below 100 (but none for bytes), so neighbouring sizes stay comparable without noise.
  const rounded = unit === 0 || value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  // 999.96 GB rounds to 1000.0: carry it into the next unit.
  if (rounded >= 1000 && unit < SIZE_UNITS.length - 1) return formatBytes(1000 ** (unit + 1), win);
  return `${formatNumber(rounded, win)} ${SIZE_UNITS[unit]}`;
}

/** "38.1 Mb/s", or "850 kb/s" below a megabit. */
export function formatBitrate(bitsPerSecond: number, win: Window = window): string {
  if (bitsPerSecond < 1_000_000) return `${formatNumber(Math.round(bitsPerSecond / 1000), win)} kb/s`;
  const mbps = bitsPerSecond / 1_000_000;
  return `${formatNumber(mbps >= 100 ? Math.round(mbps) : Math.round(mbps * 10) / 10, win)} Mb/s`;
}

export function formatFiles(files: number, win: Window = window): string {
  return `${formatNumber(files, win)} ${files === 1 ? 'file' : 'files'}`;
}

const CODEC_LABELS: Record<string, string> = {
  H264: 'H.264',
  HEVC: 'HEVC',
  AV1: 'AV1',
  Other: 'Other',
  Unknown: 'Not probed',
};

export const codecLabel = (key: string): string => CODEC_LABELS[key] ?? key;

/** Resolution keys are already their labels (SD, 720p, 1080p, 4K), except Unknown. */
export const resolutionLabel = (key: string): string => (key === 'Unknown' ? 'Not probed' : key);

/** ffprobe's codec names that aren't just their upper case. */
const CODEC_NAMES: Record<string, string> = {
  mpeg2video: 'MPEG-2',
  mpeg1video: 'MPEG-1',
  mpeg4: 'MPEG-4',
  msmpeg4v3: 'DivX 3',
  vc1: 'VC-1',
  wmv3: 'WMV 9',
  prores: 'ProRes',
};

/** A file's codec: the bucket's name, or for Other, the codec itself ("VP9", "MPEG-2"). */
export function fileCodecLabel(key: string, codecName: string | null): string {
  if (key !== 'Other' || !codecName) return codecLabel(key);
  return CODEC_NAMES[codecName.toLowerCase()] ?? codecName.toUpperCase();
}

/**
 * Each bucket's share of the whole, in percent, by size; by file count when no size is known (all .strm files).
 * Rounded so they add up to 100 (largest remainder).
 */
export function shares(buckets: StorageBucket[]): number[] {
  const bySize = buckets.some((b) => b.Size > 0);
  const values = buckets.map((b) => (bySize ? b.Size : b.Files));
  const total = values.reduce((sum, v) => sum + v, 0);
  if (total === 0) return values.map(() => 0);
  const exact = values.map((v) => (v / total) * 100);
  const floored = exact.map(Math.floor);
  let left = 100 - floored.reduce((sum, v) => sum + v, 0);
  const order = exact.map((v, i) => ({ i, rest: v - floored[i]! })).sort((a, b) => b.rest - a.rest);
  for (const { i } of order) {
    if (left <= 0) break;
    floored[i]!++;
    left--;
  }
  return floored;
}

/**
 * A series' codec mix by size, largest first: "H.264 86% · VP9 14%" (at most three). Its buckets are the codec keys,
 * except that an uncommon codec comes as ffprobe names it ("vp9") rather than as Other.
 */
export function codecMix(buckets: StorageBucket[]): string {
  const percent = shares(buckets);
  return buckets
    .map((b, i) => ({
      label: Object.prototype.hasOwnProperty.call(CODEC_LABELS, b.Key)
        ? codecLabel(b.Key)
        : fileCodecLabel('Other', b.Key),
      share: percent[i]!,
    }))
    .filter((b) => b.share > 0)
    .slice(0, 3)
    .map((b) => (buckets.length === 1 ? b.label : `${b.label} ${b.share}%`))
    .join(' · ');
}
