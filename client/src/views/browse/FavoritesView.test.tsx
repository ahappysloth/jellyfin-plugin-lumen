import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeClient, routes } from '../../../test/fakeClient';
import { makeContext } from '../../../test/viewContext';
import type { AjaxRequest } from '../../compat/jellyfin';
import { clearBrowseState } from './browseStore';
import { FavoritesView } from './FavoritesView';

const BY_TYPE: Record<string, { Id: string; Name: string; Type: string }[]> = {
  Movie: [],
  Series: [{ Id: 's1', Name: 'Show One', Type: 'Series' }],
  Episode: [
    { Id: 'e1', Name: 'Pilot', Type: 'Episode' },
    { Id: 'e2', Name: 'Second', Type: 'Episode' },
  ],
};

function itemsRoute(r: AjaxRequest) {
  const q = new URL(r.url).searchParams;
  const items = BY_TYPE[q.get('includeItemTypes')!]!;
  expect(q.get('filters')).toBe('IsFavorite');
  return { Items: items.slice(0, Number(q.get('limit'))), TotalRecordCount: items.length };
}

describe('FavoritesView', () => {
  afterEach(() => clearBrowseState());

  it('shows tabs only for kinds with favorites, opening on the first non-empty one', async () => {
    const ctx = makeContext(createFakeClient(routes({ Items: itemsRoute })));
    render(<FavoritesView ctx={ctx} />);

    expect(await screen.findByText('3 titles')).toBeInTheDocument();
    const tabs = screen.getByRole('group', { name: 'Favorites' });
    expect(within(tabs).queryByRole('button', { name: /Movies/ })).toBeNull();
    expect(within(tabs).getByRole('button', { name: /Shows/ })).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByRole('button', { name: 'Show One' })).toBeInTheDocument();

    fireEvent.click(within(tabs).getByRole('button', { name: /Episodes/ }));
    await waitFor(() => expect(screen.getByRole('list', { name: 'Episodes' })).toBeInTheDocument());
    expect(await screen.findByRole('button', { name: /^Pilot,/ })).toBeInTheDocument();
  });

  it('explains how to add favorites when there are none', async () => {
    const ctx = makeContext(createFakeClient(routes({ Items: { Items: [], TotalRecordCount: 0 } })));
    render(<FavoritesView ctx={ctx} />);

    expect(await screen.findByText('No favorites yet')).toBeInTheDocument();
  });
});
