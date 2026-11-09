import { useEffect, useLayoutEffect, useState } from 'preact/hooks';
import type { CatalogItem, CatalogState, RequestStatus } from '../../api/types';
import { detailsHash, type JellyfinApiClient } from '../../compat/jellyfin';
import { strings } from '../../strings';
import { titleHash } from '../../takeover/routes';
import { registerSessionCache } from '../../util/sessionCaches';
import type { ViewContext } from '../context';

export type CatalogImageSize = 'w185' | 'w300' | 'w780' | 'w1280';

const NO_ACCESS: RequestStatus = { Enabled: false, CanRequestMovies: false, CanRequestTv: false };

/** One status lookup per user per page load; request features stay hidden until (and unless) it says yes. */
const statusByUser = new Map<string, Promise<RequestStatus>>();

export function loadRequestStatus(ctx: ViewContext): Promise<RequestStatus> {
  let status = statusByUser.get(ctx.userId);
  if (!status) {
    status = ctx.api.getRequestStatus().catch(() => {
      statusByUser.delete(ctx.userId); // a transient failure is retried next time, not remembered
      return NO_ACCESS;
    });
    statusByUser.set(ctx.userId, status);
  }
  return status;
}

export function useRequestStatus(ctx: ViewContext): RequestStatus {
  const [status, setStatus] = useState<RequestStatus>(NO_ACCESS);
  useEffect(() => {
    let cancelled = false;
    void loadRequestStatus(ctx).then((s) => !cancelled && setStatus(s));
    return () => {
      cancelled = true;
    };
  }, [ctx.userId]);
  return status;
}

export function clearRequestStatus(): void {
  statusByUser.clear();
  stateOverrides.clear();
}

/** TMDB artwork through Lumen's proxy. <img> can't send headers, so the token rides along as ApiKey. */
export function catalogImageUrl(
  client: Pick<JellyfinApiClient, 'getUrl' | 'accessToken'>,
  file: string,
  size: CatalogImageSize,
): string {
  return client.getUrl(`Lumen/Requests/Image/${size}/${encodeURIComponent(file)}`, {
    ApiKey: client.accessToken() ?? undefined,
  });
}

/** States changed by requests made this session, so every card for the title updates in place. */
const stateOverrides = new Map<string, CatalogState>();
const listeners = new Set<() => void>();

export function setCatalogState(key: string, state: CatalogState): void {
  stateOverrides.set(key, state);
  listeners.forEach((l) => l());
}

/** Fresh state from Seerr for this title (its page just loaded): it replaces this session's optimistic one. */
export function forgetCatalogState(key: string): void {
  if (stateOverrides.delete(key)) listeners.forEach((l) => l());
}

export function useCatalogState(item: CatalogItem): CatalogState {
  const [, bump] = useState(0);
  useLayoutEffect(() => {
    const listener = (): void => bump((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return stateOverrides.get(item.Key) ?? item.State;
}

/** Owned titles open their normal details page; the rest open the catalog title page. */
export function catalogHash(item: CatalogItem): string {
  return item.JellyfinItemId ? detailsHash(item.JellyfinItemId) : titleHash(item.MediaType, item.TmdbId);
}

/** The label on a catalog card's tab; null for states that show none. */
export function stateLabel(state: CatalogState): string | null {
  switch (state) {
    case 'None':
      return strings.request;
    case 'Requested':
      return strings.requested;
    case 'Downloading':
      return strings.downloading;
    case 'PartlyAvailable':
      return strings.partlyAvailable;
    default:
      return null;
  }
}

registerSessionCache(clearRequestStatus);
