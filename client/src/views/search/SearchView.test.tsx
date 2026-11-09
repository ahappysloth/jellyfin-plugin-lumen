import { act, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient, routes } from '../../../test/fakeClient';
import { makeContext } from '../../../test/viewContext';
import type { AjaxRequest } from '../../compat/jellyfin';
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

  it('says so when nothing matches', async () => {
    const client = createFakeClient(routes({ Items: items, Persons: { Items: [] } }));
    render(<SearchView initialQuery="zzz" ctx={makeContext(client)} />);
    await flush();

    expect(screen.getByText('No results for “zzz”')).toBeInTheDocument();
  });
});
