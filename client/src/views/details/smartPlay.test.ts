import { describe, expect, it } from 'vitest';
import type { BaseItem } from '../../api/types';
import { computeSmartPlay, episodeCode } from './smartPlay';

const ep = (id: string, s: number, e: number, extra: Partial<BaseItem> = {}): BaseItem => ({
  Id: id,
  Name: id,
  Type: 'Episode',
  ParentIndexNumber: s,
  IndexNumber: e,
  ...extra,
});

describe('computeSmartPlay', () => {
  it('prefers resuming, then next up, then the first episode', () => {
    const resume = ep('r', 2, 5, { RunTimeTicks: 100, UserData: { PlaybackPositionTicks: 25 } });
    expect(computeSmartPlay(resume, ep('n', 2, 6), ep('f', 1, 1))).toEqual({
      label: 'Resume S2:E5',
      episodeId: 'r',
      startTicks: 25,
      progress: 25,
    });
    expect(computeSmartPlay(undefined, ep('n', 2, 6), ep('f', 1, 1))).toEqual({
      label: 'Play S2:E6',
      episodeId: 'n',
    });
    expect(computeSmartPlay(undefined, undefined, ep('f', 1, 1))).toEqual({
      label: 'Play S1:E1',
      episodeId: 'f',
    });
    expect(computeSmartPlay()).toBeNull();
  });

  it('formats episode codes', () => {
    expect(episodeCode(ep('x', 0, 3))).toBe('S0:E3');
  });
});
