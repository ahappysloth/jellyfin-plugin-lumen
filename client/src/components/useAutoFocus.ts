import type { RefObject } from 'preact';
import { useEffect } from 'preact/hooks';
import type { Layout } from '../compat/jellyfin';

const SAFE_ID = /^[\w-]+$/;

/**
 * TV layout only: D-pad users need a focused element, pointer users don't. Focus goes to the previously selected item
 * if present, else the view's primary action (.lmn-autofocus), else its first button. jellyfin-web's own focus
 * manager then handles the arrow keys inside #lmn-root.
 */
export function useAutoFocus(
  ref: RefObject<HTMLElement | null>,
  ready: boolean,
  layout: Layout,
  preferredItemId?: string,
): void {
  useEffect(() => {
    const root = ref.current;
    if (!ready || layout !== 'tv' || !root) return;
    const preferred =
      preferredItemId && SAFE_ID.test(preferredItemId)
        ? root.querySelector<HTMLElement>(`[data-item-id="${preferredItemId}"]`)
        : null;
    (
      preferred ??
      root.querySelector<HTMLElement>('.lmn-autofocus') ??
      root.querySelector<HTMLElement>('button')
    )?.focus();
  }, [ready, layout, preferredItemId]);
}
