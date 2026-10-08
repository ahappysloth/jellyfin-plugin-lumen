import type { BaseItem, HomeRow } from '../../api/types';
import type { JellyfinApiClient } from '../../compat/jellyfin';
import { Card } from '../../components/Card';
import type { CardVariant } from '../../components/images';

const THUMB_ROWS = new Set(['ContinueWatching', 'NextUp']);

export function captionFor(item: BaseItem): string {
  return item.Type === 'Episode'
    ? `${item.SeriesName ?? ''} · S${item.ParentIndexNumber ?? 0}:E${item.IndexNumber ?? 0}`
    : item.Name;
}

interface Props {
  row: HomeRow;
  client: Pick<JellyfinApiClient, 'getUrl'>;
  onSelect: (item: BaseItem, row: HomeRow) => void;
}

export function Row({ row, client, onSelect }: Props) {
  const variant: CardVariant = THUMB_ROWS.has(row.Type) ? 'thumb' : 'poster';
  return (
    <section class="lmn-row" aria-label={row.Title}>
      <h2 class="lmn-row__title">{row.Title}</h2>
      <div class="lmn-row__scroller focuscontainer-x">
        {row.Items.map((item) => (
          <Card
            key={item.Id}
            item={item}
            client={client}
            variant={variant}
            caption={variant === 'thumb' ? captionFor(item) : undefined}
            onSelect={(selected) => onSelect(selected, row)}
          />
        ))}
      </div>
    </section>
  );
}
