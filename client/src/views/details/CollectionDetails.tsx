import { useRef } from 'preact/hooks';
import type { BaseItem } from '../../api/types';
import { useAutoFocus } from '../../components/useAutoFocus';
import { strings } from '../../strings';
import { BrowseGrid } from '../browse/BrowseGrid';
import { useGridPage } from '../browse/useGridPage';
import { useItemMenu } from '../itemMenu/lazyItemMenu';
import type { DetailsProps } from './DetailsView';
import { DetailsHeader } from './DetailsHeader';
import { goBack, useItemActions } from './useItemActions';

/** A collection (box set): the details header (Play plays it in order) over its titles, oldest first. */
export function CollectionDetails({ item, ctx, reload }: DetailsProps & { item: BaseItem }) {
  const actions = useItemActions(item, ctx);
  const more = useItemMenu(ctx, item, {
    complete: true,
    onChanged: reload,
    onDeleted: () => goBack(ctx),
    fallback: ctx.onFallback,
  });
  const rootRef = useRef<HTMLElement>(null);

  const queryKey = `${ctx.userId}|collection|${item.Id}`;
  const { state, select, onMenu } = useGridPage(ctx, queryKey, (page) =>
    ctx.api.getBrowseItems({
      parentId: item.Id,
      includeItemTypes: 'Movie,Series',
      sortBy: 'ProductionYear,PremiereDate,SortName',
      sortOrder: 'Ascending',
      ...page,
    }),
  );
  useAutoFocus(rootRef, true, ctx.layout, state.restoredSelectedId ?? undefined);

  return (
    <article ref={rootRef} class="lmn-details lmn-details--collection">
      <DetailsHeader
        item={item}
        client={ctx.client}
        config={ctx.config}
        primary={
          state.total === 0
            ? null
            : { label: strings.play, onClick: () => actions.play(item.Id), busy: actions.starting }
        }
        trailerId={null}
        backdropFallback={state.items[0]}
        onBack={() => goBack(ctx)}
        badges={state.total ? [strings.titleCount(state.total)] : []}
        more={more}
        {...actions}
      />
      <section class="lmn-details__section" aria-label={strings.inCollection}>
        <h2 class="lmn-row__title">{strings.inCollection}</h2>
        <BrowseGrid
          state={state}
          client={ctx.client}
          variant="poster"
          label={strings.inCollection}
          onSelect={select}
          onMenu={onMenu}
          empty={<p>{strings.emptyCollection}</p>}
        />
      </section>
    </article>
  );
}
