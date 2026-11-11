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

/** The server has no such item for this user. */
export class ItemNotFoundError extends Error {}

/**
 * Which Lumen view handles an item. Null means the stock details page keeps it. Rejects with ItemNotFoundError when
 * the server says there's no such item.
 */
export async function resolveDetails(api: LumenApi, id: string): Promise<ResolvedDetails | null> {
  try {
    return await resolveItem(api, id);
  } catch (error) {
    if (isNotFound(error)) throw new ItemNotFoundError(id);
    throw error;
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
 * item the user can't see (a library they have no access to, a parental rating above theirs).
 */
export function isNotFound(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return status === 404 || status === 400;
}

export function DetailsView({ id, ctx }: { id: string; ctx: ViewContext }) {
  const [resolved, setResolved] = useState<ResolvedDetails | null>(null);
  const [failure, setFailure] = useState<'notFound' | 'failed' | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setFailure(null);
    withTimeout(resolveDetails(ctx.api, id), VIEW_TIMEOUT_MS)
      .then((result) => {
        if (cancelled) return;
        if (result) setResolved(result);
        else ctx.onFallback();
      })
      // jellyfin-web's own page would only spin forever here (the item is gone, or the server is down): say which.
      .catch((error: unknown) => {
        if (!cancelled) setFailure(error instanceof ItemNotFoundError ? 'notFound' : 'failed');
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
        message={strings.pageFailed}
        onRetry={() => setAttempt((n) => n + 1)}
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
