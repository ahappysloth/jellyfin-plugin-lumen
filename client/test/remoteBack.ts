import { fireEvent } from '@testing-library/preact';

/** A webOS remote's Back key (461) and a Tizen remote's (10009); both report no useful `key`. */
export const REMOTE_BACK_KEY_CODES = [461, 10009] as const;

/**
 * Presses a TV remote's Back on `target`, and says whether jellyfin-web would have gone back a page too: its keyboard
 * navigation (scripts/keyboardNavigation.js) listens on `window` in the bubble phase and skips defaultPrevented events.
 */
export function pressRemoteBack(target: Element, keyCode: number): { reachedJellyfin: boolean } {
  let reachedJellyfin = false;
  const stock = (e: KeyboardEvent): void => {
    if (!e.defaultPrevented) reachedJellyfin = true;
  };
  window.addEventListener('keydown', stock);
  try {
    fireEvent.keyDown(target, { key: 'Unidentified', keyCode });
  } finally {
    window.removeEventListener('keydown', stock);
  }
  return { reachedJellyfin };
}
