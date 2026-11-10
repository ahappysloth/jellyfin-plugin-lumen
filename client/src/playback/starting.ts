import { useEffect, useRef, useState } from 'preact/hooks';
import type { BaseItem } from '../api/types';
import type { JellyfinApiClient } from '../compat/jellyfin';
import { type ImageRef, imageUrl, resolveImage } from '../components/images';

/** What the loading screen shows while playback starts: the title and its backdrop. */
export interface StartingInfo {
  title: string | null;
  backdrop: string | null;
}

/** Never cover the page longer than this if the player doesn't open (it clears on failure before that). */
const MAX_MS = 30_000;

let current: StartingInfo | null = null;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;

function notify(): void {
  listeners.forEach((l) => l());
}

/**
 * Playback is starting. From the click until the video's first frame Lumen shows its loading screen: over the page
 * while jellyfin-web prepares the stream (its bitrate test, the playback info), then in the player.
 */
export function showStarting(info: StartingInfo): void {
  current = info;
  clearTimeout(timer);
  timer = setTimeout(clearStarting, MAX_MS);
  notify();
}

export function clearStarting(): void {
  clearTimeout(timer);
  if (current === null) return;
  current = null;
  notify();
}

export function startingInfo(): StartingInfo | null {
  return current;
}

export function useStarting(): StartingInfo | null {
  const [, setTick] = useState(0);
  useEffect(() => {
    const listener = (): void => setTick((n) => n + 1);
    listeners.add(listener);
    return () => void listeners.delete(listener);
  }, []);
  return current;
}

/** The loading screen's backdrop, blurred and dimmed: 1280 px at any pixel density is plenty. */
export function loadingBackdropUrl(client: Pick<JellyfinApiClient, 'getUrl'>, ref: ImageRef): string {
  return imageUrl(client, ref, { width: 1280 }, 1);
}

/** The loading screen's title and backdrop for an item (an episode shows its show's name and art). */
export function startingFor(client: Pick<JellyfinApiClient, 'getUrl'>, item: BaseItem): StartingInfo {
  const ref = resolveImage(item, ['Backdrop', 'Thumb', 'Primary']);
  return {
    title: (item.Type === 'Episode' ? item.SeriesName : item.Name) ?? null,
    backdrop: ref ? loadingBackdropUrl(client, ref) : null,
  };
}

/**
 * A Play button's "Starting…" for one click: `run(key, start)` marks `key` as starting until `start` settles, or for
 * at most as long as the loading screen stays up, so a play request Jellyfin never answers can't leave it stuck.
 */
export function useStartingButton<K>(): [K | null, (key: K, start: () => Promise<unknown>) => void] {
  const [key, setKey] = useState<K | null>(null);
  const click = useRef(0);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const run = (next: K, start: () => Promise<unknown>): void => {
    const id = ++click.current;
    setKey(next);
    const done = (): void => {
      clearTimeout(timer);
      if (mounted.current && click.current === id) setKey(null);
    };
    const timer = setTimeout(done, MAX_MS);
    start().then(done, done);
  };
  return [key, run];
}
