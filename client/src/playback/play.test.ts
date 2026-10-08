import { describe, expect, it } from 'vitest';
import { createFakeClient, routes } from '../../test/fakeClient';
import { LumenApi } from '../api/lumenApi';
import type { AjaxRequest } from '../compat/jellyfin';
import { findOwnSession, PlaybackError, playItem, resumeTicks } from './play';

const deviceParam = (r: AjaxRequest): string | null => new URL(r.url).searchParams.get('deviceId');

describe('playback', () => {
  it('finds the own session by decoded device id and starts playback with a resume position', async () => {
    const client = createFakeClient(
      routes({
        Sessions: (r: AjaxRequest) =>
          deviceParam(r) === 'dev+ice' ? [{ Id: 's1', DeviceId: 'dev+ice', UserId: 'USER1' }] : [],
        'Sessions/s1/Playing': {},
      }),
    );

    await playItem(new LumenApi(client), client, 'item1', 500);

    expect(client.requests.at(-1)?.url).toBe(
      'http://jf/Sessions/s1/Playing?playCommand=PlayNow&itemIds=item1&startPositionTicks=500',
    );
  });

  it('falls back to the raw device id', async () => {
    const client = createFakeClient(
      routes({
        Sessions: (r: AjaxRequest) =>
          deviceParam(r) === 'dev%2Bice' ? [{ Id: 's2', DeviceId: 'dev%2Bice' }] : [],
      }),
    );

    expect((await findOwnSession(new LumenApi(client), client))?.Id).toBe('s2');
  });

  it('fails closed on ambiguous sessions', async () => {
    const client = createFakeClient(
      routes({
        Sessions: [
          { Id: 'a', DeviceId: 'dev+ice' },
          { Id: 'b', DeviceId: 'dev+ice' },
        ],
      }),
    );

    await expect(playItem(new LumenApi(client), client, 'x')).rejects.toBeInstanceOf(PlaybackError);
  });

  it('computes resume ticks only for started items', () => {
    expect(resumeTicks({ Id: 'a', Name: 'a', Type: 'Movie', UserData: { PlaybackPositionTicks: 9 } })).toBe(
      9,
    );
    expect(resumeTicks({ Id: 'a', Name: 'a', Type: 'Movie' })).toBeUndefined();
  });
});
