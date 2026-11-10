import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeClient, routes } from '../../../test/fakeClient';
import { makeContext } from '../../../test/viewContext';
import type { AjaxRequest } from '../../compat/jellyfin';
import type { BaseItem } from '../../api/types';
import { clearBrowseState } from './browseStore';
import { LibraryView, sortParams } from './LibraryView';
import { LumenApi } from '../../api/lumenApi';
import { PAGE_SIZE, useBrowseItems } from './useBrowseItems';
import { clearUserData, setUserData } from '../userDataStore';

const LIB = '0123456789abcdef0123456789abcdef';
const movie = (i: number): BaseItem => ({ Id: `m${i}`, Name: `Movie ${i}`, Type: 'Movie', ServerId: 's' });
const params = (r: AjaxRequest) => new URL(r.url).searchParams;

function setup(total: number) {
  const all = Array.from({ length: total }, (_, i) => movie(i));
  const client = createFakeClient(
    routes({
      [`Items/${LIB}`]: { Id: LIB, Name: 'Films', Type: 'CollectionFolder' },
      Genres: { Items: [{ Id: 'g1', Name: 'Drama', Type: 'Genre' }] },
      Items: (r: AjaxRequest) => {
        const start = Number(params(r).get('startIndex'));
        const limit = Number(params(r).get('limit'));
        return { Items: all.slice(start, start + limit), TotalRecordCount: total };
      },
    }),
  );
  const ctx = makeContext(client);
  render(<LibraryView id={LIB} collection="movies" ctx={ctx} />);
  const itemRequests = () => client.requests.filter((r) => new URL(r.url).pathname === '/Items');
  return { client, ctx, itemRequests };
}

describe('LibraryView', () => {
  afterEach(() => clearBrowseState());

  it('shows the library name, title count and a poster grid, newest first', async () => {
    const { itemRequests } = setup(3);

    expect(await screen.findByRole('heading', { name: 'Films' })).toBeInTheDocument();
    expect(await screen.findByText('3 titles')).toBeInTheDocument();
    const grid = screen.getByRole('list', { name: 'Films' });
    expect(within(grid).getAllByRole('button')).toHaveLength(3);
    const q = params(itemRequests()[0]!);
    expect(q.get('parentId')).toBe(LIB);
    expect(q.get('includeItemTypes')).toBe('Movie');
    expect(q.get('sortBy')).toBe('DateCreated,SortName');
    expect(q.get('sortOrder')).toBe('Descending');
    expect(q.get('recursive')).toBe('true');
  });

  it('refetches with the chosen filter, genre and sort, and can clear filters when nothing matches', async () => {
    const { client, itemRequests } = setup(2);
    await screen.findByText('2 titles');

    fireEvent.click(screen.getByRole('button', { name: 'Unwatched' }));
    await waitFor(() => expect(params(itemRequests().at(-1)!).get('filters')).toBe('IsUnplayed'));

    fireEvent.click(await screen.findByRole('button', { name: 'Genre All genres' }));
    fireEvent.click(screen.getByRole('option', { name: 'Drama' }));
    await waitFor(() => expect(params(itemRequests().at(-1)!).get('genreIds')).toBe('g1'));

    fireEvent.click(screen.getByRole('button', { name: 'Sort by Recently added' }));
    fireEvent.click(screen.getByRole('option', { name: 'Title' }));
    await waitFor(() => expect(params(itemRequests().at(-1)!).get('sortBy')).toBe('SortName'));
    expect(params(itemRequests().at(-1)!).get('sortOrder')).toBe('Ascending');

    client.respond = routes({ Items: { Items: [], TotalRecordCount: 0 } });
    fireEvent.click(screen.getByRole('button', { name: 'Watched' }));
    expect(await screen.findByText('Nothing matches these filters.')).toBeInTheDocument();
  });

  it('pages in PAGE_SIZE chunks and opens details on select', async () => {
    const { ctx, itemRequests } = setup(PAGE_SIZE + 5);
    await screen.findByText(`${PAGE_SIZE + 5} titles`);
    expect(params(itemRequests()[0]!).get('limit')).toBe(String(PAGE_SIZE));

    fireEvent.click(screen.getByRole('button', { name: 'Movie 1' }));
    expect(ctx.navigate).toHaveBeenCalledWith('#/details?id=m1&serverId=s');
  });

  it('sorts shows by their newest episode for "Recently added"', () => {
    expect(sortParams('added', 'tvshows').sortBy).toBe('DateLastContentAdded,SortName');
    expect(sortParams('rating', 'movies')).toEqual({
      sortBy: 'CommunityRating,SortName',
      sortOrder: 'Descending',
    });
  });
});

