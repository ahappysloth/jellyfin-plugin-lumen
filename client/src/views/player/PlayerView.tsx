import { SwitchOverlay, useStreamSwitch } from './streamSwitch';
import { useTrickplay } from './trickplay';
import { othersInGroup, useSyncPlayState } from '../syncplay/syncPlayState';
import { useEffect, useRef, useState } from 'preact/hooks';
import { getPlaybackManager, type PlaybackManager, type Player } from '../../compat/playbackManager';
import { Icon } from '../../components/icons';
import { strings } from '../../strings';
import type { ViewContext } from '../context';
import { formatRuntime } from '../details/badges';
import { AudioSubtitlesPanel, QualityPanel, qualityLabel } from './PlayerPanels';
import { ProgressBar } from './ProgressBar';
import { SkipIcon } from './SkipIcon';
import { setUserData, useUserData } from '../userDataStore';
import { clearStarting, useStarting } from '../../playback/starting';
import {
  endsAt,
  LoadingScreen,
  openCastMenu,
  PlaybackInfoCard,
  SettingsPanel,
  useCastAvailable,
  usePlaybackProgress,
} from './PlayerExtras';
import { readPlayerState, type PlayerSnapshot } from './playerState';

/** How often the controls re-read jellyfin-web's player (cheap: it reads cached state). */
const POLL_MS = 250;
/** Controls fade out after this long without input while playing. */
const IDLE_MS = 3000;
/** How long the volume pill stays after the last change. */
const PILL_MS = 1200;

type Panel = 'quality' | 'tracks' | 'settings' | null;

/**
 * Lumen's controls over jellyfin-web's video player. Playback, subtitles rendering, keyboard shortcuts and the
 * skip-intro / up-next prompts stay jellyfin-web's; this draws the overlay and drives jellyfin-web's playback manager.
 * Without a playback manager or a local player it hands the page back (stock controls).
 */
