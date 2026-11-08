import { render, screen, waitFor } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { createFakeClient, routes } from '../../test/fakeClient';
import { makeContext } from '../../test/viewContext';
import { Nav } from './Nav';

describe('Nav', () => {
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
    await waitFor(() => expect(screen.getByRole('link', { name: 'Movies' })).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Movies' })).toHaveAttribute(
      'href',
      '#/movies?topParentId=lm&collectionType=movies',
    );
    expect(screen.getByRole('link', { name: 'Shows' })).toHaveAttribute(
      'href',
      '#/tv?topParentId=lt&collectionType=tvshows',
    );
    expect(screen.getByRole('link', { name: 'Mixed' })).toHaveAttribute(
      'href',
      '#/list?parentId=lx&serverId=s',
    );
    expect(screen.getByRole('link', { name: 'Search' })).toHaveAttribute('href', '#/search');
    expect(screen.getByRole('link', { name: 'Settings and profile' })).toHaveAttribute(
      'href',
      '#/mypreferencesmenu',
    );
  });

  it('still renders when the libraries cannot be loaded', async () => {
    const client = createFakeClient(() => Promise.reject(new Error('offline')), 'nav-offline');
    render(<Nav ctx={makeContext(client)} />);

    expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Search' })).toBeInTheDocument();
  });
});
