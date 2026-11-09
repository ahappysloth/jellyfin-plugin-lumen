import { useRef, useState } from 'preact/hooks';
import { strings } from '../../strings';
import { formatClock } from './PlayerView';

interface Props {
  positionMs: number;
  durationMs: number;
  bufferedMs: number;
  disabled: boolean;
  onSeek: (ms: number) => void;
}

/**
 * A slim scrubber: played (white), buffered (grey) and a thumb that grows on hover. Dragging previews the time and
 * seeks on release; arrow keys step 10 s (it is a slider for assistive tech).
 */
export function ProgressBar({ positionMs, durationMs, bufferedMs, disabled, onSeek }: Props) {
  const track = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const shown = drag ?? positionMs;
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
      aria-label={strings.player.seek}
      aria-valuemin={0}
      aria-valuemax={Math.round(durationMs / 1000)}
      aria-valuenow={Math.round(shown / 1000)}
      aria-valuetext={formatClock(shown, durationMs)}
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
        onSeek(ms);
      }}
      onPointerCancel={() => setDrag(null)}
      onPointerLeave={() => setHover(null)}
      onKeyDown={(e) => {
        if (disabled) return;
        const step = e.key === 'ArrowRight' ? 10_000 : e.key === 'ArrowLeft' ? -10_000 : 0;
        if (!step) return;
        e.preventDefault();
        e.stopPropagation(); // jellyfin-web also seeks on arrows; don't do it twice
        onSeek(Math.min(durationMs, Math.max(0, positionMs + step)));
      }}
    >
      <div class="lmn-seek__rail">
        <div class="lmn-seek__buffered" style={{ width: pct(bufferedMs) }} />
        <div class="lmn-seek__played" style={{ width: pct(shown) }} />
      </div>
      <div class="lmn-seek__thumb" style={{ left: pct(shown) }} />
      {(hover ?? drag) !== null && (
        <div class="lmn-seek__tip" style={{ left: pct((drag ?? hover)!) }}>
          {formatClock((drag ?? hover)!, durationMs)}
        </div>
      )}
    </div>
  );
}
