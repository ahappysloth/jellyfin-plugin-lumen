import { describe, expect, it, vi } from 'vitest';
import { createFakeClient, routes } from '../../test/fakeClient';
import { LumenApi } from '../api/lumenApi';
import type { AjaxRequest } from '../compat/jellyfin';
import type { BaseItem } from '../api/types';
import type { PlaybackManager } from '../compat/playbackManager';
import { canPlayAsIs, findOwnSession, PlaybackError, playItem, resumeTicks } from './play';

const deviceParam = (r: AjaxRequest): string | null => new URL(r.url).searchParams.get('deviceId');

/** A movie as GET /Items/{id} returns it: every field, so Chapters, MediaSources and Trickplay are there. */
const fullMovie = (): BaseItem => ({
  Id: 'item1',
  Name: 'Movie',
  Type: 'Movie',
  MediaType: 'Video',
  IsFolder: false,
  ServerId: 'srv1',
  RunTimeTicks: 1000,
  UserData: { PlaybackPositionTicks: 500 },
  Chapters: [],
  MediaSources: [{ Id: 'item1' }],
  Trickplay: {},
});

describe('playback', () => {
  it('finds the own session by decoded device id and starts playback with a resume position', async () => {
    const client = createFakeClient(
      routes({
        Sessions: (r: AjaxRequest) =>
          deviceParam(r) === 'dev+ice' ? [{ Id: 's1', DeviceId: 'dev+ice', UserId: 'USER1' }] : [],
        'Sessions/s1/Playing': {},
      }),
    );

    await playItem(new LumenApi(client), client, 'item1', 500, null);

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

    await expect(playItem(new LumenApi(client), client, 'x', undefined, null)).rejects.toBeInstanceOf(
      PlaybackError,
    );
  });

  it("plays in this tab's own player, never through the server's session", async () => {
    const client = Object.assign(createFakeClient(routes({})), { serverId: () => 'srv1' });
    const play = vi.fn(async () => undefined);

    await playItem(new LumenApi(client), client, 'item1', 500, { play } as unknown as PlaybackManager);

    expect(play).toHaveBeenCalledWith({ ids: ['item1'], startPositionTicks: 500, serverId: 'srv1' });
    expect(client.requests).toEqual([]);
  });

  it('starts from the beginning when there is no resume point', async () => {
    const client = Object.assign(createFakeClient(routes({})), { serverId: () => 'srv1' });
    const play = vi.fn(async () => undefined);

    await playItem(new LumenApi(client), client, 'item1', 0, { play } as unknown as PlaybackManager);

    expect(play).toHaveBeenCalledWith({ ids: ['item1'], startPositionTicks: undefined, serverId: 'srv1' });
  });

  it("reports a failure from jellyfin-web's player", async () => {
    const client = Object.assign(createFakeClient(routes({})), { serverId: () => 'srv1' });
    const play = vi.fn(async () => Promise.reject(new Error('no media')));

    await expect(
      playItem(new LumenApi(client), client, 'item1', undefined, { play } as unknown as PlaybackManager),
    ).rejects.toBeInstanceOf(PlaybackError);
  });

  it("falls back to the server's PlayNow without a server id", async () => {
    const client = createFakeClient(
      routes({
        Sessions: (r: AjaxRequest) =>
          deviceParam(r) === 'dev+ice' ? [{ Id: 's1', DeviceId: 'dev+ice', UserId: 'USER1' }] : [],
        'Sessions/s1/Playing': {},
      }),
    );
    const play = vi.fn(async () => undefined);

    await playItem(new LumenApi(client), client, 'item1', undefined, { play } as unknown as PlaybackManager);

    expect(play).not.toHaveBeenCalled();
    expect(client.requests.at(-1)?.url).toBe(
      'http://jf/Sessions/s1/Playing?playCommand=PlayNow&itemIds=item1',
    );
  });

  it("hands a fully loaded movie to jellyfin-web's player, so it doesn't fetch it again", async () => {
    const client = Object.assign(createFakeClient(routes({})), { serverId: () => 'srv1' });
    const play = vi.fn<(options: unknown) => Promise<void>>(async () => undefined);
    const item = fullMovie();

    await playItem(new LumenApi(client), client, item, 500, { play } as unknown as PlaybackManager);

    expect(play).toHaveBeenCalledWith({ items: [item], startPositionTicks: 500, serverId: 'srv1' });
    expect(play.mock.calls[0]?.[0]).not.toHaveProperty('ids');
    // A copy: jellyfin-web writes PlaylistItemId and playOptions onto the items it plays.
    expect((play.mock.calls[0]?.[0] as { items: BaseItem[] }).items[0]).not.toBe(item);
    expect(client.requests).toEqual([]);
  });

  it.each([
    ['an episode', { Type: 'Episode', SeriesId: 'show1' }],
    ['a video', { Type: 'Video' }],
  ])('hands %s over as it is too', async (_name, fields) => {
    const client = Object.assign(createFakeClient(routes({})), { serverId: () => 'srv1' });
    const play = vi.fn<(options: unknown) => Promise<void>>(async () => undefined);
    const item = { ...fullMovie(), ...fields };

    await playItem(new LumenApi(client), client, item, undefined, { play } as unknown as PlaybackManager);

    expect(play).toHaveBeenCalledWith({ items: [item], startPositionTicks: undefined, serverId: 'srv1' });
  });

  it.each([
    ["a card's item (no Chapters, MediaSources or Trickplay)", { Chapters: undefined }],
    ['an item without media sources', { MediaSources: undefined }],
    ['an item without trickplay', { Trickplay: undefined }],
    ['an empty media source list', { MediaSources: [] }],
    ['a series (jellyfin-web expands it)', { Type: 'Series', IsFolder: true, MediaType: 'Unknown' }],
    ['a season', { Type: 'Season', IsFolder: true, MediaType: 'Unknown' }],
    ['a collection', { Type: 'BoxSet', IsFolder: true, MediaType: 'Unknown' }],
    ['a trailer', { Type: 'Trailer' }],
    ['audio', { MediaType: 'Audio' }],
    ['no media type', { MediaType: undefined }],
    ["another server's item", { ServerId: 'srv2' }],
  ])('plays %s by id', async (_name, fields) => {
    const client = Object.assign(createFakeClient(routes({})), { serverId: () => 'srv1' });
    const play = vi.fn<(options: unknown) => Promise<void>>(async () => undefined);
    const item = { ...fullMovie(), ...fields } as BaseItem;

    expect(canPlayAsIs(item, 'srv1')).toBe(false);
    await playItem(new LumenApi(client), client, item, 500, { play } as unknown as PlaybackManager);

    expect(play).toHaveBeenCalledWith({ ids: ['item1'], startPositionTicks: 500, serverId: 'srv1' });
  });

  it("sends a fully loaded item's id to the server's PlayNow fallback", async () => {
    const client = createFakeClient(
      routes({
        Sessions: (r: AjaxRequest) =>
          deviceParam(r) === 'dev+ice' ? [{ Id: 's1', DeviceId: 'dev+ice', UserId: 'USER1' }] : [],
        'Sessions/s1/Playing': {},
      }),
    );

    await playItem(new LumenApi(client), client, fullMovie(), 500, null);

    expect(client.requests.at(-1)?.url).toBe(
      'http://jf/Sessions/s1/Playing?playCommand=PlayNow&itemIds=item1&startPositionTicks=500',
    );
  });

  it('computes resume ticks only for started items', () => {
    expect(resumeTicks({ Id: 'a', Name: 'a', Type: 'Movie', UserData: { PlaybackPositionTicks: 9 } })).toBe(
      9,
    );
    expect(resumeTicks({ Id: 'a', Name: 'a', Type: 'Movie' })).toBeUndefined();
  });
});
