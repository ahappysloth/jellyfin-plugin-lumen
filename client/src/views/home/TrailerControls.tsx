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
      <button
        type="button"
        class="lmn-icon-button lmn-icon-button--lg"
        aria-label={state.muted ? UNMUTE : MUTE}
        onClick={() => state.setMuted(!state.muted)}
      >
        <Icon name={state.muted ? 'volumeOff' : 'volumeHigh'} size={20} />
      </button>
    </div>
  );
}
