import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeClient, routes } from '../../../test/fakeClient';
import { makeContext } from '../../../test/viewContext';
import type { BaseItem } from '../../api/types';
import type { AjaxRequest } from '../../compat/jellyfin';
import { clearBrowseState } from './browseStore';
import { GenreView } from './GenreView';

const GENRE = 'g1';
const LIB = 'lib1';
const params = (r: AjaxRequest) => new URL(r.url).searchParams;
const titles: BaseItem[] = [
  { Id: 'm1', Name: 'Space Movie', Type: 'Movie', ServerId: 's' },
  { Id: 's1', Name: 'Space Show', Type: 'Series', ServerId: 's' },
];

function setup(items: BaseItem[] = titles, parentId?: string) {
  const client = createFakeClient(
    routes({
      [`Items/${GENRE}`]: { Id: GENRE, Name: 'Science Fiction', Type: 'Genre' },
      Items: { Items: items, TotalRecordCount: items.length },
    }),
  );
  const ctx = makeContext(client);
  const view = render(<GenreView id={GENRE} parentId={parentId} ctx={ctx} />);
  const itemRequests = () => client.requests.filter((r) => new URL(r.url).pathname === '/Items');
  return { client, ctx, view, itemRequests };
}

describe('GenreView', () => {
  afterEach(() => clearBrowseState());

  it("shows the genre's movies and shows in one grid, inside the library it was opened from", async () => {
    const { itemRequests } = setup(titles, LIB);

    expect(await screen.findByRole('heading', { name: 'Science Fiction' })).toBeInTheDocument();
    expect(await screen.findByText('2 titles')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Science Fiction' })).getAllByRole('button')).toHaveLength(
      2,
    );
    const q = params(itemRequests()[0]!);
    expect(q.get('genreIds')).toBe(GENRE);
    expect(q.get('parentId')).toBe(LIB);
    expect(q.get('includeItemTypes')).toBe('Movie,Series');
    expect(q.get('sortBy')).toBe('DateCreated,SortName');
  });

  it('narrows to one kind and re-sorts, remembering the choice for the next genre', async () => {
    const { itemRequests, view } = setup();
    await screen.findByText('2 titles');

    fireEvent.click(screen.getByRole('button', { name: 'Shows' }));
    await waitFor(() => expect(params(itemRequests().at(-1)!).get('includeItemTypes')).toBe('Series'));
    // Shows sort "recently added" by their newest episode.
    expect(params(itemRequests().at(-1)!).get('sortBy')).toBe('DateLastContentAdded,SortName');

    fireEvent.click(screen.getByRole('button', { name: 'Sort by: Recently added' }));
    fireEvent.click(screen.getByRole('option', { name: 'Rating' }));
    await waitFor(() =>
      expect(params(itemRequests().at(-1)!).get('sortBy')).toBe('CommunityRating,SortName'),
    );

    view.unmount();
    setup();
    expect(await screen.findByRole('button', { name: 'Shows' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Sort by: Rating' })).toBeInTheDocument();
  });

  it('opens a title, and Back lands on the same grid without refetching it', async () => {
    const { ctx, itemRequests, view } = setup();
    await screen.findByText('2 titles');

    fireEvent.click(screen.getByRole('button', { name: 'Space Show' }));
    expect(ctx.navigate).toHaveBeenCalledWith('#/details?id=s1&serverId=s');
    view.unmount();

    const before = itemRequests().length;
    render(<GenreView id={GENRE} ctx={ctx} />);
    expect(screen.getByRole('button', { name: 'Space Show' })).toBeInTheDocument();
    expect(itemRequests()).toHaveLength(before);
  });

  it('says so when the genre is empty', async () => {
    setup([]);
    expect(await screen.findByText('Nothing in this genre yet.')).toBeInTheDocument();
  });

  it('focuses the active chip in the TV layout', async () => {
    const client = createFakeClient(
      routes({
        [`Items/${GENRE}`]: { Id: GENRE, Name: 'Science Fiction', Type: 'Genre' },
        Items: { Items: titles, TotalRecordCount: 2 },
      }),
    );
    render(<GenreView id={GENRE} ctx={makeContext(client, { layout: 'tv' })} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'All' })).toHaveFocus());
  });
});
