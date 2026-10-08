import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import type { AdminApi, LumenConfig, SectionTypeDef } from './adminApi';
import { AdminApp } from './AdminApp';

const types: SectionTypeDef[] = [
  { Type: 'ContinueWatching', DisplayName: 'Continue Watching', Parameters: [] },
  {
    Type: 'Genre',
    DisplayName: 'Genre rows',
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
    ...overrides,
  };
}

describe('AdminApp', () => {
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
    fireEvent.change(screen.getByRole('combobox', { name: 'Section type to add' }), {
      target: { value: 'Genre' },
    });
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
    expect(screen.queryByLabelText('Collection')).toBeNull();
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'Collection' } });
    expect(screen.getByLabelText('Collection')).toBeInTheDocument();
  });

  it('reports load failures', async () => {
    render(<AdminApp api={fakeApi({ getConfig: vi.fn(() => Promise.reject(new Error('x'))) })} />);

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load Lumen settings");
  });
});
