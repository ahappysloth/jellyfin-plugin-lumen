import { useLayoutEffect, useRef } from 'preact/hooks';
import { Icon } from '../../components/icons';
import { strings } from '../../strings';
import type { TrailerControlState } from './lazyTrailer';

/** Only these buttons say them, so they come with this file rather than in strings.ts (the startup bundle). */
const MUTE = 'Mute trailer';
const UNMUTE = 'Unmute trailer';

/**
 * Pause and Mute for the trailer behind a details header (a library title's or a catalog title's), in its top bar, once
 * the trailer shows. Pause stops it where it is: no moving picture the user can't stop (WCAG 2.2.2). Part of the
 * trailer's lazy file: they only ever show once it's in (lazyTrailer.tsx's LazyTrailerControls).
 */
export function TrailerControls({ state }: { state: TrailerControlState }) {
  return (
    <div class="lmn-details__trailer-controls">
      <button
        type="button"
        class="lmn-icon-button lmn-icon-button--lg"
        aria-label={state.paused ? strings.playTrailer : strings.pauseTrailer}
        onClick={() => state.setPaused(!state.paused)}
      >
        <Icon name={state.paused ? 'play' : 'pause'} size={20} />
      </button>
      <MuteButton muted={state.muted} onChange={state.setMuted} large />
    </div>
  );
}

/**
 * Mute or Unmute for a trailer: the details header's, and the home banner's beside its Pause (Hero.tsx, through
 * lazyTrailer.tsx's LazyMuteButton), with the details page's icons and names.
 */
export function MuteButton({
  muted,
  onChange,
  large,
}: {
  muted: boolean;
  onChange: (muted: boolean) => void;
  large?: boolean;
}) {
  const button = useRef<HTMLButtonElement>(null);
  // It goes when its trailer stops showing. With focus on it, focus goes to the control before it (Pause) rather than
  // to the page, where a TV remote would be stranded.
  useLayoutEffect(() => {
    const element = button.current;
    return () => {
      if (element && document.activeElement === element)
        (element.previousElementSibling as HTMLElement | null)?.focus({ preventScroll: true });
    };
  }, []);
  return (
    <button
      ref={button}
      type="button"
      class={`lmn-icon-button${large ? ' lmn-icon-button--lg' : ''}`}
      aria-label={muted ? UNMUTE : MUTE}
      onClick={() => onChange(!muted)}
    >
      <Icon name={muted ? 'volumeOff' : 'volumeHigh'} size={large ? 20 : 16} />
    </button>
  );
}
