import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import type { AdminApi, LumenConfig, SectionTypeDef, UpdateStatus } from './adminApi';
import { AdminApp } from './AdminApp';

const types: SectionTypeDef[] = [
  { Type: 'ContinueWatching', DisplayName: 'Continue Watching', Parameters: [] },
  {
    Type: 'RecentlyAdded',
    DisplayName: 'Recently Added',
    Parameters: [
      {
        Name: 'libraryId',
        Label: 'Library (empty = all libraries)',
        Kind: 'Library',
        Required: false,
        DefaultValue: null,
        Min: null,
        Max: null,
      },
    ],
  },
  {
    Type: 'Genre',
    DisplayName: 'Genre rows',
    Description: 'A row per genre the viewer likes.',
    Parameters: [
      {
        Name: 'genreCount',
        Label: 'Number of genre rows',
        Kind: 'Integer',
        Required: false,
        DefaultValue: '3',
        Min: 1,
        Max: 6,
      },
    ],
  },
];

function config(): LumenConfig {
  return {
    SchemaVersion: 1,
    ConfigVersion: 4,
    Enabled: true,
    HomeTakeover: true,
    DetailsTakeover: true,
    LibraryTakeover: true,
    StyleStockPages: true,
    StyleVideoPlayer: true,
    AccentColor: '#f5a524',
    HeroSource: 0,
    HeroCollectionId: null,
    HeroCount: 5,
    HeroIntervalSeconds: 8,
    TrailerPreview: true,
    TrailerDelaySeconds: 4,
    HeroWaitForTrailer: false,
    Sections: [
      { Id: 's1', Type: 'ContinueWatching', Enabled: true, Title: null, Params: [] },
      { Id: 's2', Type: 'Genre', Enabled: true, Title: null, Params: [{ Name: 'genreCount', Value: '3' }] },
    ],
  };
}

function update(overrides: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    Installed: '0.3.2',
    Latest: '0.3.3',
    Changelog: '\n### Added\n- Faster home page.\n\n### Fixed\n- The scrollbar stays\n  when a menu opens.',
    UpdateAvailable: true,
    ManifestReachable: true,
    ListedByJellyfin: true,
    RestartPending: false,
    ...overrides,
  };
}

function fakeApi(overrides: Partial<AdminApi> = {}): AdminApi {
  return {
    getConfig: vi.fn(async () => config()),
    saveConfig: vi.fn(async () => ({ ok: true as const })),
    reset: vi.fn(async () => undefined),
    getSectionTypes: vi.fn(async () => types),
    getDiagnostics: vi.fn(async () => []),
    getLibraries: vi.fn(async () => [{ id: 'lib1', name: 'Movies' }]),
    getCollections: vi.fn(async () => [{ id: 'col1', name: 'Holiday' }]),
    getPlaylists: vi.fn(async () => []),
    testSeerr: vi.fn(async () => ({ Ok: true, Version: '3.5.1', Error: null })),
    getSeerrUsers: vi.fn(async () => ({ JellyfinServerName: null, SameJellyfinServer: null, Unmapped: [] })),
    checkForUpdates: vi.fn(async () => update()),
    installUpdate: vi.fn(async () => update({ UpdateAvailable: false, RestartPending: true })),
    restartServer: vi.fn(async () => undefined),
    serverState: vi.fn(async () => ({ up: true as const, restartPending: false })),
    getStorage: vi.fn(async () => ({ State: 'Computing' as const, Report: null, Error: null })),
    refreshStorage: vi.fn(async () => ({ State: 'Computing' as const, Report: null, Error: null })),
    ...overrides,
  };
}

