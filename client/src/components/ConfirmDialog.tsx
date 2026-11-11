import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { isBackKey } from '../compat/jellyfin';
import { strings } from '../strings';
import { onNavigate } from '../takeover/navigation';

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
  // The request being asked, kept outside state so each one is answered exactly once, and never from inside a state
  // updater (Preact may run those more than once).
  const pending = useRef<Open | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mine = (next: Open): void => {
      const replaced = pending.current;
      pending.current = next;
      replaced?.resolve(false);
      setOpen(next);
    };
    show = mine;
    return () => {
      if (show === mine) show = null;
    };
  }, []);

  /** Answers the open request. `refocus` false: the page changed, and the new one decides where focus goes. */
  const close = (ok: boolean, refocus = true): void => {
    const current = pending.current;
    if (!current) return;
    pending.current = null;
    if (refocus) current.returnFocus?.focus({ preventScroll: true });
    setOpen(null);
    current.resolve(ok);
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
    document.addEventListener('keydown', onKey, true);
    // Any page change: jellyfin-web's own (pushState: a remote's Home key, a "go home" or "play" sent from another
    // device, signing out) as well as a hash change. The question was about the page that's gone.
    const stopNavigation = onNavigate(() => close(false, false));
    const unlock = lockScroll();
    return () => {
      document.removeEventListener('keydown', onKey, true);
      stopNavigation();
      unlock();
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

/**
 * Keeps the page behind from scrolling (a wheel or a swipe over the backdrop) and gives back exactly the inline styles
 * <body> had. Where a classic scrollbar goes away, <body> keeps its width so the page doesn't shift sideways.
 * jellyfin-web's own pages override <body>'s overflow with !important (stock-skin.css), and win there.
 */
function lockScroll(): () => void {
  const { body, documentElement } = document;
  const { overflow, paddingRight } = body.style;
  const scrollbar = window.innerWidth - documentElement.clientWidth;
  body.style.overflow = 'hidden';
  if (scrollbar > 0)
    body.style.paddingRight = `${parseFloat(getComputedStyle(body).paddingRight) + scrollbar}px`;
  return () => {
    body.style.overflow = overflow;
    body.style.paddingRight = paddingRight;
  };
}
