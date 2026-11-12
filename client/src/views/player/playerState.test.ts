import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlaybackManager, Player } from '../../compat/playbackManager';
import { readVolume, snapshotKey, type PlayerSnapshot } from './playerState';
import { PLAYER_ICONS } from './playerIcons';
import { volumeIcon } from './volume';

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

describe('readVolume', () => {
  // jellyfin-web's playback manager where the device's buttons set the volume: a fixed 1, not the player's volume.
  const manager = { getVolume: vi.fn(() => 1) } as unknown as PlaybackManager;
  const local: Player = { id: 'htmlvideoplayer', isLocalPlayer: true };
  const host = (supports: boolean) => {
    (window as Window & { NativeShell?: unknown }).NativeShell = {
      AppHost: { supports: (feature: string) => supports && feature === 'physicalvolumecontrol' },
    };
  };
  afterEach(() => delete (window as Window & { NativeShell?: unknown }).NativeShell);

  it("counts as full on a phone, where the device's buttons set the volume (full, not one wave, on the icon)", () => {
    host(true);
    expect(readVolume(manager, local)).toBe(100);
    expect(volumeIcon(readVolume(manager, local), false)).toBe('volumeHigh');
    expect(volumeIcon(readVolume(manager, local), true)).toBe('volumeOff');
  });

  it("is the player's own on a desktop, and for a remote player", () => {
    expect(readVolume(manager, local)).toBe(1);
    expect(volumeIcon(readVolume(manager, local), false)).toBe(PLAYER_ICONS.volumeLow);
    host(false);
    expect(readVolume(manager, local)).toBe(1);
    host(true);
    expect(readVolume(manager, { id: 'chromecast' })).toBe(1);
  });
});
