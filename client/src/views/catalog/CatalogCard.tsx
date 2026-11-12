import { useEffect } from 'preact/hooks';
import type { CatalogItem } from '../../api/types';
import type { JellyfinApiClient } from '../../compat/jellyfin';
import type { CardVariant } from '../../components/images';
import { ProgressBar } from '../../components/ProgressBar';
import { strings } from '../../strings';
import { catalogImageUrl, stateLabel, useCatalogState } from './catalog';
import { prefetchTitle } from './lazyTitle';
import { isMoving, progressDetail, progressLabel, useRequestProgress } from './requestProgress';

interface Props {
  item: CatalogItem;
  client: Pick<JellyfinApiClient, 'getUrl'>;
  /** The user's catalog image token (useCatalogImageToken); the art waits for it. */
  imageToken: string | null | undefined;
  variant: CardVariant;
  onSelect: (item: CatalogItem) => void;
  /** A Top 10 card's place, read before its title (the big numeral beside it is decoration). */
  rank?: number;
  /** Leaves out the outlined "Request" tab (a Top 10 card has a Request button under it instead). */
  hideRequestTab?: boolean;
}

/**
 * A title from Seerr's catalog in Lumen's card style, with a tab for its request state: an outlined "Request", or a
 * filled "Requested" / "Downloading" / "Partial" (partly available). A title the user requested themselves says how
 * their request is going instead ("Queued", "Downloading", "Ready", "Declined"…), with a progress bar along the art and
 * the percentage and time left in place of the meta line while it downloads (requestProgress.ts).
 */
export function CatalogCard({ item, client, imageToken, variant, onSelect, rank, hideRequestTab }: Props) {
  const state = useCatalogState(item);
  const progress = useRequestProgress(item.Key);
  // Most open the title page, whose code loads on its own (lazyTitle.tsx): have it ready.
  useEffect(prefetchTitle, []);
  // A Top 10 card's Request is the button under it, not the card (which opens the title): its name doesn't say Request.
  const label =
    item.JellyfinItemId || (hideRequestTab && state === 'None' && !progress)
      ? null
      : progress
        ? progressLabel(progress.Status)
        : stateLabel(state);
  // The tab has a phone poster's width at most: one short line ("Partly available" wrapped to two). The card's name
  // keeps the full label.
  const tab = !progress && state === 'PartlyAvailable' ? strings.partlyAvailableShort : label;
  const detail = progress && !item.JellyfinItemId ? progressDetail(progress) : '';
  const bar = progress && isMoving(progress.Status) && progress.Percent != null ? progress.Percent : null;
  const problem = progress?.Status === 'Declined' || progress?.Status === 'Failed';
  const file = variant === 'poster' ? (item.Poster ?? item.Backdrop) : (item.Backdrop ?? item.Poster);
  const meta = [item.Year?.toString(), item.MediaType === 'movie' ? strings.movie : strings.show].filter(
    (p): p is string => !!p,
  );
  return (
    <button
      type="button"
      class={`lmn-card lmn-card--${variant} lmn-card--catalog`}
      data-catalog-key={item.Key}
      aria-label={
        (rank === undefined ? '' : strings.rankOf(rank)) +
        (label ? `${item.Title}, ${label}` : item.Title) +
        (detail ? `, ${detail}` : '')
      }
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
          <span
            class={`lmn-card__state${problem ? ' is-problem' : state === 'None' && !progress ? '' : ' is-filled'}`}
            aria-hidden="true"
          >
            {tab}
          </span>
        )}
        {bar !== null && <ProgressBar percent={bar} />}
      </span>
      <span class="lmn-card__title">{item.Title}</span>
      {detail ? (
        <span class="lmn-card__meta lmn-card__meta--progress">{detail}</span>
      ) : (
        <span class="lmn-card__meta">
          {item.Rating ? <span>★ {item.Rating.toFixed(1)}</span> : null}
          {meta.map((part) => (
            <span key={part}>{part}</span>
          ))}
        </span>
      )}
    </button>
  );
}
