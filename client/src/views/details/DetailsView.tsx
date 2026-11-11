import { useEffect, useState } from 'preact/hooks';
import type { LumenApi } from '../../api/lumenApi';
import type { BaseItem } from '../../api/types';
import { VIEW_TIMEOUT_MS, withTimeout } from '../../util/withTimeout';
import type { ViewContext } from '../context';
import { strings } from '../../strings';
import { liftVeil } from '../../veil/veil';
import { PageError } from '../pageError';
import { CollectionDetails } from './CollectionDetails';
import { EpisodeDetails } from './EpisodeDetails';
import { PersonDetails } from './PersonDetails';
import { MovieDetails } from './MovieDetails';
import { SeriesDetails } from './SeriesDetails';
import { goBack } from './useItemActions';

export interface ResolvedDetails {
  item: BaseItem;
  seasonId?: string;
}

/**
 * Why an item couldn't be loaded. `notFound`: the server has no such item for this user; `forbidden`: the user may not
 * (a 401/403); `server`: the server failed (5xx and the like); `offline`: no answer at all (a network error, or the
 * view's timeout).
 */
export type LoadFailure = 'notFound' | 'forbidden' | 'server' | 'offline';

export class ItemLoadError extends Error {
  constructor(readonly failure: LoadFailure) {
    super(`item couldn't be loaded: ${failure}`);
  }
}

/**
 * Which Lumen view handles an item. Null means the stock details page keeps it. Rejects with ItemLoadError when the
 * server answered with an error.
 */
export async function resolveDetails(api: LumenApi, id: string): Promise<ResolvedDetails | null> {
  try {
    return await resolveItem(api, id);
  } catch (error) {
    throw new ItemLoadError(loadFailure(error));
  }
}

async function resolveItem(api: LumenApi, id: string): Promise<ResolvedDetails | null> {
  const item = await api.getItem(id);
  if (
    item.Type === 'Movie' ||
    item.Type === 'Series' ||
    item.Type === 'BoxSet' ||
    item.Type === 'Person' ||
    (item.Type === 'Episode' && item.SeriesId && item.SeasonId)
  )
    return { item };
  if (item.Type === 'Season' && item.SeriesId)
    return { item: await api.getItem(item.SeriesId), seasonId: item.Id };
  return null;
}

/**
 * jellyfin-web's ajax rejects with the fetch Response. The server answers 404 both for an id it doesn't have and for an
 * item the user can't see (a library they have no access to, a parental rating above theirs); 400 for an id that
 * isn't one. No status: the request never got an answer.
 */
export function loadFailure(error: unknown): LoadFailure {
  const status = (error as { status?: unknown } | null)?.status;
  if (status === 404 || status === 400) return 'notFound';
  if (status === 401 || status === 403) return 'forbidden';
  return typeof status === 'number' && status > 0 ? 'server' : 'offline';
}

const FAILURE_MESSAGES: Record<Exclude<LoadFailure, 'notFound'>, string> = {
  forbidden: strings.pageForbidden,
  server: strings.pageServerError,
  offline: strings.pageFailed,
};

export function DetailsView({ id, ctx }: { id: string; ctx: ViewContext }) {
  const [resolved, setResolved] = useState<ResolvedDetails | null>(null);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Try again keeps the error page (and Lumen's nav) up, its button busy, until the new attempt settles.
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    withTimeout(resolveDetails(ctx.api, id), VIEW_TIMEOUT_MS)
      .then((result) => {
        if (cancelled) return;
        setRetrying(false);
        setFailure(null);
        if (result) setResolved(result);
        else ctx.onFallback();
      })
      // jellyfin-web's own page would only spin forever here (the item is gone, or the server is down): say which.
      .catch((error: unknown) => {
        if (cancelled) return;
        setRetrying(false);
        setFailure(error instanceof ItemLoadError ? error.failure : 'offline');
      });
    return () => {
      cancelled = true;
    };
  }, [id, attempt]);

  useEffect(() => {
    if (resolved || failure) liftVeil();
  }, [resolved !== null, failure]);

  if (failure === 'notFound')
    return (
      <PageError
        ctx={ctx}
        title={strings.itemNotFoundTitle}
        message={strings.itemNotFound}
        onBack={() => goBack(ctx)}
      />
    );
  if (failure)
    return (
      <PageError
        ctx={ctx}
        title={strings.pageFailedTitle}
        message={FAILURE_MESSAGES[failure]}
        // Asking again won't give the user access.
        onRetry={
          failure === 'forbidden'
            ? undefined
            : () => {
                setRetrying(true);
                setAttempt((n) => n + 1);
              }
        }
        retrying={retrying}
        onBack={() => goBack(ctx)}
      />
    );
  if (!resolved) return <div class="lmn-details lmn-details--loading" aria-busy="true" />;
  switch (resolved.item.Type) {
    case 'Movie':
      return <MovieDetails item={resolved.item} ctx={ctx} />;
    case 'BoxSet':
      return <CollectionDetails item={resolved.item} ctx={ctx} />;
    case 'Person':
      return <PersonDetails item={resolved.item} ctx={ctx} />;
    case 'Episode':
      return <EpisodeDetails key={resolved.item.Id} episode={resolved.item} ctx={ctx} />;
    default:
      return <SeriesDetails series={resolved.item} initialSeasonId={resolved.seasonId} ctx={ctx} />;
  }
}
