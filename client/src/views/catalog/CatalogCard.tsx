import type { CatalogItem } from '../../api/types';
import type { JellyfinApiClient } from '../../compat/jellyfin';
import type { CardVariant } from '../../components/images';
import { strings } from '../../strings';
import { catalogImageUrl, stateLabel, useCatalogState } from './catalog';

interface Props {
  item: CatalogItem;
  client: Pick<JellyfinApiClient, 'getUrl'>;
  /** The user's catalog image token (useCatalogImageToken); the art waits for it. */
  imageToken: string | null | undefined;
  variant: CardVariant;
  onSelect: (item: CatalogItem) => void;
}

/**
 * A title from Seerr's catalog in Lumen's card style, with a tab for its request state: an outlined "Request", or a
 * filled "Requested" / "Downloading" / "Partly available".
 */
export function CatalogCard({ item, client, imageToken, variant, onSelect }: Props) {
  const state = useCatalogState(item);
  const label = item.JellyfinItemId ? null : stateLabel(state);
  const file = variant === 'poster' ? (item.Poster ?? item.Backdrop) : (item.Backdrop ?? item.Poster);
  const meta = [item.Year?.toString(), item.MediaType === 'movie' ? strings.movie : strings.show].filter(
    (p): p is string => !!p,
  );
  return (
    <button
      type="button"
      class={`lmn-card lmn-card--${variant} lmn-card--catalog`}
      data-catalog-key={item.Key}
      aria-label={label ? `${item.Title}, ${label}` : item.Title}
      onClick={() => onSelect(item)}
    >
      <span class="lmn-card__art">
        {file && imageToken ? (
          <img
            src={catalogImageUrl(client, file, variant === 'poster' ? 'w300' : 'w780', imageToken)}
            alt=""
            loading="lazy"
            decoding="async"
          />
        ) : (
          <span class="lmn-card__placeholder">{item.Title}</span>
        )}
        {label && (
          <span class={`lmn-card__state${state === 'None' ? '' : ' is-filled'}`} aria-hidden="true">
            {label}
          </span>
        )}
      </span>
      <span class="lmn-card__title">{item.Title}</span>
      <span class="lmn-card__meta">
        {item.Rating ? <span>★ {item.Rating.toFixed(1)}</span> : null}
        {meta.map((part) => (
          <span key={part}>{part}</span>
        ))}
      </span>
    </button>
  );
}
