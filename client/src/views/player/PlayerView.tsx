import { SwitchOverlay, useStreamSwitch } from './streamSwitch';
import { useTrickplay } from './trickplay';
import { LoadingScreen } from './LoadingScreen';
import { othersInGroup, useSyncPlayState } from '../syncplay/syncPlayState';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { HOME_HASH, isBackKey, isRemoteBack } from '../../compat/jellyfin';
import { IGNORED_KEY_CODE } from '../../compat/registry';
import { getPlaybackManager, type PlaybackManager, type Player } from '../../compat/playbackManager';
import { Icon } from '../../components/icons';
import { strings } from '../../strings';
import type { ViewContext } from '../context';
import { formatRuntime } from '../details/badges';
import { AudioSubtitlesPanel, QualityPanel, qualityLabel } from './PlayerPanels';
import { ARRIVED_MS, PENDING_MAX_MS, ProgressBar } from './ProgressBar';
import { SkipIcon } from './SkipIcon';
import { setUserData, useUserData } from '../userDataStore';
import { clearStarting, useStarting } from '../../playback/starting';
import {
  endsAt,
  openCastMenu,
  PlaybackInfoCard,
  SettingsPanel,
  useCastAvailable,
  usePlaybackProgress,
} from './PlayerExtras';
import { readPlayerState, readPosition, readVolume, snapshotKey, type PlayerSnapshot } from './playerState';
import { PLAYER_ICONS } from './playerIcons';
import { playerStrings } from './playerStrings';
import { lockLandscape, unlockOrientation } from './orientation';
import { isTouchLike, type LastTap, surfaceTap } from './touch';
import { SKIP_KEYS, skipTarget } from './skip';
import { LazySegments } from './lazySegments';
import { throttle, volumeIcon } from './volume';

/**
 * How often the controls re-read jellyfin-web's player (cheap: it reads cached state). They only redraw when what
 * they show changed, and not at all in a background tab.
 */
const POLL_MS = 250;
/** Controls fade out after this long without input while playing. */
const IDLE_MS = 3000;
/** How long the volume pill stays after the last change. */
const PILL_MS = 1200;
/** How long after a press is lifted its click may arrive and still be counted as that press's (see `press`). */
const PRESS_MS = 1000;
/** How long "−10 s" stays on screen after a double tap skips. */
const SKIPPED_MS = 700;
/** A held arrow key skips at most this often (outside Watch together, where it skips once). */
const REPEAT_MS = 250;

type Panel = 'quality' | 'tracks' | 'settings' | null;

/**
 * Lumen's controls over jellyfin-web's video player. Playback, subtitles rendering and keyboard shortcuts stay
 * jellyfin-web's; this draws the overlay and drives jellyfin-web's playback manager. The Skip Intro button and the
 * next-episode card are Lumen's too, from a file of their own (lazySegments.tsx): jellyfin-web's prompts show only
 * where that can't draw them. Without a playback manager or a local player it hands the page back (stock controls).
 */
