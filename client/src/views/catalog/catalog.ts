import { useEffect, useLayoutEffect, useState } from 'preact/hooks';
import type { CatalogItem, CatalogState, RequestStatus } from '../../api/types';
import { detailsHash, type JellyfinApiClient } from '../../compat/jellyfin';
import { strings } from '../../strings';
import { titleHash } from '../../takeover/routes';
import { registerSessionCache } from '../../util/sessionCaches';
import type { ViewContext } from '../context';
import { refreshRequestProgress } from './requestProgress';

export type CatalogImageSize = 'w185' | 'w300' | 'w780' | 'w1280';

const NO_ACCESS: RequestStatus = { Enabled: false, CanRequestMovies: false, CanRequestTv: false };

/** One status lookup per user per page load; request features stay hidden until (and unless) it says yes. */
const statusByUser = new Map<string, Promise<RequestStatus>>();

export function loadRequestStatus(ctx: Pick<ViewContext, 'api' | 'userId'>): Promise<RequestStatus> {
  let status = statusByUser.get(ctx.userId);
  if (!status) {
    const userId = ctx.userId;
    status = ctx.api.getRequestStatus().then(
      (s) => {
        setImageToken(userId, s.ImageToken ?? null);
        return s;
      },
      () => {
        statusByUser.delete(userId); // a transient failure is retried next time, not remembered
        return NO_ACCESS;
      },
    );
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
  imageTokens.clear();
}

/** Each user's catalog image token, from their request status. */
const imageTokens = new Map<string, string | null>();
const tokenListeners = new Set<() => void>();

function setImageToken(userId: string, token: string | null): void {
  imageTokens.set(userId, token);
  tokenListeners.forEach((l) => l());
}

/**
 * The signed-in user's catalog image token, loading their request status if needed; undefined until it arrives.
 * Re-renders when it does.
 */
export function useCatalogImageToken(
  ctx: Pick<ViewContext, 'api' | 'userId'>,
  enabled = true,
): string | null | undefined {
  const [, rerender] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const listener = () => rerender((n) => n + 1);
    tokenListeners.add(listener);
    void loadRequestStatus(ctx);
    return () => void tokenListeners.delete(listener);
  }, [ctx.userId, enabled]);
  return imageTokens.get(ctx.userId);
}

/**
 * TMDB artwork through Lumen's proxy. <img> can't send headers, so the URL carries the user's image token, which
 * only opens catalog artwork: never the Jellyfin access token, which would end up in logs and the browser history.
 */
export function catalogImageUrl(
  client: Pick<JellyfinApiClient, 'getUrl'>,
  file: string,
  size: CatalogImageSize,
  token: string,
): string {
  return client.getUrl(`Lumen/Requests/Image/${size}/${encodeURIComponent(file)}`, { t: token });
}

/** States changed by requests made this session, so every card for the title updates in place. */
const stateOverrides = new Map<string, CatalogState>();
const listeners = new Set<() => void>();

export function setCatalogState(key: string, state: CatalogState): void {
  stateOverrides.set(key, state);
  listeners.forEach((l) => l());
  // A request was just filed: follow its progress from now on.
  void refreshRequestProgress();
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
