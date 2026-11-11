import { describe, expect, it, vi } from 'vitest';
import type { LumenApi } from '../../api/lumenApi';
import type { HomeRow } from '../../api/types';
import {
  clearCachedHome,
  fetchHome,
  getCachedHome,
  isEmptyHome,
  setCachedHome,
  restoreScrollTop,
  mapHomeItems,
} from './homeStore';

const home = { ConfigVersion: 1, Hero: [], Rows: [] };

describe('homeStore', () => {
  it('keeps only the current user', () => {
    setCachedHome('a', home);
    setCachedHome('b', home);

    expect(getCachedHome('a')).toBeUndefined();
    expect(getCachedHome('b')).toBe(home);
  });

  it('clears the cached home for that user only', () => {
    setCachedHome('a', home);
    clearCachedHome('b');
    expect(getCachedHome('a')).toBe(home);
    clearCachedHome('a');
    expect(getCachedHome('a')).toBeUndefined();
  });

  it('retries once', async () => {
    const getHome = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce(home);

    await expect(fetchHome({ getHome } as unknown as LumenApi, 0)).resolves.toBe(home);
    expect(getHome).toHaveBeenCalledTimes(2);
  });

  it('detects empty homes', () => {
    expect(isEmptyHome(home)).toBe(true);
  });
});

describe('restoreScrollTop', () => {
  function page(top: number): HTMLElement {
    const root = document.createElement('div');
    root.innerHTML = '<section data-row-id="r1"><button data-item-id="m1"></button></section>';
    root.querySelector('button')!.getBoundingClientRect = () => ({ top }) as DOMRect;
    return root;
  }

  it('scrolls so the selected card is back where it was, even if rows above it changed', () => {
    // The card was 300px from the top; a new row above now puts it 615px down the current viewport.
    expect(restoreScrollTop(page(615), { itemId: 'm1', rowId: 'r1', scrollY: 1071, top: 300 }, 1071)).toBe(
      1386,
    );
  });

  it('falls back to the saved scroll offset when the card is gone or ids are unsafe', () => {
    expect(restoreScrollTop(page(0), { itemId: 'gone', rowId: 'r1', scrollY: 700, top: 300 }, 0)).toBe(700);
    expect(restoreScrollTop(page(0), { itemId: 'm1"]', scrollY: 500, top: 10 }, 0)).toBe(500);
    expect(restoreScrollTop(page(0), { itemId: 'm1', scrollY: 400 }, 0)).toBe(400);
  });

  it('leaves a deleted title out of the hero and the rows, and a row it leaves empty', () => {
    const item = (Id: string) => ({ Id, Name: Id, Type: 'Movie' });
    const full = {
      ConfigVersion: 1,
      Hero: [
        { Item: item('a'), TrailerItemId: null },
        { Item: item('b'), TrailerItemId: null },
      ],
      Rows: [
        { Id: 'r1', Type: 'Latest', Title: 'Latest', Items: [item('a'), item('b')] },
        { Id: 'r2', Type: 'Resume', Title: 'Resume', Items: [item('a')] },
        {
          Id: 'r3',
          Type: 'Trending',
          Title: 'Trending',
          Items: [],
          Entries: [{ Item: item('a') }, { Item: item('c') }],
        },
      ],
    };
    const left = mapHomeItems(full, (i) => (i.Id === 'a' ? null : i));
    expect(left.Hero.map((h) => h.Item.Id)).toEqual(['b']);
    expect(left.Rows.map((r) => r.Id)).toEqual(['r1', 'r3']);
    expect(left.Rows[0]!.Items.map((i) => i.Id)).toEqual(['b']);
    expect(left.Rows[1]!.Entries!.map((e) => e.Item!.Id)).toEqual(['c']);
  });

  it('changes titles in place, keeping a catalog row’s order and its titles the server doesn’t have', () => {
    const item = (Id: string) => ({ Id, Name: Id, Type: 'Movie' });
    const catalog = { Key: 'k', MediaType: 'movie', TmdbId: 1, Title: 'T', GenreNames: [], State: 'None' };
    const full = {
      ConfigVersion: 1,
      Hero: [{ Item: item('a'), TrailerItemId: 't' }],
      Rows: [
        {
          Id: 'r1',
          Type: 'Trending',
          Title: 'Trending',
          Items: [],
          Entries: [{ Item: item('a') }, { Catalog: catalog }, { Item: item('b') }],
        },
      ] as HomeRow[],
    };
    const renamed = mapHomeItems(full, (i) => (i.Id === 'a' ? { ...i, Name: 'A2' } : i));
    expect(renamed.Hero).toEqual([{ Item: { ...item('a'), Name: 'A2' }, TrailerItemId: 't' }]);
    expect(renamed.Rows[0]!.Entries).toEqual([
      { Item: { ...item('a'), Name: 'A2' } },
      { Catalog: catalog },
      { Item: item('b') },
    ]);
    // Untouched entries are the same objects.
    expect(renamed.Rows[0]!.Entries![2]).toBe(full.Rows[0]!.Entries![2]);
  });
});
