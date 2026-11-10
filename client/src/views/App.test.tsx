import { render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeClient, routes } from '../../test/fakeClient';
import { makeContext } from '../../test/viewContext';
import { resetSessionCaches } from '../util/sessionCaches';
import { App } from './App';
import { clearBrowseState } from './browse/browseStore';

function context() {
  const client = createFakeClient(
    routes({ Items: { Items: [], TotalRecordCount: 0 }, UserViews: { Items: [] } }),
  );
  client.getPublicSystemInfo = async () => ({ ServerName: 'Den' });
  return makeContext(client);
}

describe('App', () => {
  afterEach(() => {
    resetSessionCaches();
    clearBrowseState();
    document.title = '';
  });

  it("puts the page in the main landmark, with Lumen's nav the only banner", async () => {
    render(<App route={{ kind: 'favorites' }} ctx={context()} />);

    const main = screen.getByRole('main');
    expect(within(main).getByRole('heading', { level: 1, name: 'Favorites' })).toBeInTheDocument();
    // A <header> outside main is a banner landmark (Testing Library's roles don't scope it, axe's and browsers' do):
    // only the nav's is.
    const banners = [...document.querySelectorAll('header')].filter((h) => !h.closest('main'));
    expect(banners).toHaveLength(1);
    expect(within(banners[0]!).getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe('Favorites – Den'));
  });

  it("moves focus to the next page's heading", () => {
    const ctx = context();
    const { rerender } = render(<App route={{ kind: 'favorites' }} ctx={ctx} />);
    rerender(<App route={{ kind: 'profile' }} ctx={ctx} />);
    rerender(<App route={{ kind: 'favorites' }} ctx={ctx} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Favorites' })).toHaveFocus();
  });
});
