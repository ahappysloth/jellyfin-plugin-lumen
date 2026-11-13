import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient, routes } from '../../../test/fakeClient';
import { makeContext, testConfig } from '../../../test/viewContext';
import type { HomeResponse } from '../../api/types';
import { ContextMenuHost } from '../../components/ContextMenu';
import { HomeView } from './HomeView';
import { getCachedHome, getSelection, setCachedHome } from './homeStore';
import { forgetItem } from '../itemChanges';
import { resetSessionCaches } from '../../util/sessionCaches';

const home: HomeResponse = {
  ConfigVersion: 1,
  Hero: [],
  Rows: [
    {
      Id: 'r1',
      Type: 'ContinueWatching',
      Title: 'Continue Watching',
      Items: [
        {
          Id: 'e1',
          Name: 'Pilot',
          Type: 'Episode',
          SeriesName: 'Show',
          ParentIndexNumber: 1,
          IndexNumber: 1,
          UserData: { PlaybackPositionTicks: 77 },
        },
      ],
    },
    {
      Id: 'r2',
      Type: 'RecentlyAdded',
      Title: 'Recently Added',
      Items: [{ Id: 'm1', Name: 'Alpha', Type: 'Movie', ServerId: 's' }],
    },
  ],
};

describe('HomeView', () => {
  beforeEach(() => setCachedHome('nobody', { ConfigVersion: 0, Hero: [], Rows: [] }));
  afterEach(() => resetSessionCaches());

  it('shows server badges on cards and opens a genre tile in the stock genre list', async () => {
    const withExtras: HomeResponse = {
      ...home,
      Rows: [
        ...home.Rows,
        {
          Id: 'g',
          Type: 'Genres',
          Title: 'Popular Genres',
          Items: [
            {
              Id: 'gid',
              Name: 'Drama',
              Type: 'Genre',
              ServerId: 's',
              ParentBackdropItemId: 'm1',
              ParentBackdropImageTags: ['bt'],
            },
          ],
        },
      ],
      Badges: { m1: 'RecentlyAdded' },
    };
    const ctx = makeContext(createFakeClient(routes({ 'Lumen/Home': withExtras })));
    render(<HomeView ctx={ctx} />);

    expect(await screen.findByText('Recently added')).toBeInTheDocument();
    const tile = screen.getByRole('button', { name: 'Drama' });
    expect(tile.querySelector('img')!.getAttribute('src')).toContain('Items/m1/Images/Backdrop');
    fireEvent.click(tile);
    expect(ctx.navigate).toHaveBeenCalledWith('#/list?genreId=gid&serverId=s');
  });

  it('leaves out a title deleted here even while the server, catching up, still lists it', async () => {
    forgetItem('user1', 'm1');
    const ctx = makeContext(createFakeClient(routes({ 'Lumen/Home': home })));
    render(<HomeView ctx={ctx} />);

    await waitFor(() => expect(document.querySelector('[data-item-id="e1"]')).not.toBeNull());
    // Its row, left empty, goes too.
    expect(document.querySelector('[data-item-id="m1"]')).toBeNull();
    expect(document.querySelector('[data-row-id="r2"]')).toBeNull();
  });

  it('has a page heading for screen readers (the hero and rows have h2s)', async () => {
    render(<HomeView ctx={makeContext(createFakeClient(routes({ 'Lumen/Home': home })))} />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument();
  });

  it('renders rows and opens details for movies', async () => {
    const ctx = makeContext(createFakeClient(routes({ 'Lumen/Home': home })));
    render(<HomeView ctx={ctx} />);

    fireEvent.click(await screen.findByRole('link', { name: 'Alpha' }));

    expect(screen.getByRole('region', { name: 'Recently Added' })).toBeInTheDocument();
    expect(ctx.navigate).toHaveBeenCalledWith('#/details?id=m1&serverId=s');
  });

  it("opens a card's page on click (an episode opens its season), and plays from the right-click menu", async () => {
    const client = createFakeClient(
      routes({
        'Lumen/Home': home,
        Sessions: [{ Id: 's1', DeviceId: 'dev+ice' }],
        'Sessions/s1/Playing': {},
      }),
    );
    const ctx = makeContext(client);
    render(
      <>
        <HomeView ctx={ctx} />
        <ContextMenuHost />
      </>,
    );

    const card = await screen.findByRole('link', { name: /Pilot/ });
    fireEvent.click(card);
    expect(ctx.navigate).toHaveBeenCalledWith('#/details?id=e1');

    fireEvent.contextMenu(card, { clientX: 40, clientY: 40 });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Resume' }));

    await waitFor(() =>
      expect(client.requests.at(-1)?.url).toContain(
        'Sessions/s1/Playing?playCommand=PlayNow&itemIds=e1&startPositionTicks=77',
      ),
    );
  });

  it('renders catalog rows mixing library cards and request cards', async () => {
    const withCatalog: HomeResponse = {
      ConfigVersion: 1,
      Hero: [],
      Rows: [
        {
          Id: 'r9',
          Type: 'CatalogTrending',
          Title: 'Trending',
          Items: [],
          Entries: [
            { Item: { Id: 'm1', Name: 'Alpha', Type: 'Movie', ServerId: 's' } },
            {
              Catalog: {
                Key: 'movie-603',
                MediaType: 'movie',
                TmdbId: 603,
                Title: 'The Matrix',
                GenreNames: [],
                State: 'None',
              },
            },
          ],
        },
      ],
    };
    const ctx = makeContext(createFakeClient(routes({ 'Lumen/Home': withCatalog })));
    render(<HomeView ctx={ctx} />);

    const row = await screen.findByRole('region', { name: 'Trending' });
    fireEvent.click(within(row).getByRole('button', { name: 'The Matrix, Request' }));
    expect(ctx.navigate).toHaveBeenCalledWith('#/home?title=movie-603');
    fireEvent.click(within(row).getByRole('link', { name: 'Alpha' }));
    expect(ctx.navigate).toHaveBeenCalledWith('#/details?id=m1&serverId=s');
  });

  it('offers a Top 10 row’s Top chart (See all), but not while the row is Seerr’s trending list', async () => {
    const entry = { Item: { Id: 'm1', Name: 'Alpha', Type: 'Movie', ServerId: 's' } };
    const top10: HomeResponse = {
      ConfigVersion: 1,
      Hero: [],
      Rows: [
        { Id: 't1', Type: 'Top10Movies', Title: 'Top 10 Movies This Week', Items: [], Entries: [entry] },
        // Trakt has no list yet: the server fills the row from Seerr's trending titles, and says so.
        {
          Id: 't2',
          Type: 'Top10Shows',
          Title: 'Top 10 Shows This Week',
          Items: [],
          Entries: [entry],
          Source: 'Seerr',
        },
      ],
    };
    const ctx = makeContext(createFakeClient(routes({ 'Lumen/Home': top10 })), {
      config: { ...testConfig, Charts: true },
    });
    render(<HomeView ctx={ctx} />);

    const movies = await screen.findByRole('region', { name: 'Top 10 Movies This Week' });
    expect(within(movies).getByRole('link', { name: /see all/ })).toHaveAttribute(
      'href',
      '#/home?lumen=charts&chart=movies&period=weekly',
    );
    const shows = screen.getByRole('region', { name: 'Top 10 Shows This Week' });
    expect(within(shows).queryByRole('link', { name: /see all/ })).toBeNull();
  });

  it('falls back to stock when home is empty', async () => {
    const ctx = makeContext(
      createFakeClient(routes({ 'Lumen/Home': { ConfigVersion: 1, Hero: [], Rows: [] } })),
    );
    render(<HomeView ctx={ctx} />);

    await waitFor(() => expect(ctx.onFallback).toHaveBeenCalled());
  });

  it('drops a stale cached home when the fresh home is empty', async () => {
    setCachedHome('user1', home);
    const ctx = makeContext(
      createFakeClient(routes({ 'Lumen/Home': { ConfigVersion: 2, Hero: [], Rows: [] } })),
    );
    render(<HomeView ctx={ctx} />);

    await waitFor(() => expect(ctx.onFallback).toHaveBeenCalled());
    expect(getCachedHome('user1')).toBeUndefined();
  });

  describe('with a request that never answers', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('falls back to stock after 10 seconds when nothing is cached', async () => {
      setCachedHome('user1', { ConfigVersion: 0, Hero: [], Rows: [] });
      const ctx = makeContext(createFakeClient(() => new Promise(() => undefined)));
      render(<HomeView ctx={ctx} />);

      await vi.advanceTimersByTimeAsync(9_999);
      expect(ctx.onFallback).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(ctx.onFallback).toHaveBeenCalledTimes(1);
    });

    it('keeps showing a usable cached home instead of falling back', async () => {
      setCachedHome('user1', home);
      const ctx = makeContext(createFakeClient(() => new Promise(() => undefined)));
      render(<HomeView ctx={ctx} />);

      await vi.advanceTimersByTimeAsync(11_000);

      expect(ctx.onFallback).not.toHaveBeenCalled();
      expect(screen.getByRole('link', { name: 'Alpha' })).toBeInTheDocument();
    });
  });

  it('falls back to stock when the request fails and nothing is cached', async () => {
    const ctx = makeContext(createFakeClient(() => Promise.reject(new Error('down'))));
    render(<HomeView ctx={ctx} />);

    await waitFor(() => expect(ctx.onFallback).toHaveBeenCalled(), { timeout: 2000 });
  });

  it('shows the cached home instantly and keeps it when the refresh fails', async () => {
    setCachedHome('user1', home);
    const ctx = makeContext(createFakeClient(() => Promise.reject(new Error('down'))));
    render(<HomeView ctx={ctx} />);

    expect(screen.getByRole('link', { name: 'Alpha' })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 700));
    expect(ctx.onFallback).not.toHaveBeenCalled();
  });

  it('falls back to stock when the cached home is empty and the refresh fails', async () => {
    setCachedHome('user1', { ConfigVersion: 1, Hero: [], Rows: [] });
    const ctx = makeContext(createFakeClient(() => Promise.reject(new Error('down'))));
    const { container } = render(<HomeView ctx={ctx} />);

    expect(container.querySelector('.lmn-home--loading')).not.toBeNull();
    await waitFor(() => expect(ctx.onFallback).toHaveBeenCalled(), { timeout: 2000 });
    expect(container.querySelector('.lmn-row')).toBeNull();
  });

  it("does not show another user's cached home", () => {
    setCachedHome('someone-else', home);
    render(<HomeView ctx={makeContext(createFakeClient(() => new Promise(() => undefined)))} />);

    expect(screen.queryByRole('button', { name: 'Alpha' })).toBeNull();
  });

  it('remembers the selected card so returning home can restore it', async () => {
    const ctx = makeContext(createFakeClient(routes({ 'Lumen/Home': home })));
    render(<HomeView ctx={ctx} />);

    fireEvent.click(await screen.findByRole('link', { name: 'Alpha' }));

    expect(getSelection('user1')?.itemId).toBe('m1');
  });

  it('remembers a catalog card too (a Top 10 title not on the server), in its row', async () => {
    const top10: HomeResponse = {
      ConfigVersion: 1,
      Hero: [],
      Rows: [
        ...home.Rows,
        {
          Id: 'r10',
          Type: 'Top10Movies',
          Title: 'Top 10 Movies This Week',
          Items: [],
          Entries: [
            {
              Catalog: {
                Key: 'movie-603',
                MediaType: 'movie',
                TmdbId: 603,
                Title: 'The Matrix',
                GenreNames: [],
                State: 'Requested',
              },
            },
          ],
        },
      ],
    };
    const ctx = makeContext(createFakeClient(routes({ 'Lumen/Home': top10 })));
    render(<HomeView ctx={ctx} />);
    // An earlier visit to a library card: Back from the catalog title mustn't return to that one.
    fireEvent.click(await screen.findByRole('link', { name: 'Alpha' }));

    fireEvent.click(screen.getByRole('button', { name: '1, The Matrix, Requested' }));

    expect(ctx.navigate).toHaveBeenLastCalledWith('#/home?title=movie-603');
    expect(getSelection('user1')).toMatchObject({ itemId: 'movie-603', rowId: 'r10' });
  });

  describe('hero Play on a series', () => {
    const seriesHome: HomeResponse = {
      ConfigVersion: 1,
      Rows: [],
      Hero: [{ Item: { Id: 'ser1', Name: 'The Show', Type: 'Series', ServerId: 's' }, TrailerItemId: null }],
    };

    it('plays the resumable episode with its ticks, not the series id', async () => {
      const client = createFakeClient(
        routes({
          'Lumen/Home': seriesHome,
          'UserItems/Resume': {
            Items: [{ Id: 'ep9', Name: 'Nine', Type: 'Episode', UserData: { PlaybackPositionTicks: 555 } }],
          },
          'Shows/NextUp': { Items: [] },
          Sessions: [{ Id: 's1', DeviceId: 'dev+ice' }],
          'Sessions/s1/Playing': {},
        }),
      );
      render(<HomeView ctx={makeContext(client)} />);

      fireEvent.click(await screen.findByRole('button', { name: 'Play' }));

      await waitFor(() =>
        expect(client.requests.at(-1)?.url).toContain(
          'Sessions/s1/Playing?playCommand=PlayNow&itemIds=ep9&startPositionTicks=555',
        ),
      );
    });

    it('opens the details page when nothing is playable', async () => {
      const client = createFakeClient(
        routes({
          'Lumen/Home': seriesHome,
          'UserItems/Resume': { Items: [] },
          'Shows/NextUp': { Items: [] },
          'Shows/ser1/Seasons': { Items: [] },
        }),
      );
      const ctx = makeContext(client);
      render(<HomeView ctx={ctx} />);

      fireEvent.click(await screen.findByRole('button', { name: 'Play' }));

      await waitFor(() => expect(ctx.navigate).toHaveBeenCalledWith('#/details?id=ser1&serverId=s'));
      expect(client.requests.some((r) => r.url.includes('Sessions'))).toBe(false);
    });
  });
});
