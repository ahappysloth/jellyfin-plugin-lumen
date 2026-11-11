/**
 * What a tap on the picture does, and when a press outside a panel closes it. Kept apart from the components so the
 * rules can be tested on their own.
 *
 * A mouse click on the picture plays or pauses, as on any desktop player. A finger (or a pen) follows the phone
 * players instead: a tap shows the controls, or hides them when they're up; play and pause are the Play button's. Two
 * quick taps on the left or right of the picture skip back or forward, without holding up a single tap: the first
 * tap acts at once, and the second turns into the skip.
 */

/** A finger or a pen, as opposed to a mouse (or a TV's pointer remote, which browsers report as a mouse). */
export const isTouchLike = (pointerType: string | undefined): boolean =>
  pointerType === 'touch' || pointerType === 'pen';

/** The longest gap between the two taps of a double tap. */
export const DOUBLE_TAP_MS = 300;
/** How far a finger may move between pressing and lifting for it still to count as a tap rather than a drag. */
export const TAP_SLOP_PX = 10;

/** Which side of the picture a tap at `x` is on: the outer thirds skip, the middle doesn't. */
export function tapSide(x: number, width: number): 'back' | 'forward' | null {
  if (!(width > 0)) return null;
  if (x < width / 3) return 'back';
  if (x > (width * 2) / 3) return 'forward';
  return null;
}

/** The last touch tap on the picture, for spotting a double tap. */
export interface LastTap {
  at: number;
  side: 'back' | 'forward' | null;
}

export type TapAction = 'closePanel' | 'togglePlay' | 'show' | 'hide' | 'back' | 'forward';

/**
 * What a tap or click on the picture does. `shown` and `panelOpen` are as they were when it was pressed: by the time
 * the click arrives, the press itself has already brought the controls up and closed an open panel.
 */
export function surfaceTap(
  press: { pointerType: string | undefined; shown: boolean; panelOpen: boolean },
  tap: { at: number; x: number; width: number },
  last: LastTap | null,
): { action: TapAction; last: LastTap | null } {
  // Closing a panel is all a press outside it does.
  if (press.panelOpen) return { action: 'closePanel', last: null };
  if (!isTouchLike(press.pointerType)) return { action: 'togglePlay', last: null };
  const side = tapSide(tap.x, tap.width);
  // A second quick tap on the same side skips (and so does a third, on from the second).
  if (side && last && last.side === side && tap.at - last.at <= DOUBLE_TAP_MS)
    return { action: side, last: { at: tap.at, side } };
  return { action: press.shown ? 'hide' : 'show', last: { at: tap.at, side } };
}

/**
 * Closes a panel on a press outside it (`isInside` says what counts as inside: the panel and its pill). A mouse closes
 * it as the button goes down, as menus do on a desktop. A finger closes it only when it lifts without having moved:
 * one that touches down outside and then scrolls or drags is not a tap, and the browser cancels it.
 */
export function outsidePress(isInside: (target: EventTarget | null) => boolean, onClose: () => void) {
  let pending: { id: number; x: number; y: number } | null = null;
  return {
    down(e: Pick<PointerEvent, 'pointerId' | 'pointerType' | 'clientX' | 'clientY' | 'target'>): void {
      pending = null;
      if (isInside(e.target)) return;
      if (!isTouchLike(e.pointerType)) return onClose();
      pending = { id: e.pointerId, x: e.clientX, y: e.clientY };
    },
    up(e: Pick<PointerEvent, 'pointerId' | 'clientX' | 'clientY'>): void {
      const down = pending;
      pending = null;
      if (!down || down.id !== e.pointerId) return;
      if (Math.abs(e.clientX - down.x) <= TAP_SLOP_PX && Math.abs(e.clientY - down.y) <= TAP_SLOP_PX)
        onClose();
    },
    cancel(): void {
      pending = null;
    },
  };
}
