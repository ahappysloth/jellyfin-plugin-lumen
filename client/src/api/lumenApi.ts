import type { AjaxRequest, JellyfinApiClient } from '../compat/jellyfin';
import type { BaseItem, ClientConfig, HomeResponse, ItemsResult, SessionInfo } from './types';

export interface DiagnosticsReport {
  Client: string;
  ServerVersion: string;
  FailedChecks: string[];
}

type Params = () => Record<string, unknown>;

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
      limit: 16,
      fields: 'PrimaryImageAspectRatio',
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
