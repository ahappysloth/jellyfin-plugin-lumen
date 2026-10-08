import type { BaseItem } from '../../api/types';
import type { JellyfinApiClient } from '../../compat/jellyfin';
import { imageUrl, resolveImage } from '../../components/images';
import { ProgressBar } from '../../components/ProgressBar';
import { strings } from '../../strings';

export interface PrimaryAction {
  label: string;
  progress?: number;
  onClick: () => void;
}

interface Props {
  item: BaseItem;
  client: Pick<JellyfinApiClient, 'getUrl'>;
  primary: PrimaryAction | null;
  onTrailer?: () => void;
  meta: string[];
  badges: string[];
  played: boolean;
  favorite: boolean;
  error: string | null;
  toggleWatched: () => void;
  toggleFavorite: () => void;
}

export function DetailsHeader(props: Props) {
  const { item, client, primary } = props;
  const backdrop = resolveImage(item, ['Backdrop']);
  const logo = resolveImage(item, ['Logo']);
  return (
    <header class="lmn-details__header">
      {backdrop && (
        <img class="lmn-details__backdrop" src={imageUrl(client, backdrop, { width: 1920 })} alt="" />
      )}
      <div class="lmn-details__scrim" />
      <div class="lmn-details__info">
        {logo ? (
          <img class="lmn-details__logo" src={imageUrl(client, logo, { width: 480 })} alt={item.Name} />
        ) : (
          <h1 class="lmn-details__title">{item.Name}</h1>
        )}
        <p class="lmn-details__meta">
          {props.meta.map((m) => (
            <span key={m}>{m}</span>
          ))}
          {props.badges.map((b) => (
            <span key={b} class="lmn-badge">
              {b}
            </span>
          ))}
        </p>
        {item.Overview && <p class="lmn-details__overview">{item.Overview}</p>}
        <div class="lmn-details__actions">
          {primary && (
            <button
              type="button"
              class="lmn-button lmn-button--primary lmn-autofocus"
              onClick={primary.onClick}
            >
              {primary.label}
              {primary.progress ? <ProgressBar percent={primary.progress} /> : null}
            </button>
          )}
          {props.onTrailer && (
            <button type="button" class="lmn-button" onClick={props.onTrailer}>
              {strings.trailer}
            </button>
          )}
          <button
            type="button"
            class="lmn-button"
            aria-pressed={props.played}
            aria-label={strings.markWatched}
            onClick={props.toggleWatched}
          >
            {strings.watched}
          </button>
          <button
            type="button"
            class="lmn-button"
            aria-pressed={props.favorite}
            aria-label={strings.addFavorite}
            onClick={props.toggleFavorite}
          >
            {strings.favorite}
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
