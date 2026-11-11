import type { AjaxRequest, JellyfinApiClient } from '../compat/jellyfin';
import type {
  BaseItem,
  CatalogMediaType,
  CatalogSearch,
  CatalogTitle,
  ClientConfig,
  HomeResponse,
  ItemsResult,
  RequestResult,
  RequestStatus,
  SessionInfo,
  UserInfo,
  SyncPlayGroup,
  MovieRecommendation,
} from './types';

/** A rejected request with Seerr's (or Lumen's) message, for showing to the user. */
export class RequestError extends Error {}

export interface DiagnosticsReport {
  Client: string;
  ServerVersion: string;
  FailedChecks: string[];
}

type Params = () => Record<string, unknown>;

/** One page of a library or favorites grid (Jellyfin's /Items query, PascalCase values as the server expects). */
/** Fields and image types for rows of cards (suggestions, upcoming). */
const ROW_FIELDS = 'PrimaryImageAspectRatio';
const ROW_IMAGES = 'Primary,Backdrop,Thumb,Logo';

export interface BrowseQuery {
  parentId?: string;
  includeItemTypes: string;
  sortBy: string;
  sortOrder: 'Ascending' | 'Descending';
  /** Jellyfin ItemFilter names, e.g. IsUnplayed, IsFavorite. */
  filters?: string[];
  genreIds?: string[];
  studioIds?: string[];
  personIds?: string[];
  searchTerm?: string;
  startIndex: number;
  limit: number;
  /**
   * Have Jellyfin count every match (TotalRecordCount), which costs a second query over the whole library. Only the
   * first page needs it, so that's the default; later pages keep the first page's count.
   */
  count?: boolean;
}

/** Typed access to Lumen's and Jellyfin's HTTP APIs through jellyfin-web's authenticated ApiClient. */
export class LumenApi {
  constructor(private readonly client: JellyfinApiClient) {}

  getClientConfig(): Promise<ClientConfig> {
    return this.get('Lumen/ClientConfig');
  }

  getHome(): Promise<HomeResponse> {
    return this.get('Lumen/Home');
  }

  postDiagnostics(report: DiagnosticsReport): Promise<void> {
    return this.send('POST', 'Lumen/Diagnostics', undefined, report);
  }

  getItem(id: string): Promise<BaseItem> {
    return this.get(`Items/${id}`, () => ({ userId: this.userId() }));
  }

  getSeasons(seriesId: string): Promise<ItemsResult> {
    return this.get(`Shows/${seriesId}/Seasons`, () => ({ userId: this.userId(), enableUserData: true }));
  }

  getEpisodes(seriesId: string, seasonId: string): Promise<ItemsResult> {
    return this.get(`Shows/${seriesId}/Episodes`, () => ({
      userId: this.userId(),
      seasonId,
      isMissing: false,
      enableUserData: true,
      fields: 'Overview,PrimaryImageAspectRatio',
    }));
  }

  getNextUp(seriesId: string): Promise<ItemsResult> {
    return this.get('Shows/NextUp', () => ({
      userId: this.userId(),
      seriesId,
      limit: 1,
      enableResumable: false,
    }));
  }

  /** In-progress titles of some types inside a library, most recent first. */
  getResumeIn(parentId: string, includeItemTypes: string, limit = 24): Promise<ItemsResult> {
    return this.get('UserItems/Resume', () => ({
      userId: this.userId(),
      parentId,
      includeItemTypes,
      limit,
      fields: ROW_FIELDS,
      enableImageTypes: ROW_IMAGES,
      imageTypeLimit: 1,
      enableUserData: true,
    }));
  }

  /** The newest titles of some types in a library; episodes are listed one by one, not grouped by show. */
  getLatestIn(parentId: string, includeItemTypes: string, limit = 24): Promise<BaseItem[]> {
    return this.get('Items/Latest', () => ({
      userId: this.userId(),
      parentId,
      includeItemTypes,
      limit,
      groupItems: false,
      fields: ROW_FIELDS,
      enableImageTypes: ROW_IMAGES,
      imageTypeLimit: 1,
      enableUserData: true,
    }));
  }

  /** Each show's next episode to watch, inside a library. */
  getNextUpIn(parentId: string, limit = 24): Promise<ItemsResult> {
    return this.get('Shows/NextUp', () => ({
      userId: this.userId(),
      parentId,
      limit,
      fields: ROW_FIELDS,
      enableImageTypes: ROW_IMAGES,
      imageTypeLimit: 1,
      enableUserData: true,
    }));
  }

