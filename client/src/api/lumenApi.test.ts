import { describe, expect, it } from 'vitest';
import { createFakeClient } from '../../test/fakeClient';
import { LumenApi } from './lumenApi';

describe('LumenApi', () => {
  it('reads Lumen endpoints as JSON', async () => {
    const client = createFakeClient(() => ({ Rows: [] }));

    await new LumenApi(client).getHome();

    expect(client.requests).toEqual([{ type: 'GET', url: 'http://jf/Lumen/Home', dataType: 'json' }]);
  });

  it('scopes item reads to the signed-in user via the non-obsolete route', async () => {
    const client = createFakeClient();

    await new LumenApi(client).getItem('abc');

    expect(client.requests[0]?.url).toBe('http://jf/Items/abc?userId=user1');
  });

  it('starts playback through the own session', async () => {
    const client = createFakeClient();

    await new LumenApi(client).playNow('s1', ['a', 'b'], 10);

    expect(client.requests[0]).toEqual({
      type: 'POST',
      url: 'http://jf/Sessions/s1/Playing?playCommand=PlayNow&itemIds=a%2Cb&startPositionTicks=10',
    });
  });

  it('toggles played and favorite with POST/DELETE', async () => {
    const client = createFakeClient();
    const api = new LumenApi(client);

    await api.setPlayed('x', true);
    await api.setPlayed('x', false);
    await api.setFavorite('x', true);

    expect(client.requests.map((r) => `${r.type} ${r.url}`)).toEqual([
      'POST http://jf/UserPlayedItems/x?userId=user1',
      'DELETE http://jf/UserPlayedItems/x?userId=user1',
      'POST http://jf/UserFavoriteItems/x?userId=user1',
    ]);
  });

  it('posts diagnostics as JSON', async () => {
    const client = createFakeClient();

    await new LumenApi(client).postDiagnostics({
      Client: 'web',
      ServerVersion: '12.1.0',
      FailedChecks: ['stockPage'],
    });

    expect(client.requests[0]).toMatchObject({
      type: 'POST',
      url: 'http://jf/Lumen/Diagnostics',
      contentType: 'application/json',
      data: '{"Client":"web","ServerVersion":"12.1.0","FailedChecks":["stockPage"]}',
    });
  });

  it('rejects user-scoped calls when signed out', async () => {
    await expect(new LumenApi(createFakeClient(undefined, null)).getItem('x')).rejects.toThrow(
      'Not signed in',
    );
  });
});
