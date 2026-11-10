import type { RefObject } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { TranscodingInfo } from '../../api/types';
import type { MediaStreamInfo, PlaybackManager, RepeatMode } from '../../compat/playbackManager';
import { type MenuEntry, openContextMenu } from '../../components/ContextMenu';
import { Icon } from '../../components/icons';
import { showToast } from '../../components/Toast';
import { findOwnSession } from '../../playback/play';
import { strings } from '../../strings';
import { formatTime } from '../../util/locale';
import type { ViewContext } from '../context';
import { openWatchTogether } from '../syncplay/WatchTogether';
import { othersInGroup, type SyncPlayState } from '../syncplay/syncPlayState';
import type { PlayerSnapshot } from './playerState';

/* ---- Ends at ------------------------------------------------------------------------------------------------- */

/** "Ends at 10:42 PM": the remaining time at the current speed, from now. Null without a duration. */
export function endsAt(
  snap: Pick<PlayerSnapshot, 'positionMs' | 'durationMs' | 'rate'>,
  now = Date.now(),
): string | null {
  if (!snap.durationMs) return null;
  const remaining = Math.max(0, snap.durationMs - snap.positionMs) / (snap.rate > 0 ? snap.rate : 1);
  const time = formatTime(new Date(now + remaining), { hour: 'numeric', minute: '2-digit' });
  return strings.player.endsAt(time);
}

/* ---- Settings (gear) panel: Repeat and Playback info ----------------------------------------------------------- */

/** Movies repeat themselves; episodes can repeat or loop the queue. */
export function repeatOptions(isEpisode: boolean): { mode: RepeatMode; label: string }[] {
  return isEpisode
    ? [
        { mode: 'RepeatNone', label: strings.player.off },
        { mode: 'RepeatOne', label: strings.player.repeatEpisode },
        { mode: 'RepeatAll', label: strings.player.repeatAll },
      ]
    : [
        { mode: 'RepeatNone', label: strings.player.off },
        { mode: 'RepeatOne', label: strings.player.repeatOn },
      ];
}

