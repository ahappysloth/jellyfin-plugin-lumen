import { act, renderHook, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LumenApi } from '../../api/lumenApi';
import { useTrickplay, type TrickplayInfo } from './trickplay';

const info: TrickplayInfo = {
  Width: 320,
  Height: 180,
  TileWidth: 10,
  TileHeight: 10,
  ThumbnailCount: 100,
  Interval: 10_000,
};
const api = {
  getItem: vi.fn(async (id: string) => ({ Id: id, Trickplay: { [`${id}-src`]: { '320': info } } })),
} as unknown as LumenApi;
const client = { getUrl: (path: string) => `/${path}`, accessToken: () => 't' };

describe('useTrickplay', () => {
  afterEach(() => vi.unstubAllGlobals());

  it("never shows the previous item's tiles after the item changes", async () => {
    const downloads: { url: string; finish: () => void }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (url: string) =>
          new Promise((resolve) =>
            downloads.push({ url, finish: () => resolve({ ok: true, blob: async () => new Blob([url]) }) }),
          ),
      ),
    );
    let made = 0;
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: () => `blob:${++made}`, revokeObjectURL: vi.fn() }),
    );

    const { result, rerender } = renderHook(({ id }) => useTrickplay(api, client, id, `${id}-src`), {
      initialProps: { id: 'a' },
    });
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current!(0)).toBeNull(); // starts downloading a's first tile

    rerender({ id: 'b' });
    expect(result.current).toBeNull(); // nothing of a's, even before b's info arrives
    await waitFor(() => expect(result.current).not.toBeNull());
    await act(async () => {
      downloads[0]!.finish(); // a's tile lands late
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current!(0)).toBeNull(); // b fetches its own tile instead
    expect(downloads.at(-1)!.url).toContain('Videos/b/');
  });
});
