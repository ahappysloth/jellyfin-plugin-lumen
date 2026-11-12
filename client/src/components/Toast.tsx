import { useEffect, useState } from 'preact/hooks';
import { strings } from '../strings';
import { Icon } from './icons';

/** How long a toast stays up before it dismisses itself. */
export const TOAST_MS = 6000;

interface Toast {
  id: number;
  message: string;
}

let listener: ((message: string) => void) | null = null;
let nextId = 0;

/**
 * Shows a short message (a failed action) at the bottom of the screen. One at a time: a new one replaces the old.
 * The host must be mounted (see App).
 */
export function showToast(message: string): void {
  listener?.(message);
}

/** Renders the current toast. The live region is always present, so screen readers announce what lands in it. */
export function ToastHost() {
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    listener = (message) => setToast({ id: ++nextId, message });
    return () => {
      listener = null;
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast?.id]);

  return (
    <div class="lmn-toast-host" role="alert">
      {toast && (
        <p key={toast.id} class="lmn-toast">
          <span>{toast.message}</span>
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
