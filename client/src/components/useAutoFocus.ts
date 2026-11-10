import type { RefObject } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import type { Layout } from '../compat/jellyfin';

const SAFE_ID = /^[\w-]+$/;
const PRIMARY = '.lmn-autofocus';

/**
 * TV layout only: D-pad users need a focused element, pointer users don't. Focus goes to the previously selected item
 * if present, else the view's primary action (.lmn-autofocus), else its first button. jellyfin-web's own focus
 * manager then handles the arrow keys inside #lmn-root.
 *
 * A primary action can render after the data it needs (a series' Play waits for its episodes). Until the user moves
 * focus themselves, the first button stands in and focus moves on to the primary action once it appears.
 */
export function useAutoFocus(
  ref: RefObject<HTMLElement | null>,
  ready: boolean,
  layout: Layout,
  preferredItemId?: string,
): void {
  // The stand-in focused while the primary action wasn't rendered yet; null once there's nothing left to do.
  const standIn = useRef<HTMLElement | null>(null);

  useEffect(() => {
    standIn.current = null;
    const root = ref.current;
    if (!ready || layout !== 'tv' || !root) return;
    const preferred =
      preferredItemId && SAFE_ID.test(preferredItemId)
        ? root.querySelector<HTMLElement>(`[data-item-id="${preferredItemId}"]`)
        : null;
    const primary = root.querySelector<HTMLElement>(PRIMARY);
    const target = preferred ?? primary ?? root.querySelector<HTMLElement>('button');
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
  }, [ready, layout, preferredItemId]);

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
