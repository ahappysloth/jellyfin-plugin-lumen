import type { BaseItem } from '../api/types';
import type { JellyfinApiClient } from '../compat/jellyfin';
import { CARD_SIZES, type CardVariant, cardImage, imageUrl } from './images';
import { ProgressBar, playedPercent } from './ProgressBar';

interface CardProps {
  item: BaseItem;
  client: Pick<JellyfinApiClient, 'getUrl'>;
  variant: CardVariant;
  caption?: string;
  onSelect: (item: BaseItem) => void;
}

export function Card({ item, client, variant, caption, onSelect }: CardProps) {
  const ref = cardImage(item, variant);
  const size = CARD_SIZES[variant];
  const progress = playedPercent(item);
  return (
    <button
      type="button"
      class={`lmn-card lmn-card--${variant}`}
      data-item-id={item.Id}
      aria-label={caption ? `${item.Name}, ${caption}` : item.Name}
      onClick={() => onSelect(item)}
    >
      <span class="lmn-card__art">
        {ref ? (
          <img
            src={imageUrl(client, ref, size)}
            alt=""
            loading="lazy"
            decoding="async"
            width={size.width}
            height={size.height}
          />
        ) : (
          <span class="lmn-card__placeholder">{item.Name}</span>
        )}
        {progress > 0 && progress < 100 && <ProgressBar percent={progress} />}
      </span>
      {caption && <span class="lmn-card__caption">{caption}</span>}
    </button>
  );
}
