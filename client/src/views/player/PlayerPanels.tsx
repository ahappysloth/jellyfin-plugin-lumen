import {
  cloneElement,
  type ComponentChild,
  type ComponentChildren,
  isValidElement,
  toChildArray,
  type VNode,
} from 'preact';
import { useEffect, useId, useRef } from 'preact/hooks';
import type { PlaybackManager, Stream } from '../../compat/playbackManager';
import type { PlayerSnapshot } from './playerState';
import { playerStrings } from './playerStrings';

/**
 * Quality presets, highest first. A preset shows when the source is at least `minHeight` tall (no "4K" for a 1080p
 * file). Bitrates follow jellyfin-web's own quality menu, and like it they only cap the bitrate: the server transcodes
 * under the cap but keeps the source resolution, so the menu shows the bitrate next to each name.
 */
export const QUALITY_PRESETS = [
  { label: '4K', detail: 'Ultra HD', bitrate: 120_000_000, minHeight: 1500 },
  { label: '1080p', detail: 'Full HD', bitrate: 20_000_000, minHeight: 1000 },
  { label: '720p', detail: 'HD', bitrate: 6_000_000, minHeight: 700 },
  { label: '480p', detail: 'SD', bitrate: 3_000_000, minHeight: 0 },
  { label: '360p', detail: '', bitrate: 1_000_000, minHeight: 0 },
] as const;

/** Speeds offered in the panel (jellyfin-web supports more; these cover what people use). */
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

function heightLabel(height: number | null): string {
  if (!height) return '';
  if (height >= 1500) return '4K';
  if (height >= 1000) return '1080p';
  if (height >= 700) return '720p';
  if (height >= 450) return '480p';
  return `${height}p`;
}

/** The preset matching a manual bitrate cap: the highest preset at or under it. */
function presetFor(bitrate: number) {
  return QUALITY_PRESETS.find((p) => p.bitrate <= bitrate) ?? QUALITY_PRESETS[QUALITY_PRESETS.length - 1]!;
}

/** What the Quality pill says: the playing resolution on Auto, else the chosen preset. */
export function qualityLabel(snap: PlayerSnapshot): string {
  return snap.autoQuality
    ? heightLabel(snap.videoHeight) || playerStrings.auto
    : presetFor(snap.maxBitrate).label;
}

/** Keys jellyfin-web's player shortcuts seek or skip chapters with. */
const SEEK_KEYS = ['Home', 'End', 'PageUp', 'PageDown'];
const ARROW_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];

/**
 * A panel's behaviour as a non-modal dialog under its pill: it closes on a click outside the panel and its pill (the
 * pills row contains both), and takes focus as it opens, to the current choice (else its first control). Escape and a
 * remote's Back close it and give focus back to the pill (PlayerView). Keys in it stay from jellyfin-web's shortcuts,
 * which would seek or change the volume: Home, End, Page Up and Down, and the arrows outside the TV layout (where
 * they are jellyfin-web's D-pad navigation).
 */
export function usePanel(ref: { current: HTMLElement | null }, onClose: () => void, tv?: boolean): void {
  useEffect(() => {
    const panel = ref.current;
    (
      panel?.querySelector<HTMLElement>('[aria-checked="true"], [aria-pressed="true"]') ??
      panel?.querySelector<HTMLElement>('button')
    )?.focus();
    const onDown = (e: PointerEvent): void => {
      const pills = ref.current?.parentElement;
      if (pills && !pills.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (SEEK_KEYS.includes(e.key) || (!tv && ARROW_KEYS.includes(e.key))) e.stopPropagation();
    };
    document.addEventListener('pointerdown', onDown, true);
    panel?.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      panel?.removeEventListener('keydown', onKey);
    };
  }, []);
}

/**
 * A column of choices: a radio group named by its heading. Outside the TV layout the arrow keys move between its
 * choices (Space or Enter picks one: picking may restart the stream, so moving doesn't), and stay from jellyfin-web's
 * shortcuts, which would seek or change the volume. In the TV layout they stay jellyfin-web's D-pad navigation.
 */
