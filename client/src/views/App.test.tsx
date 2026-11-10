import { render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeClient, routes } from '../../test/fakeClient';
import { makeContext } from '../../test/viewContext';
import { resetSessionCaches } from '../util/sessionCaches';
import { App } from './App';
import { clearBrowseState } from './browse/browseStore';
import { rememberSelection } from './home/homeStore';

function context() {
  const client = createFakeClient(
    routes({
      Items: { Items: [], TotalRecordCount: 0 },
      UserViews: { Items: [] },
      'Lumen/Home': {
        ConfigVersion: 1,
        Hero: [],
        // The same title in two rows: the one the user opened it from is the one focused.
        // Ids as the server makes them ("<section>:<index>"), which aren't safe in a CSS selector.
        Rows: ['One', 'Two'].map((Title, i) => ({
          Id: `s${i}:0`,
          Type: 'Latest',
          Title,
          Items: [{ Id: 'm1', Name: 'Alpha', Type: 'Movie' }],
        })),
      },
    }),
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
    // Not focusable until it has to take focus (no h1): a click on the page would focus it.
    expect(main).not.toHaveAttribute('tabindex');
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

  it('focuses the card the user had opened on Back, not the heading (Tab carries on from there)', async () => {
    const ctx = context();
    const { rerender } = render(<App route={{ kind: 'favorites' }} ctx={ctx} />);
    rememberSelection(ctx.userId, { itemId: 'm1', rowId: 's1:0', scrollY: 0 });
    rerender(<App route={{ kind: 'home' }} ctx={ctx} />);

    const card = () =>
      within(screen.getByRole('region', { name: 'Two' })).getByRole('link', { name: 'Alpha' });
    await waitFor(() => expect(card()).toHaveFocus());
    await new Promise((r) => setTimeout(r, 50));
    expect(card()).toHaveFocus();
  });
});