describe('AdminApp updates', () => {
  it("checks on open from Jellyfin's Plugins page, installs the update and restarts Jellyfin", async () => {
    const api = fakeApi();
    const confirm = vi.fn(() => true);
    const reload = vi.fn();
    render(
      <AdminApp
        api={api}
        confirm={confirm}
        reload={reload}
        hash="#/configurationpage?name=Lumen&check=updates"
      />,
    );

    expect(await screen.findByText('Lumen 0.3.3 is available.')).toBeInTheDocument();
    // The release's CHANGELOG entry, as headings and items.
    expect(screen.getByRole('heading', { name: 'Added' })).toBeInTheDocument();
    expect(screen.getByText('The scrollbar stays when a menu opens.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Install update' }));

    await waitFor(() => expect(api.installUpdate).toHaveBeenCalledWith('0.3.3'));
    expect(
      await screen.findByText(/Lumen 0.3.3 is installed. Restart Jellyfin to finish./),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Restart now' }));

    expect(confirm).toHaveBeenCalled();
    await waitFor(() => expect(api.restartServer).toHaveBeenCalled());
    expect(await screen.findByText(/Restarting Jellyfin/)).toBeInTheDocument();
    // Once Jellyfin is back (here at the first check), the page reloads to run the new version.
    await waitFor(() => expect(reload).toHaveBeenCalled(), { timeout: 4000 });
  }, 15_000); // several waits in a row: slow only under heavy parallel load

  it('checks only when asked, and says when Lumen is up to date', async () => {
    const api = fakeApi({
      checkForUpdates: vi.fn(async () =>
        update({ Latest: '0.3.2', UpdateAvailable: false, ListedByJellyfin: false }),
      ),
    });
    render(<AdminApp api={api} hash="#/configurationpage?name=Lumen" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Check for updates' }));
    expect(api.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Lumen 0.3.2 is the latest version./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install update' })).toBeNull();
    // Jellyfin can't auto-update Lumen without its repository.
    expect(screen.getByText(/Manage Repositories/)).toBeInTheDocument();
  });

  it('says so when the check fails', async () => {
    const api = fakeApi({ checkForUpdates: vi.fn(async () => Promise.reject(new Error('offline'))) });
    render(<AdminApp api={api} hash="#/configurationpage?name=Lumen&check=updates" />);

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't check for updates");
  });
});

describe('AdminApp', () => {
  it('never shows the Seerr key, keeps it on save, and sends a newly typed one', async () => {
    const api = fakeApi({
      getConfig: vi.fn(async () => ({
        ...config(),
        RequestsEnabled: true,
        SeerrUrl: 'http://seerr:5055',
        SeerrApiKeySet: true,
      })),
    });
    render(<AdminApp api={api} />);

    const key = await screen.findByLabelText('Seerr API key');
    expect(key).toHaveValue('');
    expect(key).toHaveAttribute('placeholder', 'Saved (leave blank to keep it)');
    await waitFor(() => expect(key).toHaveAccessibleDescription('Seerr → Settings → General'));
    // Some other change: the key field left blank keeps the saved key.
    fireEvent.click(screen.getByRole('button', { name: 'Move Continue Watching down' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.saveConfig).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.saveConfig).mock.calls[0]![0].SeerrApiKey ?? '').toBe('');

    fireEvent.input(screen.getByLabelText('Seerr API key'), { target: { value: 'new-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.saveConfig).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.saveConfig).mock.calls[1]![0].SeerrApiKey).toBe('new-key');
  });

  it('saves letting hero trailers finish, offered only while trailer previews are on', async () => {
    const api = fakeApi();
    render(<AdminApp api={api} />);

    const toggle = await screen.findByRole('switch', { name: /Let trailers finish before the next slide/ });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('switch', { name: /Play muted trailer previews/ }));
    expect(screen.queryByRole('switch', { name: /Let trailers finish/ })).toBeNull();
    fireEvent.click(screen.getByRole('switch', { name: /Play muted trailer previews/ }));
    expect(screen.getByRole('switch', { name: /Let trailers finish/ })).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.saveConfig).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.saveConfig).mock.calls[0]![0].HeroWaitForTrailer).toBe(true);
  });

  it("saves the web app speed-up, on when the server doesn't say", async () => {
    const api = fakeApi();
    render(<AdminApp api={api} />);

    const toggle = await screen.findByRole('switch', { name: /Load Jellyfin's web app faster/ });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.saveConfig).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.saveConfig).mock.calls[0]![0].OptimizeWebClientFiles).toBe(false);
  });

  it("saves the home-screen name choice, off when the server doesn't say", async () => {
    const api = fakeApi();
    render(<AdminApp api={api} />);

    const toggle = await screen.findByRole('switch', { name: /Name the home-screen app after this server/ });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.saveConfig).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.saveConfig).mock.calls[0]![0].AppNameFromServer).toBe(true);
  });

  it('tests the Seerr connection with the typed address and key', async () => {
    const api = fakeApi({
      testSeerr: vi.fn(async () => ({ Ok: false, Version: null, Error: 'Seerr rejected the API key.' })),
    });
    render(<AdminApp api={api} />);

    fireEvent.input(await screen.findByLabelText('Seerr address'), {
      target: { value: 'http://seerr:5055' },
    });
    fireEvent.input(screen.getByLabelText('Seerr API key'), { target: { value: 'k1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));

    expect(await screen.findByText('Seerr rejected the API key.')).toBeInTheDocument();
    expect(api.testSeerr).toHaveBeenCalledWith('http://seerr:5055', 'k1');
  });

  it('explains when Seerr is linked to a different Jellyfin server instead of suggesting an import', async () => {
    const api = fakeApi({
      getConfig: vi.fn(async () => ({
        ...config(),
        RequestsEnabled: true,
        SeerrUrl: 'http://seerr:5055',
        SeerrApiKeySet: true,
      })),
      getSeerrUsers: vi.fn(async () => ({
        JellyfinServerName: 'Main',
        SameJellyfinServer: false,
        Unmapped: [{ Id: 'u2', Name: 'kid' }],
      })),
    });
    render(<AdminApp api={api} />);

    expect(await screen.findByText('Seerr is linked to a different Jellyfin server')).toBeInTheDocument();
    expect(screen.getByText(/Seerr uses “Main”/)).toBeInTheDocument();
    expect(screen.queryByText('Users without a Seerr account')).toBeNull();
  });

  it('lists users without a Seerr account once requests are set up', async () => {
    const api = fakeApi({
      getConfig: vi.fn(async () => ({
        ...config(),
        RequestsEnabled: true,
        SeerrUrl: 'http://seerr:5055',
        SeerrApiKeySet: true,
      })),
      getSeerrUsers: vi.fn(async () => ({
        JellyfinServerName: 'Home',
        SameJellyfinServer: true,
        Unmapped: [{ Id: 'u2', Name: 'kid' }],
      })),
    });
    render(<AdminApp api={api} />);

    expect(await screen.findByText('kid')).toBeInTheDocument();
    expect(screen.getByText('Users without a Seerr account')).toBeInTheDocument();
  });

  it('lists sections in order and saves a reordered list', async () => {
    const api = fakeApi();
    render(<AdminApp api={api} />);

    await screen.findByText('Genre rows');
    fireEvent.click(screen.getByRole('button', { name: 'Move Continue Watching down' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.saveConfig).toHaveBeenCalled());
    const saved = vi.mocked(api.saveConfig).mock.calls[0]![0];
    expect(saved.Sections.map((s) => s.Id)).toEqual(['s2', 's1']);
    expect(saved.HeroSource).toBe('RecentlyAdded');
    expect(await screen.findByRole('status')).toHaveTextContent('Settings saved.');
  });

  it('adds a section with defaults', async () => {
    const api = fakeApi();
    render(<AdminApp api={api} newId={() => 'new1'} />);

    await screen.findByText('Genre rows');
    // Genre rows are already on the home screen, and once is enough: out of the list first.
    fireEvent.click(screen.getByRole('button', { name: 'Remove Genre rows' }));
    fireEvent.click(screen.getByRole('button', { name: /^Section type to add:/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Genre rows' }));
    // The chosen type explains itself before it's added.
    expect(screen.getAllByText('A row per genre the viewer likes.').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.saveConfig).toHaveBeenCalled());
    expect(vi.mocked(api.saveConfig).mock.calls[0]![0].Sections[1]).toEqual({
      Id: 'new1',
      Type: 'Genre',
      Enabled: true,
      Title: null,
      Params: [{ Name: 'genreCount', Value: '3' }],
    });
  });

  it('offers a section type only useful once as "already added" while it is on the home screen', async () => {
    const api = fakeApi({
      getConfig: vi.fn(async () => ({
        ...config(),
        Sections: [
          ...config().Sections,
          { Id: 's3', Type: 'RecentlyAdded', Enabled: true, Title: null, Params: [] },
        ],
      })),
    });
    render(<AdminApp api={api} newId={() => 'new1'} />);
    await screen.findByText('Genre rows');
    const open = () => fireEvent.click(screen.getByRole('button', { name: /^Section type to add:/ }));

    open();
    const continueWatching = screen.getByRole('option', { name: 'Continue Watching (already added)' });
    expect(continueWatching).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('option', { name: 'Genre rows (already added)' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    // One that picks a library can be added again, for another library.
    expect(screen.getByRole('option', { name: 'Recently Added' })).not.toHaveAttribute('aria-disabled');
    fireEvent.click(continueWatching);
    expect(screen.getByRole('listbox')).toBeInTheDocument(); // still open: nothing was picked
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
    fireEvent.click(screen.getByRole('option', { name: 'Recently Added' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    // Removed, it's addable again.
    fireEvent.click(screen.getByRole('button', { name: 'Remove Continue Watching' }));
    open();
    fireEvent.click(screen.getByRole('option', { name: 'Continue Watching' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    open();
    expect(screen.getByRole('option', { name: 'Continue Watching (already added)' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.saveConfig).toHaveBeenCalled());
    expect(vi.mocked(api.saveConfig).mock.calls[0]![0].Sections.map((s) => s.Type)).toEqual([
      'Genre',
      'RecentlyAdded',
      'RecentlyAdded',
      'ContinueWatching',
    ]);
  });

  it('still loads, edits and saves a config that already has a section twice', async () => {
    const twice = [
      { Id: 'a', Type: 'ContinueWatching', Enabled: true, Title: null, Params: [] },
      { Id: 'b', Type: 'ContinueWatching', Enabled: true, Title: 'Again', Params: [] },
    ];
    const api = fakeApi({ getConfig: vi.fn(async () => ({ ...config(), Sections: twice })) });
    render(<AdminApp api={api} />);
    await screen.findByText('Again');
    fireEvent.click(screen.getByRole('switch', { name: 'Show Again' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.saveConfig).toHaveBeenCalled());
    expect(vi.mocked(api.saveConfig).mock.calls[0]![0].Sections).toEqual([
      twice[0],
      { ...twice[1], Enabled: false },
    ]);
  });

  it('shows server validation errors', async () => {
    const api = fakeApi({
      saveConfig: vi.fn(async () => ({
        ok: false as const,
        errors: ['Accent color must look like #RRGGBB.'],
      })),
    });
    render(<AdminApp api={api} />);

    await screen.findByText('Genre rows');
    fireEvent.click(screen.getByRole('button', { name: 'Move Continue Watching down' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Accent color must look like #RRGGBB.');
  });

  it('shows the collection picker only for the collection hero source', async () => {
    render(<AdminApp api={fakeApi()} />);

    await screen.findByText('Genre rows');
    expect(screen.queryByRole('button', { name: /^Collection:/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Source: Recently added' }));
    fireEvent.click(screen.getByRole('option', { name: 'A collection' }));
    expect(screen.getByRole('button', { name: 'Collection: (none)' })).toBeInTheDocument();
  });

  it('keeps password managers out of the Seerr fields', async () => {
    render(<AdminApp api={fakeApi()} />);
    await screen.findByText('Genre rows');

    const key = screen.getByLabelText('Seerr API key');
    expect(key).toHaveAttribute('autocomplete', 'new-password');
    expect(key).toHaveAttribute('data-1p-ignore', 'true');
    expect(screen.getByLabelText('Seerr address')).toHaveAttribute('autocomplete', 'off');
  });

  it('reports load failures', async () => {
    render(<AdminApp api={fakeApi({ getConfig: vi.fn(() => Promise.reject(new Error('x'))) })} />);

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load Lumen settings");
  });

  describe('failure handling', () => {
    it('keeps the form when one lookup fails, and says which lists are missing', async () => {
      const api = fakeApi({
        getPlaylists: vi.fn(() => Promise.reject(new Error('x'))),
        getCollections: vi.fn(() => Promise.reject(new Error('x'))),
        getDiagnostics: vi.fn(() => Promise.reject(new Error('x'))),
      });
      render(<AdminApp api={api} />);

      expect(await screen.findByText('Genre rows')).toBeInTheDocument();
      expect(
        screen.getByText(/Couldn't load the collections and playlists to choose from/),
      ).toBeInTheDocument();
      // A failed diagnostics request doesn't read as "no problems".
      expect(screen.getByText(/Couldn't load the diagnostics/)).toBeInTheDocument();
      expect(screen.queryByText('No compatibility problems reported.')).toBeNull();
      // Nothing to save: the save bar is down, and Save with it.
      expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    });

    it('still fails the page when the section types fail', async () => {
      render(<AdminApp api={fakeApi({ getSectionTypes: vi.fn(() => Promise.reject(new Error('x'))) })} />);

      expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load Lumen settings");
    });

    it('reports a save that throws', async () => {
      const api = fakeApi({ saveConfig: vi.fn(() => Promise.reject(new Error('x'))) });
      render(<AdminApp api={api} />);

      await screen.findByText('Genre rows');
      fireEvent.click(screen.getByRole('button', { name: 'Move Continue Watching down' }));
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('Saving failed. Check the server log.');
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    });

    it('says saved, not "Saving failed", when only the reload after a save fails', async () => {
      const getConfig = vi.fn(async () => config());
      const api = fakeApi({ getConfig });
      render(<AdminApp api={api} />);

      await screen.findByText('Genre rows');
      getConfig.mockRejectedValueOnce(new Error('x'));
      fireEvent.click(screen.getByRole('button', { name: 'Move Continue Watching down' }));
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      expect(await screen.findByRole('status')).toHaveTextContent('Settings saved.');
      expect(screen.getByText(/Settings saved, but they couldn't be reloaded/)).toBeInTheDocument();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(api.saveConfig).toHaveBeenCalledTimes(1);
    });

    it('does nothing when the reset is not confirmed', async () => {
      const api = fakeApi();
      render(<AdminApp api={api} confirm={() => false} />);

      await screen.findByText('Genre rows');
      fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));

      expect(api.reset).not.toHaveBeenCalled();
    });

    it('reloads the settings after a reset', async () => {
      const getConfig = vi.fn(async () => config());
      const api = fakeApi({ getConfig });
      render(<AdminApp api={api} confirm={() => true} />);

      await screen.findByText('Genre rows');
      getConfig.mockResolvedValueOnce({ ...config(), Sections: [] });
      fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));

      await waitFor(() => expect(screen.queryByText('Genre rows')).toBeNull());
      expect(api.reset).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: 'Reset to defaults' })).toBeEnabled();
      expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    });

    it('reports a failed reset and keeps the form', async () => {
      const api = fakeApi({ reset: vi.fn(() => Promise.reject(new Error('x'))) });
      render(<AdminApp api={api} confirm={() => true} />);

      await screen.findByText('Genre rows');
      fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));

      expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't reset the settings.");
      expect(screen.getByText('Genre rows')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reset to defaults' })).toBeEnabled();
    });

    it('says the reset worked when only the reload after it fails', async () => {
      const getConfig = vi.fn(async () => config());
      render(<AdminApp api={fakeApi({ getConfig })} confirm={() => true} />);

      await screen.findByText('Genre rows');
      getConfig.mockRejectedValueOnce(new Error('x'));
      fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        "Lumen settings were reset to their defaults, but they couldn't be reloaded.",
      );
    });
  });
});

describe('AdminApp save bar', () => {
  const bar = (container: Element): HTMLElement => container.querySelector<HTMLElement>('.lmna-savebar')!;
  const expectHidden = (container: Element): void => {
    expect(bar(container)).not.toHaveClass('is-shown');
    expect(bar(container)).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  };
  const expectShown = (container: Element): void => {
    expect(bar(container)).toHaveClass('is-shown');
    expect(bar(container)).not.toHaveAttribute('aria-hidden');
    expect(container.querySelector('form')).toHaveClass('has-savebar');
  };

  it('stays down with nothing to save, comes up with a change, says saved, then goes down again', async () => {
    let finishSave: () => void = () => undefined;
    const api = fakeApi({
      saveConfig: vi.fn(
        () => new Promise<{ ok: true }>((resolve) => (finishSave = () => resolve({ ok: true }))),
      ),
    });
    const { container } = render(<AdminApp api={api} savedFor={50} />);
    await screen.findByText('Genre rows');
    expectHidden(container);
    expect(container.querySelector('form')).not.toHaveClass('has-savebar');
    // Reset to defaults doesn't need the bar.
    expect(screen.getByRole('button', { name: 'Reset to defaults' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Move Continue Watching down' }));
    expectShown(container);
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saving…'));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expectShown(container);

    finishSave();
    expect(await screen.findByRole('status')).toHaveTextContent('Settings saved.');
    expect(bar(container).querySelector('.lmn-icon, svg')).not.toBeNull();
    expectShown(container);
    await waitFor(() => expectHidden(container));
  });

  it('stays up with the problem when a save fails', async () => {
    const api = fakeApi({
      saveConfig: vi.fn(async () => ({
        ok: false as const,
        errors: ['Accent color must look like #RRGGBB.', 'Hero count must be between 1 and 10.'],
      })),
    });
    const { container } = render(<AdminApp api={api} savedFor={20} />);
    await screen.findByText('Genre rows');
    fireEvent.click(screen.getByRole('button', { name: 'Move Continue Watching down' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByRole('alert');
    expect(bar(container)).toHaveTextContent(
      "2 problems need fixing. They're listed at the top of the page.",
    );
    // The alert at the top reads the problems out; the bar's live region doesn't repeat them.
    expect(screen.getByRole('status')).toHaveTextContent('');
    await new Promise((r) => setTimeout(r, 60));
    expectShown(container);
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('shows a failed reset next to Reset, not in the bar, when nothing was changed', async () => {
    const api = fakeApi({ reset: vi.fn(() => Promise.reject(new Error('x'))) });
    const { container } = render(<AdminApp api={api} confirm={() => true} />);
    await screen.findByText('Genre rows');
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));

    await screen.findByRole('alert');
    expectHidden(container);
    expect(container.querySelector('.lmna-reset')).toHaveTextContent(
      "Couldn't reset the settings. Check the server log.",
    );
  });

  it('shows a failed reset as a problem, not a success, right after a save', async () => {
    const api = fakeApi({ reset: vi.fn(() => Promise.reject(new Error('x'))) });
    const { container } = render(<AdminApp api={api} confirm={() => true} savedFor={10_000} />);
    await screen.findByText('Genre rows');
    fireEvent.click(screen.getByRole('button', { name: 'Move Continue Watching down' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Settings saved.');

    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    await screen.findByRole('alert');
    expect(bar(container)).toHaveTextContent("Couldn't reset the settings. Check the server log.");
    expect(bar(container).querySelector('.lmna-savebar__status--error')).not.toBeNull();
    expect(bar(container).querySelector('.lmna-savebar__status--ok')).toBeNull();
  });

  it('keeps its live region in the page while the bar is down', async () => {
    const { container } = render(<AdminApp api={fakeApi()} />);
    await screen.findByText('Genre rows');
    const status = screen.getByRole('status');
    expect(bar(container).contains(status)).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Move Continue Watching down' }));
    expect(screen.getByRole('status')).toBe(status);
    expect(status).toHaveTextContent('Unsaved changes');
  });

  it('removes its Ctrl+S listener once jellyfin-web has dropped the page', async () => {
    const remove = vi.spyOn(document, 'removeEventListener');
    const { container } = render(<AdminApp api={fakeApi()} />);
    await screen.findByText('Genre rows');
    container.remove(); // jellyfin-web drops old pages without unmounting
    fireEvent.keyDown(document, { key: 'x' });
    expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function));
    remove.mockRestore();
  });

  it('puts focus on the heading when the bar goes down with focus in it', async () => {
    const { container } = render(<AdminApp api={fakeApi()} savedFor={20} />);
    await screen.findByText('Genre rows');
    fireEvent.click(screen.getByRole('button', { name: 'Move Continue Watching down' }));
    const save = screen.getByRole('button', { name: 'Save' });
    save.focus();
    fireEvent.click(save);

    await waitFor(() => expectHidden(container));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Lumen' })).toHaveFocus());
  });

  it('discards unsaved changes: the settings as loaded, the bar down and focus on the heading, nothing saved', async () => {
    const api = fakeApi();
    const { container } = render(<AdminApp api={api} />);
    await screen.findByText('Genre rows');
    const names = () =>
      [...container.querySelectorAll('.lmna-section__name')].map((n) => n.firstChild?.textContent);
    expect(names()).toEqual(['Continue Watching', 'Genre rows']);
    // No Discard with nothing to discard.
    expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Move Continue Watching down' }));
    fireEvent.input(screen.getByLabelText('Seerr address'), { target: { value: 'http://typo' } });
    expect(names()).toEqual(['Genre rows', 'Continue Watching']);
    const discard = screen.getByRole('button', { name: 'Discard' });
    discard.focus();
    fireEvent.click(discard);

    expect(names()).toEqual(['Continue Watching', 'Genre rows']);
    expect(screen.getByLabelText('Seerr address')).toHaveValue('');
    expectHidden(container);
    expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Lumen' })).toHaveFocus());
    expect(api.saveConfig).not.toHaveBeenCalled();
  });

  it("discards a failed save's changes and its problems, back to what was last saved", async () => {
    const saveConfig = vi
      .fn<AdminApi['saveConfig']>()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, errors: ['Accent color must look like #RRGGBB.'] });
    // The server hands back what was saved.
    let stored = config();
    const api = fakeApi({
      getConfig: vi.fn(async () => stored),
      saveConfig: vi.fn(async (c: LumenConfig) => {
        const result = await saveConfig(c);
        if (result.ok) stored = c;
        return result;
      }),
    });
    const { container } = render(<AdminApp api={api} savedFor={10} />);
    await screen.findByText('Genre rows');
    fireEvent.click(screen.getByRole('button', { name: 'Move Continue Watching down' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expectHidden(container));

    fireEvent.click(screen.getByRole('button', { name: 'Move Genre rows down' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));

    expect(screen.queryByRole('alert')).toBeNull();
    expectHidden(container);
    // The order saved first, not the one loaded at the start.
    expect(screen.getByRole('button', { name: 'Move Genre rows up' })).toBeDisabled();
  });

  it('starts sections with state of their own afresh on Discard (a Seerr test result, a section type picked)', async () => {
    const { container } = render(<AdminApp api={fakeApi()} />);
    await screen.findByText('Genre rows');
    fireEvent.input(screen.getByLabelText('Seerr address'), { target: { value: 'http://seerr:5055' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText('Connected to Seerr 3.5.1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Section type to add:/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Recently Added' }));
    expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expectHidden(container);
    expect(screen.queryByText('Connected to Seerr 3.5.1')).toBeNull();
    expect(screen.getByRole('button', { name: /^Section type to add:/ })).toHaveAccessibleName(
      'Section type to add: Choose a section to add…',
    );
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
  });

  it('saves on Ctrl+S or Cmd+S while the page is showing and there are changes', async () => {
    const api = fakeApi();
    const { container } = render(<AdminApp api={api} />);
    await screen.findByText('Genre rows');
    // jsdom has no layout: say the form is on screen (offsetParent is null for a hidden page).
    const form = container.querySelector('form')!;
    let onScreen = true;
    Object.defineProperty(form, 'offsetParent', { get: () => (onScreen ? document.body : null) });

    const clean = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true });
    document.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(true); // not the browser's "Save page as"
    expect(api.saveConfig).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Move Continue Watching down' }));
    onScreen = false; // another dashboard page is showing
    fireEvent.keyDown(document, { key: 's', ctrlKey: true });
    expect(api.saveConfig).not.toHaveBeenCalled();

    onScreen = true;
    fireEvent.keyDown(document, { key: 's', metaKey: true });
    await waitFor(() => expect(api.saveConfig).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('status')).toHaveTextContent('Settings saved.');
  });
});
