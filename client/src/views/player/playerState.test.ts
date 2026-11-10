import { describe, expect, it } from 'vitest';
import { snapshotKey, type PlayerSnapshot } from './playerState';

const snap = (over: Partial<PlayerSnapshot> = {}): PlayerSnapshot =>
  ({
    player: { id: 'p' },
    item: { Id: 'e1', Name: 'Pilot', Type: 'Episode' },
    positionMs: 1000,
    bufferedMs: 5000,
    paused: false,
    audioTracks: [{ Index: 1 }],
    ...over,
  }) as unknown as PlayerSnapshot;

describe('snapshotKey', () => {
  it('is the same for two readings of an unchanged player (fresh objects each time)', () => {
    expect(snapshotKey(snap(), true)).toBe(snapshotKey(snap(), true));
  });

  it('changes with what the controls show', () => {
    expect(snapshotKey(snap({ paused: true }), true)).not.toBe(snapshotKey(snap(), true));
    expect(snapshotKey(snap({ audioTracks: [{ Index: 2 }] } as never), true)).not.toBe(
      snapshotKey(snap(), true),
    );
    expect(snapshotKey(snap({ item: { Id: 'e2' } } as never), true)).not.toBe(snapshotKey(snap(), true));
  });

  it('ignores the position only while it is off screen', () => {
    expect(snapshotKey(snap({ positionMs: 2000 }), true)).not.toBe(snapshotKey(snap(), true));
    expect(snapshotKey(snap({ positionMs: 2000, bufferedMs: 9000 }), false)).toBe(snapshotKey(snap(), false));
  });
});
