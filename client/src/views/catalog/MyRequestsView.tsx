import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { MyRequest, Requester } from '../../api/types';
import { Icon } from '../../components/icons';
import { LoadError } from '../../components/LoadError';
import { useAutoFocus } from '../../components/useAutoFocus';
import { strings } from '../../strings';
import { loadStyles } from '../../util/loadStyles';
import { formatDate, formatNumber } from '../../util/locale';
import { liftVeil } from '../../veil/veil';
import { avatarUrl, loadAccount } from '../account/account';
import { PageHeader } from '../browse/Toolbar';
import type { ViewContext } from '../context';
import { LazyPushToggle } from '../push/lazyPush';
import { readEveryone, saveEveryone, useAllRequests } from './allRequests';
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
import {
  countByFilter,
  inFilter,
  matchesSearch,
  REQUEST_FILTERS,
  type RequestFilter,
  requestFromHash,
  searchWords,
  shownFilters,
} from './requestFilters';
import { titleStrings } from './titleStrings';

/**
 * The page's own stylesheet (search, chips, requester) and the notifications toggle's, whose switch "Everyone's
 * requests" looks like. Asked for as the page's code runs: the list waits for them (as it waits for its data), and shows
 * anyway if they can't load.
 */
let styles: Promise<unknown> | null = null;
const loadPageStyles = (): Promise<unknown> =>
  (styles ??= Promise.all([loadStyles('lumen-requests.css'), loadStyles('lumen-push.css')]).catch(
    () => undefined,
  ));

/**
 * The user's requests, newest first, each with its status, progress and time left (request progress design note,
 * 2026-11-12). One row per title; a row opens the title's page, or its library page once it's ready. Fresh when it
 * opens, then checked every 10 s while something is downloading (requestProgress.ts).
 *
 * A search box filters them by title as you type, and a row of chips by where they stand (requestFilters.ts), both
 * over the list as loaded: the user's 50 most recent requested titles (RequestProgressService.Take), everyone's 100
 * (EveryonesRequests.Take), which is all of them for most users and servers. Administrators also get "Everyone's
 * requests", every user's requests with who asked (search finds those names too), kept on per device and user.
 */
