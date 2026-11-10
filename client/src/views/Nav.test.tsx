import { render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeClient, routes } from '../../test/fakeClient';
import { makeContext } from '../../test/viewContext';
import { Nav } from './Nav';
import { resetSessionCaches } from '../util/sessionCaches';

describe('Nav', () => {
  afterEach(resetSessionCaches);

  it("doesn't fetch the libraries again when the next page shows the nav", async () => {
    const client = createFakeClient(
      routes({
        UserViews: {
          Items: [{ Id: 'lm', Name: 'Movies', Type: 'CollectionFolder', CollectionType: 'movies' }],
        },
      }),
    );
    const first = render(<Nav ctx={makeContext(client)} />);
    await within(screen.getByRole('navigation', { name: 'Main' })).findByRole('link', { name: 'Movies' });
    first.unmount();
    render(<Nav ctx={makeContext(client)} />);
    const main = screen.getByRole('navigation', { name: 'Main' });
    expect(within(main).getByRole('link', { name: 'Movies' })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(client.requests.filter((r) => r.url.includes('UserViews'))).toHaveLength(1);
  });

  it('shows the server name and links to home, each library, search and settings', async () => {
    const client = createFakeClient(
      routes({
        UserViews: {
          Items: [
            { Id: 'lm', Name: 'Movies', Type: 'CollectionFolder', CollectionType: 'movies' },
            { Id: 'lt', Name: 'Shows', Type: 'CollectionFolder', CollectionType: 'tvshows' },
            { Id: 'lx', Name: 'Mixed', Type: 'CollectionFolder', ServerId: 's' },
          ],
        },
      }),
      'nav-user',
    );
    client.getPublicSystemInfo = async () => ({ ServerName: 'Den' });
    render(<Nav ctx={makeContext(client)} />);

    expect(await screen.findByText('Den')).toBeInTheDocument();
    const main = screen.getByRole('navigation', { name: 'Main' });
    await waitFor(() => expect(within(main).getByRole('link', { name: 'Movies' })).toBeInTheDocument());
    expect(within(main).getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    expect(within(main).getByRole('link', { name: 'Movies' })).toHaveAttribute(
      'href',
      '#/movies?topParentId=lm&collectionType=movies',
    );
    expect(within(main).getByRole('link', { name: 'Shows' })).toHaveAttribute(
      'href',
      '#/tv?topParentId=lt&collectionType=tvshows',
    );
    expect(within(main).getByRole('link', { name: 'Mixed' })).toHaveAttribute(
      'href',
      '#/list?parentId=lx&serverId=s',
    );
    expect(within(main).getByRole('link', { name: 'Search' })).toHaveAttribute('href', '#/search');
    expect(within(main).getByRole('link', { name: 'Settings and profile' })).toHaveAttribute(
      'href',
      '#/mypreferencesmenu',
    );

    // Phones: five tabs. With three libraries the second slot is "More", a menu of the other two.
    const tabs = screen.getByRole('navigation', { name: 'Tabs' });
    expect(
      within(tabs)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Home', 'Movies', 'Favorites', 'Me']);
    expect(within(tabs).getByRole('button', { name: 'More' })).toHaveAttribute('aria-haspopup', 'menu');
    expect(within(tabs).getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
  });

  it('still renders when the libraries cannot be loaded', async () => {
    const client = createFakeClient(() => Promise.reject(new Error('offline')), 'nav-offline');
    render(<Nav ctx={makeContext(client)} />);

    const main = screen.getByRole('navigation', { name: 'Main' });
    expect(within(main).getByRole('link', { name: 'Home' })).toBeInTheDocument();
    expect(within(main).getByRole('link', { name: 'Search' })).toBeInTheDocument();
  });
});
