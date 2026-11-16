import { useEffect, useRef, useState } from 'preact/hooks';
import type { CatalogItem, CatalogMediaType, CatalogTitle, RequestResult } from '../../api/types';
import { detailsHash } from '../../compat/jellyfin';
import { Icon } from '../../components/icons';
import { ProgressBar } from '../../components/ProgressBar';
import { LoadError } from '../../components/LoadError';
import { openContextMenu } from '../../components/ContextMenu';
import { showToast } from '../../components/Toast';
import { useAutoFocus } from '../../components/useAutoFocus';
import { strings } from '../../strings';
import { liftVeil } from '../../veil/veil';
import { loadStyles } from '../../util/loadStyles';
import { VIEW_TIMEOUT_MS, withTimeout } from '../../util/withTimeout';
import type { ViewContext } from '../context';
import { FailedPageMark } from '../pageError';
import { initials } from '../details/CastRow';
import { BackHome, goBack } from '../BackHome';
import { DETAILS_TRAILER_DELAY_SECONDS } from '../details/DetailsHeader';
import { LazyTrailer, LazyTrailerControls, useTrailerControls } from '../home/lazyTrailer';
import { useMoreButton } from '../itemMenu/lazyItemMenu';
import { usePrefersReducedMotion } from '../../components/usePrefersReducedMotion';
import {
  catalogHash,
  catalogImageUrl,
  forgetCatalogState,
  setCatalogState,
  stateLabel,
  useCatalogImageToken,
  useCatalogState,
} from './catalog';
import { CatalogCard } from './CatalogCard';
import { RequestDialog, requestedState } from './RequestDialog';
import { myRequestHash } from './requestFilters';
import { isMoving, progressDetail, progressLabel, usePollFast, useRequestProgress } from './requestProgress';
import { titleStrings } from './titleStrings';

// The request dialog for a card's Request button (lazyTitle.tsx's LazyQuickRequest) and My requests come in this chunk
// too: only users with request features ever need them.
export { QuickRequest } from './QuickRequest';
export { MyRequestsView } from './MyRequestsView';

/**
 * A catalog title's page (requests spec §5.3): the details-page header with Request (or the request's state) in place
 * of Play, then cast and Seerr's recommendations. A title the server already has links to its library page. With "Use
 * online trailers" on, its trailer plays muted behind the header, as on a library title's page: IMDb's, else YouTube's.
 */
