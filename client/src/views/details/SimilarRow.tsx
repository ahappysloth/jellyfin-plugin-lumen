import { useEffect, useState } from 'preact/hooks';
import type { BaseItem } from '../../api/types';
import { detailsHash } from '../../compat/jellyfin';
import { Card } from '../../components/Card';
import { cardMenuHandler } from '../cardMenu';
import { strings } from '../../strings';
import type { ViewContext } from '../context';

/** "You may like": a wrapping grid of landscape cards (two rows on a desktop screen). */
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
    <section class="lmn-row lmn-similar" aria-label={strings.moreLikeThis}>
      <h2 class="lmn-row__title">{strings.moreLikeThis}</h2>
      <div class="lmn-grid focuscontainer-x">
        {items.map((item) => (
          <Card
            key={item.Id}
            item={item}
            client={ctx.client}
            variant="landscape"
            onSelect={(selected) => ctx.navigate(detailsHash(selected.Id, selected.ServerId))}
            onMenu={cardMenuHandler(ctx)}
          />
        ))}
      </div>
    </section>
  );
}
