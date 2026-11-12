import type { JellyfinApiClient } from '../compat/jellyfin';
import { restartServer, serverState, type ServerState } from './restart';

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
  /** One sentence: what the section shows (absent from older servers). */
  Description?: string;
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
  LibraryTakeover: boolean;
  StyleStockPages: boolean;
  StyleVideoPlayer: boolean;
  /** jellyfin-web's built files served precompressed, hash-checked ones cached for a week (absent from older servers: on). */
  OptimizeWebClientFiles?: boolean;
  AccentColor: string;
  /** A home-screen install takes the server's name instead of "Lumen" (absent from older servers: off). */
  AppNameFromServer?: boolean;
  /** Jellyfin may serialize the enum as a name or a number; normalizeConfig converts it to a name. */
  HeroSource: string | number;
  HeroCollectionId: string | null;
  HeroCount: number;
  HeroIntervalSeconds: number;
  TrailerPreview: boolean;
  TrailerDelaySeconds: number;
  HeroWaitForTrailer: boolean;
  Sections: SectionDef[];
  RequestsEnabled?: boolean;
  SeerrUrl?: string | null;
  /** Never sent by the server; set only when the admin types a new key. Empty on save keeps the stored key. */
  SeerrApiKey?: string | null;
  SeerrApiKeySet?: boolean;
  ImageCacheMb?: number;
  /** The Trakt key for the Top 10 rows: write-only like SeerrApiKey (empty on save keeps the stored one). */
  TraktClientId?: string | null;
  TraktClientIdSet?: boolean;
  /** Set to remove the stored Trakt key on save. */
  ClearTraktClientId?: boolean;
}

export interface TraktTestResult {
  Ok: boolean;
  /** This week's most watched movie, as proof the key works. */
  TopMovie: string | null;
  Error: string | null;
}

export interface SeerrTestResult {
  Ok: boolean;
  Version: string | null;
  Error: string | null;
  /** The Jellyfin server Seerr is linked to; SameJellyfinServer is null when unknown. */
  JellyfinServerName?: string | null;
  SameJellyfinServer?: boolean | null;
}

export interface SeerrUsers {
  JellyfinServerName: string | null;
  SameJellyfinServer: boolean | null;
  Unmapped: UnmappedUser[];
}

export interface UnmappedUser {
  Id: string;
  Name: string;
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

/** Lumen against its latest release (UpdateStatusDto). */
export interface UpdateStatus {
  Installed: string;
  Latest: string | null;
  Changelog: string | null;
  UpdateAvailable: boolean;
  ManifestReachable: boolean;
  ListedByJellyfin: boolean;
  RestartPending: boolean;
}

/** One slice of a storage breakdown (StorageBucketDto). */
export interface StorageBucket {
  Key: string;
  /** Bytes, over the files whose size is known. */
  Size: number;
  Files: number;
  /** Files without a size (.strm and other remote files). */
  UnknownSizeFiles: number;
}

/** Sizes and file counts by codec and resolution (StorageBreakdownDto). */
export interface StorageBreakdown {
  Size: number;
  Files: number;
  UnknownSizeFiles: number;
  /** H264, HEVC, AV1, Other, Unknown, in that order. */
  Codecs: StorageBucket[];
  /** SD, 720p, 1080p, 4K, Unknown, in that order. */
  Resolutions: StorageBucket[];
  Hdr: StorageBucket;
  H264AtLeast1080p: StorageBucket;
}

export interface StorageMovie {
  Id: string;
  Name: string;
  Year: number | null;
  Size: number;
  Files: number;
  Codec: string;
  /** ffprobe's name for the codec (vp9), for "Other". */
  CodecName: string | null;
  Resolution: string;
  Width: number | null;
  Height: number | null;
  /** Bits per second. */
  Bitrate: number | null;
  /** HDR10, HDR10+, Dolby Vision, HLG or HDR; null for SDR. */
  Hdr: string | null;
}

export interface StorageSeries {
  Id: string;
  Name: string;
  Episodes: number;
  Size: number;
  Files: number;
  /** Largest first; only the codecs it has. */
  Codecs: StorageBucket[];
}

/** Where the space goes (StorageReportDto). */
export interface StorageReport {
  ComputedAt: string;
  Seconds: number;
  Totals: StorageBreakdown;
  Libraries: { Id: string; Name: string; CollectionType: string | null; Storage: StorageBreakdown }[];
  BiggestMovies: StorageMovie[];
  BiggestSeries: StorageSeries[];
}

/** The storage report, or where its scan has got to (StorageStatusDto). */
export interface StorageStatus {
  /** Computing: a scan is running, and Report is the previous one (if any). */
  State: 'Ready' | 'Computing' | 'Failed';
  Report: StorageReport | null;
  Error: string | null;
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
  testSeerr(url: string, apiKey: string): Promise<SeerrTestResult>;
  getSeerrUsers(): Promise<SeerrUsers>;
  /** Checks a Trakt key (the stored one when empty) without saving it. */
  testTrakt(clientId: string): Promise<TraktTestResult>;
  checkForUpdates(): Promise<UpdateStatus>;
  installUpdate(version: string): Promise<UpdateStatus>;
  restartServer(): Promise<void>;
  /** The cached storage report; the server starts a scan when there's none or it's stale. */
  getStorage(): Promise<StorageStatus>;
  /** Scans again now (unless a scan is running). */
  refreshStorage(): Promise<StorageStatus>;
  /**
   * Where a restart has got to: 'down' while Jellyfin doesn't answer; 'up' when it answers, with whether it still has
   * a restart pending (it does until it has actually restarted).
   */
  serverState(): Promise<ServerState>;
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
    testSeerr: async (url, apiKey) =>
      (await client.ajax({
        type: 'POST',
        url: client.getUrl('Lumen/Admin/Seerr/Test'),
        data: JSON.stringify({ Url: url, ApiKey: apiKey || null }),
        contentType: 'application/json',
        dataType: 'json',
      })) as SeerrTestResult,
    getSeerrUsers: () => getJson('Lumen/Admin/Seerr/Users'),
    testTrakt: async (clientId) =>
      (await client.ajax({
        type: 'POST',
        url: client.getUrl('Lumen/Admin/Trakt/Test'),
        data: JSON.stringify({ ClientId: clientId || null }),
        contentType: 'application/json',
        dataType: 'json',
      })) as TraktTestResult,
    checkForUpdates: () => getJson('Lumen/Admin/Updates'),
    installUpdate: async (version) =>
      (await client.ajax({
        type: 'POST',
        url: client.getUrl('Lumen/Admin/Updates/Install'),
        data: JSON.stringify({ Version: version }),
        contentType: 'application/json',
        dataType: 'json',
      })) as UpdateStatus,
    restartServer: () => restartServer(client),
    getStorage: () => getJson('Lumen/Admin/Storage'),
    refreshStorage: async () =>
      (await client.ajax({
        type: 'POST',
        url: client.getUrl('Lumen/Admin/Storage/Refresh'),
        dataType: 'json',
      })) as StorageStatus,
    serverState: () => serverState(client),
  };
}