export function MyRequestsView({ ctx }: { ctx: ViewContext }) {
  const mine = useMyRequests();
  const imageToken = useCatalogImageToken(ctx, !!ctx.config.Requests);
  const [admin, setAdmin] = useState(false);
  const [everyoneOn, setEveryoneOn] = useState(() => readEveryone(ctx.userId));
  // With the switch left on, the list waits for who they are: their own first, then everyone's, would flicker.
  const [accountKnown, setAccountKnown] = useState(!everyoneOn);
  // Only ever for an administrator: anyone else's switch was left on by an account that has since lost the role.
  const everyone = admin && everyoneOn;
  const all = useAllRequests(ctx, everyone);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<RequestFilter>('all');
  const [styled, setStyled] = useState(false);
  // The request a title page's status opened this page on (myRequestHash): its row is scrolled to and lit up once, and
  // takes a TV's first focus instead of the newest.
  const [target, setTarget] = useState(() => requestFromHash(window.location.hash));
  const scrolled = useRef(false);
  const field = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  /** The chip that had focus as this render began (see below). */
  const focusedChip = useRef<RequestFilter | null>(null);

  const requests = !accountKnown ? null : everyone ? all.requests : mine.requests;
  const failed = accountKnown && (everyone ? all.failed : mine.failed);
  // Once a list has shown, switching between the two never takes the remote's focus back to the first row.
  const shown = useRef(false);
  if (requests !== null && styled) shown.current = true;
  useAutoFocus(rootRef, shown.current, ctx.layout);
  // Couldn't load: on a TV, Try again takes focus (the D-pad has nothing else here), until the list comes.
  useAutoFocus(rootRef, failed && requests === null, ctx.layout);
  usePollFast(!everyone && !!mine.requests?.some((r) => isMoving(r.Status)));
  useEffect(() => {
    let live = true;
    void loadPageStyles().then(() => live && setStyled(true));
    liftVeil();
    if (!ctx.config.Requests) return undefined;
    // Opened straight from a link, before App has started following requests: start now.
    startRequestProgress(ctx);
    refreshIfOlder(FAST_MS);
    // Who may see everyone's: Jellyfin says, and so does the server again when they're asked for.
    loadAccount(ctx)
      .then(
        (account) => live && setAdmin(!!account.user.Policy?.IsAdministrator),
        () => undefined,
      )
      .then(() => live && setAccountKnown(true));
    return () => {
      live = false;
    };
  }, []);

  const features = !!ctx.config.Requests && mine.available !== false;
  const words = searchWords(query);
  const found = requests?.filter((r) => matchesSearch(r, words)) ?? [];
  const counts = countByFilter(found);
  const chips = shownFilters(counts, filter);
  const visible = found.filter((r) => inFilter(r, filter));
  // In everyone's requests, the user's own row for it (the title may be there once per requester), known by its
  // requester's id rather than from the user's own list, which may answer later.
  const at = visible.findIndex(
    (r) => r.Item.Key === target && (!everyone || r.RequestedBy?.UserId === ctx.userId),
  );
  useEffect(() => {
    // Once the rows are on the page (they wait for its styles).
    const root = rootRef.current;
    if (at < 0 || !styled || scrolled.current || !root) return;
    scrolled.current = true;
    const row = root.querySelector('.lmn-request.is-found');
    let y = -1;
    const show = (): void => {
      // Not after the user has scrolled on their own.
      if (y >= 0 && window.scrollY !== y) return;
      row?.scrollIntoView?.({ block: 'center' });
      y = window.scrollY;
    };
    show();
    // What shows above it a moment later (the notifications toggle, whose code loads on its own) would push it down:
    // centred again while it's lit up. Not in Safari 13.0, which lacks ResizeObserver. No cleanup: this effect runs
    // on every render, and a page left meanwhile only leaves a detached row, which doesn't scroll.
    if (typeof ResizeObserver !== 'function') return;
    const watch = new ResizeObserver(show);
    watch.observe(root);
    window.setTimeout(() => watch.disconnect(), 2400);
  });
  const tools = features && styled && !!requests && requests.length > 0;

  // A chip goes when nothing is left under it (a check moved its last request on), and one with focus may: never the
  // active one, but one the remote or keyboard is resting on. Focus would fall to the page, where a TV's D-pad has
  // nothing to move from, so it goes to the chip now in its place (the next one shown, else the one before; All always
  // shows). Which chip had it is read before the change reaches the page: not every browser fires blur on an element
  // that's removed.
  const focused = document.activeElement as HTMLElement | null;
  focusedChip.current =
    focused && focused.parentNode === chipsRef.current ? (focused.dataset.filter as RequestFilter) : null;
  useLayoutEffect(() => {
    const gone = focusedChip.current;
    if (!gone || chips.indexOf(gone) >= 0 || (document.activeElement || document.body) !== document.body)
      return;
    const goneAt = REQUEST_FILTERS.indexOf(gone);
    const next = chips.filter((f) => REQUEST_FILTERS.indexOf(f) > goneAt)[0] || chips[chips.length - 1];
    chipsRef.current?.querySelector<HTMLElement>(`[data-filter="${next}"]`)?.focus();
  });

  let body;
  if (!features) {
    body = <p class="lmn-browse__empty">{titleStrings.noRequestFeatures}</p>;
  } else if (requests === null || !styled) {
    body =
      failed && requests === null ? (
        <LoadError
          message={everyone ? titleStrings.everyoneFailed : titleStrings.requestsFailed}
          onRetry={() => (everyone ? all.retry() : void refreshRequestProgress())}
        />
      ) : (
        <div class="lmn-browse__pending" aria-busy="true">
          {/* Once the page's styles are in: the shape of the rows to come, where they'll be. */}
          {styled && (
            <div class="lmn-requests" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <div key={i} class="lmn-request lmn-request--skeleton">
                  <span class="lmn-request__art" />
                  <span class="lmn-request__body">
                    <span class="lmn-skeleton-line" />
                    <span class="lmn-skeleton-line" />
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      );
  } else if (requests.length === 0) {
    body = (
      <div class="lmn-browse__empty">
        <span class="lmn-browse__empty-icon">
          <Icon name="download" size={32} />
        </span>
        <p class="lmn-browse__empty-title">{titleStrings.noRequests}</p>
        <p>{everyone ? titleStrings.noRequestsEveryone : titleStrings.noRequestsHint}</p>
      </div>
    );
  } else if (visible.length === 0) {
    // Nothing for this search, or under this chip: say which, with the way back.
    body = (
      <div class="lmn-browse__empty lmn-requests-empty">
        <span class="lmn-browse__empty-icon">
          <Icon name={words.length ? 'search' : 'download'} size={32} />
        </span>
        <p class="lmn-browse__empty-title">
          {words.length
            ? titleStrings.noMatch(query.trim())
            : titleStrings.filterEmpty[filter as Exclude<RequestFilter, 'all'>]}
        </p>
        <button
          type="button"
          class="lmn-button lmn-button--secondary"
          onClick={() => {
            if (words.length) {
              setQuery('');
              field.current?.focus();
            } else setFilter('all');
          }}
        >
          {words.length ? titleStrings.clearSearch : titleStrings.showAll}
        </button>
      </div>
    );
  } else {
    body = (
      <ul class="lmn-requests" aria-label={strings.myRequests}>
        {visible.map((request, i) => (
          <RequestRow
            // Everyone's: a title once per requester, each entry with requests of its own.
            key={everyone ? `${request.Item.Key}:${request.RequestIds[0]}` : request.Item.Key}
            request={request}
            ctx={ctx}
            imageToken={imageToken}
            first={at < 0 ? i === 0 : i === at}
            onFound={i === at ? () => setTarget(null) : undefined}
            by={everyone ? (request.RequestedBy ?? {}) : null}
            receivedAt={everyone ? all.receivedAt : undefined}
          />
        ))}
      </ul>
    );
  }

  return (
    <div ref={rootRef} class="lmn-browse lmn-my-requests">
      <PageHeader title={strings.myRequests} />
      {/* "Notify me when requests are ready", where this device can get notifications (it draws nothing elsewhere). */}
      {features && <LazyPushToggle ctx={ctx} />}
      {features && styled && (tools || admin) && (
        <div class="lmn-requests-tools">
          {/* A settings row of its own, as the notifications toggle above is (its classes and stylesheet: push.css): the
              D-pad reaches it from the search below, which keeps Left and Right for its text. */}
          {admin && (
            <div class="lmn-push lmn-requests-everyone">
              <div class="lmn-push__row">
                <span class="lmn-push__icon">
                  <Icon name="user" size={20} />
                </span>
                <label class="lmn-push__text" for="lmn-requests-everyone">
                  <span class="lmn-push__label">{titleStrings.everyone}</span>
                </label>
                <button
                  id="lmn-requests-everyone"
                  type="button"
                  role="switch"
                  class="lmn-push__switch lmn-requests-everyone__switch"
                  aria-checked={everyone}
                  onClick={() => {
                    saveEveryone(ctx.userId, !everyone);
                    setEveryoneOn(!everyone);
                  }}
                />
              </div>
            </div>
          )}
          {tools && (
            <form
              class="lmn-requests-search"
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                field.current?.blur(); // closes a phone's keyboard; the list is already filtered
              }}
            >
              <Icon name="search" size={20} class="lmn-requests-search__icon" />
              <input
                ref={field}
                class="lmn-requests-search__input"
                type="search"
                enterKeyHint="search"
                autoComplete="off"
                spellcheck={false}
                placeholder={titleStrings.searchRequests}
                aria-label={titleStrings.searchRequests}
                value={query}
                onInput={(e) => setQuery(e.currentTarget.value)}
              />
              {query && (
                <button
                  type="button"
                  class="lmn-icon-button lmn-requests-search__clear"
                  aria-label={titleStrings.clearSearch}
                  onClick={() => {
                    setQuery('');
                    field.current?.focus();
                  }}
                >
                  <Icon name="close" size={18} />
                </button>
              )}
            </form>
          )}
          {tools && (
            // Like the library pages' chips (Toolbar.tsx Segmented), but none takes the TV's first focus: the newest
            // request does, as before. Only those with something under them (shownFilters).
            <div
              ref={chipsRef}
              class="lmn-segmented lmn-requests-filters focuscontainer-x"
              role="group"
              aria-label={titleStrings.filterLabel}
            >
              {chips.map((f) => (
                <button
                  key={f}
                  type="button"
                  data-filter={f}
                  class={`lmn-chip${f === filter ? ' is-active' : ''}`}
                  aria-pressed={f === filter}
                  onClick={() => setFilter(f)}
                >
                  {f === 'all' ? titleStrings.filterAll : strings.progress[f]}
                  <span class="lmn-chip__count">{formatNumber(counts[f])}</span>
                </button>
              ))}
            </div>
          )}
          {/* One short line for screen readers as the list narrows, rather than re-reading it on each keystroke. Not a
              status role: the notifications toggle above has the page's status line. */}
          <p class="lmn-visually-hidden" aria-live="polite" aria-atomic="true">
            {tools && (words.length || filter !== 'all') ? titleStrings.requestCount(visible.length) : ''}
          </p>
        </div>
      )}
      {body}
    </div>
  );
}