export function TitleView({
  mediaType,
  tmdbId,
  ctx,
}: {
  mediaType: CatalogMediaType;
  tmdbId: number;
  ctx: ViewContext;
}) {
  const [title, setTitle] = useState<CatalogTitle | null>(null);
  const imageToken = useCatalogImageToken(ctx);
  const [failed, setFailed] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const rootRef = useRef<HTMLElement>(null);
  useAutoFocus(rootRef, title !== null || failed, ctx.layout);
  // The user's own request for it, if any: checked every 10 s while it's downloading and this page is visible.
  const progress = useRequestProgress(title?.Key ?? `${mediaType}-${tmdbId}`);
  usePollFast(!!progress && isMoving(progress.Status));
  // Once it's ready, the title (fetched again, quietly) links to the library.
  const ready = progress?.Status === 'Ready';
  useEffect(() => {
    if (!ready || !title || title.JellyfinItemId) return undefined;
    let cancelled = false;
    ctx.api.getCatalogTitle(mediaType, tmdbId).then(
      (t) => !cancelled && setTitle(t),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [ready, title !== null]);

  useEffect(() => {
    let cancelled = false;
    setTitle(null);
    setFailed(false);
    withTimeout(ctx.api.getCatalogTitle(mediaType, tmdbId), VIEW_TIMEOUT_MS)
      .then((t) => {
        if (cancelled) return;
        forgetCatalogState(t.Key);
        setTitle(t);
      })
      .catch(() => !cancelled && setFailed(true))
      .finally(() => liftVeil());
    return () => {
      cancelled = true;
    };
  }, [mediaType, tmdbId, attempt]);

  if (failed) {
    return (
      <article ref={rootRef} class="lmn-details lmn-title">
        {/* Lumen's nav comes back, so the page isn't a dead end. */}
        <FailedPageMark />
        <LoadError
          class="lmn-title__failed"
          message={titleStrings.titleFailed}
          onRetry={() => setAttempt((n) => n + 1)}
        >
          <button type="button" class="lmn-button lmn-button--secondary" onClick={() => goBack()}>
            {strings.back}
          </button>
        </LoadError>
      </article>
    );
  }
  if (!title) return <div class="lmn-details lmn-details--loading" aria-busy="true" />;

  const onRequested = (result: RequestResult, seasons: number[] | null): void => {
    const updated: CatalogTitle = {
      ...title,
      State: requestedState(title, result),
      Seasons: title.Seasons.map((s) =>
        s.State === 'None' && (seasons === null || seasons.includes(s.Number))
          ? { ...s, State: 'Requested' }
          : s,
      ),
    };
    updated.CanRequest = updated.MediaType === 'tv' && updated.Seasons.some((s) => s.State === 'None');
    setCatalogState(title.Key, updated.State);
    setTitle(updated);
  };

  return (
    <article ref={rootRef} class="lmn-details lmn-title">
      <TitleHeader title={title} ctx={ctx} imageToken={imageToken} onRequest={() => setDialog(true)} />
      {title.Cast.length > 0 && (
        <section class="lmn-row lmn-cast" aria-label={strings.cast}>
          <h2 class="lmn-row__title">{strings.cast}</h2>
          <div class="lmn-row__scroller focuscontainer-x">
            {title.Cast.map((person) => (
              <div key={person.TmdbId} class="lmn-person">
                {person.Photo && imageToken ? (
                  <img
                    class="lmn-person__photo"
                    src={catalogImageUrl(ctx.client, person.Photo, 'w185', imageToken)}
                    alt=""
                    loading="lazy"
                  />
                ) : (
                  <span class="lmn-person__photo lmn-person__photo--empty" aria-hidden="true">
                    {initials(person.Name)}
                  </span>
                )}
                <span class="lmn-person__name">{person.Name}</span>
                {person.Character && <span class="lmn-person__role">{person.Character}</span>}
              </div>
            ))}
          </div>
        </section>
      )}
      {title.Recommendations.length > 0 && (
        <section class="lmn-row lmn-similar" aria-label={strings.moreLikeThis}>
          <h2 class="lmn-row__title">{strings.moreLikeThis}</h2>
          <div class="lmn-grid focuscontainer-x">
            {title.Recommendations.map((item: CatalogItem) => (
              <CatalogCard
                key={item.Key}
                item={item}
                client={ctx.client}
                imageToken={imageToken}
                variant="landscape"
                onSelect={(i) => ctx.navigate(catalogHash(i))}
              />
            ))}
          </div>
        </section>
      )}
      {dialog && (
        <RequestDialog title={title} ctx={ctx} onClose={() => setDialog(false)} onRequested={onRequested} />
      )}
    </article>
  );
}

function TitleHeader({
  title,
  ctx,
  imageToken,
  onRequest,
}: {
  title: CatalogTitle;
  ctx: ViewContext;
  imageToken: string | null | undefined;
  onRequest: () => void;
}) {
  const state = useCatalogState(title);
  // Asked apart from the title (OnlineTrailerPreview), so the page doesn't wait for IMDb.
  const reducedMotion = usePrefersReducedMotion();
  const preview = ctx.config.TrailerPreview && ctx.config.YouTubeTrailers && !reducedMotion;
  const trailer = useTrailerControls();
  // More, as on a library title's page, with Trailer info: what the server found of this title's trailer online and
  // why, and how it went on this device (views/trailerInfo, its own file, loaded as it's picked). Offered where the
  // library's is, with previews on; the dialog says when online trailers are off.
  const path = `Requests/Title/${title.MediaType}/${title.TmdbId}`;
  const more = useMoreButton({
    open: (at) =>
      openContextMenu({
        ...at,
        label: strings.moreActionsFor(title.Title),
        entries: [
          {
            label: titleStrings.trailerInfo,
            icon: 'film',
            // Loaded here rather than with lazyTrailerInfo.ts, which the item menu's file has: shared, it would be a
            // file of its own.
            onSelect: () =>
              void Promise.all([
                import('../trailerInfo/TrailerInfo'),
                loadStyles('lumen-trailerinfo.css'),
              ]).then(
                ([m]) =>
                  m.openTrailerInfoDialog(
                    ctx,
                    { key: title.Key, of: path, name: title.Title },
                    at.returnFocus,
                  ),
                () => showToast(strings.itemMenuFailed),
              ),
          },
        ],
      }),
  });
  // The user's own request shows as a link to it in My requests instead of the state: the word its row there shows,
  // with the row's bar while it downloads, and the row's detail under it (or what the word means, where it has none).
  const mine = useRequestProgress(title.Key);
  const mineDetail = mine && (progressDetail(mine) || titleStrings.progressNote[mine.Status]);
  const meta = [
    title.Rating ? title.Rating.toFixed(1) : undefined,
    title.Year?.toString(),
    title.Runtime ? titleStrings.runtimeMinutes(title.Runtime) : undefined,
    title.MediaType === 'movie' ? strings.movie : strings.show,
  ].filter((p): p is string => !!p);
  const owned = title.JellyfinItemId;
  const label = stateLabel(state);
  const note =
    state === 'Blocklisted'
      ? titleStrings.blocklisted
      : !title.CanRequest && state === 'None' && !owned
        ? titleStrings.cannotRequest
        : null;

  return (
    <header class={`lmn-details__header${trailer.playing ? ' is-playing' : ''}`}>
      {title.Backdrop && imageToken && (
        <img
          class="lmn-details__backdrop"
          src={catalogImageUrl(ctx.client, title.Backdrop, 'w1280', imageToken)}
          alt=""
        />
      )}
      {preview && (
        <LazyTrailer
          key={title.Key}
          lookup={() => ctx.api.getOnlineTrailer(path)}
          // Its attempts on this device, for Trailer info (a catalog key, apart from library items' ids).
          logKey={title.Key}
          embedBase={ctx.config.YouTubeEmbedBase}
          delaySeconds={DETAILS_TRAILER_DELAY_SECONDS}
          client={ctx.client}
          muted={trailer.muted}
          paused={trailer.paused}
          class="lmn-details__trailer"
          onPlayingChange={trailer.setPlaying}
        />
      )}
      <div class="lmn-details__scrim" />
      <div class="lmn-details__topbar focuscontainer-x">
        <BackHome onBack={() => goBack()} />
        <LazyTrailerControls state={trailer} />
      </div>
      <div class="lmn-details__info">
        {!owned && <p class="lmn-title__kicker">{titleStrings.notInLibrary}</p>}
        <h1 class="lmn-details__title">{title.Title}</h1>
        <p class="lmn-meta lmn-details__meta">
          {meta.map((part, i) => (
            <span key={part}>
              {i === 0 && title.Rating ? <Icon name="star" size={14} class="lmn-star" /> : null}
              {part}
            </span>
          ))}
        </p>
        {title.GenreNames.length > 0 && (
          <p class="lmn-meta lmn-details__genres">
            {title.GenreNames.slice(0, 4).map((g) => (
              <span key={g}>{g}</span>
            ))}
          </p>
        )}
        {title.Overview && <p class="lmn-details__overview">{title.Overview}</p>}
        <div class="lmn-actions">
          {owned ? (
            <button
              type="button"
              class="lmn-button lmn-button--primary lmn-autofocus"
              onClick={() => ctx.navigate(detailsHash(owned))}
            >
              <Icon name="play" />
              {titleStrings.openInLibrary}
            </button>
          ) : title.CanRequest ? (
            <button type="button" class="lmn-button lmn-button--primary lmn-autofocus" onClick={onRequest}>
              <Icon name="plus" />
              {state === 'PartlyAvailable' || state === 'Requested'
                ? titleStrings.requestMore
                : strings.request}
            </button>
          ) : null}
          {mine && !owned && (
            // Without an aria-label (a phone shrinks a labelled secondary button to its icon): its words name it.
            <a
              class="lmn-button lmn-button--secondary lmn-autofocus lmn-title__status"
              href={myRequestHash(title.Key)}
              aria-describedby={mineDetail ? 'lmn-title-progress' : undefined}
            >
              {/* Ready shows only until the page, fetched again, offers Open in library. */}
              <Icon name={/^(Declined|Failed)$/.test(mine.Status) ? 'close' : 'download'} />
              {progressLabel(mine.Status)}
              {isMoving(mine.Status) && mine.Percent != null && <ProgressBar percent={mine.Percent} />}
              <span class="lmn-visually-hidden">, {strings.myRequests}</span>
            </a>
          )}
          {!owned && label && state !== 'None' && !mine && (
            <span class="lmn-title__state" role="status">
              <Icon name={state === 'Downloading' ? 'film' : 'check'} size={18} />
              {label}
            </span>
          )}
          {title.TrailerUrl && (
            <a
              class="lmn-button lmn-button--secondary"
              href={title.TrailerUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={titleStrings.watchTrailer}
            >
              <Icon name="film" />
              <span class="lmn-button__label">{titleStrings.watchTrailer}</span>
            </a>
          )}
          {ctx.config.TrailerPreview && (
            <button
              type="button"
              class="lmn-button lmn-button--secondary"
              aria-label={strings.moreActionsFor(title.Title)}
              aria-haspopup="menu"
              aria-expanded={more.expanded}
              onClick={(e) => more.open(e.currentTarget)}
            >
              <Icon name="more" />
              <span class="lmn-button__label">{strings.more}</span>
            </button>
          )}
        </div>
        {mine && !owned && mineDetail && (
          <p id="lmn-title-progress" class="lmn-title__note">
            {mineDetail}
          </p>
        )}
        {note && <p class="lmn-title__note">{note}</p>}
      </div>
    </header>
  );
}
