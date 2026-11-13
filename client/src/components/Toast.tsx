import { useEffect, useState } from 'preact/hooks';
import { strings } from '../strings';
import { Icon } from './icons';

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

/** Renders the current toast. The live region is always present, so screen readers announce what lands in it. */
export function ToastHost() {
  const [toast, setToast] = useState<Toast | null>(null);

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

  const action = toast?.action;
  return (
    <div class="lmn-toast-host" role="alert">
      {toast && (
        <p key={toast.id} class="lmn-toast">
          <span>{toast.message}</span>
          {action && (
            <button
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
