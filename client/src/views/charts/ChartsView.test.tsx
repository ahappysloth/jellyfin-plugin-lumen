import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient, routes } from '../../../test/fakeClient';
import { makeContext, testConfig } from '../../../test/viewContext';
import type { AjaxRequest } from '../../compat/jellyfin';
import type { CatalogItem, ChartEntry, ChartPage } from '../../api/types';
import { resetSessionCaches } from '../../util/sessionCaches';
import { chartFromHash } from './chartsRoute';
import { CHART_PAGE, CHART_STALE_AFTER, ChartsView } from './ChartsView';

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
  vi.useRealTimers();
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
    // Short labels on a phone, where four chips share the width (browse.css); the full names are the buttons' names.
    expect(
      within(periods)
        .getAllByRole('button')
        .map((b) => [b.getAttribute('aria-label'), b.querySelector('.lmn-chip__short')?.textContent]),
    ).toEqual([
      ['This week', 'Week'],
      ['This month', 'Month'],
      ['This year', 'Year'],
      ['All time', 'All time'],
    ]);
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

  it('TV: Back from a card focuses it, and it keeps focus through the re-renders that follow', async () => {
    const { ctx } = setup(() =>
      page([owned(1, 'Alpha'), owned(2, 'Beta'), { Rank: 3, Catalog: catalog(603, 'The Matrix') }]),
    );
    const tv = { ...ctx, layout: 'tv' as const };
    const first = render(<ChartsView ctx={tv} />);
    fireEvent.click(await screen.findByRole('link', { name: '2, Beta' }));
    expect(tv.navigate).toHaveBeenCalledWith(expect.stringContaining('id=i2'));
    first.unmount();

    // Back: the chart is drawn from this session's copy, with the card the user left focused.
    render(<ChartsView ctx={tv} />);
    const beta = screen.getByRole('link', { name: '2, Beta' });
    await waitFor(() => expect(beta).toHaveFocus());
    // The user's request rights come in after (a re-render): focus stays on the card, not the chart switch.
    expect(await screen.findByRole('button', { name: 'Request The Matrix' })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(beta).toHaveFocus();
  });

  it('Back: the page goes back where it was, even when jellyfin-web scrolls to the top as it shows its page', async () => {
    const { ctx } = setup(() => page([owned(1, 'Alpha'), owned(2, 'Beta')]));
    const first = render(<ChartsView ctx={ctx} />);
    const scrollY = vi.spyOn(window, 'scrollY', 'get').mockReturnValue(900);
    fireEvent.click(await screen.findByRole('link', { name: '2, Beta' }));
    scrollY.mockRestore();
    first.unmount();

    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    render(<ChartsView ctx={ctx} />);
    expect(scrollTo).toHaveBeenCalledWith({ top: 900 });
    scrollTo.mockClear();
    // libraryMenu's viewshow: jellyfin-web scrolls to the top, then Lumen puts the page back.
    document.dispatchEvent(new CustomEvent('viewshow'));
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 900 }));
    scrollTo.mockRestore();
  });

  it('Back puts the page where it was once: picking the chart again later doesn’t jump there', async () => {
    const { ctx } = setup((request) =>
      request.url.includes('/shows/')
        ? (new Promise<ChartPage>(() => undefined) as unknown as ChartPage)
        : page([owned(1, 'Alpha'), owned(2, 'Beta')]),
    );
    const first = render(<ChartsView ctx={ctx} />);
    const scrollY = vi.spyOn(window, 'scrollY', 'get').mockReturnValue(900);
    fireEvent.click(await screen.findByRole('link', { name: '2, Beta' }));
    scrollY.mockRestore();
    first.unmount();

    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    render(<ChartsView ctx={ctx} />);
    expect(scrollTo).toHaveBeenCalledWith({ top: 900 });
    scrollTo.mockClear();

    // Shows (still loading: nothing drawn), then Movies again, drawn from its copy: no jump back to 900.
    fireEvent.click(screen.getByRole('button', { name: 'Shows' }));
    await waitFor(() =>
      expect(screen.getByRole('list', { name: 'Top shows this week' })).toHaveAttribute('aria-busy', 'true'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Movies' }));
    await screen.findByRole('link', { name: '2, Beta' });
    document.dispatchEvent(new CustomEvent('viewshow'));
    await new Promise((r) => setTimeout(r, 20));
    expect(scrollTo).not.toHaveBeenCalled();
    scrollTo.mockRestore();
  });

  it('left while its first page loads and opened again: the page that lands is shown', async () => {
    let release: (p: ChartPage) => void = () => undefined;
    let asked = 0;
    const { ctx } = setup(() => {
      asked++;
      return new Promise<ChartPage>((resolve) => (release = resolve)) as unknown as ChartPage;
    });
    const first = render(<ChartsView ctx={ctx} />);
    await waitFor(() => expect(asked).toBe(1));
    first.unmount();

    render(<ChartsView ctx={ctx} />);
    const list = screen.getByRole('list', { name: 'Top movies this week' });
    expect(list).toHaveAttribute('aria-busy', 'true');
    await act(async () => {
      release(page([owned(1, 'Alpha')]));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(await within(list).findByRole('link', { name: '1, Alpha' })).toBeInTheDocument();
    expect(list).toHaveAttribute('aria-busy', 'false');
    expect(asked).toBe(1);
  });

  it('left while its first page loads and opened again: a failure offers Try again', async () => {
    let fail: () => void = () => undefined;
    const { ctx } = setup(
      () =>
        new Promise<ChartPage>(
          (_, reject) => (fail = () => reject(new Error('503'))),
        ) as unknown as ChartPage,
    );
    const first = render(<ChartsView ctx={ctx} />);
    first.unmount();

    render(<ChartsView ctx={ctx} />);
    await act(async () => {
      fail();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Top movies this week' })).toHaveAttribute('aria-busy', 'false');
  });

  it('Back from a card while the next page loads: the page lands in the grid, and the rest still load', async () => {
    const starts: number[] = [];
    let releaseSecond: () => void = () => undefined;
    const titles = (from: number, count: number) =>
      Array.from({ length: count }, (_, i) => owned(from + i + 1, `T${from + i + 1}`));
    const { ctx } = setup((request) => {
      const start = Number(new URL(request.url).searchParams.get('startIndex'));
      starts.push(start);
      if (start === CHART_PAGE)
        return new Promise<ChartPage>((resolve) => {
          releaseSecond = () => resolve(page(titles(CHART_PAGE, CHART_PAGE), 60, CHART_PAGE));
        }) as unknown as ChartPage;
      return page(titles(start, Math.min(CHART_PAGE, 60 - start)), 60, start);
    });
    const first = render(<ChartsView ctx={ctx} />);
    await screen.findByRole('list', { name: 'Top movies this week' });
    await waitFor(() => expect(observers).toHaveLength(1));
    act(scrollToEnd);
    await waitFor(() => expect(starts).toEqual([0, CHART_PAGE]));
    fireEvent.click(screen.getByRole('link', { name: '2, T2' }));
    first.unmount();

    render(<ChartsView ctx={ctx} />);
    const list = screen.getByRole('list', { name: 'Top movies this week' });
    expect(list).toHaveAttribute('aria-busy', 'true');
    await act(async () => {
      releaseSecond();
      await new Promise((r) => setTimeout(r, 0));
    });
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(2 * CHART_PAGE));
    expect(list).toHaveAttribute('aria-busy', 'false');
    // The grid's end is watched again: the third page loads.
    await waitFor(() => expect(observers).toHaveLength(1));
    act(scrollToEnd);
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(60));
    expect(starts).toEqual([0, CHART_PAGE, 2 * CHART_PAGE]);
  });

  it('TV: Back from a catalog card focuses it too', async () => {
    const { ctx } = setup(() => page([owned(1, 'Alpha'), { Rank: 2, Catalog: catalog(603, 'The Matrix') }]));
    const tv = { ...ctx, layout: 'tv' as const };
    const first = render(<ChartsView ctx={tv} />);
    fireEvent.click(await screen.findByRole('button', { name: '2, The Matrix' }));
    first.unmount();

    render(<ChartsView ctx={tv} />);
    // Named "…, Request" until the user's request rights are in (the Request button under it then says so instead).
    const matrix = screen.getByRole('button', { name: /^2, The Matrix/ });
    await waitFor(() => expect(matrix).toHaveFocus());
    expect(await screen.findByRole('button', { name: 'Request The Matrix' })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(matrix).toHaveFocus();
  });

  it('back on a chart it has, while another is still loading: the late one lands in its own chart, not this one', async () => {
    let releaseShows: (p: ChartPage) => void = () => undefined;
    let showsAsked = 0;
    const { ctx } = setup((request) => {
      if (!request.url.includes('/shows/')) return page([owned(1, 'Alpha')], 30);
      showsAsked++;
      return new Promise<ChartPage>((resolve) => (releaseShows = resolve)) as unknown as ChartPage;
    });
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

    // The shows chart landing late changes nothing here…
    await act(async () => {
      releaseShows(page([owned(1, 'Show')]));
      await new Promise((r) => setTimeout(r, 0));
    });
    const still = screen.getByRole('list', { name: 'Top movies this week' });
    expect(within(still).queryByRole('link', { name: '1, Show' })).toBeNull();
    expect(within(still).getByRole('link', { name: '1, Alpha' })).toBeInTheDocument();
    expect(still).toHaveAttribute('aria-busy', 'false');

    // …but is kept for its own chart: back on Shows, it's there at once, without asking again.
    fireEvent.click(screen.getByRole('button', { name: 'Shows' }));
    expect(await screen.findByRole('link', { name: '1, Show' })).toBeInTheDocument();
    expect(showsAsked).toBe(1);
  });

  it('a page still loading when the user switches chart and back is waited for, not asked for again', async () => {
    const starts: number[] = [];
    let releaseSecond: () => void = () => undefined;
    const { ctx } = setup((request) => {
      if (request.url.includes('/shows/')) return page([owned(1, 'Show')]);
      const start = Number(new URL(request.url).searchParams.get('startIndex'));
      starts.push(start);
      const titles = (from: number, count: number) =>
        Array.from({ length: count }, (_, i) => owned(from + i + 1, `T${from + i + 1}`));
      if (start === 0) return page(titles(0, CHART_PAGE), 30, 0);
      return new Promise<ChartPage>((resolve) => {
        releaseSecond = () => resolve(page(titles(CHART_PAGE, 30 - CHART_PAGE), 30, CHART_PAGE));
      }) as unknown as ChartPage;
    });
    render(<ChartsView ctx={ctx} />);
    await screen.findByRole('list', { name: 'Top movies this week' });
    await waitFor(() => expect(observers).toHaveLength(1));
    act(scrollToEnd);
    await waitFor(() => expect(starts).toEqual([0, CHART_PAGE]));

    fireEvent.click(screen.getByRole('button', { name: 'Shows' }));
    await screen.findByRole('link', { name: '1, Show' });
    fireEvent.click(screen.getByRole('button', { name: 'Movies' }));
    const again = await screen.findByRole('list', { name: 'Top movies this week' });
    // Still loading its second page: the grid says so, and reaching its end asks for nothing more.
    expect(again).toHaveAttribute('aria-busy', 'true');
    act(scrollToEnd);
    expect(starts).toEqual([0, CHART_PAGE]);

    await act(async () => {
      releaseSecond();
      await new Promise((r) => setTimeout(r, 0));
    });
    await waitFor(() => expect(within(again).getAllByRole('listitem')).toHaveLength(30));
    expect(again).toHaveAttribute('aria-busy', 'false');
    expect(starts).toEqual([0, CHART_PAGE]);
  });

  it('fetches a chart again on a later visit once its copy is half an hour old', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-12T10:00:00Z'));
    let asked = 0;
    const { ctx } = setup(() => {
      asked++;
      return page([owned(1, asked === 1 ? 'Old' : 'New')]);
    });
    render(<ChartsView ctx={ctx} />);
    expect(await screen.findByRole('link', { name: '1, Old' })).toBeInTheDocument();
    cleanup();

    vi.setSystemTime(Date.now() + CHART_STALE_AFTER - 1000);
    render(<ChartsView ctx={ctx} />);
    expect(screen.getByRole('link', { name: '1, Old' })).toBeInTheDocument();
    cleanup();
    expect(asked).toBe(1);

    vi.setSystemTime(Date.now() + 2000);
    render(<ChartsView ctx={ctx} />);
    expect(await screen.findByRole('link', { name: '1, New' })).toBeInTheDocument();
    expect(asked).toBe(2);
  });

  it('says when a page came without some of its titles, and Try again brings them into their places', async () => {
    let asked = 0;
    const { ctx, client } = setup(() => {
      asked++;
      // Seerr failed on two of the page's titles the first time (the server says how many).
      return asked === 1
        ? { ...page([owned(1, 'Alpha'), owned(4, 'Delta')]), Missing: 2 }
        : page([owned(1, 'Alpha'), owned(2, 'Beta'), owned(3, 'Gamma'), owned(4, 'Delta')]);
    });
    render(<ChartsView ctx={ctx} />);

    const note = await screen.findByRole('status');
    expect(note).toHaveTextContent('Some titles couldn’t be loaded.');
    fireEvent.click(within(note).getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    const list = screen.getByRole('list', { name: 'Top movies this week' });
    expect(
      within(list)
        .getAllByRole('link')
        .map((l) => l.getAttribute('aria-label')),
    ).toEqual(['1, Alpha', '2, Beta', '3, Gamma', '4, Delta']);
    // The same page again, nothing more.
    expect(client.requests.filter((r) => r.url.includes('Lumen/Charts')).map((r) => r.url)).toEqual([
      expect.stringContaining('startIndex=0'),
      expect.stringContaining('startIndex=0'),
    ]);
  });

  it('keeps the note while a page is still short, or its Try again fails, and says nothing of a whole chart', async () => {
    let answer: () => ChartPage = () => ({ ...page([owned(1, 'Alpha')]), Missing: 1 });
    const { ctx } = setup(() => answer());
    render(<ChartsView ctx={ctx} />);

    const retry = within(await screen.findByRole('status')).getByRole('button', { name: 'Try again' });
    fireEvent.click(retry);
    // Not disabled while it tries (a TV remote's focus stays on it); a second press asks nothing more.
    expect(retry).toHaveAttribute('aria-busy', 'true');
    expect(retry).toBeEnabled();
    await waitFor(() => expect(retry).not.toHaveAttribute('aria-busy'));
    expect(screen.getByRole('status')).toBeInTheDocument();

    answer = () => {
      throw new Error('offline');
    };
    fireEvent.click(retry);
    await waitFor(() => expect(retry).not.toHaveAttribute('aria-busy'));
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '1, Alpha' })).toBeInTheDocument();

    answer = () => page([owned(1, 'Alpha'), owned(2, 'Beta')]);
    fireEvent.click(retry);
    expect(await screen.findByRole('link', { name: '2, Beta' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('asks again only for the pages that were short, one after another', async () => {
    const full = (start: number): ChartEntry[] =>
      Array.from({ length: CHART_PAGE }, (_, i) => owned(start + i + 1, `T${start + i + 1}`));
    const times: Record<string, number> = {};
    const { ctx, client } = setup((request) => {
      const start = Number(new URL(request.url).searchParams.get('startIndex'));
      times[start] = (times[start] ?? 0) + 1;
      const entries = full(start);
      // The first and third pages each come one title short the first time.
      return times[start] === 1 && start !== CHART_PAGE
        ? { ...page(entries.slice(1), 72, start), Missing: 1 }
        : page(entries, 72, start);
    });
    render(<ChartsView ctx={ctx} />);
    await screen.findByRole('link', { name: '2, T2' });
    // Preact runs effects after the paint: the grid's end is watched once it has.
    await waitFor(() => expect(observers).toHaveLength(1));
    act(scrollToEnd);
    await screen.findByRole('link', { name: '25, T25' });
    await waitFor(() => expect(observers).toHaveLength(1));
    act(scrollToEnd);
    await screen.findByRole('link', { name: '50, T50' });

    fireEvent.click(within(screen.getByRole('status')).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());

    expect(times).toEqual({ 0: 2, [CHART_PAGE]: 1, [2 * CHART_PAGE]: 2 });
    const names = screen.getAllByRole('link').map((l) => l.getAttribute('aria-label'));
    expect(names).toHaveLength(72);
    expect(names.slice(0, 2)).toEqual(['1, T1', '2, T2']);
    expect(names.slice(47, 50)).toEqual(['48, T48', '49, T49', '50, T50']);
    expect(client.requests.filter((r) => r.url.includes('Lumen/Charts'))).toHaveLength(5);
  });

  it('doesn’t show a short copy again on the next visit: the chart is fetched afresh', async () => {
    let asked = 0;
    const { ctx } = setup(() => {
      asked++;
      return asked === 1
        ? { ...page([owned(1, 'Alpha')]), Missing: 3 }
        : page([owned(1, 'Alpha'), owned(2, 'Beta')]);
    });
    render(<ChartsView ctx={ctx} />);
    await screen.findByRole('status');
    cleanup();

    render(<ChartsView ctx={ctx} />);
    expect(await screen.findByRole('link', { name: '2, Beta' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
    expect(asked).toBe(2);
  });

  it('opens on the chart and period in the URL', async () => {
    window.location.hash = '#/home?lumen=charts&chart=shows&period=weekly';
    const { ctx } = setup(() => page([owned(1, 'Show')]));
    render(<ChartsView ctx={ctx} />);

    expect(await screen.findByRole('list', { name: 'Top shows this week' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Shows' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('follows the URL to another chart while it’s open (a link, the address edited), and stays put as the page is left', async () => {
    const asked: string[] = [];
    const { ctx } = setup((request) => {
      asked.push(request.url.replace(/^.*Lumen\/Charts\//, '').replace(/\?.*$/, ''));
      return page([owned(1, request.url.includes('/shows/') ? 'Show' : 'Movie')]);
    });
    render(<ChartsView ctx={ctx} />);
    expect(await screen.findByRole('list', { name: 'Top movies this week' })).toBeInTheDocument();

    // Another chart's address, with the page still up (the route is the same, so it isn't opened afresh).
    window.location.hash = '#/home?lumen=charts&chart=shows&period=weekly';
    await act(async () => void window.dispatchEvent(new HashChangeEvent('hashchange')));
    expect(await screen.findByRole('list', { name: 'Top shows this week' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Shows' })).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByRole('link', { name: '1, Show' })).toBeInTheDocument();

    // On the way to another page (a title, home), the chart stays as it is: nothing is asked for.
    window.location.hash = '#/home?title=movie-603';
    await act(async () => void window.dispatchEvent(new HashChangeEvent('hashchange')));
    expect(screen.getByRole('button', { name: 'Shows' })).toHaveAttribute('aria-pressed', 'true');
    expect(asked).toEqual(['movies/weekly', 'shows/weekly']);
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
