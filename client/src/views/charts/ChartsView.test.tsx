import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient, routes } from '../../../test/fakeClient';
import { makeContext, testConfig } from '../../../test/viewContext';
import type { AjaxRequest } from '../../compat/jellyfin';
import type { CatalogItem, ChartEntry, ChartPage } from '../../api/types';
import { resetSessionCaches } from '../../util/sessionCaches';
import { chartFromHash } from './chartsRoute';
import { CHART_PAGE, ChartsView } from './ChartsView';

const catalog = (tmdbId: number, title: string, state: CatalogItem['State'] = 'None'): CatalogItem => ({
  Key: `movie-${tmdbId}`,
  MediaType: 'movie',
  TmdbId: tmdbId,
  Title: title,
  Year: 2026,
  GenreNames: [],
  Poster: 'p.jpg',
  State: state,
});
const owned = (rank: number, name: string): ChartEntry => ({
  Rank: rank,
  Item: {
    Id: `i${rank}`,
    Name: name,
    Type: 'Movie',
    ServerId: 's',
    ProductionYear: 2001,
    ImageTags: { Primary: 'p' },
  },
});

/** IntersectionObserver as jsdom lacks it: each observer can be told its target came into view. */
const observers: { callback: IntersectionObserverCallback; target: Element | null }[] = [];
class FakeObserver {
  private readonly entry: { callback: IntersectionObserverCallback; target: Element | null };
  constructor(callback: IntersectionObserverCallback) {
    this.entry = { callback, target: null };
    observers.push(this.entry);
  }
  observe(target: Element): void {
    this.entry.target = target;
  }
  disconnect(): void {
    observers.splice(observers.indexOf(this.entry), 1);
  }
}
const scrollToEnd = (): void =>
  observers.forEach((o) =>
    o.callback(
      [{ isIntersecting: true, target: o.target } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ),
  );

function setup(
  chart: (request: AjaxRequest) => ChartPage,
  status = { Enabled: true, CanRequestMovies: true },
) {
  const client = createFakeClient(
    routes({
      'Lumen/Charts/movies/weekly': chart,
      'Lumen/Charts/movies/monthly': chart,
      'Lumen/Charts/shows/weekly': chart,
      'Lumen/Requests/Status': { ...status, CanRequestTv: true, ImageToken: 't' },
    }),
  );
  const ctx = makeContext(client, { config: { ...testConfig, Charts: true } });
  return { client, ctx };
}

const page = (entries: ChartEntry[], total = entries.length, start = 0): ChartPage => ({
  Entries: entries,
  TotalCount: total,
  StartIndex: start,
});

beforeEach(() => {
  window.location.hash = '#/home?lumen=charts';
  vi.stubGlobal('IntersectionObserver', FakeObserver);
});
afterEach(() => {
  resetSessionCaches();
  vi.unstubAllGlobals();
  observers.length = 0;
});

describe('chartFromHash', () => {
  it('reads the chart and period, Movies and This week otherwise', () => {
    expect(chartFromHash('#/home?lumen=charts&chart=shows&period=yearly')).toEqual({
      chart: 'shows',
      period: 'yearly',
    });
    expect(chartFromHash('#/home?lumen=charts')).toEqual({ chart: 'movies', period: 'weekly' });
    expect(chartFromHash('#/home?lumen=charts&chart=people&period=daily')).toEqual({
      chart: 'movies',
      period: 'weekly',
    });
  });
});

describe('ChartsView', () => {
  it('ranks titles with their true Trakt rank: owned ones open their page, the rest can be requested', async () => {
    const { ctx } = setup(() =>
      page([
        owned(1, 'Alpha'),
        { Rank: 2, Catalog: catalog(603, 'The Matrix') },
        { Rank: 4, Catalog: catalog(604, 'Reloaded', 'Requested') },
      ]),
    );
    render(<ChartsView ctx={ctx} />);

    const list = await screen.findByRole('list', { name: 'Top movies this week' });
    const cells = within(list).getAllByRole('listitem');
    expect(cells.map((c) => c.querySelector('.lmn-charts__rank')?.textContent)).toEqual(['1', '2', '4']);
    cells.forEach((c) => expect(c.querySelector('.lmn-charts__rank')).toHaveAttribute('aria-hidden', 'true'));
    expect(cells[0]).toHaveClass('is-top');
    expect(within(list).getByRole('link', { name: '1, Alpha' })).toHaveClass('lmn-card--poster');
    // Year and type under each card.
    expect(within(list).getByRole('link', { name: '1, Alpha' })).toHaveTextContent('2001');
    expect(within(list).getByRole('button', { name: '4, Reloaded, Requested' })).toHaveTextContent('Movie');
    // Only a title nobody has requested yet offers Request (once the user's request rights are in).
    expect(await within(list).findByRole('button', { name: 'Request The Matrix' })).toBeInTheDocument();
    expect(within(list).getAllByRole('button', { name: /^Request / })).toHaveLength(1);

    // The button under it requests; the card itself opens the title's page.
    fireEvent.click(within(list).getByRole('button', { name: '2, The Matrix' }));
    expect(ctx.navigate).toHaveBeenCalledWith('#/home?title=movie-603');
  });

  it('switches between movies and shows, and between periods, keeping the choice in the URL', async () => {
    const asked: string[] = [];
    const { ctx } = setup((request) => {
      asked.push(new URL(request.url).pathname);
      return page([owned(1, new URL(request.url).pathname)]);
    });
    render(<ChartsView ctx={ctx} />);
    await screen.findByRole('list', { name: 'Top movies this week' });

    const type = screen.getByRole('group', { name: 'Movies or shows' });
    expect(within(type).getByRole('button', { name: 'Movies' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(type).getByRole('button', { name: 'Shows' }));
    await screen.findByRole('list', { name: 'Top shows this week' });
    expect(window.location.hash).toBe('#/home?lumen=charts&chart=shows&period=weekly');

    fireEvent.click(within(type).getByRole('button', { name: 'Movies' }));
    const periods = screen.getByRole('group', { name: 'Period' });
    expect(
      within(periods)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['This week', 'This month', 'This year', 'All time']);
    fireEvent.click(within(periods).getByRole('button', { name: 'This month' }));
    await screen.findByRole('list', { name: 'Top movies this month' });
    expect(window.location.hash).toBe('#/home?lumen=charts&chart=movies&period=monthly');

    // A chart seen before this session comes back at once, without asking again.
    expect(asked).toEqual([
      '/Lumen/Charts/movies/weekly',
      '/Lumen/Charts/shows/weekly',
      '/Lumen/Charts/movies/monthly',
    ]);
  });

  it('TV: focuses the chart switch as the page opens, then leaves focus on the chip the user picks', async () => {
    const { ctx } = setup(() => page([owned(1, 'Alpha')]));
    render(<ChartsView ctx={{ ...ctx, layout: 'tv' }} />);

    await screen.findByRole('list', { name: 'Top movies this week' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Movies' })).toHaveFocus());
    const month = screen.getByRole('button', { name: 'This month' });
    month.focus();
    fireEvent.click(month);
    await screen.findByRole('list', { name: 'Top movies this month' });
    // Long enough for the new chart’s effects to run: focus must not move.
    await new Promise((r) => setTimeout(r, 50));
    expect(month).toHaveFocus();
  });

  it('back on a chart it has, while another is still loading, shows it ready', async () => {
    let releaseShows: (p: ChartPage) => void = () => undefined;
    const { ctx } = setup((request) =>
      request.url.includes('/shows/')
        ? (new Promise<ChartPage>((resolve) => (releaseShows = resolve)) as unknown as ChartPage)
        : page([owned(1, 'Alpha')], 30),
    );
    render(<ChartsView ctx={ctx} />);
    const movies = await screen.findByRole('list', { name: 'Top movies this week' });
    expect(movies).toHaveAttribute('aria-busy', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Shows' }));
    await waitFor(() =>
      expect(screen.getByRole('list', { name: 'Top shows this week' })).toHaveAttribute('aria-busy', 'true'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Movies' }));

    const again = await screen.findByRole('list', { name: 'Top movies this week' });
    expect(again).toHaveAttribute('aria-busy', 'false');
    expect(within(again).getByRole('link', { name: '1, Alpha' })).toBeInTheDocument();
    // The shows chart landing late changes nothing here.
    act(() => releaseShows(page([owned(1, 'Show')])));
    expect(screen.getByRole('list', { name: 'Top movies this week' })).toHaveAttribute('aria-busy', 'false');
  });

  it('opens on the chart and period in the URL', async () => {
    window.location.hash = '#/home?lumen=charts&chart=shows&period=weekly';
    const { ctx } = setup(() => page([owned(1, 'Show')]));
    render(<ChartsView ctx={ctx} />);

    expect(await screen.findByRole('list', { name: 'Top shows this week' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Shows' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('loads a page at a time as the end of the grid nears the screen, up to the chart’s end', async () => {
    const starts: number[] = [];
    const { ctx } = setup((request) => {
      const start = Number(new URL(request.url).searchParams.get('startIndex'));
      expect(new URL(request.url).searchParams.get('limit')).toBe(String(CHART_PAGE));
      starts.push(start);
      const count = Math.min(CHART_PAGE, 30 - start);
      return page(
        Array.from({ length: count }, (_, i) => owned(start + i + 1, `T${start + i + 1}`)),
        30,
        start,
      );
    });
    render(<ChartsView ctx={ctx} />);

    const list = await screen.findByRole('list', { name: 'Top movies this week' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(CHART_PAGE);
    // Preact runs effects after the paint: the grid's end is watched once it has.
    await waitFor(() => expect(observers).toHaveLength(1));
    act(scrollToEnd);
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(30));
    expect(starts).toEqual([0, CHART_PAGE]);
    // The end: nothing more to load.
    expect(document.querySelector('.lmn-browse-grid__sentinel')).toBeNull();
  });

  it('says when none of the chart’s titles can be shown', async () => {
    const { ctx } = setup(() => page([], 0));
    render(<ChartsView ctx={ctx} />);

    expect(await screen.findByText('Nothing here yet')).toBeInTheDocument();
    expect(screen.getByText("None of this chart's titles are on this server.")).toBeInTheDocument();
  });

  it('offers Try again when the chart can’t load', async () => {
    let fail = true;
    const { ctx } = setup(() => {
      if (fail) throw new Error('503');
      return page([owned(1, 'Alpha')]);
    });
    render(<ChartsView ctx={ctx} />);

    const retry = await screen.findByRole('button', { name: 'Try again' });
    fail = false;
    fireEvent.click(retry);
    expect(await screen.findByRole('link', { name: '1, Alpha' })).toBeInTheDocument();
  });

  it('shows no Request button when the user may not request movies', async () => {
    const { ctx, client } = setup(() => page([{ Rank: 1, Catalog: catalog(603, 'The Matrix') }]), {
      Enabled: true,
      CanRequestMovies: false,
    });
    render(<ChartsView ctx={ctx} />);

    expect(await screen.findByRole('button', { name: '1, The Matrix, Request' })).toBeInTheDocument();
    await waitFor(() => expect(client.requests.some((r) => r.url.includes('Requests/Status'))).toBe(true));
    expect(screen.queryByRole('button', { name: 'Request The Matrix' })).toBeNull();
  });
});
