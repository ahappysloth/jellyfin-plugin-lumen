import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { BaseItem, ClientConfig } from '../../api/types';
import type { JellyfinApiClient } from '../../compat/jellyfin';
import { Icon } from '../../components/icons';
import { backdropUrl, type ImageRef, imageUrl, resolveImage, TITLE_LOGO } from '../../components/images';
import { ProgressBar } from '../../components/ProgressBar';
import { usePrefersReducedMotion } from '../../components/usePrefersReducedMotion';
import { strings } from '../../strings';
import { formatDate } from '../../util/locale';
import type { PreparedMenu } from '../itemMenu/itemMenu';
import { openUnder } from '../itemMenu/lazyItemMenu';
import { LazyTrailer } from '../home/lazyTrailer';
import { formatRuntime } from './badges';
import { type DownloadLink, nativeDownload } from './download';

/** The details trailer starts sooner than the home hero's: the user chose this title. */
const DETAILS_TRAILER_DELAY_SECONDS = 1.5;

export interface PrimaryAction {
  label: string;
  progress?: number;
  onClick: () => void;
  /** Playback is starting: the button shows a spinner and "Starting…" and ignores clicks. */
  busy?: boolean;
  /** With progress to resume: play from the beginning instead (a "Start over" button beside Resume). */
  restart?: () => void;
}

interface Props {
  item: BaseItem;
  client: JellyfinApiClient;
  config: ClientConfig;
  primary: PrimaryAction | null;
  /** Local trailer: plays muted behind the header and backs the Trailer button. */
  trailerId: string | null;
  onTrailer?: () => void;
  /** The item's file, where the user may download it (download.ts). */
  download?: DownloadLink | null;
  onBack: () => void;
  badges: string[];
  /** Lends its backdrop when the item has none (a collection without art borrows its first title's). */
  backdropFallback?: BaseItem;
  /** Replaces the backdrop (an episode shows its own still first). */
  image?: ImageRef | null;
  /** Shown above the title (an episode's show and number). */
  eyebrow?: ComponentChildren;
  played: boolean;
  favorite: boolean;
  error: string | null;
  /** Gets the button, for focus to come back to after Mark as unwatched asks. */
  toggleWatched: (from: HTMLElement) => void;
  toggleFavorite: () => void;
  /** jellyfin-web's ⋯ actions this user has for the item (views/itemMenu); no More button without any. */
  more?: PreparedMenu | null;
}

/** "Mar 4, 2010" for an ISO date; undefined when missing or unparseable. */
export function airDate(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? undefined
    : formatDate(date, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      });
}

