import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient, routes } from '../../../test/fakeClient';
import { makeContext } from '../../../test/viewContext';
import type { CatalogItem, CatalogTitle, HomeResponse, HomeRow } from '../../api/types';
import { resetSessionCaches } from '../../util/sessionCaches';
import { HomeView } from './HomeView';
import { setCachedHome } from './homeStore';
import { Row } from './Row';
import { isTop10Row, isTraktRow } from './Top10Item';

const matrix: CatalogItem = {
  Key: 'movie-603',
  MediaType: 'movie',
  TmdbId: 603,
  Title: 'The Matrix',
  GenreNames: [],
  Poster: 'matrix.jpg',
  State: 'None',
};
const requested: CatalogItem = {
  ...matrix,
  Key: 'movie-604',
  TmdbId: 604,
  Title: 'Reloaded',
  State: 'Requested',
};

const top10: HomeRow = {
  Id: 't1',
  Type: 'Top10Movies',
  Title: 'Top 10 Movies This Week',
  Items: [],
  Entries: [
    { Item: { Id: 'm1', Name: 'Alpha', Type: 'Movie', ServerId: 's', ImageTags: { Primary: 'p' } } },
    { Catalog: matrix },
    { Catalog: requested },
  ],
};

describe('Top 10 rows', () => {
  it('recognises both Top 10 section types', () => {
    expect(isTop10Row(top10)).toBe(true);
    expect(isTop10Row({ ...top10, Type: 'Top10Shows' })).toBe(true);
    expect(isTop10Row({ ...top10, Type: 'CatalogTrending' })).toBe(false);
  });

  it('ranks the cards 1..n with decorative numerals, the rank read first in each card’s name', () => {
    const { container } = render(
      <Row row={top10} client={createFakeClient()} onSelect={vi.fn()} catalogImageToken="tok" />,
    );

    const row = screen.getByRole('region', { name: 'Top 10 Movies This Week' });
    expect(row).toHaveClass('lmn-row--top10');
    const numerals = [...container.querySelectorAll('.lmn-top10__rank')];
    expect(numerals.map((n) => n.textContent)).toEqual(['1', '2', '3']);
    numerals.forEach((n) => expect(n).toHaveAttribute('aria-hidden', 'true'));
    expect(within(row).getByRole('link', { name: '1, Alpha' })).toHaveClass('lmn-card--poster');
    expect(within(row).getByRole('button', { name: '2, The Matrix, Request' })).toHaveClass(
      'lmn-card--poster',
    );
    expect(within(row).getByRole('button', { name: '3, Reloaded, Requested' })).toBeInTheDocument();
  });

  it('offers Request under titles the user can request, and opens the title page from the card', () => {
    const onRequest = vi.fn();
    const onSelectCatalog = vi.fn();
    const onSelect = vi.fn();
    render(
      <Row
        row={top10}
        client={createFakeClient()}
        onSelect={onSelect}
        onSelectCatalog={onSelectCatalog}
        canRequest={(item) => item.MediaType === 'movie'}
        onRequest={onRequest}
      />,
    );

    // Only the title not yet requested gets the button, and then its card's own "Request" tab is left out, from its
    // name too: the card opens the title, and only the button requests it.
    const buttons = screen.getAllByRole('button', { name: /^Request / });
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Request The Matrix']);
    expect(
      screen.getByRole('button', { name: '2, The Matrix' }).querySelector('.lmn-card__state'),
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: '3, Reloaded, Requested' }).querySelector('.lmn-card__state'),
    ).not.toBeNull();

    fireEvent.click(buttons[0]!);
    expect(onRequest).toHaveBeenCalledWith(matrix);
    fireEvent.click(screen.getByRole('button', { name: '2, The Matrix' }));
    // With its row, as a library card is: home remembers both, for Back.
    expect(onSelectCatalog).toHaveBeenCalledWith(matrix, top10);
    fireEvent.click(screen.getByRole('link', { name: '1, Alpha' }));
    expect(onSelect).toHaveBeenCalledWith(top10.Entries![0]!.Item, top10);
  });

  it('shows no Request button when the user may not request that kind of title', () => {
    render(
      <Row
        row={top10}
        client={createFakeClient()}
        onSelect={vi.fn()}
        canRequest={() => false}
        onRequest={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: /^Request / })).toBeNull();
    // The card still says it isn't here yet.
    expect(
      screen.getByRole('button', { name: '2, The Matrix, Request' }).querySelector('.lmn-card__state'),
    ).not.toBeNull();
  });
});

