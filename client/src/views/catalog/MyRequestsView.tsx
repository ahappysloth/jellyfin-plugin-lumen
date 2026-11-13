import { useEffect, useRef } from 'preact/hooks';
import type { MyRequest } from '../../api/types';
import { Icon } from '../../components/icons';
import { LoadError } from '../../components/LoadError';
import { useAutoFocus } from '../../components/useAutoFocus';
import { strings } from '../../strings';
import { formatDate } from '../../util/locale';
import { liftVeil } from '../../veil/veil';
import { PageHeader } from '../browse/Toolbar';
import type { ViewContext } from '../context';
import { LazyPushToggle } from '../push/lazyPush';
import { catalogHash, catalogImageUrl, useCatalogImageToken } from './catalog';
import { RequestProgressBlock } from './RequestProgressBlock';
import {
  FAST_MS,
  isMoving,
  refreshIfOlder,
  refreshRequestProgress,
  startRequestProgress,
  useMyRequests,
  usePollFast,
} from './requestProgress';
import { titleStrings } from './titleStrings';

/**
 * The user's requests, newest first, each with its status, progress and time left (request progress design note,
 * 2026-11-12). One row per title; a row opens the title's page, or its library page once it's ready. Fresh when it
 * opens, then checked every 10 s while something is downloading (requestProgress.ts).
 */
export function MyRequestsView({ ctx }: { ctx: ViewContext }) {
  const { requests, available, failed } = useMyRequests();
  const imageToken = useCatalogImageToken(ctx, !!ctx.config.Requests);
  const rootRef = useRef<HTMLDivElement>(null);
  useAutoFocus(rootRef, requests !== null, ctx.layout);
  usePollFast(!!requests?.some((r) => isMoving(r.Status)));
  useEffect(() => {
    liftVeil();
    if (!ctx.config.Requests) return;
    // Opened straight from a link, before App has started following requests: start now.
    startRequestProgress(ctx);
    refreshIfOlder(FAST_MS);
  }, []);

  let body;
  if (!ctx.config.Requests || available === false) {
    body = <p class="lmn-browse__empty">{titleStrings.noRequestFeatures}</p>;
  } else if (requests === null) {
    body = failed ? (
      <LoadError message={titleStrings.requestsFailed} onRetry={() => void refreshRequestProgress()} />
    ) : (
      <div class="lmn-browse__pending" aria-busy="true" />
    );
  } else if (requests.length === 0) {
    body = (
      <div class="lmn-browse__empty">
        <span class="lmn-browse__empty-icon">
          <Icon name="download" size={32} />
        </span>
        <p class="lmn-browse__empty-title">{titleStrings.noRequests}</p>
        <p>{titleStrings.noRequestsHint}</p>
      </div>
    );
  } else {
    body = (
      <ul class="lmn-requests" aria-label={strings.myRequests}>
        {requests.map((request, i) => (
          <RequestRow
            key={request.Item.Key}
            request={request}
            ctx={ctx}
            imageToken={imageToken}
            first={i === 0}
          />
        ))}
      </ul>
    );
  }

  return (
    <div ref={rootRef} class="lmn-browse lmn-my-requests">
      <PageHeader title={strings.myRequests} />
      {/* "Notify me when requests are ready", where this device can get notifications (it draws nothing elsewhere). */}
      {ctx.config.Requests && available !== false && <LazyPushToggle ctx={ctx} />}
      {body}
    </div>
  );
}

function RequestRow({
  request,
  ctx,
  imageToken,
  first,
}: {
  request: MyRequest;
  ctx: ViewContext;
  imageToken: string | null | undefined;
  first: boolean;
}) {
  const item = request.Item;
  const meta = [
    item.Year?.toString(),
    item.MediaType === 'movie' ? strings.movie : strings.show,
    request.RequestedAt
      ? titleStrings.requestedOn(
          formatDate(new Date(request.RequestedAt), { month: 'short', day: 'numeric' }),
        )
      : undefined,
  ].filter((p): p is string => !!p);
  const art = item.Poster ?? item.Backdrop;
  return (
    <li>
      {/* Ready (and on the server for this user): its library page; otherwise the title's page. */}
      <a class={`lmn-request${first ? ' lmn-autofocus' : ''}`} href={catalogHash(item)}>
        <span class="lmn-request__art">
          {art && imageToken ? (
            <img src={catalogImageUrl(ctx.client, art, 'w185', imageToken)} alt="" loading="lazy" />
          ) : (
            <span class="lmn-card__placeholder" aria-hidden="true">
              {item.Title}
            </span>
          )}
        </span>
        <div class="lmn-request__body">
          <span class="lmn-request__title">{item.Title}</span>
          <span class="lmn-request__meta">{meta.join(' · ')}</span>
          <RequestProgressBlock request={request} compact />
        </div>
        <Icon name="chevronRight" size={20} class="lmn-request__go" />
      </a>
    </li>
  );
}
