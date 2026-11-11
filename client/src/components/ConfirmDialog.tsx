import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { isBackKey } from '../compat/jellyfin';
import { strings } from '../strings';

export interface ConfirmOptions {
  title: string;
  body: string;
  /** The button that goes ahead, in Lumen's red: this is for things a click can't take back. */
  confirmLabel: string;
  /** Where focus goes back to on close: by default, whatever had it as the dialog opened. */
  returnFocus?: HTMLElement | null;
}

interface Open extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

let show: ((next: Open) => void) | null = null;

/**
 * Asks before going ahead, in Lumen's dialog: resolves true for the confirm button, false for Cancel, Escape, a
 * remote's Back, a press outside or leaving the page. One at a time: a second one answers the first with false. Without
 * a host (see App) it can't ask, and resolves false.
 */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (!show) return resolve(false);
    show({
      ...options,
      returnFocus: options.returnFocus ?? (document.activeElement as HTMLElement | null),
      resolve,
    });
  });
}

/**
 * Renders the open confirmation. Focus starts on Cancel (the safe answer), stays inside (Tab goes round; Left and Right
 * pick a button, for a TV's D-pad as for a keyboard), and goes back to the control that opened it.
 */
export function ConfirmHost() {
  const [open, setOpen] = useState<Open | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mine = (next: Open): void =>
      setOpen((current) => {
        current?.resolve(false);
        return next;
      });
    show = mine;
    return () => {
      if (show === mine) show = null;
    };
  }, []);

  const close = (ok: boolean): void => {
    if (!open) return;
    open.returnFocus?.focus({ preventScroll: true });
    setOpen(null);
    open.resolve(ok);
  };

  // A layout effect: focus is in the dialog as it appears, never moved there after an answer came in.
  useLayoutEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    // Back and Escape wherever focus is, before jellyfin-web sees them (it would go back a page).
    const onKey = (e: KeyboardEvent): void => {
      if (!isBackKey(e)) return;
      e.preventDefault();
      e.stopPropagation();
      close(false);
    };
    const onLeave = (): void => close(false);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('hashchange', onLeave);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('hashchange', onLeave);
    };
  }, [open]);

  if (!open) return null;

  const onKeyDown = (e: KeyboardEvent): void => {
    // Every arrow, so jellyfin-web's D-pad never takes focus out to the page (nothing is above or below), and Tab.
    if (!/^Arrow|^Tab$/.test(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    const [cancel, ok] = Array.from(panel.current!.querySelectorAll('button'));
    const to = { ArrowLeft: cancel, ArrowRight: ok, Tab: document.activeElement === ok ? cancel : ok }[e.key];
    to?.focus();
  };

  return (
    <div
      class="lmn-dialog"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close(false);
      }}
    >
      <div
        ref={panel}
        class="lmn-dialog__panel lmn-dialog__panel--confirm focuscontainer"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="lmn-confirm-title"
        aria-describedby="lmn-confirm-body"
        onKeyDown={onKeyDown}
      >
        <h2 id="lmn-confirm-title" class="lmn-dialog__title">
          {open.title}
        </h2>
        <p id="lmn-confirm-body" class="lmn-dialog__text">
          {open.body}
        </p>
        <div class="lmn-dialog__actions">
          <button type="button" class="lmn-button lmn-button--secondary" onClick={() => close(false)}>
            {strings.cancel}
          </button>
          <button type="button" class="lmn-button lmn-button--danger" onClick={() => close(true)}>
            {open.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
