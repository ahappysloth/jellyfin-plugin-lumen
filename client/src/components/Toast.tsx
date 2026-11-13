import { useEffect, useRef, useState } from 'preact/hooks';
import { strings } from '../strings';
import { Icon } from './icons';
import { OPEN_POPUP } from './useAutoFocus';

/** How long a toast stays up before it dismisses itself. */
export const TOAST_MS = 6000;
/** One with a button stays longer: time to read it and reach the button (a TV remote is slower than a mouse). */
export const ACTION_TOAST_MS = 12000;

/** A toast's button ("Watch"), which also dismisses it. */
export interface ToastAction {
  label: string;
  onSelect: () => void;
}

interface Toast {
  id: number;
  message: string;
  action?: ToastAction;
}

/** A dialog, menu or list that's open: Lumen's (OPEN_POPUP) or jellyfin-web's. */
const MODAL = `${OPEN_POPUP}, .dialogContainer`;

let listener: ((message: string, action?: ToastAction) => void) | null = null;
let nextId = 0;
const hostWaiters = new Set<() => void>();

/**
 * Whether a toast shown now would be seen. Not while jellyfin-web has the page (the Dashboard, a music library): Lumen's
 * page is unmounted there, and its host with it.
 */
export const canShowToast = (): boolean => listener !== null;

/** Calls `fn` each time the host mounts (a Lumen page again), for a toast that waited for one. */
export function onToastHost(fn: () => void): void {
  hostWaiters.add(fn);
}

/**
 * Shows a short message (a failed action, a request that's ready) at the bottom of the screen, with an optional
 * button. One at a time: a new one replaces the old. The host must be mounted (see App).
 */
export function showToast(message: string, action?: ToastAction): void {
  listener?.(message, action);
}

/**
 * Renders the current toast. The live region is always present, so screen readers announce what lands in it.
 *
 * `tv`: a toast with a button takes the remote's focus to it, and gives it back when it goes. The D-pad moves by where
 * things are on screen, and from most of a page nothing leads to a box floating over it. (Not in the player, where OK
 * is Pause: App leaves `tv` off there.)
 */
export function ToastHost({ tv }: { tv?: boolean }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  // Where focus was before a toast took it (null: nowhere); undefined while no toast has it.
  const returnTo = useRef<HTMLElement | null | undefined>(undefined);

  useEffect(() => {
    listener = (message, action) => setToast({ id: ++nextId, message, action });
    hostWaiters.forEach((fn) => fn());
    return () => {
      listener = null;
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.action ? ACTION_TOAST_MS : TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast?.id]);

  useEffect(() => {
    const host = hostRef.current;
    // Not from an open dialog, menu or list (Lumen's or jellyfin-web's): it has the remote until it closes.
    if (tv && button.current && !document.querySelector(MODAL)) {
      // Where to give focus back. Kept from the first of a run of toasts: when a second replaces the first, focus is on
      // the body (the first's button went with it), not on the page. Taken afresh if the user has gone back to the page.
      const now = document.activeElement as HTMLElement | null;
      if (returnTo.current === undefined || (now && now !== document.body && !host?.contains(now))) {
        returnTo.current = now;
      }
      button.current.focus();
      return;
    }
    // Gone, or replaced by one that doesn't take focus: give it back, if the toast had it.
    const before = returnTo.current;
    if (before === undefined) return;
    returnTo.current = undefined;
    // Only if focus went with the toast: Open's new page, or the user, may have put it elsewhere since.
    const now = document.activeElement;
    if (now && now !== document.body && !host?.contains(now)) return;
    // Back where it was. If it was nowhere (the toast came up before the page had drawn; useAutoFocus then left it
    // with the toast) or that's gone, the page's own first choice.
    const page = (selector: string): HTMLElement | null => document.querySelector(`.lmn-main ${selector}`);
    (before && before !== document.body && document.contains(before)
      ? before
      : (page('.lmn-autofocus') ?? page('a,button'))
    )?.focus();
  }, [toast?.id]);

  const action = toast?.action;
  return (
    <div ref={hostRef} class="lmn-toast-host" role="alert">
      {toast && (
        <p key={toast.id} class="lmn-toast">
          <span>{toast.message}</span>
          {action && (
            <button
              ref={button}
              type="button"
              class="lmn-toast__action"
              onClick={() => {
                setToast(null);
                action.onSelect();
              }}
            >
              {action.label}
            </button>
          )}
          <button
            type="button"
            class="lmn-toast__close"
            aria-label={strings.dismiss}
            onClick={() => setToast(null)}
          >
            <Icon name="close" size={18} />
          </button>
        </p>
      )}
    </div>
  );
}