describe('Trakt rows', () => {
  const trending: HomeRow = { ...top10, Id: 't2', Type: 'TraktTrendingMovies', Title: 'Trending Movies' };

  it('recognises Trakt’s other section types, and not Top 10 or the catalog rows', () => {
    for (const Type of [
      'TraktBoxOffice',
      'TraktAnticipatedMovies',
      'TraktAnticipatedShows',
      'TraktTrendingMovies',
      'TraktTrendingShows',
      'TraktList',
    ])
      expect(isTraktRow({ ...top10, Type })).toBe(true);
    expect(isTraktRow(top10)).toBe(false);
    expect(isTraktRow({ ...top10, Type: 'CatalogTrending' })).toBe(false);
  });

  it('shows Top 10’s poster cards and Request button, without numerals or ranks', () => {
    const onRequest = vi.fn();
    const { container } = render(
      <Row
        row={trending}
        client={createFakeClient()}
        onSelect={vi.fn()}
        catalogImageToken="tok"
        canRequest={() => true}
        onRequest={onRequest}
      />,
    );

    const row = screen.getByRole('region', { name: 'Trending Movies' });
    expect(row).toHaveClass('lmn-row--trakt');
    expect(row).not.toHaveClass('lmn-row--top10');
    expect(container.querySelector('.lmn-top10__rank')).toBeNull();
    expect(within(row).getByRole('link', { name: 'Alpha' })).toHaveClass('lmn-card--poster');
    fireEvent.click(within(row).getByRole('button', { name: 'Request The Matrix' }));
    expect(onRequest).toHaveBeenCalledWith(matrix);
  });

  it('links a row’s title to Top charts when asked, with See all', () => {
    render(<Row row={top10} client={createFakeClient()} onSelect={vi.fn()} seeAll="#/home?lumen=charts" />);

    const link = screen.getByRole('link', { name: 'Top 10 Movies This Week, see all in Top charts' });
    expect(link).toHaveAttribute('href', '#/home?lumen=charts');
    // A space between the two: run together, the link's text ("…This WeekSee all") isn't part of its name ("…This
    // Week, see all in Top charts"), which speech input goes by (axe's label-content-name-mismatch).
    expect(link).toHaveTextContent('Top 10 Movies This Week See all');
    expect(link.querySelector('.lmn-row__link-text')).toHaveTextContent('Top 10 Movies This Week');
  });

  it('has a plain title otherwise', () => {
    render(<Row row={top10} client={createFakeClient()} onSelect={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Top 10 Movies This Week' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /see all/ })).toBeNull();
  });
});

describe('Top 10 on the home screen', () => {
  beforeEach(() => setCachedHome('nobody', { ConfigVersion: 0, Hero: [], Rows: [] }));
  afterEach(() => resetSessionCaches());

  const title: CatalogTitle = {
    ...matrix,
    Cast: [],
    Seasons: [],
    Recommendations: [],
    CanRequest: true,
  };
  const homeWithTop10: HomeResponse = { ConfigVersion: 1, Hero: [], Rows: [top10] };

  it('links the Top 10 rows to their Top chart only when there is a Trakt key', async () => {
    const shows: HomeRow = { ...top10, Id: 't3', Type: 'TraktTrendingShows', Title: 'Trending Shows' };
    const home: HomeResponse = {
      ConfigVersion: 1,
      Hero: [],
      Rows: [top10, { ...top10, Id: 't4', Type: 'Top10Shows', Title: 'Top 10 Shows This Week' }, shows],
    };
    const client = createFakeClient(
      routes({
        'Lumen/Home': home,
        'Lumen/Requests/Status': { Enabled: false, CanRequestMovies: false, CanRequestTv: false },
      }),
    );
    const { unmount } = render(
      <HomeView ctx={makeContext(client, { config: { ...makeContext(client).config, Charts: true } })} />,
    );

    expect(await screen.findByRole('link', { name: /^Top 10 Movies This Week, see all/ })).toHaveAttribute(
      'href',
      '#/home?lumen=charts&chart=movies&period=weekly',
    );
    expect(screen.getByRole('link', { name: /^Top 10 Shows This Week, see all/ })).toHaveAttribute(
      'href',
      '#/home?lumen=charts&chart=shows&period=weekly',
    );
    // Trakt's other rows have no chart of their own.
    expect(screen.queryByRole('link', { name: /^Trending Shows/ })).toBeNull();
    unmount();

    render(<HomeView ctx={makeContext(client)} />);
    await screen.findByRole('region', { name: 'Top 10 Movies This Week' });
    expect(screen.queryByRole('link', { name: /see all/ })).toBeNull();
  });

  it('requests a title from its card in place, and the card takes the new state', async () => {
    const requests: unknown[] = [];
    const ctx = makeContext(
      createFakeClient(
        routes({
          'Lumen/Home': homeWithTop10,
          'Lumen/Requests/Status': {
            Enabled: true,
            CanRequestMovies: true,
            CanRequestTv: false,
            ImageToken: 't',
          },
          'Lumen/Requests/Title/movie/603': title,
          'Lumen/Requests': (request: { data?: string }) => {
            requests.push(JSON.parse(request.data ?? '{}'));
            return { State: 'Requested', NeedsApproval: false };
          },
        }),
      ),
    );
    render(<HomeView ctx={ctx} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Request The Matrix' }));
    // A moment of "Loading…" while Seerr's details come, then the title page's own dialog.
    fireEvent.click(await screen.findByRole('button', { name: 'Request' }));
    const dialog = screen.getByRole('dialog', { name: 'Request The Matrix' });

    expect(await within(dialog).findByText(/Requested\. It will appear/)).toBeInTheDocument();
    expect(requests).toEqual([{ MediaType: 'movie', TmdbId: 603, Seasons: null }]);
    expect(ctx.navigate).not.toHaveBeenCalled();
    // Requested: the button goes and the card says so.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Request The Matrix' })).toBeNull());
    expect(screen.getByRole('button', { name: '2, The Matrix, Requested' })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it("says so when the title can't be requested any more, and closes on Back", async () => {
    const ctx = makeContext(
      createFakeClient(
        routes({
          'Lumen/Home': homeWithTop10,
          'Lumen/Requests/Status': {
            Enabled: true,
            CanRequestMovies: true,
            CanRequestTv: true,
            ImageToken: 't',
          },
          'Lumen/Requests/Title/movie/603': { ...title, State: 'Requested', CanRequest: false },
        }),
      ),
    );
    render(<HomeView ctx={ctx} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Request The Matrix' }));
    const dialog = await screen.findByRole('dialog', { name: 'Request The Matrix' });
    expect(await within(dialog).findByText('Requested')).toBeInTheDocument();
    fireEvent.keyDown(within(dialog).getByRole('button', { name: 'Close' }), { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: '2, The Matrix, Requested' })).toBeInTheDocument();
  });
});
