import type { RefObject } from 'preact';
import { useEffect } from 'preact/hooks';
import { getServerName } from '../compat/jellyfin';
import { registerSessionCache } from '../util/sessionCaches';
import type { ViewContext } from './context';

/** How long a new page's h1 is waited for (it may need data) before focus goes to the main element instead. */
const HEADING_WAIT_MS = 2000;

/** Whether this session has shown a page yet: the first one leaves focus where the browser put it. */
let shownBefore = false;
let serverName: Promise<string | null> | null = null;
registerSessionCache(() => {
  shownBefore = false;
  serverName = null;
});

/**
 * Names the tab after the page ("Lumen Alpha – Den": its h1, else `fallback`) and keeps it so while jellyfin-web's
 * hidden page sets its own. On every page but the first, moves focus to the h1 (or `main`) once it renders, as a
 * screen reader user would expect of a new page. Not in the TV layout, where views focus their primary action
 * (useAutoFocus), nor once the page (search focuses its field) or the user has moved focus.
 */
export function usePageChange(
  main: RefObject<HTMLElement | null>,
  key: string,
  fallback: string,
  ctx: ViewContext,
): void {
  useEffect(() => {
    const root = main.current;
    if (!root) return;
    const doc = root.ownerDocument;
    let focusPending = shownBefore && ctx.layout !== 'tv';
    shownBefore = true;
    const before = doc.activeElement;
    let server: string | null = null;
    let ours = '';
    let stock = doc.title;

    const update = (giveUp = false): void => {
      const h1 = root.querySelector('h1');
      const name = h1?.textContent?.trim() || h1?.querySelector('img')?.alt || fallback;
      const title = [name, server].filter(Boolean).join(' – ');
      if (doc.title !== ours) stock = doc.title;
      if (title && doc.title !== title) doc.title = ours = title;
      if (!focusPending || (!h1 && !giveUp)) return;
      focusPending = false;
      const active = doc.activeElement;
      if (active && active !== doc.body && (active !== before || root.contains(active))) return;
      const target = h1 ?? root;
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    };

    let live = true;
    void (serverName ??= getServerName(ctx.client)).then((name) => {
      server = name;
      if (live) update();
    });
    const observer = new MutationObserver(() => update());
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    observer.observe(doc.head, { childList: true, subtree: true, characterData: true });
    const timer = setTimeout(() => update(true), HEADING_WAIT_MS);
    update();
    return () => {
      live = false;
      observer.disconnect();
      clearTimeout(timer);
      if (doc.title === ours) doc.title = stock;
    };
  }, [key]);
}
