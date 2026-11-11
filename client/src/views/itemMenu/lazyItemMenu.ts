import { useEffect, useRef, useState } from 'preact/hooks';
import type { BaseItem } from '../../api/types';
import type { ViewContext } from '../context';
import type { ItemMenuOptions, PreparedMenu } from './itemMenu';

type ItemMenuModule = typeof import('./itemMenu');

let loading: Promise<ItemMenuModule> | null = null;

/**
 * The item menu's code is a file of its own (./itemMenu.ts), loaded when a details page first shows or a card's
 * "More actions…" is picked, so it costs nothing at startup. A failed load is asked for again next time.
 */
export function loadItemMenu(): Promise<ItemMenuModule> {
  loading ??= import('./itemMenu').catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

/**
 * A details page's ⋯ menu for `item`: null until it's known what this user may do with it, and when that's nothing
 * (the page then shows no More button). Prepared again when the page has the item afresh (after an edit).
 */
export function useItemMenu(
  ctx: ViewContext,
  item: BaseItem | null | undefined,
  options: ItemMenuOptions,
): PreparedMenu | null {
  const [menu, setMenu] = useState<PreparedMenu | null>(null);
  // The latest callbacks, so a menu prepared earlier still reloads and navigates for the page as it is now.
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => {
    if (!item) {
      setMenu(null);
      return;
    }
    let live = true;
    loadItemMenu()
      .then((module) =>
        module.prepareItemMenu(ctx, item, {
          complete: options.complete,
          downloadButton: options.downloadButton,
          onChanged: () => latest.current.onChanged?.(),
          onDeleted: () => latest.current.onDeleted?.(),
          fallback: options.fallback && (() => latest.current.fallback?.()),
        }),
      )
      .then(
        (prepared) => {
          if (live) setMenu(prepared.commands.length > 0 ? prepared : null);
        },
        () => {
          if (live) setMenu(null);
        },
      );
    return () => {
      live = false;
    };
  }, [item]);
  return menu;
}

/** Opens a prepared menu under its button, aligned to the button's left edge (the menu flips if it would overflow). */
export function openUnder(menu: PreparedMenu, button: HTMLElement): void {
  const box = button.getBoundingClientRect();
  menu.open({ x: box.left, y: box.bottom, returnFocus: button, anchor: button });
}
