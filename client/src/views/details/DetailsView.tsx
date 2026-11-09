import { useEffect, useState } from 'preact/hooks';
import type { LumenApi } from '../../api/lumenApi';
import type { BaseItem } from '../../api/types';
import { VIEW_TIMEOUT_MS, withTimeout } from '../../util/withTimeout';
import type { ViewContext } from '../context';
import { liftVeil } from '../../veil/veil';
import { CollectionDetails } from './CollectionDetails';
import { PersonDetails } from './PersonDetails';
import { MovieDetails } from './MovieDetails';
import { SeriesDetails } from './SeriesDetails';

export interface ResolvedDetails {
  item: BaseItem;
  seasonId?: string;
}

/** Which Lumen view handles an item. Null means the stock details page keeps it. */
export async function resolveDetails(api: LumenApi, id: string): Promise<ResolvedDetails | null> {
  const item = await api.getItem(id);
  if (item.Type === 'Movie' || item.Type === 'Series' || item.Type === 'BoxSet' || item.Type === 'Person')
    return { item };
  if (item.Type === 'Season' && item.SeriesId)
    return { item: await api.getItem(item.SeriesId), seasonId: item.Id };
  return null;
}

export function DetailsView({ id, ctx }: { id: string; ctx: ViewContext }) {
  const [resolved, setResolved] = useState<ResolvedDetails | null>(null);

  useEffect(() => {
    let cancelled = false;
    withTimeout(resolveDetails(ctx.api, id), VIEW_TIMEOUT_MS)
      .then((result) => {
        if (cancelled) return;
        if (result) setResolved(result);
        else ctx.onFallback();
      })
      .catch(() => {
        if (!cancelled) ctx.onFallback();
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (resolved) liftVeil();
  }, [resolved !== null]);

  if (!resolved) return <div class="lmn-details lmn-details--loading" aria-busy="true" />;
  switch (resolved.item.Type) {
    case 'Movie':
      return <MovieDetails item={resolved.item} ctx={ctx} />;
    case 'BoxSet':
      return <CollectionDetails item={resolved.item} ctx={ctx} />;
    case 'Person':
      return <PersonDetails item={resolved.item} ctx={ctx} />;
    default:
      return <SeriesDetails series={resolved.item} initialSeasonId={resolved.seasonId} ctx={ctx} />;
  }
}