  /** Jellyfin's movie recommendations for a library ("Because you watched…", "Starring…", …). */
  getMovieRecommendations(parentId: string): Promise<MovieRecommendation[]> {
    return this.get('Movies/Recommendations', () => ({
      userId: this.userId(),
      parentId,
      categoryLimit: 6,
      itemLimit: 16,
      fields: ROW_FIELDS,
      enableImageTypes: ROW_IMAGES,
      imageTypeLimit: 1,
      enableUserData: true,
    }));
  }

  /** Episodes due to air, soonest first. */
  getUpcoming(parentId: string, limit = 60): Promise<ItemsResult> {
    return this.get('Shows/Upcoming', () => ({
      userId: this.userId(),
      parentId,
      limit,
      fields: `${ROW_FIELDS},Overview`,
      enableImageTypes: ROW_IMAGES,
      imageTypeLimit: 1,
      enableUserData: true,
    }));
  }

  getResumeForSeries(seriesId: string): Promise<ItemsResult> {
    return this.get('UserItems/Resume', () => ({
      userId: this.userId(),
      parentId: seriesId,
      includeItemTypes: 'Episode',
      limit: 1,
    }));
  }

  getSimilar(id: string): Promise<ItemsResult> {
    return this.get(`Items/${id}/Similar`, () => ({
      userId: this.userId(),
      limit: 12,
      fields: 'PrimaryImageAspectRatio,Genres',
    }));
  }

  /** The user's libraries, in their configured order. */
  getUserViews(): Promise<ItemsResult> {
    return this.get('UserViews', () => ({ userId: this.userId() }));
  }

  /** A page of titles for the library and favorites grids, with the total for "N titles" and paging. */
  getBrowseItems(query: BrowseQuery): Promise<ItemsResult> {
    return this.get('Items', () => ({
      userId: this.userId(),
      parentId: query.parentId,
      includeItemTypes: query.includeItemTypes,
      recursive: true,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
      filters: query.filters?.length ? query.filters.join(',') : undefined,
      genreIds: query.genreIds?.length ? query.genreIds.join('|') : undefined,
      studioIds: query.studioIds?.length ? query.studioIds.join('|') : undefined,
      personIds: query.personIds?.length ? query.personIds.join('|') : undefined,
      searchTerm: query.searchTerm || undefined,
      startIndex: query.startIndex,
      limit: query.limit,
      fields: 'PrimaryImageAspectRatio,Genres',
      enableUserData: true,
      imageTypeLimit: 1,
      enableImageTypes: 'Primary,Backdrop,Thumb,Logo',
      enableTotalRecordCount: query.count ?? query.startIndex === 0,
    }));
  }

  getRequestStatus(): Promise<RequestStatus> {
    return this.get('Lumen/Requests/Status');
  }

  searchCatalog(query: string, page = 1): Promise<CatalogSearch> {
    return this.get('Lumen/Requests/Search', () => ({ query, page }));
  }

  getCatalogTitle(mediaType: CatalogMediaType, tmdbId: number): Promise<CatalogTitle> {
    return this.get(`Lumen/Requests/Title/${mediaType}/${tmdbId}`);
  }

  /** Files a request in Seerr as the signed-in user. Seasons: TV only; omitted means all. */
  async requestTitle(
    mediaType: CatalogMediaType,
    tmdbId: number,
    seasons?: number[],
  ): Promise<RequestResult> {
    try {
      return (await this.client.ajax({
        type: 'POST',
        url: this.client.getUrl('Lumen/Requests'),
        dataType: 'json',
        data: JSON.stringify({
          MediaType: mediaType,
          TmdbId: tmdbId,
          Seasons: seasons?.length ? seasons : null,
        }),
        contentType: 'application/json',
      })) as RequestResult;
    } catch (error) {
      throw new RequestError(await errorMessage(error));
    }
  }

  /** People whose name matches, for search. */
  searchPeople(searchTerm: string, limit: number): Promise<ItemsResult> {
    return this.get('Persons', () => ({ userId: this.userId(), searchTerm, limit, enableImages: true }));
  }

  getCurrentUser(): Promise<UserInfo> {
    return this.get(`Users/${this.userId()}`);
  }