function Choices({
  heading,
  tv,
  empty,
  children,
}: {
  heading: string;
  tv?: boolean;
  /** A note under the choices ("No subtitles for this title"). */
  empty?: string | false;
  children: ComponentChildren;
}) {
  const id = useId();
  // Tab stops at a group's checked choice (else its first) outside the TV layout, where the arrow keys move between
  // them. In the TV layout every choice stays focusable: jellyfin-web's D-pad navigation skips tabindex="-1".
  const options = toChildArray(children);
  const checked = options.findIndex((o) => isOption(o) && o.props.selected);
  const roving = tv
    ? options
    : options.map((o, i) => (isOption(o) ? cloneElement(o, { tabbable: i === Math.max(checked, 0) }) : o));
  return (
    <section class="lmn-panel__column">
      <h2 class="lmn-panel__heading" id={id}>
        {heading}
      </h2>
      {options.length > 0 && (
        <div
          role="radiogroup"
          aria-labelledby={id}
          onKeyDown={(e) => {
            if (tv) return;
            const step =
              e.key === 'ArrowDown' || e.key === 'ArrowRight'
                ? 1
                : e.key === 'ArrowUp' || e.key === 'ArrowLeft'
                  ? -1
                  : 0;
            const radios = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]'));
            const at = radios.indexOf(e.target as HTMLElement);
            if (!step || at < 0) return;
            e.preventDefault();
            e.stopPropagation();
            radios[(at + step + radios.length) % radios.length]!.focus();
          }}
        >
          {roving}
        </div>
      )}
      {empty && <p class="lmn-panel__empty">{empty}</p>}
    </section>
  );
}

interface OptionProps {
  selected: boolean;
  label: string;
  detail?: string;
  onSelect: () => void;
  /** False: out of the Tab order (its group's roving tabindex). */
  tabbable?: boolean;
}

const isOption = (child: ComponentChild): child is VNode<OptionProps> => isValidElement(child);

function Option({ selected, label, detail, onSelect, tabbable }: OptionProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      tabIndex={tabbable === false ? -1 : undefined}
      class={`lmn-panel__option${selected ? ' is-selected' : ''}`}
      onClick={onSelect}
    >
      <span class="lmn-panel__option-label">{label}</span>
      {detail && <span class="lmn-panel__option-detail">{detail}</span>}
    </button>
  );
}