function RequestRow({
  request,
  ctx,
  imageToken,
  first,
  onFound,
  by,
  receivedAt,
}: {
  request: MyRequest;
  ctx: ViewContext;
  imageToken: string | null | undefined;
  first: boolean;
  /** The row a title page's status opened the page on: lit up, then this once that's done. */
  onFound?: () => void;
  /** Who asked: in everyone's requests only. */
  by: Requester | null;
  /** When everyone's requests arrived, for the time left (the user's own count from their own answer). */
  receivedAt?: number;
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
      <a
        class={`lmn-request${first ? ' lmn-autofocus' : ''}${onFound ? ' is-found' : ''}`}
        href={catalogHash(item)}
        onAnimationEnd={onFound}
      >
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
          {by && <RequesterLine ctx={ctx} by={by} />}
          <span class="lmn-request__meta">{meta.join(' · ')}</span>
        </div>
        {/* A column of its own, as wide on every row: the statuses and their bars line up down the list. */}
        <RequestProgressBlock request={request} receivedAt={receivedAt} />
        <Icon name="chevronRight" size={20} class="lmn-request__go" />
      </a>
    </li>
  );
}

/** "Requested by" a Jellyfin user (their picture, else their initial) or a Seerr-only account (its name). */
function RequesterLine({ ctx, by }: { ctx: ViewContext; by: Requester }) {
  const name = by.Name || titleStrings.unknownRequester;
  const picture =
    by.UserId && by.ImageTag
      ? avatarUrl(ctx, { Id: by.UserId, Name: name, PrimaryImageTag: by.ImageTag }, 20)
      : null;
  return (
    <span class="lmn-request__by">
      {picture ? (
        <img class="lmn-request__avatar" src={picture} alt="" loading="lazy" />
      ) : (
        <span class="lmn-request__avatar" aria-hidden="true">
          {by.Name ? by.Name.charAt(0).toUpperCase() : '?'}
        </span>
      )}
      <span>
        <span class="lmn-visually-hidden">{titleStrings.requestedBy}</span>
        {name}
      </span>
    </span>
  );
}
