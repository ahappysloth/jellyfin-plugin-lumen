import type { IconRef } from '../../components/icons';
import { PLAYER_ICONS } from './playerIcons';

/** The volume icon for a level: struck through when muted or at 0, then one, two or three waves. */
export function volumeIcon(level: number, muted: boolean): IconRef {
  if (muted || level <= 0) return 'volumeOff';
  if (level < 34) return PLAYER_ICONS.volumeLow;
  if (level < 67) return PLAYER_ICONS.volumeMid;
  return 'volumeHigh';
}

/**
 * Calls `fn` at once, then at most once every `ms` with the latest value, and always with the last one (also on
 * `flush`). A drag sends a value per pointer move; the player needs only a few of them.
 */
export function throttle<T>(fn: (value: T) => void, ms: number) {
  let last = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queued: { value: T } | null = null;
  const run = (value: T): void => {
    last = Date.now();
    queued = null;
    fn(value);
  };
  return {
    call(value: T): void {
      const wait = last + ms - Date.now();
      if (wait <= 0 && !timer) return run(value);
      queued = { value };
      timer ??= setTimeout(
        () => {
          timer = undefined;
          if (queued) run(queued.value);
        },
        Math.max(0, wait),
      );
    },
    /** A value is waiting to be sent. */
    pending(): boolean {
      return !!queued;
    },
    flush(): void {
      clearTimeout(timer);
      timer = undefined;
      if (queued) run(queued.value);
    },
  };
}
