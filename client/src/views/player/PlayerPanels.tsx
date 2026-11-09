import { useEffect, useRef } from 'preact/hooks';
import type { PlaybackManager, Stream } from '../../compat/playbackManager';
import { strings } from '../../strings';
import type { PlayerSnapshot } from './playerState';

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
    ? heightLabel(snap.videoHeight) || strings.player.auto
    : presetFor(snap.maxBitrate).label;
}

/** Closes on a click outside the panel and its pill (the pills row contains both). */
function useOutsideClose(ref: { current: HTMLElement | null }, onClose: () => void): void {
  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      const pills = ref.current?.parentElement;
      if (pills && !pills.contains(e.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, []);
}

function Option({
  selected,
  label,
  detail,
  onSelect,
}: {
  selected: boolean;
  label: string;
  detail?: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
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
  onClose,
}: {
  manager: PlaybackManager;
  snap: PlayerSnapshot;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(ref, onClose);
  const sourceHeight = snap.videoHeight ?? 0;
  const presets = QUALITY_PRESETS.filter((p) => sourceHeight === 0 || p.minHeight <= sourceHeight);
  const current = snap.autoQuality ? null : presetFor(snap.maxBitrate).bitrate;
  const setQuality = (bitrate: number | null): void =>
    manager.setMaxStreamingBitrate(
      { enableAutomaticBitrateDetection: bitrate === null, maxBitrate: bitrate ?? snap.maxBitrate },
      snap.player,
    );
  const speeds = SPEEDS.filter((s) => snap.rates.length === 0 || snap.rates.includes(s));

  return (
    <div ref={ref} class="lmn-panel lmn-panel--quality" role="menu" aria-label={strings.player.quality}>
      <div class="lmn-panel__columns">
        <section class="lmn-panel__column">
          <h2 class="lmn-panel__heading">{strings.player.quality}</h2>
          <Option
            selected={current === null}
            label={strings.player.auto}
            detail={heightLabel(snap.videoHeight)}
            onSelect={() => setQuality(null)}
          />
          {presets.map((p) => (
            <Option
              key={p.bitrate}
              selected={current === p.bitrate}
              label={p.label}
              detail={[p.detail, `${p.bitrate / 1_000_000} Mbps`].filter(Boolean).join(' · ')}
              onSelect={() => setQuality(p.bitrate)}
            />
          ))}
        </section>
        {snap.aspectRatios.length > 1 && (
          <section class="lmn-panel__column">
            <h2 class="lmn-panel__heading">{strings.player.aspectRatio}</h2>
            {snap.aspectRatios.map((a) => (
              <Option
                key={a.id}
                selected={snap.aspectRatio === a.id}
                label={a.name}
                onSelect={() => manager.setAspectRatio(a.id, snap.player)}
              />
            ))}
          </section>
        )}
      </div>
      {speeds.length > 1 && (
        <div class="lmn-panel__footer">
          <span class="lmn-panel__heading">{strings.player.speed}</span>
          <div class="lmn-panel__speeds" role="group" aria-label={strings.player.speed}>
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
  onClose,
}: {
  manager: PlaybackManager;
  snap: PlayerSnapshot;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(ref, onClose);
  const offset = snap.subtitleOffset;
  const nudge = (delta: number): void =>
    manager.setSubtitleOffset?.(Math.round(((offset ?? 0) + delta) * 10) / 10, snap.player);

  return (
    <div ref={ref} class="lmn-panel lmn-panel--tracks" role="menu" aria-label={strings.player.audioSubtitles}>
      <div class="lmn-panel__columns">
        <section class="lmn-panel__column">
          <h2 class="lmn-panel__heading">{strings.player.audio}</h2>
          {snap.audioTracks.length > 0 ? (
            snap.audioTracks.map((t) => (
              <Option
                key={t.Index}
                selected={snap.audioIndex === t.Index}
                {...trackParts(t)}
                onSelect={() => manager.setAudioStreamIndex(t.Index, snap.player)}
              />
            ))
          ) : (
            <p class="lmn-panel__empty">{strings.player.noAudio}</p>
          )}
        </section>
        <section class="lmn-panel__column">
          <h2 class="lmn-panel__heading">{strings.player.subtitles}</h2>
          <Option
            selected={snap.subtitleIndex === -1}
            label={strings.player.off}
            onSelect={() => manager.setSubtitleStreamIndex(-1, snap.player)}
          />
          {snap.subtitleTracks.length > 0 ? (
            snap.subtitleTracks.map((t) => (
              <Option
                key={t.Index}
                selected={snap.subtitleIndex === t.Index}
                {...trackParts(t)}
                onSelect={() => manager.setSubtitleStreamIndex(t.Index, snap.player)}
              />
            ))
          ) : (
            <p class="lmn-panel__empty">{strings.player.noSubtitles}</p>
          )}
        </section>
      </div>
      {offset !== null && snap.subtitleIndex !== -1 && (
        <div class="lmn-panel__footer">
          <span class="lmn-panel__heading">{strings.player.subtitleTiming}</span>
          <div class="lmn-panel__stepper">
            <button
              type="button"
              class="lmn-panel__speed"
              aria-label={strings.player.earlier}
              onClick={() => nudge(-0.1)}
            >
              −0.1s
            </button>
            <span class="lmn-panel__offset">{`${offset > 0 ? '+' : ''}${offset.toFixed(1)}s`}</span>
            <button
              type="button"
              class="lmn-panel__speed"
              aria-label={strings.player.later}
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
