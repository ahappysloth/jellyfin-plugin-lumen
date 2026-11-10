import { act, fireEvent, render, screen, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient, routes } from '../../../test/fakeClient';
import { FakeResizeObserver, resize } from '../../../test/resizeObserver';
import { makeContext } from '../../../test/viewContext';
import type { AjaxRequest } from '../../compat/jellyfin';
import { clearRequestStatus } from '../catalog/catalog';
import { SearchView } from './SearchView';

const params = (r: AjaxRequest) => new URL(r.url).searchParams;

function items(r: AjaxRequest) {
  const q = params(r);
  if (q.get('sortBy') === 'Random') return { Items: [{ Id: 'x1', Name: 'Random Pick', Type: 'Movie' }] };
  const term = q.get('searchTerm');
  if (term !== 'alp') return { Items: [] };
  return q.get('includeItemTypes') === 'Movie'
    ? { Items: [{ Id: 'm1', Name: 'Lumen Alpha', Type: 'Movie' }] }
    : { Items: [] };
}

describe('SearchView', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    history.replaceState(null, '', '#/search');
  });
  afterEach(() => vi.useRealTimers());

  const flush = async (ms = 300) => {
    await act(async () => {
      vi.advanceTimersByTime(ms);
      await Promise.resolve();
    });
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
  };

  it('explores before typing, then shows grouped results and keeps the query in the URL', async () => {
    const client = createFakeClient(
      routes({ Items: items, Persons: { Items: [{ Id: 'p1', Name: 'Ada Actor', Type: 'Person' }] } }),
    );
    render(<SearchView initialQuery="" ctx={makeContext(client)} />);
    await flush();
    expect(screen.getByRole('list', { name: 'Explore your library' })).toBeInTheDocument();

    fireEvent.input(screen.getByRole('searchbox', { name: 'Search' }), { target: { value: 'alp' } });
    await flush();

    expect(screen.getByRole('list', { name: 'Movies' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lumen Alpha' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Shows' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Ada Actor' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/search?query=alp');
    const search = client.requests.find(
      (r) => new URL(r.url).pathname === '/Items' && params(r).get('searchTerm') === 'alp',
    )!;
    expect(params(search).get('recursive')).toBe('true');
  });

  it("asks for a person's photo at the width of its column in the people grid", async () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    vi.stubGlobal('devicePixelRatio', 1);
    try {
      const client = createFakeClient(
        routes({
          Items: items,
          Persons: { Items: [{ Id: 'p1', Name: 'Ada Actor', Type: 'Person', ImageTags: { Primary: 'pt' } }] },
        }),
      );
      render(<SearchView initialQuery="alp" ctx={makeContext(client)} />);
      await flush();
      const photo = screen.getByRole('button', { name: 'Ada Actor' }).querySelector('img')!;
      expect(photo).not.toHaveAttribute('src');

      // minmax(116px, 1fr): a column can be nearly twice the 116 px a photo is in a cast row.
      resize(200, [photo]);
      const src = new URL(photo.getAttribute('src')!);
      expect(src.pathname).toBe('/Items/p1/Images/Primary');
      expect(src.searchParams.get('fillWidth')).toBe('240');
      expect(src.searchParams.get('fillHeight')).toBe('319');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('says so when nothing matches', async () => {
    const client = createFakeClient(routes({ Items: items, Persons: { Items: [] } }));
    render(<SearchView initialQuery="zzz" ctx={makeContext(client)} />);
    await flush();

    expect(screen.getByText('No results for “zzz”')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('0 results');
  });

  it('announces a short result count instead of a live region around every result', async () => {
    const client = createFakeClient(routes({ Items: items, Persons: { Items: [] } }));
    render(<SearchView initialQuery="alp" ctx={makeContext(client)} />);
    await flush();

    expect(screen.getByRole('status')).toHaveTextContent('1 result');
    expect(document.querySelector('[aria-live]')).toBeNull();
  });

  it('shows a load error with Try again, not "No results", when every search fails', async () => {
    const client = createFakeClient(() => Promise.reject(new Error('offline')));
    render(<SearchView initialQuery="alp" ctx={makeContext(client)} />);
    await flush();

    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't search right now.");
    expect(screen.queryByText(/No results/)).toBeNull();

    client.respond = routes({ Items: items, Persons: { Items: [] } });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await flush();
    expect(screen.getByRole('button', { name: 'Lumen Alpha' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the results of the kinds that answered when only some fail', async () => {
    const client = createFakeClient(
      routes({ Items: items, Persons: () => Promise.reject(new Error('people search down')) }),
    );
    render(<SearchView initialQuery="alp" ctx={makeContext(client)} />);
    await flush();

    expect(screen.getByRole('button', { name: 'Lumen Alpha' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('SearchView catalog results', () => {
  beforeEach(() => {
    clearRequestStatus();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    clearRequestStatus();
  });

  it('adds Seerr titles under "More to request", skipping ones already listed from the library', async () => {
    const client = createFakeClient(
      routes({
        Items: (r: AjaxRequest) =>
          params(r).get('includeItemTypes') === 'Movie'
            ? { Items: [{ Id: '0123456789abcdef0123456789abcdef', Name: 'Lumen Alpha', Type: 'Movie' }] }
            : { Items: [] },
        Persons: { Items: [] },
        'Lumen/Requests/Status': { Enabled: true, CanRequestMovies: true, CanRequestTv: true },
        'Lumen/Requests/Search': {
          Page: 1,
          TotalPages: 1,
          Results: [
            {
              Key: 'movie-1',
              MediaType: 'movie',
              TmdbId: 1,
              Title: 'Lumen Alpha',
              GenreNames: [],
              State: 'Available',
              JellyfinItemId: '0123456789abcdef0123456789abcdef',
            },
            {
              Key: 'movie-2',
              MediaType: 'movie',
              TmdbId: 2,
              Title: 'Lumen Omega',
              GenreNames: [],
              State: 'None',
            },
          ],
        },
      }),
    );
    const ctx = makeContext(client);
    render(<SearchView initialQuery="lumen" ctx={ctx} />);
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const more = screen.getByRole('list', { name: 'More to request' });
    expect(
      within(more)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual(['Lumen Omega, Request']);
    fireEvent.click(within(more).getByRole('button'));
    expect(ctx.navigate).toHaveBeenCalledWith('#/home?title=movie-2');
  });
});
