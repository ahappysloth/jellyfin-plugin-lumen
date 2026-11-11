import { useEffect, useRef, useState } from 'preact/hooks';
import { playerStrings } from './playerStrings';

/** A switch only shows the overlay if the stream actually restarts within this long. */
const ARM_MS = 2000;
/**
 * Never cover the picture longer than this. A server transcoding without hardware acceleration can take well over 20 s
 * to deliver the new stream's first segment; dropping the note before that left a black, frozen picture that looked
 * paused while the stream was still loading.
 */
export const MAX_SHOWN_MS = 90_000;

interface Switching {
  label: string;
  /** The last frame before the switch (a data URL), held on screen while the new stream loads. */
  frame: string | null;
  shown: boolean;
}

/** The picture as it is now, or null when it can't be read (e.g. a cross-origin stream). */
function captureFrame(): string | null {
  const video = document.querySelector<HTMLVideoElement>('video.htmlvideoplayer');
  if (!video || !video.videoWidth) return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.85);
  } catch {
    return null;
  }
}

/**
 * Smooths quality, audio and subtitle changes. jellyfin-web switches some of them in place, but for others it restarts
 * the stream (a new transcode), and the picture stalls for a second or two. `begin` keeps the current frame; if the
 * <video> then reloads (emptied/loadstart), the frame stays on screen with "Switching to …" until playback is going
 * again. Changes that don't reload never show anything.
 */
export function useStreamSwitch(): { state: Switching | null; begin: (label: string) => void } {
  const [state, setState] = useState<Switching | null>(null);
  const armedUntil = useRef(0);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const onReload = (e: Event): void => {
      if (!(e.target instanceof HTMLVideoElement) || Date.now() > armedUntil.current) return;
      armedUntil.current = 0;
      setState((s) => (s ? { ...s, shown: true } : s));
      clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setState(null), MAX_SHOWN_MS);
    };
    const onProgress = (e: Event): void => {
      const video = e.target;
      if (!(video instanceof HTMLVideoElement) || video.paused || video.readyState < 3) return;
      setState((s) => (s?.shown ? null : s));
    };
    // The new stream failed (jellyfin-web reports it): nothing is coming.
    const onError = (e: Event): void => {
      if (e.target instanceof HTMLVideoElement) setState((s) => (s?.shown ? null : s));
    };
    document.addEventListener('emptied', onReload, true);
    document.addEventListener('error', onError, true);
    document.addEventListener('loadstart', onReload, true);
    document.addEventListener('timeupdate', onProgress, true);
    return () => {
      document.removeEventListener('emptied', onReload, true);
      document.removeEventListener('error', onError, true);
      document.removeEventListener('loadstart', onReload, true);
      document.removeEventListener('timeupdate', onProgress, true);
      clearTimeout(timer.current);
    };
  }, []);

  const begin = (label: string): void => {
    armedUntil.current = Date.now() + ARM_MS;
    setState({ label, frame: captureFrame(), shown: false });
    clearTimeout(timer.current);
    // Nothing reloaded: it was switched in place.
    timer.current = window.setTimeout(() => setState((s) => (s?.shown ? s : null)), ARM_MS);
  };
  return { state, begin };
}

export function SwitchOverlay({ state }: { state: Switching | null }) {
  if (!state?.shown) return null;
  return (
    <div class="lmn-switching" role="status">
      {state.frame && <img class="lmn-switching__frame" src={state.frame} alt="" />}
      <p class="lmn-switching__note">
        <span class="lmn-spinner" aria-hidden="true" />
        {playerStrings.switching(state.label)}
      </p>
    </div>
  );
}
