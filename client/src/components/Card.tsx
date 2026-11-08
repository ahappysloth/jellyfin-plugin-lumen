import type { BadgeKey, BaseItem } from '../api/types';
import type { JellyfinApiClient } from '../compat/jellyfin';
import { strings } from '../strings';
import { Icon } from './icons';
import { CARD_SIZES, type CardVariant, cardArt, imageUrl } from './images';
import { ProgressBar, playedPercent } from './ProgressBar';

interface CardProps {
  item: BaseItem;
  client: Pick<JellyfinApiClient, 'getUrl'>;
  variant: CardVariant;
  /** Replaces the default meta line (e.g. "S1:E2 · Pilot" for episodes) and is read out with the title. */
  caption?: string;
  badge?: BadgeKey;
  onSelect: (item: BaseItem) => void;
}

const TYPE_LABELS: Record<string, string> = {
  Movie: strings.movie,
  Series: strings.show,
  Episode: strings.episode,
};

/** "★ 7.4 · 2021 · Movie": the dim line under a card title. */
export function cardMeta(item: BaseItem): string[] {
  return [
    item.CommunityRating ? item.CommunityRating.toFixed(1) : undefined,
    item.ProductionYear?.toString(),
    TYPE_LABELS[item.Type],
  ].filter((part): part is string => !!part);
}

export function Card({ item, client, variant, caption, badge, onSelect }: CardProps) {
  const art = cardArt(item, variant);
  const size = CARD_SIZES[variant];
  const progress = playedPercent(item);
  const title = item.Type === 'Episode' && item.SeriesName ? item.SeriesName : item.Name;
  const meta = cardMeta(item);
  return (
    <button
      type="button"
      class={`lmn-card lmn-card--${variant}`}
      data-item-id={item.Id}
      aria-label={caption ? `${item.Name}, ${caption}` : item.Name}
      onClick={() => onSelect(item)}
    >
      <span class="lmn-card__art">
        {art.image ? (
          <img
            src={imageUrl(client, art.image, size)}
            alt=""
            loading="lazy"
            decoding="async"
            width={size.width}
            height={size.height}
          />
        ) : (
          <span class="lmn-card__placeholder">{title}</span>
        )}
        {art.logo && (
          <img
            class="lmn-card__logo"
            src={imageUrl(client, art.logo, { width: Math.round(size.width * 0.6) })}
            alt=""
            loading="lazy"
            decoding="async"
          />
        )}
        {badge && <span class="lmn-card__badge">{strings.badges[badge]}</span>}
        {progress > 0 && progress < 100 && <ProgressBar percent={progress} />}
      </span>
      <span class="lmn-card__title">{title}</span>
      <span class="lmn-card__meta">
        {caption ? (
          <span>{caption}</span>
        ) : (
          meta.map((part, i) => (
            <span key={part}>
              {i === 0 && item.CommunityRating ? <Icon name="star" size={11} class="lmn-star" /> : null}
              {part}
            </span>
          ))
        )}
      </span>
    </button>
  );
}
