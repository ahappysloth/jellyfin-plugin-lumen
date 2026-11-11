/**
 * Turning the picture sideways in full screen, where the browser lets a page do that (Chrome on Android, in full
 * screen only). Elsewhere `screen.orientation.lock` is missing (Safari before 16.4, Chromium 68) or rejects (iOS,
 * desktops): both are fine, and neither may throw.
 */
interface Lockable {
  lock?: (orientation: string) => Promise<void> | void;
  unlock?: () => void;
}

function orientationOf(win: Window): Lockable | undefined {
  try {
    return (win.screen as unknown as { orientation?: Lockable }).orientation;
  } catch {
    return undefined;
  }
}

/** Asks for landscape; true when the browser has a lock to ask with (so it should be undone with unlockOrientation). */
export function lockLandscape(win: Window = window): boolean {
  const orientation = orientationOf(win);
  if (!orientation || typeof orientation.lock !== 'function') return false;
  try {
    const pending = orientation.lock('landscape');
    if (pending && typeof pending.catch === 'function') pending.catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

export function unlockOrientation(win: Window = window): void {
  try {
    orientationOf(win)?.unlock?.();
  } catch {
    // nothing to undo
  }
}