describe('LibraryView snapshots', () => {
  afterEach(() => {
    clearBrowseState();
    clearUserData();
  });

  it('keeps the saved grid through a favorite change, with the new value, but not through a watched change when filtered', async () => {
    const { ctx, itemRequests } = setup(3);
    await screen.findByText('3 titles');
    fireEvent.click(screen.getByRole('button', { name: 'Movie 1' }));
    cleanup();

    // On the details page: favorite it. Back to the library: the same grid, no refetch.
    await setUserData(ctx, movie(1), 'IsFavorite', true);
    const before = itemRequests().length;
    render(<LibraryView id={LIB} collection="movies" ctx={ctx} />);
    expect(screen.getByRole('button', { name: 'Movie 1' })).toBeInTheDocument();
    expect(itemRequests()).toHaveLength(before);
    cleanup();

    // Filtered to Unwatched: marking a title watched drops that grid, so Back refetches.
    render(<LibraryView id={LIB} collection="movies" ctx={ctx} />);
    fireEvent.click(screen.getByRole('button', { name: 'Unwatched' }));
    await waitFor(() => expect(params(itemRequests().at(-1)!).get('filters')).toBe('IsUnplayed'));
    await screen.findByRole('button', { name: 'Movie 2' });
    fireEvent.click(screen.getByRole('button', { name: 'Movie 2' }));
    cleanup();
    await setUserData(ctx, movie(2), 'Played', true);
    const count = itemRequests().length;
    render(<LibraryView id={LIB} collection="movies" ctx={ctx} />);
    await waitFor(() => expect(itemRequests().length).toBeGreaterThan(count));
  });
});

describe('LibraryView paging', () => {
  afterEach(() => clearBrowseState());

  it('advances by the server offset, so a page of repeats does not stall loading', async () => {
    // Page 2 repeats page 1 entirely (titles were added meanwhile); paging must still move on to page 3.
    const page1 = Array.from({ length: PAGE_SIZE }, (_, i) => movie(i));
    const page3 = [movie(1000)];
    const starts: number[] = [];
    const client = createFakeClient(
      routes({
        [`Items/${LIB}`]: { Id: LIB, Name: 'Films', Type: 'CollectionFolder' },
        Genres: { Items: [] },
        Items: (r: AjaxRequest) => {
          const start = Number(params(r).get('startIndex'));
          starts.push(start);
          const items = start === 0 ? page1 : start === PAGE_SIZE ? page1 : page3;
          return { Items: items, TotalRecordCount: PAGE_SIZE * 2 + 1 };
        },
      }),
    );
    const { result } = await import('@testing-library/preact').then(({ renderHook }) =>
      renderHook(() =>
        useBrowseItems('k', (page) =>
          new LumenApi(client).getBrowseItems({
            parentId: LIB,
            includeItemTypes: 'Movie',
            sortBy: 'SortName',
            sortOrder: 'Ascending',
            ...page,
          }),
        ),
      ),
    );
    await waitFor(() => expect(result.current.items).toHaveLength(PAGE_SIZE));
    act(() => result.current.loadMore());
    await waitFor(() => expect(starts).toEqual([0, PAGE_SIZE]));
    act(() => result.current.loadMore());
    await waitFor(() => expect(starts).toEqual([0, PAGE_SIZE, PAGE_SIZE * 2]));
    await waitFor(() => expect(result.current.hasMore).toBe(false));
    expect(result.current.items).toHaveLength(PAGE_SIZE + 1);
  });
});