export function PlayerView({ ctx }: { ctx: ViewContext }) {
  const pm = useRef<PlaybackManager | null>(getPlaybackManager());
  const syncPlay = useSyncPlayState(ctx);
  const [snap, setSnap] = useState<PlayerSnapshot | null>(null);
  const [visible, setVisible] = useState(true);
  const [panel, setPanel] = useState<Panel>(null);
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement);
  const idleTimer = useRef<number | undefined>(undefined);
  const missing = useRef(0);

  // Poll the player. Give it a moment to appear; if it never does, fall back to the stock controls. Without a playback
  // manager there's nothing to wait for (the takeover normally checks before mounting: takeover.ts playerCheck).
  useEffect(() => {
    if (!pm.current) {
      ctx.onFallback();
      return;
    }
    const read = (): void => {
      const manager = pm.current;
      const player = manager?.getCurrentPlayer();
      if (!manager || !player) {
        missing.current += 1;
        if (missing.current * POLL_MS > 4000) ctx.onFallback();
        return;
      }
      missing.current = 0;
      setSnap(readPlayerState(manager, player));
    };
    read();
    const timer = setInterval(read, POLL_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const onChange = (): void => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const itemId = snap?.item?.Id;

  // Is there an episode after this one in the play queue? (Read once per item; the queue is a promise.)
  const [hasNext, setHasNext] = useState(false);
  useEffect(() => {
    const manager = pm.current;
    if (!manager || !snap) return;
    let cancelled = false;
    manager
      .getPlaylist(snap.player)
      .then(
        (list) => !cancelled && setHasNext(snap.playlistIndex >= 0 && snap.playlistIndex < list.length - 1),
      )
      .catch(() => !cancelled && setHasNext(false));
    return () => {
      cancelled = true;
    };
  }, [itemId, snap?.playlistIndex]);

  // Show on any input; hide after a pause while playing with no menu open.
  const wake = (): void => {
    setVisible(true);
    clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setVisible(false), IDLE_MS);
  };
  useEffect(() => {
    wake();
    // Not the wheel: jellyfin-web turns it into volume changes, which get the volume pill instead.
    const events = ['pointermove', 'pointerdown', 'keydown'] as const;
    events.forEach((e) => document.addEventListener(e, wake, { passive: true }));
    return () => {
      clearTimeout(idleTimer.current);
      events.forEach((e) => document.removeEventListener(e, wake));
    };
  }, []);

  // A volume change (jellyfin-web's wheel and keyboard shortcuts, or Lumen's mute) shows the volume pill, not the
  // controls. <video> volume events don't bubble, so listen in the capture phase. The first reading is only the
  // starting point: jellyfin-web sets the volume as playback starts.
  const [volume, setVolume] = useState<{ level: number; muted: boolean; shownAt: number } | null>(null);
  const lastVolume = useRef<{ level: number; muted: boolean } | null>(null);
  const pillTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const onVolume = (): void => {
      const manager = pm.current;
      const player = manager?.getCurrentPlayer();
      if (!manager || !player) return;
      let next: { level: number; muted: boolean };
      try {
        next = { level: Math.round(manager.getVolume(player)), muted: manager.isMuted(player) };
      } catch {
        return;
      }
      const prev = lastVolume.current;
      lastVolume.current = next;
      if (!prev || (prev.level === next.level && prev.muted === next.muted)) return;
      setVolume({ ...next, shownAt: Date.now() });
      clearTimeout(pillTimer.current);
      pillTimer.current = window.setTimeout(() => setVolume((v) => (v ? { ...v, shownAt: 0 } : v)), PILL_MS);
    };
    document.addEventListener('volumechange', onVolume, true);
    return () => {
      document.removeEventListener('volumechange', onVolume, true);
      clearTimeout(pillTimer.current);
    };
  }, []);
  // Seed the starting point from the first snapshot too (a player may not fire volumechange as it starts).
  if (snap && !lastVolume.current) lastVolume.current = { level: Math.round(snap.volume), muted: snap.muted };

  const preview = useTrickplay(ctx.api, ctx.client, snap?.item?.Id, snap?.mediaSourceId);
  const switching = useStreamSwitch();
  const progress = usePlaybackProgress();
  const starting = useStarting();
  // The loading screen that began at the Play click ends with the first frame (or when the player closes).
  useEffect(() => {
    if (progress.started) clearStarting();
  }, [progress.started]);
  useEffect(() => clearStarting, []);
  const [info, setInfo] = useState(false);
  const castAvailable = useCastAvailable(pm.current, itemId);

  // Until the first frame: the title's backdrop and a spinner, not a black screen.
  if (!snap || !pm.current)
    return pm.current ? <LoadingScreen ctx={ctx} snap={null} starting={starting} /> : null;
  const manager = pm.current;
  const player: Player = snap.player;
  const shown = visible || snap.paused || panel !== null;
  const act = (fn: () => void) => (): void => {
    try {
      fn();
    } catch {
      // a player that doesn't support it: nothing to do
    }
  };

  const item = snap.item;
  const isEpisode = item?.Type === 'Episode';
  const title = (isEpisode ? item?.SeriesName : item?.Name) ?? '';
  const subtitle = isEpisode
    ? `S${item?.ParentIndexNumber ?? 0}:E${item?.IndexNumber ?? 0} · ${item?.Name ?? ''}`
    : [item?.ProductionYear?.toString(), formatRuntime(item?.RunTimeTicks)].filter(Boolean).join(' · ');

  return (
    <div
      class={`lmn-osd${shown ? '' : ' is-idle'}${panel ? ' has-panel' : ''}${progress.started ? '' : ' is-loading'}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && panel) {
          e.stopPropagation();
          setPanel(null);
        }
      }}
    >
      {!progress.started && <LoadingScreen ctx={ctx} snap={snap} starting={starting} />}
      {progress.started && progress.buffering && !switching.state?.shown && (
        <div class="lmn-player-buffering" role="status" aria-label={strings.player.buffering}>
          <span class="lmn-spinner" aria-hidden="true" />
        </div>
      )}
      {info && <PlaybackInfoCard ctx={ctx} snap={snap} onClose={() => setInfo(false)} />}
      <VolumePill volume={volume} />
      <SwitchOverlay state={switching.state} />
      {/* Clicking the picture toggles play (closes a menu first); double-click toggles full screen. */}
      <div
        class="lmn-player__surface"
        onClick={(e) => {
          if (panel) return setPanel(null);
          if ((e as unknown as PointerEvent).pointerType === 'touch' && !visible) return; // first tap just shows the controls
          act(() => manager.playPause(player))();
        }}
        onDblClick={act(() => manager.toggleFullscreen(player))}
      />

      <header class="lmn-player__top">
        <button
          type="button"
          class="lmn-player__icon lmn-player__back"
          aria-label={strings.player.back}
          onClick={() => window.history.back()}
        >
          <Icon name="arrowLeft" size={26} />
        </button>
        <div class="lmn-player__titles">
          <h1 class="lmn-player__title">{title}</h1>
          {subtitle && <p class="lmn-player__subtitle">{subtitle}</p>}
          {syncPlay.group && (
            <p class="lmn-player__syncplay">
              <Icon name="group" size={16} />
              {othersInGroup(syncPlay).length > 0
                ? strings.watchingWith(othersInGroup(syncPlay))
                : strings.inGroup(syncPlay.group.GroupName)}
            </p>
          )}
        </div>
        <div class="lmn-player__pills">
          <button
            type="button"
            class={`lmn-player__pill${panel === 'quality' ? ' is-open' : ''}`}
            aria-expanded={panel === 'quality'}
            onClick={() => setPanel(panel === 'quality' ? null : 'quality')}
          >
            <Icon name="quality" size={20} />
            <span class="lmn-player__pill-label">{strings.player.quality}</span>
            <span class="lmn-player__pill-value">{qualityLabel(snap)}</span>
          </button>
          <button
            type="button"
            class={`lmn-player__pill${panel === 'tracks' ? ' is-open' : ''}`}
            aria-expanded={panel === 'tracks'}
            onClick={() => setPanel(panel === 'tracks' ? null : 'tracks')}
          >
            <Icon name="closedCaption" size={20} />
            <span class="lmn-player__pill-label">{strings.player.audioSubtitles}</span>
          </button>
          <button
            type="button"
            class={`lmn-player__pill lmn-player__pill--icon${panel === 'settings' ? ' is-open' : ''}`}
            aria-label={strings.player.settings}
            aria-expanded={panel === 'settings'}
            onClick={() => setPanel(panel === 'settings' ? null : 'settings')}
          >
            <Icon name="settings" size={20} />
          </button>
          {panel === 'quality' && (
            <QualityPanel
              manager={manager}
              snap={snap}
              onClose={() => setPanel(null)}
              onSwitch={switching.begin}
            />
          )}
          {panel === 'settings' && (
            <SettingsPanel
              ctx={ctx}
              syncPlay={syncPlay}
              manager={manager}
              snap={snap}
              isEpisode={isEpisode}
              info={info}
              onInfo={setInfo}
              onClose={() => setPanel(null)}
            />
          )}
          {panel === 'tracks' && (
            <AudioSubtitlesPanel
              manager={manager}
              snap={snap}
              onClose={() => setPanel(null)}
              onSwitch={switching.begin}
            />
          )}
        </div>
      </header>

      <footer class="lmn-player__bottom">
        <div class="lmn-player__times">
          <p class="lmn-player__time">
            {`${formatClock(snap.positionMs, snap.durationMs)} / ${formatClock(snap.durationMs, snap.durationMs)}`}
          </p>
          <p class="lmn-player__ends">{endsAt(snap)}</p>
        </div>
        <ProgressBar
          positionMs={snap.positionMs}
          durationMs={snap.durationMs}
          bufferedMs={snap.bufferedMs}
          disabled={!snap.canSeek}
          onSeek={(ms) => act(() => manager.seek(Math.round(ms * 10_000), player))()}
          preview={preview}
        />
        <div class="lmn-player__controls">
          <div class="lmn-player__group">
            <button
              type="button"
              class="lmn-player__icon"
              aria-label={snap.paused ? strings.player.play : strings.player.pause}
              onClick={act(() => manager.playPause(player))}
            >
              <Icon name={snap.paused ? 'play' : 'pause'} size={28} />
            </button>
            <button
              type="button"
              class="lmn-player__icon"
              aria-label={strings.player.rewind}
              onClick={act(() => manager.rewind(player))}
            >
              <SkipIcon direction="back" />
            </button>
            <button
              type="button"
              class="lmn-player__icon"
              aria-label={strings.player.forward}
              onClick={act(() => manager.fastForward(player))}
            >
              <SkipIcon direction="forward" />
            </button>
            <Volume manager={manager} snap={snap} />
          </div>
          <div class="lmn-player__group">
            {hasNext && (
              <button
                type="button"
                class="lmn-player__icon lmn-player__next"
                aria-label={strings.player.nextEpisode}
                title={strings.player.nextEpisode}
                onClick={act(() => manager.nextTrack(player))}
              >
                <Icon name="skipNext" size={24} />
                <span class="lmn-player__next-label">{strings.player.nextEpisode}</span>
              </button>
            )}
            {item && <FavoriteButton ctx={ctx} item={item} />}
            {manager.togglePictureInPicture && document.pictureInPictureEnabled && (
              <button
                type="button"
                class="lmn-player__icon"
                aria-label={strings.player.pip}
                title={strings.player.pip}
                onClick={act(() => manager.togglePictureInPicture?.(player))}
              >
                <Icon name="pip" size={22} />
              </button>
            )}
            {manager.toggleAirPlay && 'WebKitPlaybackTargetAvailabilityEvent' in window && (
              <button
                type="button"
                class="lmn-player__icon"
                aria-label={strings.player.airplay}
                title={strings.player.airplay}
                onClick={act(() => manager.toggleAirPlay?.(player))}
              >
                <Icon name="airplay" size={22} />
              </button>
            )}
            {castAvailable && (
              <button
                type="button"
                class="lmn-player__icon"
                aria-label={strings.player.cast}
                title={strings.player.cast}
                onClick={(e) => void openCastMenu(ctx, manager, snap, e.currentTarget)}
              >
                <Icon name="cast" size={22} />
              </button>
            )}
            <button
              type="button"
              class="lmn-player__icon"
              aria-label={fullscreen ? strings.player.exitFullscreen : strings.player.fullscreen}
              onClick={act(() => manager.toggleFullscreen(player))}
            >
              <Icon name={fullscreen ? 'fullscreenExit' : 'fullscreen'} size={24} />
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Volume({ manager, snap }: { manager: PlaybackManager; snap: PlayerSnapshot }) {
  const level = snap.muted ? 0 : snap.volume;
  return (
    <div class="lmn-player__volume">
      <button
        type="button"
        class="lmn-player__icon"
        aria-label={snap.muted ? strings.player.unmute : strings.player.mute}
        onClick={() => manager.toggleMute(snap.player)}
      >
        <Icon name={level === 0 ? 'volumeOff' : 'volumeOn'} size={24} />
      </button>
      <input
        class="lmn-player__volume-slider"
        type="range"
        min={0}
        max={100}
        step={1}
        value={level}
        aria-label={strings.player.volume}
        style={{ '--lmn-fill': `${level}%` }}
        onInput={(e) => {
          const value = Number(e.currentTarget.value);
          if (snap.muted && value > 0) manager.toggleMute(snap.player);
          manager.setVolume(value, snap.player);
        }}
      />
    </div>
  );
}

/** "0:03" or "1:02:03"; padded to match the total's shape so the readout doesn't jump. */
export function formatClock(ms: number, totalMs: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  if (totalMs >= 3_600_000) return `${h}:${String(m).padStart(2, '0')}:${sec}`;
  return `${m}:${sec}`;
}

/** The playing item's favorite toggle, shared with the details page and card menus (userDataStore). */
function FavoriteButton({ ctx, item }: { ctx: ViewContext; item: NonNullable<PlayerSnapshot['item']> }) {
  const asItem = { Id: item.Id, Name: item.Name ?? '', Type: item.Type ?? '', UserData: item.UserData };
  const favorite = useUserData(asItem, 'IsFavorite');
  return (
    <button
      type="button"
      class={`lmn-player__icon${favorite ? ' is-on' : ''}`}
      aria-label={strings.player.favorite}
      aria-pressed={favorite}
      title={strings.player.favorite}
      onClick={() => void setUserData(ctx, asItem, 'IsFavorite', !favorite)}
    >
      <Icon name={favorite ? 'heart' : 'heartOutline'} size={22} />
    </button>
  );
}

/** The volume, dropped down from the top centre for a moment after it changes. */
function VolumePill({ volume }: { volume: { level: number; muted: boolean; shownAt: number } | null }) {
  const level = volume?.muted ? 0 : (volume?.level ?? 0);
  return (
    <div
      class={`lmn-volume-pill${volume && volume.shownAt ? ' is-shown' : ''}`}
      role="status"
      aria-label={strings.player.volume}
      aria-live="polite"
    >
      <Icon name={volume?.muted || level === 0 ? 'volumeOff' : 'volumeOn'} size={18} />
      <span class="lmn-volume-pill__track" aria-hidden="true">
        <span class="lmn-volume-pill__fill" style={{ width: `${level}%` }} />
      </span>
      <span class="lmn-volume-pill__value">{volume?.muted ? strings.player.muted : `${level}%`}</span>
    </div>
  );
}
