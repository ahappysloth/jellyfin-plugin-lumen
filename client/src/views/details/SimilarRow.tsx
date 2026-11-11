import { useEffect, useState } from 'preact/hooks';
import type { BaseItem } from '../../api/types';
import { detailsHash } from '../../compat/jellyfin';
import { Card } from '../../components/Card';
import { useCardMenu } from '../cardMenu';
import { strings } from '../../strings';
import type { ViewContext } from '../context';

/** "You may like": a wrapping grid of landscape cards (two rows on a desktop screen). */
export function SimilarRow({ itemId, ctx }: { itemId: string; ctx: ViewContext }) {
  const [items, setItems] = useState<BaseItem[]>([]);
  const { onMenu, shown } = useCardMenu(ctx);

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

  const cards = shown(items);
  if (cards.length === 0) return null;
  return (
    <section class="lmn-row lmn-similar" aria-label={strings.moreLikeThis}>
      <h2 class="lmn-row__title">{strings.moreLikeThis}</h2>
      <div class="lmn-grid focuscontainer-x">
        {cards.map((item) => (
          <Card
            key={item.Id}
            item={item}
            client={ctx.client}
            variant="landscape"
            onSelect={(selected) => ctx.navigate(detailsHash(selected.Id, selected.ServerId))}
            onMenu={onMenu}
          />
        ))}
      </div>
    </section>
  );
}