export function QualityPanel({
  manager,
  snap,
  tv,
  onClose,
  onSwitch,
}: {
  manager: PlaybackManager;
  snap: PlayerSnapshot;
  tv?: boolean;
  onClose: () => void;
  /** Called with a label ("720p") before a change that may restart the stream. */
  onSwitch?: (label: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  usePanel(ref, onClose, tv);
  const sourceHeight = snap.videoHeight ?? 0;
  const presets = QUALITY_PRESETS.filter((p) => sourceHeight === 0 || p.minHeight <= sourceHeight);
  const current = snap.autoQuality ? null : presetFor(snap.maxBitrate).bitrate;
  // jellyfin-web restarts the stream for any quality change, so picking the current choice does nothing.
  const setQuality = (bitrate: number | null, label: string): void => {
    if (bitrate === current) return;
    onSwitch?.(label);
    manager.setMaxStreamingBitrate(
      { enableAutomaticBitrateDetection: bitrate === null, maxBitrate: bitrate ?? snap.maxBitrate },
      snap.player,
    );
  };
  const speeds = SPEEDS.filter((s) => snap.rates.length === 0 || snap.rates.includes(s));

  return (
    <div ref={ref} class="lmn-panel lmn-panel--quality" role="dialog" aria-label={playerStrings.quality}>
      <div class="lmn-panel__columns">
        <Choices heading={playerStrings.quality} tv={tv}>
          <Option
            selected={current === null}
            label={playerStrings.auto}
            detail={heightLabel(snap.videoHeight)}
            onSelect={() => setQuality(null, playerStrings.auto)}
          />
          {presets.map((p) => (
            <Option
              key={p.bitrate}
              selected={current === p.bitrate}
              label={p.label}
              detail={[p.detail, `${p.bitrate / 1_000_000} Mbps`].filter(Boolean).join(' · ')}
              onSelect={() => setQuality(p.bitrate, p.label)}
            />
          ))}
        </Choices>
        {snap.aspectRatios.length > 1 && (
          <Choices heading={playerStrings.aspectRatio} tv={tv}>
            {snap.aspectRatios.map((a) => (
              <Option
                key={a.id}
                selected={snap.aspectRatio === a.id}
                label={a.name}
                onSelect={() => manager.setAspectRatio(a.id, snap.player)}
              />
            ))}
          </Choices>
        )}
      </div>
      {speeds.length > 1 && (
        <div class="lmn-panel__footer">
          <span class="lmn-panel__heading">{playerStrings.speed}</span>
          <div class="lmn-panel__speeds" role="group" aria-label={playerStrings.speed}>
            {speeds.map((s) => (
              <button
                key={s}
                type="button"
                class={`lmn-panel__speed${snap.rate === s ? ' is-selected' : ''}`}
                aria-pressed={snap.rate === s}
                onClick={() => manager.setPlaybackRate(s, snap.player)}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * jellyfin-web's DisplayTitle reads "English - AAC - 5.1 - Default"; show the language (or name) as the label and the
 * technical parts as a quieter detail line.
 */
export function trackParts(track: Stream): { label: string; detail?: string } {
  const parts = (track.DisplayTitle ?? '')
    .split(' - ')
    .map((p) => p.trim())
    .filter(Boolean);
  const label = parts[0] || track.Title || track.Language || `Track ${track.Index}`;
  const detail = parts
    .slice(1)
    .filter((p) => !/^(external|default)$/i.test(p))
    .join(' · ');
  return { label, detail: detail || undefined };
}

export function AudioSubtitlesPanel({
  manager,
  snap,
  tv,
  onClose,
  onSwitch,
}: {
  manager: PlaybackManager;
  snap: PlayerSnapshot;
  tv?: boolean;
  onClose: () => void;
  /** Called with a label before a change that may restart the stream. */
  onSwitch?: (label: string) => void;
}) {
  // Picking the current track is a no-op; otherwise jellyfin-web may restart the stream (see SwitchOverlay).
  const setAudio = (index: number, label: string): void => {
    if (index === snap.audioIndex) return;
    onSwitch?.(label);
    manager.setAudioStreamIndex(index, snap.player);
  };
  const setSubtitles = (index: number, label: string): void => {
    if (index === snap.subtitleIndex) return;
    onSwitch?.(label);
    manager.setSubtitleStreamIndex(index, snap.player);
  };
  const ref = useRef<HTMLDivElement>(null);
  usePanel(ref, onClose, tv);
  const offset = snap.subtitleOffset;
  const nudge = (delta: number): void =>
    manager.setSubtitleOffset?.(Math.round(((offset ?? 0) + delta) * 10) / 10, snap.player);

  return (
    <div
      ref={ref}
      class="lmn-panel lmn-panel--tracks"
      role="dialog"
      aria-label={playerStrings.audioSubtitles}
    >
      <div class="lmn-panel__columns">
        <Choices
          heading={playerStrings.audio}
          tv={tv}
          empty={snap.audioTracks.length === 0 && playerStrings.noAudio}
        >
          {snap.audioTracks.map((t) => (
            <Option
              key={t.Index}
              selected={snap.audioIndex === t.Index}
              {...trackParts(t)}
              onSelect={() => setAudio(t.Index, trackParts(t).label)}
            />
          ))}
        </Choices>
        <Choices
          heading={playerStrings.subtitles}
          tv={tv}
          empty={snap.subtitleTracks.length === 0 && playerStrings.noSubtitles}
        >
          <Option
            selected={snap.subtitleIndex === -1}
            label={playerStrings.off}
            onSelect={() => setSubtitles(-1, playerStrings.subtitlesOff)}
          />
          {snap.subtitleTracks.map((t) => (
            <Option
              key={t.Index}
              selected={snap.subtitleIndex === t.Index}
              {...trackParts(t)}
              onSelect={() => setSubtitles(t.Index, trackParts(t).label)}
            />
          ))}
        </Choices>
      </div>
      {offset !== null && snap.subtitleIndex !== -1 && (
        <div class="lmn-panel__footer">
          <span class="lmn-panel__heading">{playerStrings.subtitleTiming}</span>
          <div class="lmn-panel__stepper" role="group" aria-label={playerStrings.subtitleTiming}>
            <button
              type="button"
              class="lmn-panel__speed"
              aria-label={playerStrings.earlier}
              onClick={() => nudge(-0.1)}
            >
              −0.1s
            </button>
            <span
              class="lmn-panel__offset"
              aria-live="polite"
            >{`${offset > 0 ? '+' : ''}${offset.toFixed(1)}s`}</span>
            <button
              type="button"
              class="lmn-panel__speed"
              aria-label={playerStrings.later}
              onClick={() => nudge(0.1)}
            >
              +0.1s
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
