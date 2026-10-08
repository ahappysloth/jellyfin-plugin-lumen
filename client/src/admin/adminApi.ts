import type { JellyfinApiClient } from '../compat/jellyfin';

export interface SectionParamDef {
  Name: string;
  Label: string;
  Kind: string;
  Required: boolean;
  DefaultValue: string | null;
  Min: number | null;
  Max: number | null;
}

export interface SectionTypeDef {
  Type: string;
  DisplayName: string;
  Parameters: SectionParamDef[];
}

export interface SectionDef {
  Id: string;
  Type: string;
  Enabled: boolean;
  Title: string | null;
  Params: { Name: string; Value: string }[];
}

export interface LumenConfig {
  SchemaVersion: number;
  ConfigVersion: number;
  Enabled: boolean;
  HomeTakeover: boolean;
  DetailsTakeover: boolean;
  AccentColor: string;
  /** Jellyfin may serialize the enum as a name or a number; normalizeConfig converts it to a name. */
  HeroSource: string | number;
  HeroCollectionId: string | null;
  HeroCount: number;
  HeroIntervalSeconds: number;
  TrailerPreview: boolean;
  TrailerDelaySeconds: number;
  Sections: SectionDef[];
}

export interface Option {
  id: string;
  name: string;
}

export interface DiagnosticEntry {
  Client: string;
  ServerVersion: string;
  FailedChecks: string[];
  LastSeen: string;
}

export type SaveResult = { ok: true } | { ok: false; errors: string[] };

export interface AdminApi {
  getConfig(): Promise<LumenConfig>;
  saveConfig(config: LumenConfig): Promise<SaveResult>;
  reset(): Promise<void>;
  getSectionTypes(): Promise<SectionTypeDef[]>;
  getDiagnostics(): Promise<DiagnosticEntry[]>;
  getLibraries(): Promise<Option[]>;
  getCollections(): Promise<Option[]>;
  getPlaylists(): Promise<Option[]>;
}

const isResponse = (value: unknown): value is Response =>
  typeof value === 'object' && value !== null && 'status' in value && 'json' in value;

export function createAdminApi(client: JellyfinApiClient): AdminApi {
  const getJson = async <T>(path: string, params?: Record<string, unknown>): Promise<T> =>
    (await client.ajax({ type: 'GET', url: client.getUrl(path, params), dataType: 'json' })) as T;

  const items = async (type: string): Promise<Option[]> => {
    const result = await getJson<{ Items: { Id: string; Name: string }[] }>('Items', {
      userId: client.getCurrentUserId() ?? undefined,
      includeItemTypes: type,
      recursive: true,
      sortBy: 'SortName',
    });
    return result.Items.map((i) => ({ id: i.Id, name: i.Name }));
  };

  return {
    getConfig: () => getJson('Lumen/Admin/Config'),
    async saveConfig(config) {
      try {
        await client.ajax({
          type: 'POST',
          url: client.getUrl('Lumen/Admin/Config'),
          data: JSON.stringify(config),
          contentType: 'application/json',
        });
        return { ok: true };
      } catch (error) {
        // jellyfin-web's ajax rejects with the Response for status >= 400.
        if (isResponse(error) && error.status === 400) {
          const body = (await error.json()) as { Errors?: string[] };
          return { ok: false, errors: body.Errors ?? ['The configuration is invalid.'] };
        }
        throw error;
      }
    },
    async reset() {
      await client.ajax({ type: 'POST', url: client.getUrl('Lumen/Admin/Config/Reset') });
    },
    getSectionTypes: () => getJson('Lumen/Admin/SectionTypes'),
    getDiagnostics: () => getJson('Lumen/Admin/Diagnostics'),
    getLibraries: async () =>
      (await getJson<{ Name: string; ItemId: string }[]>('Library/VirtualFolders')).map((f) => ({
        id: f.ItemId,
        name: f.Name,
      })),
    getCollections: () => items('BoxSet'),
    getPlaylists: () => items('Playlist'),
  };
}
