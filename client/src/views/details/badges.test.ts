import { describe, expect, it } from 'vitest';
import { deriveBadges, formatRuntime, metaFor } from './badges';

describe('badges', () => {
  it('derives resolution, dynamic range, and audio badges', () => {
    expect(
      deriveBadges([
        { Type: 'Video', Width: 3840, Height: 2160, VideoRange: 'HDR', VideoRangeType: 'DOVIWithHDR10' },
        { Type: 'Audio', Profile: 'Dolby TrueHD + Dolby Atmos', Channels: 8 },
      ]),
    ).toEqual(['4K', 'Dolby Vision', 'Atmos']);
    expect(
      deriveBadges([
        { Type: 'Video', Width: 1920, VideoRange: 'HDR', VideoRangeType: 'HDR10' },
        { Type: 'Audio', Channels: 6 },
      ]),
    ).toEqual(['HD', 'HDR', '5.1']);
    expect(deriveBadges(undefined)).toEqual([]);
  });

  it('formats runtimes', () => {
    expect(formatRuntime(67_200_000_000)).toBe('1h 52m');
    expect(formatRuntime(27_000_000_000)).toBe('45m');
    expect(formatRuntime(undefined)).toBeNull();
  });

  it('builds the metadata line', () => {
    expect(
      metaFor({
        Id: 'a',
        Name: 'a',
        Type: 'Movie',
        ProductionYear: 2001,
        OfficialRating: 'PG-13',
        RunTimeTicks: 27_000_000_000,
      }),
    ).toEqual(['2001', 'PG-13', '45m']);
  });
});
