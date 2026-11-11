import type { RefObject } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import type { Layout } from '../compat/jellyfin';

const SAFE_ID = /^[\w-]+$/;
const PRIMARY = '.lmn-autofocus';
/** Open menus, lists and dialogs: focus in one of them is left there. */
const POPUP = '[role="menu"], [role="listbox"], [role="dialog"], [role="alertdialog"]';

/**
 * TV layout: D-pad users need a focused element, pointer users don't. Focus goes to the previously selected item
 * if present, else the view's primary action (.lmn-autofocus), else its first button or card. jellyfin-web's own focus
 * manager then handles the arrow keys inside #lmn-root.
 *
 * Other layouts: only a restored selection (Back to a page) is focused, without scrolling (the view has scrolled back
 * to it), so the next Tab carries on from there; a new page focuses its heading instead (usePageChange).
 *
 * A primary action can render after the data it needs (a series' Play waits for its episodes). Until the user moves
 * focus themselves, the first button stands in and focus moves on to the primary action once it appears.
 */
export function useAutoFocus(
  ref: RefObject<HTMLElement | null>,
  ready: boolean,
  layout: Layout,
  preferredItemId?: string,
  /** The row it was selected in (home shows a title in several rows). */
  preferredRowId?: string,
): void {
  // The stand-in focused while the primary action wasn't rendered yet; null once there's nothing left to do.
  const standIn = useRef<HTMLElement | null>(null);

  useEffect(() => {
    standIn.current = null;
    const root = ref.current;
    if (!ready || !root) return;
    const card =
      preferredItemId && SAFE_ID.test(preferredItemId) ? `[data-item-id="${preferredItemId}"]` : null;
    // Row ids aren't selector-safe ("<guid>:0"): compared, not put in a selector.
    const row = [...root.querySelectorAll('[data-row-id]')].find(
      (r) => r.getAttribute('data-row-id') === preferredRowId,
    );
    const preferred = card
      ? ((row ?? root).querySelector<HTMLElement>(card) ?? root.querySelector<HTMLElement>(card))
      : null;
    if (layout !== 'tv') return preferred?.focus({ preventScroll: true });
    // The user is in a menu or dialog (the account menu, opened from the nav while home was loading): taking focus
    // would close it under them.
    if (document.activeElement?.closest(POPUP)) return;
    const primary = root.querySelector<HTMLElement>(PRIMARY);
    const target = preferred ?? primary ?? root.querySelector<HTMLElement>('button, .lmn-card');
    target?.focus();
    if (preferred || primary || !target) return;

    standIn.current = target;
    // Any later focus change is the user's (or another view's) choice, and a pointer (a Magic Remote's) or wheel means
    // the user is already on their way: the primary action no longer takes over.
    const events = ['focusin', 'pointerdown', 'wheel'] as const;
    const settle = (): void => {
      standIn.current = null;
      events.forEach((type) => document.removeEventListener(type, settle, true));
    };
    events.forEach((type) => document.addEventListener(type, settle, { capture: true, passive: true }));
    return settle;
  }, [ready, layout, preferredItemId, preferredRowId]);

  useEffect(() => {
    const waiting = standIn.current;
    if (!waiting) return;
    const active = document.activeElement;
    // Focus still on the stand-in, or dropped to the body because the stand-in went away.
    if (active !== waiting && active !== document.body && active !== null) return;
    const primary = ref.current?.querySelector<HTMLElement>(PRIMARY);
    if (!primary) return;
    standIn.current = null;
    // The user may have scrolled on while it loaded; the page stays where they are.
    primary.focus({ preventScroll: true });
  });
}
