import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import type { AdminApi, LumenConfig, SectionTypeDef } from './adminApi';
import { AdminApp } from './AdminApp';

const types: SectionTypeDef[] = [
  { Type: 'ContinueWatching', DisplayName: 'Continue Watching', Parameters: [] },
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
    AccentColor: '#f5a524',
    HeroSource: 0,
    HeroCollectionId: null,
    HeroCount: 5,
    HeroIntervalSeconds: 8,
    TrailerPreview: true,
    TrailerDelaySeconds: 4,
    Sections: [
      { Id: 's1', Type: 'ContinueWatching', Enabled: true, Title: null, Params: [] },
      { Id: 's2', Type: 'Genre', Enabled: true, Title: null, Params: [{ Name: 'genreCount', Value: '3' }] },
    ],
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
    ...overrides,
  };
}

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
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.saveConfig).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.saveConfig).mock.calls[0]![0].SeerrApiKey ?? '').toBe('');

    fireEvent.input(screen.getByLabelText('Seerr API key'), { target: { value: 'new-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.saveConfig).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.saveConfig).mock.calls[1]![0].SeerrApiKey).toBe('new-key');
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
    fireEvent.click(screen.getByRole('button', { name: /^Section type to add:/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Genre rows' }));
    // The chosen type explains itself before it's added.
    expect(screen.getAllByText('A row per genre the viewer likes.').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.saveConfig).toHaveBeenCalled());
    expect(vi.mocked(api.saveConfig).mock.calls[0]![0].Sections[2]).toEqual({
      Id: 'new1',
      Type: 'Genre',
      Enabled: true,
      Title: null,
      Params: [{ Name: 'genreCount', Value: '3' }],
    });
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

  it('puts the save status first and Save last, and keeps password managers out of the Seerr fields', async () => {
    const { container } = render(<AdminApp api={fakeApi()} />);
    await screen.findByText('Genre rows');

    const bar = container.querySelector('.lmna-savebar')!;
    expect([...bar.children].map((c) => c.textContent)).toEqual([
      'All changes saved',
      'Reset to defaults',
      'Save',
    ]);
    const key = screen.getByLabelText('Seerr API key');
    expect(key).toHaveAttribute('autocomplete', 'new-password');
    expect(key).toHaveAttribute('data-1p-ignore', 'true');
    expect(screen.getByLabelText('Seerr address')).toHaveAttribute('autocomplete', 'off');
  });

  it('reports load failures', async () => {
    render(<AdminApp api={fakeApi({ getConfig: vi.fn(() => Promise.reject(new Error('x'))) })} />);

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load Lumen settings");
  });
});
