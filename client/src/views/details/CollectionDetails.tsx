import { useRef } from 'preact/hooks';
import type { BaseItem } from '../../api/types';
import { useAutoFocus } from '../../components/useAutoFocus';
import { strings } from '../../strings';
import { BrowseGrid } from '../browse/BrowseGrid';
import { saveSnapshot } from '../browse/browseStore';
import { useBrowseItems } from '../browse/useBrowseItems';
import { cardMenuHandler, infoHash } from '../cardMenu';
import type { ViewContext } from '../context';
import { DetailsHeader } from './DetailsHeader';
import { goBack, useItemActions } from './useItemActions';

/** A collection (box set): the details header (Play plays it in order) over its titles, oldest first. */
export function CollectionDetails({ item, ctx }: { item: BaseItem; ctx: ViewContext }) {
  const actions = useItemActions(item, ctx);
  const rootRef = useRef<HTMLElement>(null);
  useAutoFocus(rootRef, true, ctx.layout);

  const queryKey = `${ctx.userId}|collection|${item.Id}`;
  const state = useBrowseItems(queryKey, (page) =>
    ctx.api.getBrowseItems({
      parentId: item.Id,
      includeItemTypes: 'Movie,Series',
      sortBy: 'ProductionYear,PremiereDate,SortName',
      sortOrder: 'Ascending',
      ...page,
    }),
  );
  const save = (): void => {
    if (state.total !== null)
      saveSnapshot(queryKey, {
        items: state.items,
        total: state.total,
        scrollY: window.scrollY,
        offset: state.offset,
      });
  };

  return (
    <article ref={rootRef} class="lmn-details lmn-details--collection">
      <DetailsHeader
        item={item}
        client={ctx.client}
        config={ctx.config}
        primary={state.total === 0 ? null : { label: strings.play, onClick: () => actions.play(item.Id) }}
        trailerId={null}
        backdropFallback={state.items[0]}
        onBack={() => goBack(ctx)}
        badges={state.total ? [strings.titleCount(state.total)] : []}
        {...actions}
      />
      <section class="lmn-details__section" aria-label={strings.inCollection}>
        <h2 class="lmn-row__title">{strings.inCollection}</h2>
        <BrowseGrid
          state={state}
          client={ctx.client}
          variant="poster"
          label={strings.inCollection}
          onSelect={(child) => {
            save();
            ctx.navigate(infoHash(child));
          }}
          onMenu={cardMenuHandler(ctx, { beforeNavigate: save })}
          empty={<p>{strings.emptyCollection}</p>}
        />
      </section>
    </article>
  );
}
