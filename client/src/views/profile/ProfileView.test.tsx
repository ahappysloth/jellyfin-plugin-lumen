import { act, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient, routes } from '../../../test/fakeClient';
import { makeContext, testConfig } from '../../../test/viewContext';
import { refreshRequestProgress, startRequestProgress } from '../catalog/requestProgress';
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

  it("links to My requests for a user with request features, even when their requests couldn't be loaded", async () => {
    const client = createFakeClient((request) =>
      request.url.includes('Lumen/Requests/Mine')
        ? Promise.reject({ status: 502 })
        : routes({
            'Users/user1': { Id: 'user1', Name: 'Sam', Policy: { IsAdministrator: false } },
            'Lumen/Requests/Status': {
              Enabled: true,
              CanRequestMovies: true,
              CanRequestTv: true,
              ImageToken: 't',
            },
          })(request),
    );
    const ctx = makeContext(client, { config: { ...testConfig, Requests: true } });
    startRequestProgress(ctx);
    await act(() => refreshRequestProgress());
    render(<ProfileView ctx={ctx} />);

    await waitFor(() =>
      expect(screen.getByRole('link', { name: /My requests/ })).toHaveAttribute(
        'href',
        '#/home?lumen=requests',
      ),
    );
  });

  it('leaves My requests out for a user without request features', async () => {
    const client = createFakeClient((request) =>
      request.url.includes('Lumen/Requests/Mine')
        ? Promise.reject({ status: 404 })
        : routes({
            'Users/user1': { Id: 'user1', Name: 'Sam', Policy: { IsAdministrator: false } },
            'Lumen/Requests/Status': {
              Enabled: false,
              CanRequestMovies: false,
              CanRequestTv: false,
              ImageToken: null,
            },
          })(request),
    );
    const ctx = makeContext(client, { config: { ...testConfig, Requests: true } });
    startRequestProgress(ctx);
    await act(() => refreshRequestProgress());
    render(<ProfileView ctx={ctx} />);

    expect(await screen.findByRole('heading', { name: 'Sam' })).toBeInTheDocument();
    await act(() => Promise.resolve());
    expect(screen.queryByRole('link', { name: /My requests/ })).toBeNull();
  });

  it('adds the administration group for admins', async () => {
    const client = createFakeClient(
      routes({ 'Users/user1': { Id: 'user1', Name: 'Root', Policy: { IsAdministrator: true } } }),
    );
    render(<ProfileView ctx={makeContext(client)} />);

    await waitFor(() =>
      expect(screen.getByRole('link', { name: /Dashboard/ })).toHaveAttribute('href', '#/dashboard'),
    );
    expect(screen.getByRole('link', { name: /Lumen settings/ })).toHaveAttribute(
      'href',
      '#/configurationpage?name=Lumen',
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
      expect(screen.queryByRole('link', { name: /Lumen settings/ })).toBeNull();
      expect(screen.queryByRole('link', { name: /Metadata manager/ })).toBeNull();
      expect(screen.queryByText('Administration')).toBeNull();
    } finally {
      document.documentElement.classList.remove('layout-tv');
    }
  });
});