  /** Whether the server has Quick Connect switched on (jellyfin-web hides its link when it's off). */
  async getQuickConnectEnabled(): Promise<boolean> {
    return (await this.get<unknown>('QuickConnect/Enabled')) === true;
  }

  /**
   * Movies and episodes the user has played, most recent first. Jellyfin has no filter for "ever played" (Played
   * misses what was only started), so this sorts by last played and the caller stops at the first title never
   * played: those sort last.
   */
  getHistory(page: Pick<BrowseQuery, 'startIndex' | 'limit' | 'count'>): Promise<ItemsResult> {
    return this.getBrowseItems({
      includeItemTypes: 'Movie,Episode',
      sortBy: 'DatePlayed',
      sortOrder: 'Descending',
      ...page,
    });
  }

  /** Genres that have titles of the given types in a library, A to Z. */
  getStudios(parentId: string, includeItemTypes: string): Promise<ItemsResult> {
    return this.get('Studios', () => ({
      userId: this.userId(),
      parentId,
      includeItemTypes,
      sortBy: 'SortName',
      sortOrder: 'Ascending',
      enableImages: false,
    }));
  }

  getGenres(parentId: string, includeItemTypes: string): Promise<ItemsResult> {
    return this.get('Genres', () => ({
      userId: this.userId(),
      parentId,
      includeItemTypes,
      sortBy: 'SortName',
      sortOrder: 'Ascending',
      enableImages: false,
    }));
  }

  getLocalTrailers(id: string): Promise<BaseItem[]> {
    return this.get(`Items/${id}/LocalTrailers`, () => ({ userId: this.userId() }));
  }

  /** Stops the server's transcode for one play session (it would otherwise run on until its ping timeout). */
  stopTranscoding(deviceId: string, playSessionId: string): Promise<void> {
    return this.send('DELETE', 'Videos/ActiveEncodings', () => ({ deviceId, playSessionId }));
  }

  getSessions(deviceId: string): Promise<SessionInfo[]> {
    return this.get('Sessions', () => ({ deviceId }));
  }

  playNow(sessionId: string, itemIds: string[], startPositionTicks?: number): Promise<void> {
    return this.send('POST', `Sessions/${sessionId}/Playing`, () => ({
      playCommand: 'PlayNow',
      itemIds: itemIds.join(','),
      startPositionTicks,
    }));
  }

  setPlayed(id: string, played: boolean): Promise<void> {
    return this.send(played ? 'POST' : 'DELETE', `UserPlayedItems/${id}`, () => ({ userId: this.userId() }));
  }

  setFavorite(id: string, favorite: boolean): Promise<void> {
    return this.send(favorite ? 'POST' : 'DELETE', `UserFavoriteItems/${id}`, () => ({
      userId: this.userId(),
    }));
  }

  private userId(): string {
    const id = this.client.getCurrentUserId();
    if (!id) throw new Error('Not signed in');
    return id;
  }

  private async get<T>(path: string, params?: Params): Promise<T> {
    return (await this.client.ajax({
      type: 'GET',
      url: this.client.getUrl(path, params?.()),
      dataType: 'json',
    })) as T;
  }

  /** SyncPlay groups this user can join. */
  getSyncPlayGroups(): Promise<SyncPlayGroup[]> {
    return this.get('SyncPlay/List');
  }

  createSyncPlayGroup(name: string): Promise<void> {
    return this.send('POST', 'SyncPlay/New', undefined, { GroupName: name });
  }

  joinSyncPlayGroup(groupId: string): Promise<void> {
    return this.send('POST', 'SyncPlay/Join', undefined, { GroupId: groupId });
  }

  leaveSyncPlayGroup(): Promise<void> {
    return this.send('POST', 'SyncPlay/Leave');
  }

  private async send(type: 'POST' | 'DELETE', path: string, params?: Params, body?: unknown): Promise<void> {
    const request: AjaxRequest = { type, url: this.client.getUrl(path, params?.()) };
    if (body !== undefined) {
      request.data = JSON.stringify(body);
      request.contentType = 'application/json';
    }
    await this.client.ajax(request);
  }
}

/** jellyfin-web's ajax rejects with the fetch Response; Lumen's errors carry { Error }. */
async function errorMessage(error: unknown): Promise<string> {
  if (error && typeof (error as Response).json === 'function') {
    try {
      const body = (await (error as Response).json()) as { Error?: string };
      if (body.Error) return body.Error;
    } catch {
      // not JSON
    }
  }
  return '';
}
