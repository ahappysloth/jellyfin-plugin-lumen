import { useRef } from 'preact/hooks';
import type { BaseItem, ItemsResult } from '../../api/types';
import { Icon } from '../../components/icons';
import { useAutoFocus } from '../../components/useAutoFocus';
import { strings } from '../../strings';
import { formatDate } from '../../util/locale';
import { BrowseGrid } from '../browse/BrowseGrid';
import { dayKey } from '../browse/SuggestionsTabs';
import { PageHeader } from '../browse/Toolbar';
import { useGridPage } from '../browse/useGridPage';
import type { ViewContext } from '../context';

/** The titles in a page up to the first one never played: sorted by last played, those come last. */
export function playedOnly(page: ItemsResult): ItemsResult {
  const end = page.Items.findIndex((item) => !item.UserData?.LastPlayedDate);
  return end < 0 ? page : { ...page, Items: page.Items.slice(0, end) };
}

/** The local day an item was last played: "Today", "Yesterday", "Fri, Nov 13", or "Fri, Nov 13, 2025" in other years. */
export function playedDay(item: BaseItem, now: Date = new Date()): { key: string; label: string } {
  const date = new Date(item.UserData?.LastPlayedDate ?? 0);
  const key = dayKey(date);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (key === dayKey(now)) return { key, label: strings.today };
  if (key === dayKey(yesterday)) return { key, label: strings.yesterday };
  const year = date.getFullYear() === now.getFullYear() ? undefined : 'numeric';
  return { key, label: formatDate(date, { weekday: 'short', month: 'short', day: 'numeric', year }) };
}

/**
 * What the user watched lately, newest first, by day: movies and episodes (shown under their show's name) they played
 * to the end or part of the way. The card menu's Mark as unwatched takes a title off the list (Jellyfin forgets when
 * it was played).
 */
export function HistoryView({ ctx }: { ctx: ViewContext }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const { state, select, onMenu } = useGridPage(
    ctx,
    `${ctx.userId}|history`,
    (page) => ctx.api.getHistory(page).then(playedOnly),
    // Marking a title unwatched clears its last-played date, so a saved page may list it wrongly.
    { dependsOn: ['Played'] },
  );
  // TV: once the first page is in, focus the first card (or the card the user came back from).
  useAutoFocus(rootRef, state.total !== null, ctx.layout, state.restoredSelectedId ?? undefined);
  return (
    <div ref={rootRef} class="lmn-browse lmn-history">
      <PageHeader title={strings.history} />
      <BrowseGrid
        state={state}
        client={ctx.client}
        variant="landscape"
        label={strings.history}
        onSelect={select}
        onMenu={onMenu}
        groupBy={(item) => playedDay(item)}
        empty={
          <>
            <span class="lmn-browse__empty-icon">
              <Icon name="history" size={28} />
            </span>
            <p class="lmn-browse__empty-title">{strings.noHistory}</p>
            <p>{strings.noHistoryHint}</p>
          </>
        }
      />
    </div>
  );
}
