import { useEffect, useState } from 'preact/hooks';
import type { BaseItem } from '../../api/types';
import { detailsHash } from '../../compat/jellyfin';
import { strings } from '../../strings';
import type { ViewContext } from '../context';
import { Row } from '../home/Row';

export function SimilarRow({ itemId, ctx }: { itemId: string; ctx: ViewContext }) {
  const [items, setItems] = useState<BaseItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    ctx.api
      .getSimilar(itemId)
      .then((result) => {
        if (!cancelled) setItems(result.Items);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  if (items.length === 0) return null;
  return (
    <Row
      row={{ Id: `similar-${itemId}`, Type: 'Similar', Title: strings.moreLikeThis, Items: items }}
      client={ctx.client}
      onSelect={(item) => ctx.navigate(detailsHash(item.Id, item.ServerId))}
    />
  );
}
