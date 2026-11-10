import { render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient, routes } from '../../../test/fakeClient';
import { FakeResizeObserver, resize } from '../../../test/resizeObserver';
import { makeContext } from '../../../test/viewContext';
import type { AjaxRequest } from '../../compat/jellyfin';
import { clearBrowseState } from './browseStore';
import { LibraryView } from './LibraryView';

const LIB = '0123456789abcdef0123456789abcdef';
const params = (r: AjaxRequest) => new URL(r.url).searchParams;

function setup(collection: 'movies' | 'tvshows', tab: Parameters<typeof LibraryView>[0]['tab']) {
  const client = createFakeClient(
    routes({
      [`Items/${LIB}`]: { Id: LIB, Name: 'Films', Type: 'CollectionFolder' },
      Genres: { Items: [{ Id: 'g1', Name: 'Drama', Type: 'Genre' }] },
      Studios: { Items: [{ Id: 'st1', Name: 'Lumen Pictures', Type: 'Studio' }] },
      Items: (r: AjaxRequest) => ({
        Items: [
          { Id: 'x1', Name: `Item of ${params(r).get('includeItemTypes')}`, Type: 'Movie', ServerId: 's' },
        ],
        TotalRecordCount: 4,
      }),
    }),
  );
  render(<LibraryView id={LIB} collection={collection} tab={tab} ctx={makeContext(client)} />);
  return client;
}

describe('library tabs', () => {
  afterEach(() => clearBrowseState());

  it("links every Lumen tab in jellyfin-web's order and marks the current one", async () => {
    setup('movies', 'items');

    const nav = await screen.findByRole('navigation', { name: 'Library sections' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual([
      'Movies',
      'Suggestions',
      'Favorites',
      'Collections',
      'Genres',
      'Studios',
    ]);
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      `#/movies?topParentId=${LIB}&collectionType=movies`,
      `#/movies?topParentId=${LIB}&collectionType=movies&tab=1`,
      `#/movies?topParentId=${LIB}&collectionType=movies&tab=2`,
      `#/movies?topParentId=${LIB}&collectionType=movies&tab=3`,
      `#/movies?topParentId=${LIB}&collectionType=movies&tab=4`,
      `#/movies?topParentId=${LIB}&collectionType=movies&tab=5`,
    ]);
    expect(within(nav).getByRole('link', { name: 'Movies' })).toHaveAttribute('aria-current', 'page');
  });

  it('gives Shows its own tabs', async () => {
    setup('tvshows', 'episodes');

    const nav = await screen.findByRole('navigation', { name: 'Library sections' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Shows', 'Suggestions', 'Upcoming', 'Genres', 'Studios', 'Episodes', 'Collections']);
    expect(within(nav).getByRole('link', { name: 'Episodes' })).toHaveAttribute('aria-current', 'page');
  });

  it('Favorites lists only favorited titles of this library', async () => {
    const client = setup('movies', 'favorites');

    expect(await screen.findByRole('heading', { name: 'Films', level: 1 })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /Item of Movie/ })).toBeInTheDocument());
    const query = params(client.requests.find((r) => new URL(r.url).pathname === '/Items')!);
    expect(query.get('parentId')).toBe(LIB);
    expect(query.get('filters')).toBe('IsFavorite');
  });

  it('Episodes lists the newest episodes first', async () => {
    const client = setup('tvshows', 'episodes');

    await waitFor(() => expect(screen.getByRole('button', { name: /Item of Episode/ })).toBeInTheDocument());
    const query = params(client.requests.find((r) => new URL(r.url).pathname === '/Items')!);
    expect(query.get('includeItemTypes')).toBe('Episode');
    expect(query.get('sortOrder')).toBe('Descending');
  });

  it('Genres shows a tile per genre that opens the genre inside this library', async () => {
    setup('movies', 'genres');

    const tile = await screen.findByRole('link', { name: /Drama/ });
    expect(tile).toHaveAttribute('href', `#/list?genreId=g1&parentId=${LIB}`);
  });

  it('Studios shows a tile per studio that opens the studio inside this library', async () => {
    setup('movies', 'studios');

    const tile = await screen.findByRole('link', { name: /Lumen Pictures/ });
    expect(tile).toHaveAttribute('href', `#/list?studioId=st1&parentId=${LIB}`);
    // jsdom has no IntersectionObserver, so the tile loads its art and count at once.
    expect(await within(tile).findByText('4 titles')).toBeInTheDocument();
  });

  it('asks for a genre tile stretched across its grid column at the width it renders', async () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    vi.stubGlobal('devicePixelRatio', 1);
    try {
      const client = createFakeClient(
        routes({
          [`Items/${LIB}`]: { Id: LIB, Name: 'Films', Type: 'CollectionFolder' },
          Genres: { Items: [{ Id: 'g1', Name: 'Drama', Type: 'Genre' }] },
          Items: { Items: [{ Id: 'x1', Name: 'Art', Type: 'Movie', BackdropImageTags: ['bd'] }] },
        }),
      );
      render(<LibraryView id={LIB} collection="movies" tab="genres" ctx={makeContext(client)} />);
      const tile = await screen.findByRole('link', { name: /Drama/ });
      await within(tile).findByText(/titles?/);
      // Not fetched at a guessed size before the tile is measured.
      expect(tile.querySelector('img')).toBeNull();

      // minmax(240px, 1fr): a wide window stretches tiles past 320 px.
      resize(400, [tile]);
      const src = new URL(tile.querySelector('img')!.getAttribute('src')!);
      expect(src.pathname).toBe('/Items/x1/Images/Backdrop');
      expect(src.searchParams.get('fillWidth')).toBe('480');
      expect(src.searchParams.get('fillHeight')).toBe('270');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
