import { useEffect, useRef, useState } from 'preact/hooks';
import type { CatalogItem, CatalogMediaType, CatalogTitle, RequestResult } from '../../api/types';
import { detailsHash } from '../../compat/jellyfin';
import { Icon } from '../../components/icons';
import { useAutoFocus } from '../../components/useAutoFocus';
import { strings } from '../../strings';
import { liftVeil } from '../../veil/veil';
import { VIEW_TIMEOUT_MS, withTimeout } from '../../util/withTimeout';
import type { ViewContext } from '../context';
import { initials } from '../details/CastRow';
import { goBack } from '../details/useItemActions';
import {
  catalogHash,
  catalogImageUrl,
  forgetCatalogState,
  setCatalogState,
  stateLabel,
  useCatalogState,
} from './catalog';
import { CatalogCard } from './CatalogCard';
import { RequestDialog } from './RequestDialog';

/**
 * A catalog title's page (requests spec §5.3): the details-page header with Request (or the request's state) in place
 * of Play, then cast and Seerr's recommendations. A title the server already has links to its library page.
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
  const [failed, setFailed] = useState(false);
  const [dialog, setDialog] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  useAutoFocus(rootRef, title !== null, ctx.layout);

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
  }, [mediaType, tmdbId]);

  if (failed) {
    return (
      <article class="lmn-details lmn-title">
        <div class="lmn-browse__error lmn-title__failed" role="alert">
          <p>{strings.titleFailed}</p>
          <button type="button" class="lmn-button lmn-button--secondary" onClick={() => goBack(ctx)}>
            {strings.back}
          </button>
        </div>
      </article>
    );
  }
  if (!title) return <div class="lmn-details lmn-details--loading" aria-busy="true" />;

  const onRequested = (result: RequestResult, seasons: number[] | null): void => {
    const updated: CatalogTitle = {
      ...title,
      State:
        title.State === 'PartlyAvailable'
          ? 'PartlyAvailable'
          : result.State === 'None'
            ? 'Requested'
            : result.State,
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
      <TitleHeader title={title} ctx={ctx} onRequest={() => setDialog(true)} />
      {title.Cast.length > 0 && (
        <section class="lmn-row lmn-cast" aria-label={strings.cast}>
          <h2 class="lmn-row__title">{strings.cast}</h2>
          <div class="lmn-row__scroller focuscontainer-x">
            {title.Cast.map((person) => (
              <div key={person.TmdbId} class="lmn-person">
                {person.Photo ? (
                  <img
                    class="lmn-person__photo"
                    src={catalogImageUrl(ctx.client, person.Photo, 'w185')}
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
          <div class="lmn-grid focuscontainer">
            {title.Recommendations.map((item: CatalogItem) => (
              <CatalogCard
                key={item.Key}
                item={item}
                client={ctx.client}
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
  onRequest,
}: {
  title: CatalogTitle;
  ctx: ViewContext;
  onRequest: () => void;
}) {
  const state = useCatalogState(title);
  const meta = [
    title.Rating ? title.Rating.toFixed(1) : undefined,
    title.Year?.toString(),
    title.Runtime ? strings.runtimeMinutes(title.Runtime) : undefined,
    title.MediaType === 'movie' ? strings.movie : strings.show,
  ].filter((p): p is string => !!p);
  const owned = title.JellyfinItemId;
  const label = stateLabel(state);
  const note =
    state === 'Blocklisted'
      ? strings.blocklisted
      : !title.CanRequest && state === 'None' && !owned
        ? strings.cannotRequest
        : null;

  return (
    <header class="lmn-details__header">
      {title.Backdrop && (
        <img
          class="lmn-details__backdrop"
          src={catalogImageUrl(ctx.client, title.Backdrop, 'w1280')}
          alt=""
        />
      )}
      <div class="lmn-details__scrim" />
      <div class="lmn-details__topbar">
        <button
          type="button"
          class="lmn-icon-button lmn-icon-button--lg"
          aria-label={strings.back}
          onClick={() => goBack(ctx)}
        >
          <Icon name="back" size={18} />
        </button>
      </div>
      <div class="lmn-details__info">
        {!owned && <p class="lmn-title__kicker">{strings.notInLibrary}</p>}
        <h1 class="lmn-details__title">{title.Title}</h1>
        <p class="lmn-meta lmn-details__meta">
          {meta.map((part, i) => (
            <span key={part}>
              {i === 0 && title.Rating ? <Icon name="star" size={13} class="lmn-star" /> : null}
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
              {strings.openInLibrary}
            </button>
          ) : title.CanRequest ? (
            <button type="button" class="lmn-button lmn-button--primary lmn-autofocus" onClick={onRequest}>
              <Icon name="plus" />
              {state === 'PartlyAvailable' || state === 'Requested' ? strings.requestMore : strings.request}
            </button>
          ) : null}
          {!owned && label && state !== 'None' && (
            <span class="lmn-title__state" role="status">
              <Icon name={state === 'Downloading' ? 'film' : 'check'} size={16} />
              {label}
            </span>
          )}
          {title.TrailerUrl && (
            <a
              class="lmn-button lmn-button--secondary"
              href={title.TrailerUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={strings.watchTrailer}
            >
              <Icon name="film" />
              <span class="lmn-button__label">{strings.watchTrailer}</span>
            </a>
          )}
        </div>
        {note && <p class="lmn-title__note">{note}</p>}
      </div>
    </header>
  );
}