export function PlayerView({ ctx }: { ctx: ViewContext }) {
  const pm = useRef<PlaybackManager | null>(getPlaybackManager());
  const syncPlay = useSyncPlayState(ctx);
  const inGroup = useRef(false);
  inGroup.current = !!syncPlay.group;
  const [snap, setSnap] = useState<PlayerSnapshot | null>(null);
  const [visible, setVisible] = useState(true);
  /**
   * A tap put the controls away (while paused, they otherwise stay up). Any input brings them back, and so does a
   * pause from elsewhere (below).
   */
  const [tapHidden, setTapHidden] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement);
  const idleTimer = useRef<number | undefined>(undefined);
  const missing = useRef(0);
  /** Whether the position is on screen (controls, a panel or Playback info up), read by the poll below. */
  const positionShown = useRef(true);
  /** Until when a seek may still be on its way: the seek bar needs the position to see it arrive, even when hidden. */
  const seekingUntil = useRef(0);
  /**
   * Where the last skip (or other seek) went, while it may still be on its way: quick presses add up from it (as the
   * seek bar's steps do).
   */
  const lastSkip = useRef<{ ms: number; at: number } | null>(null);
  const readNow = useRef<() => void>(() => undefined);

  // Poll the player. Give it a moment to appear; if it never does, fall back to the stock controls. Without a playback
  // manager there's nothing to wait for (the takeover normally checks before mounting: takeover.ts playerCheck).
  useEffect(() => {
    if (!pm.current) {
      ctx.onFallback();
      return;
    }
    let last: { player: Player; key: string } | null = null;
    let itemId: string | undefined;
    const read = (): void => {
      if (document.hidden) return;
      const manager = pm.current;
      const player = manager?.getCurrentPlayer();
      if (!manager || !player) {
        missing.current += 1;
        if (missing.current * POLL_MS > 4000) ctx.onFallback();
        return;
      }
      missing.current = 0;
      const next = readPlayerState(manager, player);
      // The skip arrived: the next one goes on from the video, as it plays on (the seek bar lets go the same way). Or
      // the next episode began: where the last one's skip went says nothing about this one.
      if (
        lastSkip.current &&
        (Math.abs(next.positionMs - lastSkip.current.ms) < ARRIVED_MS || itemId !== next.item?.Id)
      )
        lastSkip.current = null;
      itemId = next.item?.Id;
      // And "Ends at", which moves on with the clock while paused.
      const withPosition = positionShown.current || next.paused || Date.now() < seekingUntil.current;
      const key = `${snapshotKey(next, withPosition)}|${endsAt(next)}`;
      if (last?.player === player && last.key === key) return;
      last = { player, key };
      setSnap(next);
    };
    // The next skip goes from where any seek went: a skip's own, the seek bar's, jellyfin-web's Home, End and chapter
    // keys', a Watch together member's. Not from jellyfin-web's position, which until the video next plays on is still
    // the one from before the seek (its player keeps the last `timeupdate`'s), but from the <video>, with the
    // manager's offset for a converted stream (its position less the player's). <video> events don't bubble.
    const onSeeking = (e: Event): void => {
      const manager = pm.current!;
      try {
        const player = manager.getCurrentPlayer()!;
        const ms =
          manager.currentTime(player) -
          player.currentTime!() +
          (e.target as HTMLMediaElement).currentTime * 1000;
        lastSkip.current = { ms, at: Date.now() };
      } catch {
        // no player
      }
    };
    readNow.current = read;
    read();
    const timer = setInterval(read, POLL_MS);
    document.addEventListener('visibilitychange', read);
    document.addEventListener('seeking', onSeeking, true);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', read);
      document.removeEventListener('seeking', onSeeking, true);
    };
  }, []);

  // Full screen on a phone turns the picture sideways where the browser allows it (Android); a portrait video stays as
  // it is. iOS can't lock (its expand button hands the video to iOS's own player, which turns it).
  useEffect(() => {
    let locked = false;
    const onChange = (): void => {
      const on = !!document.fullscreenElement;
      setFullscreen(on);
      if (on) {
        const video = document.querySelector<HTMLVideoElement>('video.htmlvideoplayer');
        if (!video || video.videoWidth >= video.videoHeight) locked = lockLandscape();
      } else if (locked) {
        locked = false;
        unlockOrientation();
      }
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      if (locked) unlockOrientation();
    };
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

  const osdRef = useRef<HTMLDivElement>(null);
  /**
   * The last press, anywhere, and what was on screen just before it (the document's other listeners are about to wake
   * the controls and close a panel). A click on the picture asks it which pointer it came from: WebKit's click is a
   * MouseEvent, even for a tap, and a tap on a bar may land its click on the picture underneath. `at` is when it was
   * lifted (or pressed, until then): a long press's click comes as the finger lifts.
   */
  const press = useRef<{ pointerType: string; shown: boolean; panelOpen: boolean; at: number } | null>(null);
  /** Kept from the last press, for a double click (a double tap's, in Chrome on Android, isn't full screen's). */
  const lastPointer = useRef<string | undefined>(undefined);
  const shownNow = useRef(true);
  const lastTap = useRef<LastTap | null>(null);
  /** The picture: where Escape leaves focus as it puts the controls away. */
  const surfaceRef = useRef<HTMLDivElement>(null);
  /**
   * Whether focus came to the player by keyboard (Tab, a D-pad, Enter on a pill) or a screen reader, not by a click or
   * tap. Tracked from the input that moved it, not :focus-visible: Chromium and WebKit count a clicked button as
   * :focus-visible once any key is pressed (Space to play again, say). A screen reader (VoiceOver's swipes) moves focus
   * with no key and no press: focus with no press just before it counts as the keyboard's.
   */
  const keyboardFocus = useRef(false);
  useEffect(() => {
    let keyboard = false;
    let pointerAt = 0;
    const onKey = (): void => void (keyboard = true);
    const onPointer = (e: PointerEvent): void => {
      pointerAt = Date.now();
      if (e.type === 'pointerdown') keyboard = keyboardFocus.current = false;
    };
    const onFocus = (e: FocusEvent): void => {
      const target = e.target as Element;
      keyboardFocus.current =
        !!osdRef.current?.contains(target) && (keyboard || Date.now() - pointerAt >= PRESS_MS);
      // Focus on a control brings the controls up: a screen reader can land on one while they're hidden, and its
      // activation would otherwise only wake them (see the click canceller below). A key or a press already has.
      if (target.closest?.('.lmn-player__top, .lmn-player__bottom')) wake();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('pointerup', onPointer, true);
    document.addEventListener('focusin', onFocus, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('pointerup', onPointer, true);
      document.removeEventListener('focusin', onFocus, true);
    };
  }, []);
  /**
   * Whether a control has keyboard focus. Outside the TV layout the controls stay up for it: they aren't hidden from
   * someone using them with the keyboard. In the TV layout focus is always on a control, so they hide after a pause as
   * jellyfin-web's TV controls do, and come back with the next D-pad press.
   */
  const holdsKeyboardFocus = (): boolean => {
    const focused = document.activeElement;
    return (
      ctx.layout !== 'tv' &&
      keyboardFocus.current &&
      !!focused &&
      focused !== surfaceRef.current &&
      !!osdRef.current?.contains(focused)
    );
  };
  // Show on any input; hide after a pause while playing with no menu open.
  const wake = (): void => {
    setVisible(true);
    setTapHidden(false);
    clearTimeout(idleTimer.current);
    const idle = (): void => {
      if (holdsKeyboardFocus()) idleTimer.current = window.setTimeout(idle, IDLE_MS);
      else setVisible(false);
    };
    idleTimer.current = window.setTimeout(idle, IDLE_MS);
  };
  useEffect(() => {
    wake();
    // Not the wheel: jellyfin-web turns it into volume changes, which get the volume pill instead. Keys in the capture
    // phase, as jellyfin-web's controls count them: the ones a slider keeps to itself are input too.
    const events = ['pointermove', 'pointerdown'] as const;
    events.forEach((e) => document.addEventListener(e, wake, { passive: true }));
    document.addEventListener('keydown', wake, { passive: true, capture: true });
    return () => {
      clearTimeout(idleTimer.current);
      events.forEach((e) => document.removeEventListener(e, wake));
      document.removeEventListener('keydown', wake, { capture: true });
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
        next = { level: Math.round(readVolume(manager, player)), muted: manager.isMuted(player) };
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
  const settingsPill = useRef<HTMLButtonElement>(null);
  positionShown.current = visible || panel !== null || info;
  // The position wasn't redrawn while hidden: bring it up to date before the controls are painted.
  useLayoutEffect(() => {
    if (positionShown.current) readNow.current();
  }, [positionShown.current]);
  const castAvailable = useCastAvailable(pm.current, itemId);

  // Back closes an open panel, then Playback info, and stays in the player; with neither open it leaves the player, on
  // the first press. jellyfin-web's video OSD (hidden under Lumen's) would otherwise take that first press: while it
  // counts its controls as shown (3 s after the player opens, and after a D-pad key in the TV layout, each key
  // restarting the 3 s) its `document` keydown listener hides them on Back and stops the event before jellyfin-web goes
  // back (controllers/playback/video/index.js, 12.1–12.4). This listener, on <body>, runs before it and after Lumen's
  // own menus, which stop the Back they use.
  const open = useRef({ panel: false, info: false });
  open.current = { panel: panel !== null, info };
  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      lastPointer.current = e.pointerType;
      press.current = {
        pointerType: e.pointerType,
        shown: shownNow.current,
        panelOpen: open.current.panel,
        at: Date.now(),
      };
    };
    const onUp = (): void => {
      if (press.current) press.current.at = Date.now();
    };
    // A swipe or a pinch: no click comes of it.
    const onCancel = (): void => void (press.current = null);
    // A tap that brings the hidden controls back does only that. The press woke them, so its click would land on
    // whatever control is now under the finger: Play, a pill, Back. Not a click with no press in it (detail 0: Enter or
    // Space on a button, a D-pad's OK, a screen reader's), which an earlier press may still be on record for.
    const onClick = (e: MouseEvent): void => {
      const p = press.current;
      if (!p || p.shown || !e.detail || !isTouchLike(p.pointerType) || Date.now() - p.at >= PRESS_MS) return;
      if (!(e.target as Element).closest?.('.lmn-player__top, .lmn-player__bottom')) return;
      press.current = null;
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onCancel, true);
    document.addEventListener('click', onClick, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointercancel', onCancel, true);
      document.removeEventListener('click', onClick, true);
    };
  }, []);
  // Paused from elsewhere while a tap had put the controls away (a Watch together member, headphones, the lock
  // screen, a call): they come back, as for any pause.
  const wasPaused = useRef<boolean | undefined>(undefined);
  useLayoutEffect(() => {
    if (snap?.paused && wasPaused.current === false) setTapHidden(false);
    wasPaused.current = snap?.paused;
  }, [snap?.paused]);
  // "−10 s" or "+10 s" by the side a double tap skipped on; quick taps on add up. It's how far the seek went: near
  // the start or the end a skip falls short.
  const [skipped, setSkipped] = useState<{ seconds: number; n: number } | null>(null);
  const skippedTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => clearTimeout(skippedTimer.current), []);
  const showSkipped = (seconds: number): void => {
    if (!seconds) return; // already at the start or the end, or a stream that can't seek: nothing to show
    setSkipped((s) => ({
      seconds: s && s.seconds < 0 === seconds < 0 ? s.seconds + seconds : seconds,
      n: (s?.n ?? 0) + 1,
    }));
    clearTimeout(skippedTimer.current);
    skippedTimer.current = window.setTimeout(() => setSkipped(null), SKIPPED_MS);
  };
  useEffect(() => {
    const consume = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || !isBackKey(e)) return;
      // A held Back repeats: act on the press only, and keep the repeats from jellyfin-web, which would go back again.
      if (e.repeat) return consume(e);
      if (open.current.panel) {
        consume(e);
        // The focused entry is about to unmount: give focus back to the pill that opened the panel, so a remote
        // isn't left on nothing, and keep the controls up for it.
        osdRef.current?.querySelector<HTMLElement>('.lmn-player__pill[aria-expanded="true"]')?.focus();
        setPanel(null);
        wake();
        return;
      }
      if (open.current.info) {
        consume(e);
        settingsPill.current?.focus(); // where Playback info is turned on, as its close button does
        setInfo(false);
        wake();
        return;
      }
      // Escape on a control (outside the TV layout) puts the controls away, as it does jellyfin-web's: they stay up
      // while they have keyboard focus. Focus goes to the picture, not <body>, so the next Tab comes back to them (in
      // WebKit, Tab from <body> starts at the top of the page).
      if (e.key === 'Escape' && holdsKeyboardFocus()) {
        consume(e);
        surfaceRef.current?.focus();
        clearTimeout(idleTimer.current);
        setVisible(false);
        return;
      }
      // Leave only where jellyfin-web would: Escape (and a gamepad's B) go back in the TV layout only.
      if (!isRemoteBack(e) && ctx.layout !== 'tv') return;
      // A jellyfin-web dialog over the player (its OSD ignores Back then too) closes on it instead.
      if (document.querySelector('.dialogContainer .dialog.opened')) return;
      // Nothing to go back to: jellyfin-web's Back exits the app (webOS, Tizen) where it can.
      if (window.history.length <= 1) return;
      consume(e);
      window.history.back();
    };
    document.body.addEventListener('keydown', onKey);
    return () => document.body.removeEventListener('keydown', onKey);
  }, [ctx.layout]);

  /** Skips 10 s back or on (skip.ts) and says how far it went, in seconds; set as each render has the player. */
  const skipRef = useRef<(direction: 'back' | 'forward') => number>(() => 0);
  // The arrow keys (and J and L) skip as the buttons do, 10 s, not by jellyfin-web's skip lengths (skip.ts). On <body>,
  // ahead of jellyfin-web's shortcuts on `document`; the seek bar, the volume slider and the panels keep the arrows they
  // use. In the TV layout the arrows move focus instead.
  useEffect(() => {
    if (ctx.layout === 'tv') return;
    let skippedAt = 0;
    const onKey = (e: KeyboardEvent): void => {
      const direction = SKIP_KEYS[e.key];
      if (!direction || e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      if ((e.target as Element).closest?.('input, textarea, select, [contenteditable]')) return;
      if (document.querySelector('.dialogContainer .dialog.opened')) return;
      e.preventDefault();
      e.stopPropagation();
      // A held key repeats. In Watch together each skip is a seek the whole group waits for (everyone pauses to buffer),
      // so there it skips once per press; elsewhere it goes on, at a pace the player can follow.
      if (e.repeat && (inGroup.current || Date.now() - skippedAt < REPEAT_MS)) return;
      skippedAt = Date.now();
      skipRef.current(direction);
    };
    document.body.addEventListener('keydown', onKey);
    return () => document.body.removeEventListener('keydown', onKey);
  }, [ctx.layout]);

  // Until the first frame: the title's backdrop and a spinner, not a black screen.
  if (!snap || !pm.current)
    return pm.current ? <LoadingScreen ctx={ctx} snap={null} starting={starting} /> : null;
  const manager = pm.current;
  const player: Player = snap.player;
  const shown = visible || (snap.paused && !tapHidden) || panel !== null;
  shownNow.current = shown;
  const act = (fn: () => void) => (): void => {
    try {
      fn();
    } catch {
      // a player that doesn't support it: nothing to do
    }
  };
  /** Where the video is: where a seek still on its way went, else jellyfin-web's position (stale until it lands). */
  const positionNow = (liveMs = readPosition(manager, player)): number => {
    const recent = lastSkip.current;
    return recent && Date.now() - recent.at < PENDING_MAX_MS && Math.abs(liveMs - recent.ms) > ARRIVED_MS
      ? recent.ms
      : liveMs;
  };
  /** A skip's seek (the 10 s ones, and a segment's): the next skip goes on from where this one lands. */
  const seekTo = (to: number): void => {
    lastSkip.current = { ms: to, at: Date.now() };
    seekingUntil.current = Date.now() + PENDING_MAX_MS;
    act(() => manager.seek(Math.round(to * 10_000), player))();
  };
  skipRef.current = (direction) => {
    const live = readPlayerState(manager, player);
    if (!live.canSeek) return 0;
    const from = positionNow(live.positionMs);
    const to = skipTarget(from, live.durationMs, direction);
    seekTo(to);
    return Math.round((to - from) / 1000);
  };

  const item = snap.item;
  const isEpisode = item?.Type === 'Episode';
  const title = (isEpisode ? item?.SeriesName : item?.Name) ?? '';
  const subtitle = isEpisode
    ? `S${item?.ParentIndexNumber ?? 0}:E${item?.IndexNumber ?? 0} · ${item?.Name ?? ''}`
    : [item?.ProductionYear?.toString(), formatRuntime(item?.RunTimeTicks)].filter(Boolean).join(' · ');

  return (
    <div
      ref={osdRef}
      onKeyDown={(e) => {
        // Space presses a button the keyboard is on, as anywhere else: jellyfin-web's shortcut would play or pause
        // instead, and keep the press from the button. It still gets the key, as one it ignores (registry.ts
        // IGNORED_KEY_CODE): it remembers which element the keyboard is on, and in Firefox drops a click on any other
        // (controllers/playback/video/index.js, onClickCapture). After a click, Space stays play/pause.
        if (e.key === ' ' && keyboardFocus.current && (e.target as Element).closest('button'))
          Object.defineProperty(e, 'keyCode', { value: IGNORED_KEY_CODE });
      }}
      class={`lmn-osd${shown ? '' : ' is-idle'}${tapHidden ? ' is-tapped' : ''}${panel ? ' has-panel' : ''}${progress.started ? '' : ' is-loading'}`}
    >
      {!progress.started && <LoadingScreen ctx={ctx} snap={snap} starting={starting} />}
      {progress.started && progress.buffering && !switching.state?.shown && (
        <div class="lmn-player-buffering" role="status" aria-label={playerStrings.buffering}>
          <span class="lmn-spinner" aria-hidden="true" />
        </div>
      )}
      {info && (
        <PlaybackInfoCard
          ctx={ctx}
          snap={snap}
          onClose={() => {
            // Its close button goes with it: focus goes to the settings pill, where Playback info is turned on.
            settingsPill.current?.focus();
            setInfo(false);
          }}
        />
      )}
      <VolumePill volume={volume} />
      <SwitchOverlay state={switching.state} />
      {skipped && (
        <div
          key={skipped.n}
          class={`lmn-player-skipped${skipped.seconds > 0 ? ' is-forward' : ''}`}
          aria-hidden="true"
        >
          {playerStrings.skipped(skipped.seconds)}
        </div>
      )}
      {/* A click on the picture plays or pauses (or closes a panel); a double click toggles full screen. A tap shows or
          hides the controls, and a double tap at the sides skips (touch.ts). */}
      <div
        ref={surfaceRef}
        tabIndex={-1}
        class="lmn-player__surface"
        onClick={(e) => {
          // A click with no press just before it comes from the last pointer used (a script's, from a mouse).
          const recent = press.current && Date.now() - press.current.at < PRESS_MS ? press.current : null;
          press.current = null;
          const down = recent ?? {
            pointerType: lastPointer.current ?? 'mouse',
            shown,
            panelOpen: panel !== null,
          };
          const box = e.currentTarget.getBoundingClientRect();
          const tap = surfaceTap(
            down,
            { at: Date.now(), x: e.clientX - box.left, width: box.width },
            lastTap.current,
          );
          lastTap.current = tap.last;
          switch (tap.action) {
            case 'closePanel':
              return setPanel(null);
            case 'togglePlay':
              return act(() => manager.playPause(player))();
            case 'show':
              return wake();
            case 'hide':
              clearTimeout(idleTimer.current);
              setVisible(false);
              return setTapHidden(true);
            case 'back':
            case 'forward':
              showSkipped(skipRef.current(tap.action));
              return wake();
          }
        }}
        onDblClick={() => {
          // A double tap skips instead (Chrome on Android sends a dblclick for it).
          if (!isTouchLike(lastPointer.current)) act(() => manager.toggleFullscreen(player))();
        }}
      />

      <header class="lmn-player__top">
        <button
          type="button"
          class="lmn-player__icon lmn-player__back"
          aria-label={playerStrings.back}
          onClick={() => {
            // Opened with nothing behind it: go home, as a details page's Back does.
            if (window.history.length > 1) window.history.back();
            else ctx.navigate(HOME_HASH);
          }}
        >
          <Icon name={PLAYER_ICONS.arrowLeft} size={28} />
        </button>
        <div class="lmn-player__titles">
          <h1 class="lmn-player__title">{title}</h1>
          {subtitle && <p class="lmn-player__subtitle">{subtitle}</p>}
          {syncPlay.group && (
            <p class="lmn-player__syncplay">
              <Icon name="watchTogether" size={18} />
              {othersInGroup(syncPlay).length > 0
                ? playerStrings.watchingWith(othersInGroup(syncPlay))
                : strings.inGroup(syncPlay.group.GroupName)}
            </p>
          )}
        </div>
        <div class="lmn-player__pills">
          <button
            type="button"
            class={`lmn-player__pill${panel === 'quality' ? ' is-open' : ''}`}
            aria-haspopup="dialog"
            aria-expanded={panel === 'quality'}
            onClick={() => setPanel(panel === 'quality' ? null : 'quality')}
          >
            <Icon name={PLAYER_ICONS.quality} size={22} />
            {/* Phones show the icon only; the name is always there for screen readers. */}
            <span class="lmn-visually-hidden">{`${playerStrings.quality} ${qualityLabel(snap)}`}</span>
            <span class="lmn-player__pill-label" aria-hidden="true">
              {playerStrings.quality}
            </span>
            <span class="lmn-player__pill-value" aria-hidden="true">
              {qualityLabel(snap)}
            </span>
          </button>
          <button
            type="button"
            class={`lmn-player__pill${panel === 'tracks' ? ' is-open' : ''}`}
            aria-haspopup="dialog"
            aria-expanded={panel === 'tracks'}
            onClick={() => setPanel(panel === 'tracks' ? null : 'tracks')}
          >
            <Icon name={PLAYER_ICONS.closedCaption} size={22} />
            <span class="lmn-visually-hidden">{playerStrings.audioSubtitles}</span>
            <span class="lmn-player__pill-label" aria-hidden="true">
              {playerStrings.audioSubtitles}
            </span>
          </button>
          <button
            ref={settingsPill}
            type="button"
            class={`lmn-player__pill lmn-player__pill--icon${panel === 'settings' ? ' is-open' : ''}`}
            aria-label={playerStrings.settings}
            aria-haspopup="dialog"
            aria-expanded={panel === 'settings'}
            onClick={() => setPanel(panel === 'settings' ? null : 'settings')}
          >
            <Icon name="settings" size={22} />
          </button>
          {panel === 'quality' && (
            <QualityPanel
              manager={manager}
              snap={snap}
              tv={ctx.layout === 'tv'}
              onClose={() => setPanel(null)}
              onSwitch={switching.begin}
            />
          )}
          {panel === 'settings' && (
            <SettingsPanel
              ctx={ctx}
              tv={ctx.layout === 'tv'}
              syncPlay={syncPlay}
              manager={manager}
              snap={snap}
              isEpisode={isEpisode}
              info={info}
              onInfo={setInfo}
              pill={settingsPill}
              onClose={() => setPanel(null)}
            />
          )}
          {panel === 'tracks' && (
            <AudioSubtitlesPanel
              manager={manager}
              snap={snap}
              tv={ctx.layout === 'tv'}
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
          onSeek={(ms) => {
            lastSkip.current = null; // the next skip goes from here (a converted stream restarts: no `seeking`)
            seekingUntil.current = Date.now() + PENDING_MAX_MS;
            act(() => manager.seek(Math.round(ms * 10_000), player))();
          }}
          preview={preview}
          livePositionMs={() => readPlayerState(manager, player).positionMs}
          tv={ctx.layout === 'tv'}
        />
        <div class="lmn-player__controls">
          <div class="lmn-player__group">
            <button
              type="button"
              class="lmn-player__icon"
              aria-label={snap.paused ? playerStrings.play : playerStrings.pause}
              onClick={act(() => manager.playPause(player))}
            >
              <Icon name={snap.paused ? 'play' : 'pause'} size={26} />
            </button>
            <button
              type="button"
              class="lmn-player__icon"
              aria-label={playerStrings.rewind}
              disabled={!snap.canSeek}
              onClick={() => skipRef.current('back')}
            >
              <SkipIcon direction="back" />
            </button>
            <button
              type="button"
              class="lmn-player__icon"
              aria-label={playerStrings.forward}
              disabled={!snap.canSeek}
              onClick={() => skipRef.current('forward')}
            >
              <SkipIcon direction="forward" />
            </button>
            <Volume manager={manager} snap={snap} tv={ctx.layout === 'tv'} />
          </div>
          <div class="lmn-player__group">
            {hasNext && (
              <button
                type="button"
                class="lmn-player__icon lmn-player__next"
                aria-label={playerStrings.nextEpisode}
                title={playerStrings.nextEpisode}
                onClick={act(() => manager.nextTrack(player))}
              >
                <Icon name={PLAYER_ICONS.skipNext} size={26} />
                <span class="lmn-player__next-label">{playerStrings.nextEpisode}</span>
              </button>
            )}
            {item && <FavoriteButton ctx={ctx} item={item} />}
            {manager.togglePictureInPicture && document.pictureInPictureEnabled && (
              <button
                type="button"
                class="lmn-player__icon"
                aria-label={playerStrings.pip}
                title={playerStrings.pip}
                onClick={act(() => manager.togglePictureInPicture?.(player))}
              >
                <Icon name={PLAYER_ICONS.pip} size={26} />
              </button>
            )}
            {manager.toggleAirPlay && 'WebKitPlaybackTargetAvailabilityEvent' in window && (
              <button
                type="button"
                class="lmn-player__icon"
                aria-label={playerStrings.airplay}
                title={playerStrings.airplay}
                onClick={act(() => manager.toggleAirPlay?.(player))}
              >
                <Icon name={PLAYER_ICONS.airplay} size={26} />
              </button>
            )}
            {castAvailable && (
              <button
                type="button"
                class="lmn-player__icon"
                aria-label={playerStrings.cast}
                title={playerStrings.cast}
                onClick={(e) => void openCastMenu(ctx, manager, snap, e.currentTarget)}
              >
                <Icon name={PLAYER_ICONS.cast} size={26} />
              </button>
            )}
            <button
              type="button"
              class="lmn-player__icon"
              aria-label={fullscreen ? playerStrings.exitFullscreen : playerStrings.fullscreen}
              onClick={act(() => manager.toggleFullscreen(player))}
            >
              <Icon name={fullscreen ? PLAYER_ICONS.fullscreenExit : PLAYER_ICONS.fullscreen} size={26} />
            </button>
          </div>
        </div>
      </footer>
      <LazySegments
        ctx={ctx}
        manager={manager}
        snap={snap}
        started={progress.started}
        position={() => positionNow()}
        seek={seekTo}
        busy={panel !== null || info}
        idle={!shown}
        group={!!syncPlay.group}
        icon={PLAYER_ICONS.skipNext}
      />
    </div>
  );
}

/** The keys a range input handles itself. */
const SLIDER_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'];

/** What ends a volume drag, on `document` (and `blur` on the window). */
const DRAG_END = ['pointerup', 'pointercancel', 'lostpointercapture'];
/** How often a drag sends the volume to the player (each pointer move is an input). */
const VOLUME_SEND_MS = 50;
/** How long, at most, the slider keeps the value it was let go at when the player reports nothing new. */
const VOLUME_RESYNC_MS = 1000;

function Volume({ manager, snap, tv }: { manager: PlaybackManager; snap: PlayerSnapshot; tv: boolean }) {
  const reported = snap.muted ? 0 : snap.volume;
  // What the user set, shown instead of the player's reading while they change it and until the player reports it. The
  // controls redraw with an older reading in between (on the volume change itself, and every poll), and the slider
  // given that value jumped back under the pointer and then forward again.
  const [held, setHeld] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const player = useRef(snap.player);
  player.current = snap.player;
  /** When the last value went to the player, and when the snapshot drawn now was read (near enough: first drawn). */
  const sentAt = useRef(0);
  const read = useRef({ snap, at: 0 });
  if (read.current.snap !== snap) read.current = { snap, at: Date.now() };
  const send = useRef(
    throttle((value: number) => {
      sentAt.current = Date.now();
      try {
        // Read now, not from the snapshot: a drag from muted would unmute and then mute again.
        if (value > 0 && manager.isMuted(player.current)) manager.toggleMute(player.current);
        manager.setVolume(value, player.current);
      } catch {
        // a player that doesn't support it: nothing to do
      }
    }, VOLUME_SEND_MS),
  );
  // A drag ends wherever the button comes up, on the slider or off it, or when the pointer or the window is lost
  // without that (a pointerup elsewhere, an alert, another app); and when the player closes, sending the last value.
  const end = useRef((): void => {
    DRAG_END.forEach((type) => document.removeEventListener(type, end.current, true));
    window.removeEventListener('blur', end.current);
    send.current.flush();
    setDragging(false);
  });
  useEffect(() => end.current, []);
  const startDrag = (): void => {
    setDragging(true);
    DRAG_END.forEach((type) => document.addEventListener(type, end.current, true));
    window.addEventListener('blur', end.current);
  };
  // Once the drag (or a key) is done and sent, the player's reading takes over: the first one taken after the last
  // send (it may differ: the wheel, or a player that keeps its own steps), or one that matches. Or after a moment.
  useEffect(() => {
    if (held === null || dragging) return;
    if (!send.current.pending() && (read.current.at > sentAt.current || Math.abs(reported - held) <= 1))
      return setHeld(null);
    const timer = setTimeout(() => setHeld(null), VOLUME_RESYNC_MS);
    return () => clearTimeout(timer);
  }, [held, dragging, snap]);
  const level = held ?? reported;
  return (
    <div class="lmn-player__volume">
      <button
        type="button"
        class="lmn-player__icon"
        aria-label={snap.muted ? playerStrings.unmute : playerStrings.mute}
        onClick={() => manager.toggleMute(snap.player)}
      >
        <Icon name={volumeIcon(level, held === null && snap.muted)} size={26} />
      </button>
      <input
        class="lmn-player__volume-slider"
        type="range"
        min={0}
        max={100}
        step={1}
        value={level}
        aria-label={playerStrings.volume}
        style={{ '--lmn-fill': `${level}%` }}
        onPointerDown={startDrag}
        onKeyDown={(e) => {
          // The slider's own keys are the slider's: jellyfin-web's shortcuts would also seek (arrows left and right,
          // Home, End), skip chapters (Page Up and Down) or change the volume a second time (arrows up and down). In
          // the TV layout up and down stay jellyfin-web's, which moves focus with them (and keeps them from the slider).
          if (!SLIDER_KEYS.includes(e.key) || (tv && (e.key === 'ArrowUp' || e.key === 'ArrowDown'))) return;
          e.stopPropagation();
        }}
        onInput={(e) => {
          const value = Number(e.currentTarget.value);
          setHeld(value);
          send.current.call(value);
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
      aria-label={playerStrings.favorite}
      aria-pressed={favorite}
      title={playerStrings.favorite}
      onClick={() => void setUserData(ctx, asItem, 'IsFavorite', !favorite)}
    >
      <Icon name={favorite ? 'heartFilled' : 'heart'} size={26} />
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
      aria-label={playerStrings.volume}
      aria-live="polite"
    >
      <Icon name={volumeIcon(level, !!volume?.muted)} size={20} />
      <span class="lmn-volume-pill__track" aria-hidden="true">
        <span class="lmn-volume-pill__fill" style={{ width: `${level}%` }} />
      </span>
      <span class="lmn-volume-pill__value">{volume?.muted ? playerStrings.muted : `${level}%`}</span>
    </div>
  );
}
