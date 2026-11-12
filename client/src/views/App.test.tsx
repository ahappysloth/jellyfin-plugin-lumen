import { render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeClient, routes } from '../../test/fakeClient';
import { makeContext } from '../../test/viewContext';
import { resetSessionCaches } from '../util/sessionCaches';
import { App } from './App';
import { clearBrowseState } from './browse/browseStore';
import { rememberSelection } from './home/homeStore';

function context(extra: Record<string, unknown> = {}) {
  const client = createFakeClient(
    routes({
      ...extra,
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

  it("brings back Lumen's nav while a details page can't load, so it isn't a dead end", async () => {
    const ctx = context({
      'Items/m1': () => Promise.reject(new Response(null, { status: 404 })),
      'Items/m2': () => new Promise(() => undefined),
    });
    const { rerender } = render(<App route={{ kind: 'details', id: 'm1' }} ctx={ctx} />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Not found' })).toBeInTheDocument();
    expect(await screen.findByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    // A title's page isn't Home: no place in the nav (the pill, or a phone's tab bar) is the current one.
    expect(document.querySelector('.lmn-nav [aria-current="page"], .lmn-nav .is-active')).toBeNull();

    // The next details page draws its own header again.
    rerender(<App route={{ kind: 'details', id: 'm2' }} ctx={ctx} />);
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull());
  });

  it("keeps Lumen's nav on a catalog title Seerr won't give the user, beside Back", async () => {
    const ctx = context({
      'Lumen/Requests/Title/movie/603': () => Promise.reject(new Response(null, { status: 403 })),
    });
    render(<App route={{ kind: 'title', mediaType: 'movie', tmdbId: 603 }} ctx={ctx} />);

    expect(await screen.findByText("Couldn't load this title from Seerr.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
    expect(await screen.findByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  });

  it('says a page is not found, with Home and the nav', async () => {
    render(<App route={{ kind: 'notFound' }} ctx={context()} />);

    const page = screen.getByRole('region', { name: 'Page not found' });
    expect(within(page).getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
    expect(within(page).getByRole('link', { name: 'Home' })).toHaveAttribute('href', '#/home');
    expect(await screen.findByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  });

  it('has no Top charts page without a Trakt key', () => {
    render(<App route={{ kind: 'charts' }} ctx={context()} />);

    expect(screen.getByRole('region', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('opens Top charts with a Trakt key, its file loaded when first needed', async () => {
    window.location.hash = '#/home?lumen=charts&chart=shows';
    const ctx = context({
      'Lumen/Charts/shows/weekly': { Entries: [], TotalCount: 0, StartIndex: 0 },
    });
    render(<App route={{ kind: 'charts' }} ctx={{ ...ctx, config: { ...ctx.config, Charts: true } }} />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Top charts' })).toBeInTheDocument();
    expect(await screen.findByText('Nothing here yet')).toBeInTheDocument();
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