export function DetailsHeader(props: Props) {
  const { item, client, primary } = props;
  const [muted, setMuted] = useState(true);
  const [paused, setPaused] = useState(false);
  const [trailerPlaying, setTrailerPlaying] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const backdrop =
    props.image ??
    resolveImage(item, ['Backdrop']) ??
    (props.backdropFallback ? resolveImage(props.backdropFallback, ['Backdrop']) : null);
  // An episode would borrow its show's logo; its own name is the title.
  const logo = item.Type === 'Episode' ? null : resolveImage(item, ['Logo']);
  const preview = props.trailerId && props.config.TrailerPreview && !reducedMotion ? props.trailerId : null;
  const meta = [
    item.CommunityRating ? item.CommunityRating.toFixed(1) : undefined,
    item.Type === 'Episode' ? airDate(item.PremiereDate) : item.ProductionYear?.toString(),
    item.Type === 'Movie' || item.Type === 'Episode'
      ? (formatRuntime(item.RunTimeTicks) ?? undefined)
      : undefined,
  ].filter((part): part is string => !!part);
  const boxes = [item.OfficialRating, ...props.badges].filter((b): b is string => !!b);
  // Named as they read (WCAG 2.5.3), also once a phone's layout hides the label (buttons.css). The label says the
  // state, so there's no aria-pressed: a toggle button's name must not change with it.
  const favorite = props.favorite ? strings.favorited : strings.favorite;
  const watched = props.played ? strings.watched : strings.markWatchedShort;

  return (
    <header class={`lmn-details__header${trailerPlaying ? ' is-playing' : ''}`}>
      {backdrop && <img class="lmn-details__backdrop" src={backdropUrl(client, backdrop)} alt="" />}
      {preview && (
        <LazyTrailer
          key={preview}
          trailerId={preview}
          delaySeconds={DETAILS_TRAILER_DELAY_SECONDS}
          client={client}
          muted={muted}
          paused={paused}
          class="lmn-details__trailer"
          onPlayingChange={setTrailerPlaying}
          allowTranscode
        />
      )}
      <div class="lmn-details__scrim" />
      <div class="lmn-details__topbar">
        <button
          type="button"
          class="lmn-icon-button lmn-icon-button--lg"
          aria-label={strings.back}
          onClick={props.onBack}
        >
          <Icon name="back" size={18} />
        </button>
        {trailerPlaying && (
          <div class="lmn-details__trailer-controls">
            <button
              type="button"
              class="lmn-icon-button lmn-icon-button--lg"
              aria-label={paused ? strings.playTrailer : strings.pauseTrailer}
              onClick={() => setPaused((p) => !p)}
            >
              <Icon name={paused ? 'play' : 'pause'} size={18} />
            </button>
            <button
              type="button"
              class="lmn-icon-button lmn-icon-button--lg"
              aria-label={muted ? strings.unmute : strings.mute}
              onClick={() => setMuted((m) => !m)}
            >
              <Icon name={muted ? 'volumeOff' : 'volumeOn'} size={18} />
            </button>
          </div>
        )}
      </div>
      <div class="lmn-details__info">
        {props.eyebrow && <p class="lmn-details__eyebrow">{props.eyebrow}</p>}
        {logo ? (
          <h1 class="lmn-logo-heading">
            <img class="lmn-details__logo" src={imageUrl(client, logo, TITLE_LOGO)} alt={item.Name} />
          </h1>
        ) : (
          <h1 class="lmn-details__title">{item.Name}</h1>
        )}
        <p class="lmn-meta lmn-details__meta">
          {meta.map((part, i) => (
            <span key={part}>
              {i === 0 && item.CommunityRating ? <Icon name="star" size={13} class="lmn-star" /> : null}
              {part}
            </span>
          ))}
          {boxes.map((b) => (
            <span key={b} class="lmn-badge">
              {b}
            </span>
          ))}
        </p>
        {item.Genres && item.Genres.length > 0 && (
          <p class="lmn-meta lmn-details__genres">
            {item.Genres.slice(0, 4).map((g) => (
              <span key={g}>{g}</span>
            ))}
          </p>
        )}
        {item.Overview && <p class="lmn-details__overview">{item.Overview}</p>}
        <div class="lmn-actions">
          {primary && (
            <button
              type="button"
              class={`lmn-button lmn-button--primary lmn-autofocus${primary.busy ? ' is-busy' : ''}`}
              disabled={primary.busy}
              aria-busy={primary.busy ? 'true' : undefined}
              onClick={primary.onClick}
            >
              {primary.busy ? <span class="lmn-spinner" aria-hidden="true" /> : <Icon name="play" />}
              {primary.busy ? strings.starting : primary.label}
              {primary.progress && !primary.busy ? <ProgressBar percent={primary.progress} /> : null}
            </button>
          )}
          {primary?.restart && (
            <button
              type="button"
              class="lmn-button lmn-button--secondary"
              aria-label={strings.startOver}
              disabled={primary.busy}
              onClick={primary.restart}
            >
              <Icon name="replay" />
              <span class="lmn-button__label">{strings.startOver}</span>
            </button>
          )}
          {props.download && (
            // A link, not a button: the browser downloads the file itself (the server names it, as an attachment), and
            // it can be saved or copied like any link. The official apps' shell saves it instead (download.ts).
            <a
              class="lmn-button lmn-button--secondary"
              href={props.download.url}
              download=""
              aria-label={strings.download}
              title={props.download.title}
              onClick={(e) => {
                if (props.download && nativeDownload(item, props.download.url)) e.preventDefault();
              }}
            >
              <Icon name="download" />
              <span class="lmn-button__label">{strings.download}</span>
            </a>
          )}
          {props.onTrailer && (
            <button
              type="button"
              class="lmn-button lmn-button--secondary"
              aria-label={strings.trailer}
              onClick={props.onTrailer}
            >
              <Icon name="film" />
              <span class="lmn-button__label">{strings.trailer}</span>
            </button>
          )}
          <button
            type="button"
            class="lmn-button lmn-button--secondary"
            aria-label={favorite}
            onClick={props.toggleFavorite}
          >
            <Icon
              name={props.favorite ? 'heart' : 'heartOutline'}
              class={props.favorite ? 'lmn-heart' : undefined}
            />
            <span class="lmn-button__label">{favorite}</span>
          </button>
          <button
            type="button"
            class="lmn-button lmn-button--secondary"
            aria-label={watched}
            onClick={(e) => props.toggleWatched(e.currentTarget)}
          >
            <Icon name={props.played ? 'check' : 'eye'} />
            <span class="lmn-button__label">{watched}</span>
          </button>
          {props.more && (
            <button
              type="button"
              class="lmn-button lmn-button--secondary"
              aria-label={strings.more}
              aria-haspopup="menu"
              onClick={(e) => openUnder(props.more!, e.currentTarget)}
            >
              <Icon name="more" />
              <span class="lmn-button__label">{strings.more}</span>
            </button>
          )}
        </div>
        {props.error && (
          <p class="lmn-toast" role="alert">
            {props.error}
          </p>
        )}
      </div>
    </header>
  );
}
