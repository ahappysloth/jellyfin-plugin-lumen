import { useEffect, useRef, useState } from 'preact/hooks';
import { formatClock } from './PlayerView';
import type { TrickplayPreview } from './trickplay';
import { playerStrings } from './playerStrings';

/** A seek counts as arrived once the player reports a time this close to it. */
const ARRIVED_MS = 1500;
/** Give up waiting after this long (a seek the player refused, or a stream restart that took longer). */
export const PENDING_MAX_MS = 15_000;
/** Trickplay thumbnails are shown at this width (the tiles' own width is usually 320 px). */
const PREVIEW_WIDTH = 192;

interface Props {
  positionMs: number;
  durationMs: number;
  bufferedMs: number;
  disabled: boolean;
  onSeek: (ms: number) => void;
  /** Trickplay thumbnails, when the server has them. */
  preview?: TrickplayPreview | null;
  /** The video's current position, read when the arrow keys seek. */
  livePositionMs?: () => number;
  /** The TV layout, where the up and down arrows move focus (jellyfin-web's D-pad navigation) instead of seeking. */
  tv?: boolean;
}

/**
 * A slim scrubber: played (white), buffered (grey) and a thumb that grows on hover. Dragging previews the time and
 * seeks on release; arrow keys step 10 s (it is a slider for assistive tech), up and down too outside the TV layout.
 */
export function ProgressBar({
  positionMs,
  durationMs,
  bufferedMs,
  disabled,
  onSeek,
  preview,
  livePositionMs,
  tv = false,
}: Props) {
  const track = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  // Where the user asked to go: shown until the player reports a time near it, so the bar doesn't jump back to the
  // old position while jellyfin-web seeks (or restarts a converted stream).
  const [pending, setPending] = useState<{ ms: number; at: number } | null>(null);
  useEffect(() => {
    if (
      pending &&
      (Math.abs(positionMs - pending.ms) < ARRIVED_MS || Date.now() - pending.at > PENDING_MAX_MS)
    )
      setPending(null);
  }, [positionMs, pending]);
  // The target also gives way on its own after PENDING_MAX_MS, when no new position arrives to clear it (paused, or a
  // seek that never lands).
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setPending((p) => (p === pending ? null : p)), PENDING_MAX_MS);
    return () => clearTimeout(timer);
  }, [pending]);
  const seek = (ms: number): void => {
    setPending({ ms, at: Date.now() });
    onSeek(ms);
  };
  const shown = drag ?? (pending ? pending.ms : positionMs);
  const tipAt = drag ?? hover;
  const frame = tipAt !== null && preview ? preview(tipAt) : null;
  const scale = frame ? PREVIEW_WIDTH / frame.width : 1;
  const pct = (ms: number): string =>
    `${durationMs > 0 ? Math.min(100, Math.max(0, (ms / durationMs) * 100)) : 0}%`;
  const at = (clientX: number): number => {
    const rect = track.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * durationMs;
  };

  return (
    <div
      ref={track}
      class={`lmn-seek${drag !== null ? ' is-dragging' : ''}${disabled ? ' is-disabled' : ''}`}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={playerStrings.seek}
      aria-valuemin={0}
      aria-valuemax={Math.round(durationMs / 1000)}
      aria-valuenow={Math.round(shown / 1000)}
      aria-valuetext={playerStrings.positionOf(
        formatClock(shown, durationMs),
        formatClock(durationMs, durationMs),
      )}
      onPointerDown={(e) => {
        if (disabled || e.button !== 0) return;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        setDrag(at(e.clientX));
      }}
      onPointerMove={(e) => {
        if (disabled) return;
        const ms = at(e.clientX);
        setHover(ms);
        if (drag !== null) setDrag(ms);
      }}
      onPointerUp={(e) => {
        if (drag === null) return;
        const ms = at(e.clientX);
        setDrag(null);
        seek(ms);
      }}
      onPointerCancel={() => setDrag(null)}
      onPointerLeave={() => setHover(null)}
      onKeyDown={(e) => {
        if (disabled) return;
        const forward = e.key === 'ArrowRight' || (!tv && e.key === 'ArrowUp');
        const back = e.key === 'ArrowLeft' || (!tv && e.key === 'ArrowDown');
        const step = forward ? 10_000 : back ? -10_000 : 0;
        if (!step) return;
        e.preventDefault();
        e.stopPropagation(); // jellyfin-web also seeks on arrows (and changes the volume on up and down)
        // From where the video is now: positionMs isn't redrawn while the controls are hidden (PlayerView), and the
        // seek bar keeps focus then. A recent step still on its way counts (rapid presses add up); an old one doesn't,
        // whether or not a redraw has cleared it.
        const recent = pending && Date.now() - pending.at <= PENDING_MAX_MS ? pending : null;
        const from = recent?.ms ?? livePositionMs?.() ?? positionMs;
        seek(Math.min(durationMs, Math.max(0, from + step)));
      }}
    >
      <div class="lmn-seek__rail">
        <div class="lmn-seek__buffered" style={{ width: pct(bufferedMs) }} />
        <div class="lmn-seek__played" style={{ width: pct(shown) }} />
      </div>
      <div class="lmn-seek__thumb" style={{ left: pct(shown) }} />
      {tipAt !== null && (
        <div class={`lmn-seek__tip${frame ? ' has-thumbnail' : ''}`} style={{ left: pct(tipAt) }}>
          {frame && (
            <div
              class="lmn-seek__thumbnail-box"
              style={{ width: `${PREVIEW_WIDTH}px`, height: `${Math.round(frame.height * scale)}px` }}
            >
              <div
                class="lmn-seek__thumbnail"
                style={{
                  width: `${frame.width}px`,
                  height: `${frame.height}px`,
                  backgroundImage: `url("${frame.url}")`,
                  backgroundPosition: `-${frame.x}px -${frame.y}px`,
                  transform: `scale(${scale})`,
                }}
              />
            </div>
          )}
          {formatClock(tipAt, durationMs)}
        </div>
      )}
    </div>
  );
}
