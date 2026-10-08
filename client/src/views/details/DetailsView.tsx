import { useEffect, useState } from 'preact/hooks';
import type { LumenApi } from '../../api/lumenApi';
import type { BaseItem } from '../../api/types';
import type { ViewContext } from '../context';
import { MovieDetails } from './MovieDetails';

export interface ResolvedDetails {
  item: BaseItem;
  seasonId?: string;
}

/** Which Lumen view handles an item. Null means the stock details page keeps it. */
export async function resolveDetails(api: LumenApi, id: string): Promise<ResolvedDetails | null> {
  const item = await api.getItem(id);
  if (item.Type === 'Movie') return { item };
  return null;
}

export function DetailsView({ id, ctx }: { id: string; ctx: ViewContext }) {
  const [resolved, setResolved] = useState<ResolvedDetails | null>(null);

  useEffect(() => {
    let cancelled = false;
    resolveDetails(ctx.api, id)
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

  if (!resolved) return <div class="lmn-details lmn-details--loading" aria-busy="true" />;
  return <MovieDetails item={resolved.item} ctx={ctx} />;
}
