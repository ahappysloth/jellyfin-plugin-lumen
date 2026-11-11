import { render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient, routes } from '../../../test/fakeClient';
import { makeContext } from '../../../test/viewContext';
import { resetSessionCaches } from '../../util/sessionCaches';
import { ProfileView } from './ProfileView';

describe('ProfileView', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'Dashboard');
    resetSessionCaches();
  });

  it('shows the user, the settings links and sign out; admin links only for admins', async () => {
    const logout = vi.fn();
    Object.assign(window, { Dashboard: { logout } });
    const client = createFakeClient(
      routes({ 'Users/user1': { Id: 'user1', Name: 'Sam', Policy: { IsAdministrator: false } } }),
    );
    render(<ProfileView ctx={makeContext(client)} />);

    expect(await screen.findByRole('heading', { name: 'Sam' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Playback/ })).toHaveAttribute(
      'href',
      '#/mypreferencesplayback?userId=user1',
    );
    expect(screen.queryByRole('link', { name: /Dashboard/ })).toBeNull();
    screen.getByRole('button', { name: 'Sign out' }).click();
    expect(logout).toHaveBeenCalled();
  });

  it('adds the administration group for admins', async () => {
    const client = createFakeClient(
      routes({ 'Users/user1': { Id: 'user1', Name: 'Root', Policy: { IsAdministrator: true } } }),
    );
    render(<ProfileView ctx={makeContext(client)} />);

    await waitFor(() =>
      expect(screen.getByRole('link', { name: /Dashboard/ })).toHaveAttribute('href', '#/dashboard'),
    );
    expect(screen.getByText('Administrator')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  });

  it('leaves the administration group out on a TV, as jellyfin-web does (layoutManager.tv)', async () => {
    document.documentElement.classList.add('layout-tv');
    try {
      const client = createFakeClient(
        routes({ 'Users/user1': { Id: 'user1', Name: 'Root', Policy: { IsAdministrator: true } } }),
      );
      render(<ProfileView ctx={makeContext(client, { layout: 'tv' })} />);

      expect(await screen.findByRole('heading', { name: 'Root' })).toBeInTheDocument();
      expect(screen.getByText('Administrator')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /Playback/ })).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /Dashboard/ })).toBeNull();
      expect(screen.queryByRole('link', { name: /Metadata manager/ })).toBeNull();
      expect(screen.queryByText('Administration')).toBeNull();
    } finally {
      document.documentElement.classList.remove('layout-tv');
    }
  });
});
