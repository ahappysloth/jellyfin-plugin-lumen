import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient, routes } from '../../../test/fakeClient';
import { makeContext } from '../../../test/viewContext';
import type { CatalogItem, CatalogTitle, HomeResponse, HomeRow } from '../../api/types';
import { resetSessionCaches } from '../../util/sessionCaches';
import { HomeView } from './HomeView';
import { setCachedHome } from './homeStore';
import { Row } from './Row';
import { isTop10Row } from './Top10Item';

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
    expect(onSelectCatalog).toHaveBeenCalledWith(matrix);
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
