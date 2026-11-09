import { useState } from 'preact/hooks';
import type { BaseItem, ClientConfig } from '../../api/types';
import type { JellyfinApiClient } from '../../compat/jellyfin';
import { Icon } from '../../components/icons';
import { imageUrl, resolveImage } from '../../components/images';
import { ProgressBar } from '../../components/ProgressBar';
import { usePrefersReducedMotion } from '../../components/usePrefersReducedMotion';
import { strings } from '../../strings';
import { TrailerPreview } from '../home/TrailerPreview';
import { formatRuntime } from './badges';

/** The details trailer starts sooner than the home hero's: the user chose this title. */
const DETAILS_TRAILER_DELAY_SECONDS = 1.5;

export interface PrimaryAction {
  label: string;
  progress?: number;
  onClick: () => void;
}

interface Props {
  item: BaseItem;
  client: Pick<JellyfinApiClient, 'getUrl' | 'accessToken'>;
  config: ClientConfig;
  primary: PrimaryAction | null;
  /** Local trailer: plays muted behind the header and backs the Trailer button. */
  trailerId: string | null;
  onTrailer?: () => void;
  onBack: () => void;
  badges: string[];
  played: boolean;
  favorite: boolean;
  error: string | null;
  toggleWatched: () => void;
  toggleFavorite: () => void;
}

export function DetailsHeader(props: Props) {
  const { item, client, primary } = props;
  const [muted, setMuted] = useState(true);
  const [trailerPlaying, setTrailerPlaying] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const backdrop = resolveImage(item, ['Backdrop']);
  const logo = resolveImage(item, ['Logo']);
  const preview = props.trailerId && props.config.TrailerPreview && !reducedMotion ? props.trailerId : null;
  const meta = [
    item.CommunityRating ? item.CommunityRating.toFixed(1) : undefined,
    item.ProductionYear?.toString(),
    item.Type === 'Movie' ? (formatRuntime(item.RunTimeTicks) ?? undefined) : undefined,
  ].filter((part): part is string => !!part);
  const boxes = [item.OfficialRating, ...props.badges].filter((b): b is string => !!b);

  return (
    <header class={`lmn-details__header${trailerPlaying ? ' is-playing' : ''}`}>
      {backdrop && (
        <img class="lmn-details__backdrop" src={imageUrl(client, backdrop, { width: 1920 })} alt="" />
      )}
      {preview && (
        <TrailerPreview
          key={preview}
          trailerId={preview}
          delaySeconds={DETAILS_TRAILER_DELAY_SECONDS}
          client={client}
          muted={muted}
          class="lmn-details__trailer"
          onPlayingChange={setTrailerPlaying}
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
          <button
            type="button"
            class="lmn-icon-button lmn-icon-button--lg"
            aria-label={muted ? strings.unmute : strings.mute}
            onClick={() => setMuted((m) => !m)}
          >
            <Icon name={muted ? 'volumeOff' : 'volumeOn'} size={18} />
          </button>
        )}
      </div>
      <div class="lmn-details__info">
        {logo ? (
          <img class="lmn-details__logo" src={imageUrl(client, logo, { width: 840 })} alt={item.Name} />
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
              class="lmn-button lmn-button--primary lmn-autofocus"
              onClick={primary.onClick}
            >
              <Icon name="play" />
              {primary.label}
              {primary.progress ? <ProgressBar percent={primary.progress} /> : null}
            </button>
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
            aria-pressed={props.favorite}
            aria-label={strings.favorite}
            onClick={props.toggleFavorite}
          >
            <Icon
              name={props.favorite ? 'heart' : 'heartOutline'}
              class={props.favorite ? 'lmn-heart' : undefined}
            />
            <span class="lmn-button__label">{props.favorite ? strings.favorited : strings.favorite}</span>
          </button>
          <button
            type="button"
            class="lmn-button lmn-button--secondary"
            aria-pressed={props.played}
            aria-label={strings.markWatched}
            onClick={props.toggleWatched}
          >
            <Icon name={props.played ? 'check' : 'eye'} />
            <span class="lmn-button__label">{strings.watched}</span>
          </button>
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