export function SettingsPanel({
  ctx,
  syncPlay,
  manager,
  snap,
  isEpisode,
  info,
  onInfo,
  pill,
  onClose,
}: {
  ctx: ViewContext;
  syncPlay: SyncPlayState;
  manager: PlaybackManager;
  snap: PlayerSnapshot;
  isEpisode: boolean;
  info: boolean;
  onInfo: (on: boolean) => void;
  /** The settings pill that opened the panel. */
  pill: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // An entry that closes the panel unmounts with focus on it: give focus back to the pill first, so a remote isn't
  // left on nothing.
  const closeToPill = (): void => {
    pill.current?.focus();
    onClose();
  };
  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      const pills = ref.current?.parentElement;
      if (pills && !pills.contains(e.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, []);
  return (
    <div ref={ref} class="lmn-panel lmn-panel--settings" role="menu" aria-label={strings.player.settings}>
      {snap.repeatMode !== null && manager.setRepeatMode && (
        <section class="lmn-panel__column">
          <h2 class="lmn-panel__heading">{strings.player.repeat}</h2>
          <div class="lmn-panel__speeds" role="group" aria-label={strings.player.repeat}>
            {repeatOptions(isEpisode).map((o) => {
              // A movie set to repeat the queue reads as "Repeat" too.
              const selected =
                o.mode === snap.repeatMode ||
                (!isEpisode && o.mode === 'RepeatOne' && snap.repeatMode === 'RepeatAll');
              return (
                <button
                  key={o.mode}
                  type="button"
                  class={`lmn-panel__speed${selected ? ' is-selected' : ''}`}
                  aria-pressed={selected}
                  onClick={() => manager.setRepeatMode!(o.mode, snap.player)}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </section>
      )}
      <div class="lmn-panel__rows">
        {syncPlay.available && (
          <button
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            class={`lmn-panel__option lmn-panel__toggle${syncPlay.group ? ' is-selected' : ''}`}
            onClick={(e) => {
              const from = e.currentTarget.closest('.lmn-player__pills') as HTMLElement | null;
              // Opens under the pills; its menu takes focus once it's up and hands it back to the settings pill.
              void openWatchTogether(ctx, syncPlay, from ?? e.currentTarget, pill.current);
              closeToPill();
            }}
          >
            <Icon name="group" size={18} />
            <span class="lmn-panel__option-label">{strings.watchTogether}</span>
            {syncPlay.group && (
              <span class="lmn-panel__option-detail">
                {othersInGroup(syncPlay).length > 0
                  ? othersInGroup(syncPlay).join(', ')
                  : syncPlay.group.GroupName}
              </span>
            )}
          </button>
        )}
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={info}
          class={`lmn-panel__option lmn-panel__toggle${info ? ' is-selected' : ''}`}
          onClick={() => {
            onInfo(!info);
            closeToPill();
          }}
        >
          <Icon name="info" size={18} />
          <span class="lmn-panel__option-label">
            {info ? strings.player.hidePlaybackInfo : strings.player.playbackInfo}
          </span>
        </button>
      </div>
    </div>
  );
}

/* ---- Playback info card ------------------------------------------------------------------------------------- */

const INFO_POLL_MS = 2000;

const mbps = (bps?: number): string | null => (bps ? `${(bps / 1_000_000).toFixed(1)} Mbps` : null);
const upper = (s?: string): string | null => (s ? s.toUpperCase() : null);

/** "VideoCodecNotSupported" → "video codec not supported". */
export function reasonText(reason: string): string {
  return reason.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

function channels(n?: number): string | null {
  if (!n) return null;
  return n === 1 ? 'mono' : n === 2 ? 'stereo' : n === 6 ? '5.1' : n === 8 ? '7.1' : `${n} ch`;
}

const join = (...parts: (string | null | undefined)[]): string => parts.filter(Boolean).join(' · ');

export interface InfoRow {
  label: string;
  value: string;
}

/** What Playback info shows: the source as it is and, when transcoding, what the server makes of it. */
export function playbackInfoRows(
  snap: Pick<PlayerSnapshot, 'playMethod' | 'mediaSource'>,
  transcode: TranscodingInfo | null,
): InfoRow[] {
  const streams = snap.mediaSource?.MediaStreams ?? [];
  const video: MediaStreamInfo | undefined = streams.find((s) => s.Type === 'Video');
  const audio: MediaStreamInfo | undefined = streams.find((s) => s.Type === 'Audio');
  const method =
    snap.playMethod === 'Transcode'
      ? strings.player.transcoding
      : snap.playMethod === 'DirectStream'
        ? strings.player.directStream
        : strings.player.directPlay;
  const transcoding = snap.playMethod === 'Transcode' && transcode;
  const rows: InfoRow[] = [
    {
      label: strings.player.infoPlayback,
      value: join(method, transcoding ? transcode.HardwareAccelerationType : null),
    },
  ];
  if (transcoding && transcode.TranscodeReasons?.length)
    rows.push({
      label: strings.player.infoReason,
      value: transcode.TranscodeReasons.map(reasonText).join(', '),
    });

  const sourceVideo = video
    ? join(upper(video.Codec), video.Height ? `${video.Height}p` : null, video.VideoRangeType)
    : '';
  const outVideo =
    transcoding && !transcode.IsVideoDirect
      ? join(upper(transcode.VideoCodec), transcode.Height ? `${transcode.Height}p` : null)
      : '';
  if (sourceVideo)
    rows.push({
      label: strings.player.infoVideo,
      value: outVideo ? `${sourceVideo} → ${outVideo}` : sourceVideo,
    });

  const sourceAudio = audio ? join(upper(audio.Codec), channels(audio.Channels), audio.Language) : '';
  const outAudio =
    transcoding && !transcode.IsAudioDirect
      ? join(upper(transcode.AudioCodec), channels(transcode.AudioChannels))
      : '';
  if (sourceAudio)
    rows.push({
      label: strings.player.infoAudio,
      value: outAudio ? `${sourceAudio} → ${outAudio}` : sourceAudio,
    });

  const container = upper(snap.mediaSource?.Container);
  const outContainer = transcoding ? upper(transcode.Container) : null;
  if (container)
    rows.push({
      label: strings.player.infoContainer,
      value: outContainer && outContainer !== container ? `${container} → ${outContainer}` : container,
    });

  const bitrate = mbps(snap.mediaSource?.Bitrate);
  const outBitrate = transcoding ? mbps(transcode.Bitrate) : null;
  if (bitrate || outBitrate)
    rows.push({
      label: strings.player.infoBitrate,
      value: outBitrate && bitrate ? `${bitrate} → ${outBitrate}` : (outBitrate ?? bitrate)!,
    });

  // How fast the server encodes, against the video's own frame rate: under 1× means playback will keep stalling.
  if (transcoding && transcode.Framerate) {
    const source = video?.RealFrameRate || video?.AverageFrameRate;
    const speed = source ? ` (${(transcode.Framerate / source).toFixed(1)}×)` : '';
    rows.push({
      label: strings.player.infoEncoding,
      value: `${Math.round(transcode.Framerate)} fps${speed}`,
    });
  }
  return rows;
}

export function PlaybackInfoCard({
  ctx,
  snap,
  onClose,
}: {
  ctx: ViewContext;
  snap: PlayerSnapshot;
  onClose: () => void;
}) {
  const [transcode, setTranscode] = useState<TranscodingInfo | null>(null);
  const transcoding = snap.playMethod === 'Transcode';
  useEffect(() => {
    if (!transcoding) return setTranscode(null);
    let stopped = false;
    const read = (): void =>
      void findOwnSession(ctx.api, ctx.client)
        .then((s) => !stopped && setTranscode(s?.TranscodingInfo ?? null))
        .catch(() => undefined);
    read();
    const timer = setInterval(read, INFO_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [transcoding, snap.mediaSourceId]);

  return (
    <aside class="lmn-player-info" aria-label={strings.player.playbackInfo}>
      <header class="lmn-player-info__header">
        <h2>{strings.player.playbackInfo}</h2>
        <button
          type="button"
          class="lmn-player__icon"
          aria-label={strings.player.hidePlaybackInfo}
          onClick={onClose}
        >
          <Icon name="close" size={18} />
        </button>
      </header>
      <dl>
        {playbackInfoRows(snap, transcode).map((r) => (
          <div key={r.label} class="lmn-player-info__row">
            <dt>{r.label}</dt>
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

/* ---- Cast ----------------------------------------------------------------------------------------------------- */

/** Whether anything other than this browser can play (cast devices, other Jellyfin apps). Checked once per item. */
export function useCastAvailable(manager: PlaybackManager | null, itemId: string | undefined): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (!manager?.getTargets || !manager.trySetActivePlayer || !manager.play) return;
    let cancelled = false;
    manager
      .getTargets()
      .then((targets) => !cancelled && setAvailable(targets.some((t) => !t.isLocalPlayer)))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [itemId]);
  return available;
}

const PAIR_WAIT_MS = 10_000;
const PAIR_POLL_MS = 200;

/**
 * Moves what's playing to another device: jellyfin-web's own picker only switches which player it controls. Stops
 * here, pairs with the target, then starts the same item there from the same position.
 */
async function castTo(
  ctx: ViewContext,
  manager: PlaybackManager,
  snap: PlayerSnapshot,
  target: Parameters<NonNullable<PlaybackManager['trySetActivePlayer']>>[1],
): Promise<void> {
  const itemId = snap.item?.Id;
  if (!itemId) return;
  const startPositionTicks = Math.round(snap.positionMs * 10_000);
  manager.stop?.(snap.player);
  manager.trySetActivePlayer!(target.playerName, target);
  const started = Date.now();
  while (manager.getCurrentPlayer()?.isLocalPlayer !== false) {
    if (Date.now() - started > PAIR_WAIT_MS) return showToast(strings.player.castFailed);
    await new Promise((r) => setTimeout(r, PAIR_POLL_MS));
  }
  try {
    await manager.play!({
      ids: [itemId],
      startPositionTicks,
      serverId: ctx.client.serverId?.() ?? undefined,
    });
    showToast(strings.player.castingTo(target.name));
  } catch {
    showToast(strings.player.castFailed);
  }
}

export async function openCastMenu(
  ctx: ViewContext,
  manager: PlaybackManager,
  snap: PlayerSnapshot,
  from: HTMLElement,
): Promise<void> {
  const targets = (await manager.getTargets?.().catch(() => [])) ?? [];
  const remote = targets.filter((t) => !t.isLocalPlayer);
  if (remote.length === 0) return showToast(strings.player.noCastTargets);
  const rect = from.getBoundingClientRect();
  const entries: MenuEntry[] = remote.map((t) => ({
    label: t.name,
    detail: t.appName && t.appName !== t.name ? t.appName : undefined,
    icon: 'cast',
    onSelect: () => void castTo(ctx, manager, snap, t),
  }));
  openContextMenu({
    x: rect.left,
    y: rect.top - 8,
    returnFocus: from,
    label: strings.player.cast,
    title: strings.player.castTo,
    entries,
  });
}

/* ---- Loading and buffering -------------------------------------------------------------------------------------- */

/** Only show the buffering spinner for stalls a person would notice. */
const BUFFER_DELAY_MS = 500;

/**
 * Whether the video has started (until then the player shows its loading screen) and whether it's stalled. Events
 * from jellyfin-web's <video> don't bubble, so listen in the capture phase.
 */
/**
 * jellyfin-web can start the video before it switches to the player page (a fast server: the first frame lands while
 * the details page is still up), so the player opens after the 'playing' event. Check the video as it is.
 */
function alreadyPlaying(): boolean {
  const video = document.querySelector<HTMLVideoElement>('video.htmlvideoplayer');
  return !!video && !video.paused && video.readyState >= 3;
}

export function usePlaybackProgress(): { started: boolean; buffering: boolean } {
  const [started, setStarted] = useState(alreadyPlaying);
  const [buffering, setBuffering] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const isVideo = (e: Event): e is Event & { target: HTMLVideoElement } =>
      e.target instanceof HTMLVideoElement;
    const onPlaying = (e: Event): void => {
      if (!isVideo(e)) return;
      clearTimeout(timer.current);
      setBuffering(false);
      if (!e.target.paused) setStarted(true);
    };
    const onTime = (e: Event): void => {
      if (!isVideo(e) || e.target.paused || e.target.readyState < 3) return;
      clearTimeout(timer.current);
      setBuffering(false);
      setStarted(true);
    };
    const onWaiting = (e: Event): void => {
      if (!isVideo(e)) return;
      clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setBuffering(true), BUFFER_DELAY_MS);
    };
    const onStop = (e: Event): void => {
      if (!isVideo(e)) return;
      clearTimeout(timer.current);
      setBuffering(false);
    };
    const listeners: [string, (e: Event) => void][] = [
      ['playing', onPlaying],
      ['timeupdate', onTime],
      ['waiting', onWaiting],
      ['pause', onStop],
      ['error', onStop],
    ];
    listeners.forEach(([type, fn]) => document.addEventListener(type, fn, true));
    return () => {
      clearTimeout(timer.current);
      listeners.forEach(([type, fn]) => document.removeEventListener(type, fn, true));
    };
  }, []);
  return { started, buffering };
}
