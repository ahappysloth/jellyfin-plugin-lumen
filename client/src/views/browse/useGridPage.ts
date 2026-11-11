import type { BaseItem } from '../../api/types';
import { type CardMenuHandler, cardMenuHandler, infoHash } from '../cardMenu';
import type { ViewContext } from '../context';
import { saveSnapshot, type SnapshotOptions } from './browseStore';
import { type BrowseOptions, type BrowseState, type Fetch, useBrowseItems } from './useBrowseItems';

export interface GridPage {
  state: BrowseState;
  /** Opens a card's page, remembering the grid first. */
  select: (item: BaseItem) => void;
  /** The card menu; Play, More info and Open remember the grid too. */
  onMenu: CardMenuHandler;
}

/**
 * A paged grid that leaves for other pages: loads the query, and before every navigation away saves what's loaded
 * and the scroll position, so Back lands on the same card (browseStore decides when a snapshot is used).
 */
export function useGridPage(
  ctx: ViewContext,
  queryKey: string,
  fetchPage: Fetch,
  options: SnapshotOptions & BrowseOptions = {},
): GridPage {
  const state = useBrowseItems(queryKey, fetchPage, { uncounted: options.uncounted });
  const save = (item: BaseItem): void => {
    if (state.total === null) return;
    saveSnapshot(
      queryKey,
      {
        items: state.items,
        total: state.total,
        scrollY: window.scrollY,
        offset: state.offset,
        more: state.hasMore,
        selectedId: item.Id,
      },
      { dependsOn: options.dependsOn },
    );
  };
  return {
    state,
    select: (item) => {
      save(item);
      ctx.navigate(infoHash(item));
    },
    onMenu: cardMenuHandler(ctx, { beforeNavigate: save }),
  };
}
