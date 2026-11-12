import { useEffect, useState } from 'preact/hooks';
import type { LumenApi } from '../../api/lumenApi';
import type { BaseItem } from '../../api/types';
import { VIEW_TIMEOUT_MS, withTimeout } from '../../util/withTimeout';
import type { ViewContext } from '../context';
import { strings } from '../../strings';
import { rememberEdit } from '../itemChanges';
import { liftVeil } from '../../veil/veil';
import { PageError } from '../pageError';
import { LazySecondary } from '../secondary/lazySecondary';
import { EpisodeDetails } from './EpisodeDetails';
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

/** The item types whose pages are in views/secondary's file. */
const LAZY_TYPES = ['BoxSet', 'Person'];

/** What a details page is given besides its item. */
export interface DetailsProps {
  ctx: ViewContext;
  /** Fetches the item again (after an edit from its ⋯ menu); the page stays up meanwhile. */
  reload: () => void;
}

export function DetailsView({ id, ctx }: { id: string; ctx: ViewContext }) {
  const [resolved, setResolved] = useState<ResolvedDetails | null>(null);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Try again keeps the error page (and Lumen's nav) up, its button busy, until the new attempt settles.
  const [retrying, setRetrying] = useState(false);
  // Bumped to fetch the item again after an edit from its ⋯ menu (a reload: the page stays up meanwhile).
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    withTimeout(resolveDetails(ctx.api, id), VIEW_TIMEOUT_MS)
      .then((result) => {
        if (cancelled) return;
        setRetrying(false);
        setFailure(null);
        if (result) {
          setResolved(result);
          // After an edit from the ⋯ menu: Back shows the title as it is now.
          if (version > 0) rememberEdit(ctx.userId, result.item);
        } else if (version === 0) ctx.onFallback();
      })
      // jellyfin-web's own page would only spin forever here (the item is gone, or the server is down): say which.
      .catch((error: unknown) => {
        if (cancelled) return;
        setRetrying(false);
        // A reload that fails keeps the page as it was.
        if (version > 0) return;
        setFailure(error instanceof ItemLoadError ? error.failure : 'offline');
      });
    return () => {
      cancelled = true;
    };
  }, [id, attempt, version]);
  const reload = (): void => setVersion((v) => v + 1);

  // A person's or a collection's page is in a file of its own (views/secondary): it lifts the veil once that's in.
  const lazy = resolved !== null && LAZY_TYPES.includes(resolved.item.Type);
  useEffect(() => {
    if ((resolved && !lazy) || failure) liftVeil();
  }, [resolved !== null, lazy, failure]);

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
                if (retrying) return;
                setRetrying(true);
                setAttempt((n) => n + 1);
              }
        }
        retrying={retrying}
        onBack={() => goBack(ctx)}
      />
    );
  const loading = <div class="lmn-details lmn-details--loading" aria-busy="true" />;
  if (!resolved) return loading;
  switch (resolved.item.Type) {
    case 'Movie':
      return <MovieDetails item={resolved.item} ctx={ctx} reload={reload} />;
    case 'BoxSet':
      return (
        <LazySecondary
          ctx={ctx}
          pending={loading}
          liftOnLoad
          onBack={() => goBack(ctx)}
          view={(m) => <m.CollectionDetails item={resolved.item} ctx={ctx} reload={reload} />}
        />
      );
    case 'Person':
      return (
        <LazySecondary
          ctx={ctx}
          pending={loading}
          liftOnLoad
          onBack={() => goBack(ctx)}
          view={(m) => <m.PersonDetails item={resolved.item} ctx={ctx} />}
        />
      );
    case 'Episode':
      return <EpisodeDetails key={resolved.item.Id} episode={resolved.item} ctx={ctx} reload={reload} />;
    default:
      return (
        <SeriesDetails series={resolved.item} initialSeasonId={resolved.seasonId} ctx={ctx} reload={reload} />
      );
  }
}
