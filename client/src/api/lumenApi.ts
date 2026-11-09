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
export interface BrowseQuery {
  parentId?: string;
  includeItemTypes: string;
  sortBy: string;
  sortOrder: 'Ascending' | 'Descending';
  /** Jellyfin ItemFilter names, e.g. IsUnplayed, IsFavorite. */
  filters?: string[];
  genreIds?: string[];
  searchTerm?: string;
  startIndex: number;
  limit: number;
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
      searchTerm: query.searchTerm || undefined,
      startIndex: query.startIndex,
      limit: query.limit,
      fields: 'PrimaryImageAspectRatio,Genres',
      enableUserData: true,
      imageTypeLimit: 1,
      enableImageTypes: 'Primary,Backdrop,Thumb,Logo',
      enableTotalRecordCount: true,
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

  /** Genres that have titles of the given types in a library, A to Z. */
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
