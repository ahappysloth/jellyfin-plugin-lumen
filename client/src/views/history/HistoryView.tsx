import { useLayoutEffect, useRef } from 'preact/hooks';
import type { BaseItem, ItemsResult } from '../../api/types';
import { Icon } from '../../components/icons';
import { useAutoFocus } from '../../components/useAutoFocus';
import { strings } from '../../strings';
import { formatDate } from '../../util/locale';
import { BrowseGrid, type GridCell } from '../browse/BrowseGrid';
import { captionFor } from '../home/Row';
import { dayKey } from '../browse/SuggestionsTabs';
import { PageHeader } from '../browse/Toolbar';
import { useGridPage } from '../browse/useGridPage';
import type { ViewContext } from '../context';
import { markedUnwatched, useUserDataChanges } from '../userDataStore';
import { secondaryStrings } from '../secondary/secondaryStrings';

const cardsIn = (root: HTMLElement | null): HTMLElement[] =>
  Array.from(root?.querySelectorAll<HTMLElement>('.lmn-card') ?? []);

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
  if (key === dayKey(now)) return { key, label: secondaryStrings.today };
  if (key === dayKey(yesterday)) return { key, label: secondaryStrings.yesterday };
  const year = date.getFullYear() === now.getFullYear() ? undefined : 'numeric';
  return { key, label: formatDate(date, { weekday: 'short', month: 'short', day: 'numeric', year }) };
}

/**
 * A day's titles as cards: a run of episodes of one show (marking a show watched gives every episode the same date)
 * is one card for the show, "Lumen Show · 6 episodes", with the latest episode's still. It has no card menu: Mark as
 * unwatched there would undo the whole show, including other days. Single episodes and movies are cards as usual.
 */
export function historyCells(items: BaseItem[]): GridCell[] {
  const cells: GridCell[] = [];
  for (let i = 0; i < items.length;) {
    const item = items[i]!;
    let end = i + 1;
    if (item.Type === 'Episode' && item.SeriesId)
      while (items[end]?.Type === 'Episode' && items[end]!.SeriesId === item.SeriesId) end++;
    const count = end - i;
    if (count === 1) cells.push({ key: item.Id, item, caption: captionFor(item), menu: true });
    else
      cells.push({
        key: `${item.SeriesId}/${item.Id}`,
        item: {
          Id: item.SeriesId!,
          Name: item.SeriesName ?? item.Name,
          Type: 'Series',
          ServerId: item.ServerId,
        },
        caption: secondaryStrings.episodeCount(count),
        artItem: item,
      });
    i = end;
  }
  return cells;
}

/**
 * What the user watched lately, newest first, by day: movies and episodes (shown under their show's name) they played
 * to the end or part of the way. The card menu's Mark as unwatched (once confirmed) takes a title off the list at once:
 * Jellyfin forgets when it was played.
 */
export function HistoryView({ ctx }: { ctx: ViewContext }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const { state, select, onMenu } = useGridPage(
    ctx,
    `${ctx.userId}|history`,
    (page) => ctx.api.getHistory(page).then(playedOnly),
    // Marking a title unwatched clears its last-played date, so a saved page may list it wrongly. Never counted: the
    // page shows no total, and counting would cover every title in the library, played or not.
    { dependsOn: ['Played'], uncounted: true },
  );
  // TV: once the first page is in, focus the first card (or the card the user came back from).
  useAutoFocus(rootRef, state.total !== null, ctx.layout, state.restoredSelectedId ?? undefined);
  useUserDataChanges();
  const items = state.items.filter((item) => !markedUnwatched(item));
  const shown =
    items.length === state.items.length
      ? state
      : { ...state, items, total: items.length === 0 && !state.hasMore ? 0 : state.total };
  // Where focus was among the cards, for when its card is taken off.
  const focusedCard = useRef(-1);
  const onFocusIn = (e: FocusEvent): void => {
    const card = (e.target as Element).closest('.lmn-card');
    if (card) focusedCard.current = cardsIn(rootRef.current).indexOf(card as HTMLElement);
  };
  // The focused card was the one taken off (focus fell to <body>): the card now in its place takes over, or the one
  // before if it was the last, so the next Tab or D-pad press carries on from there rather than from the top. Nothing
  // left: the TV's highlighted nav button (the account menu, where History is) or the page's heading.
  const hidden = state.items.length - items.length;
  const hiddenBefore = useRef(hidden);
  useLayoutEffect(() => {
    const removed = hidden > hiddenBefore.current;
    hiddenBefore.current = hidden;
    const active = document.activeElement;
    if (
      !removed ||
      focusedCard.current < 0 ||
      (active && active !== document.body && document.contains(active))
    )
      return;
    const cards = cardsIn(rootRef.current);
    const tv = ctx.layout === 'tv';
    const card = cards[Math.min(focusedCard.current, cards.length - 1)];
    if (card) return card.focus({ preventScroll: !tv });
    const heading = rootRef.current?.querySelector<HTMLElement>('h1');
    const target = (tv && document.querySelector<HTMLElement>('.lmn-nav .is-active')) || heading;
    if (target === heading) heading?.setAttribute('tabindex', '-1');
    target?.focus({ preventScroll: true });
  }, [hidden]);
  return (
    <div ref={rootRef} class="lmn-browse lmn-history" onFocusIn={onFocusIn}>
      <PageHeader title={strings.history} />
      <BrowseGrid
        state={shown}
        client={ctx.client}
        variant="landscape"
        label={strings.history}
        onSelect={select}
        onMenu={onMenu}
        groupBy={(item) => playedDay(item)}
        toCells={historyCells}
        empty={
          <>
            <span class="lmn-browse__empty-icon">
              <Icon name="history" size={28} />
            </span>
            <p class="lmn-browse__empty-title">{secondaryStrings.noHistory}</p>
            <p>{secondaryStrings.noHistoryHint}</p>
          </>
        }
      />
    </div>
  );
}
