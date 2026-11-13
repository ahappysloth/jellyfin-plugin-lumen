import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { BaseItem } from '../../api/types';
import type { PlaybackManager } from '../../compat/playbackManager';
import { MEDIA_SEGMENTS, STOCK_SELECTORS } from '../../compat/registry';
import { Icon, type IconPath } from '../../components/icons';
import { imageUrl, resolveImage } from '../../components/images';
import type { ViewContext } from '../context';
import { setUserData } from '../userDataStore';
import type { PlayerSnapshot } from './playerState';
import {
  autoSkip,
  BACKSTOP_MS,
  cardPlan,
  countDown,
  CREDITS_END_MS,
  endCredits,
  parseSegments,
  promptSegment,
  readActions,
  RESTART_BACKSTOP_MS,
  secondsLeft,
  SKIP_START,
  skipTo,
  undoTarget,
  type Segment,
  type SegmentAction,
  type SegmentActions,
  type SkipState,
} from './segments';
import { segmentStrings } from './segmentStrings';

/** How often the position is looked at (as the player's own poll). */
const POLL_MS = 250;
/** How long "Skipped intro" and its Undo stay up. */
export const SKIPPED_MS = 6000;
/** The next episode begins within this of Play now (or the countdown's end), or it wasn't that press that began it. */
export const WATCHED_MS = 30_000;
/** Set on <html> while Lumen draws the prompts: styles/segments.css hides jellyfin-web's own. */
export const SEGMENTS_CLASS = 'lmn-segments';
/** The player's bars: focus on a control in them, while they're up, is the user's (the seek bar, a pill, a menu). */
const CONTROLS = '.lmn-player__top,.lmn-player__bottom';
/** A menu or dialog over the player: Lumen's (Watch together, the cast picker) or jellyfin-web's. */
const OPEN = '.lmn-menu,.lmn-dialog,.dialogContainer .dialog.opened';

export interface SegmentsProps {
  ctx: ViewContext;
  manager: PlaybackManager;
  snap: PlayerSnapshot;
  /** The first frame has played (nothing shows over the loading screen). */
  started: boolean;
  /** Where the video is, or where a seek on its way will land (PlayerView). */
  position: () => number;
  /** The player's own seek, so the 10 s skips go on from where this one lands. */
  seek: (ms: number) => void;
  /** A menu or Playback info is open: it keeps the remote's focus. */
  busy: boolean;
  /** The controls are hidden. */
  idle: boolean;
  /** Watching together: what Lumen would do by itself here (skip, start the next episode) would do it to everyone. */
  group: boolean;
  /** The Skip button's icon (the player's "next" glyph). */
  icon: IconPath;
}

interface Loaded {
  /** The media source these are for. */
  id: string;
  segments: Segment[];
  actions: SegmentActions;
  /** "Show next video info during playback" (on unless switched off). */
  nextInfo: boolean;
}

interface NextUp {
  /** The episode this one comes after. */
  after: string;
  item: BaseItem;
}

interface Shown {
  prompt: Segment | null;
  card: boolean;
  /** The countdown, with autoplay on. */
  seconds: number | null;
}
const NOTHING: Shown = { prompt: null, card: false, seconds: null };

/**
 * What has happened in an item: the auto-skip's state, the segments that only ask from now on (skipped once, or seeked
 * back into), whether the card was dismissed or its episode started, and its countdown.
 */
const newMemo = (id: string | undefined) => ({
  id,
  skip: SKIP_START as SkipState,
  asks: [] as Segment[],
  dismissed: false,
  played: false,
  /** What is left of the credits card's countdown while it's up, and when that was last worked out. */
  left: null as number | null,
  at: 0,
});

/**
 * Lumen's Skip Intro / Recap / Credits / Preview / Ad button, the "Skipped intro" notice with Undo, and the
 * next-episode card, in place of jellyfin-web's skip prompt and up-next card (hidden while these are drawn:
 * SEGMENTS_CLASS). The segments come from the server's media segments API, so any segment provider feeds it, and what
 * each type does is the user's jellyfin-web setting (segments.ts).
 *
 * It draws nothing, and leaves jellyfin-web's prompts as they were, until it has the segments and the settings: when
 * the request fails, the answer or a setting isn't what Lumen knows, or this file never loads (lazySegments.tsx).
 */
export function SegmentPrompts(props: SegmentsProps) {
  const { ctx, manager, snap, started, position, seek, busy, idle, group, icon } = props;
  const item = snap.item;
  const itemId = item?.Id;
  const sourceId = snap.mediaSourceId ?? itemId;
  const tv = ctx.layout === 'tv';

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    if (!sourceId) return;
    let cancelled = false;
    let actions: SegmentActions | null = null;
    let nextInfo = true;
    try {
      const setting = (name: string): string | null => localStorage.getItem(`${ctx.userId}-${name}`);
      actions = readActions(setting);
      nextInfo = setting(MEDIA_SEGMENTS.nextVideoInfo) !== 'false';
    } catch {
      // storage is blocked: what the user chose can't be known
    }
    if (!actions) return;
    const known = actions;
    ctx.client
      .ajax({ type: 'GET', url: ctx.client.getUrl(`MediaSegments/${sourceId}`), dataType: 'json' })
      .then((body) => {
        const segments = parseSegments(body);
        if (segments && !cancelled) setLoaded({ id: sourceId, segments, actions: known, nextInfo });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [sourceId]);
  const data = loaded && loaded.id === sourceId ? loaded : null;

  // jellyfin-web's prompts go only while Lumen's are drawn.
  useLayoutEffect(() => {
    if (!data) return;
    document.documentElement.classList.add(SEGMENTS_CLASS);
    return () => document.documentElement.classList.remove(SEGMENTS_CLASS);
  }, [!data]);

  // "Play next episode automatically": the user's setting on the server. Until it's known, no countdown.
  const [autoplay, setAutoplay] = useState(false);
  useEffect(() => {
    let cancelled = false;
    ctx.api
      .getCurrentUser()
      .then((user) => !cancelled && setAutoplay(!!user.Configuration?.EnableNextEpisodeAutoPlay))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // The episode after this one: the next in jellyfin-web's play queue, which holds the episodes that follow whether or
  // not they start by themselves (12.4). With nothing after it there (the queue's end, a season's last episode, a
  // shuffled queue's last), or with Repeat set to this episode, there is no card: Lumen plays only what is queued.
  // The queue can change while the episode plays (something queued next, the rest removed): it is read as the episode
  // starts, and again as the card is due.
  const [nextUp, setNextUp] = useState<NextUp | null>(null);
  const [due, setDue] = useState(false);
  useEffect(() => {
    if (!itemId || item?.Type !== 'Episode' || snap.playlistIndex < 0) return;
    let cancelled = false;
    manager
      .getPlaylist(snap.player)
      .then((list) => {
        const queued = list[snap.playlistIndex + 1] as BaseItem | undefined;
        if (!cancelled) setNextUp(queued?.Id ? { after: itemId, item: queued } : null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [itemId, snap.playlistIndex, due]);
  const next = nextUp && nextUp.after === itemId && snap.repeatMode !== 'RepeatOne' ? nextUp.item : null;

  const memo = useRef(newMemo(itemId));
  const [skipped, setSkipped] = useState<{ segment: Segment; fromMs: number } | null>(null);
  const [shown, setShown] = useState<Shown>(NOTHING);
  if (memo.current.id !== itemId) {
    memo.current = newMemo(itemId);
    if (skipped) setSkipped(null);
  }
  useEffect(() => {
    if (!skipped) return;
    const timer = setTimeout(() => setSkipped(null), SKIPPED_MS);
    return () => clearTimeout(timer);
  }, [skipped]);

  // Jellyfin counts an episode as watched only when it stops past 90% of its length, and credits can start before
  // that. So an episode left for the next one from its card (the countdown, or Play now) is marked watched once the next
  // has begun: after jellyfin-web's "stopped" report, which would otherwise leave a resume point on a watched episode.
  // Only when it begins soon after: where the press started nothing (a group that ignored it, a queue that had changed),
  // the next episode beginning later, from wherever this one was left, isn't the card's doing.
  const watched = useRef<{ item: BaseItem; next: string; at: number } | null>(null);
  useEffect(() => {
    // Between the two, jellyfin-web's player state can have no item for a moment (the first has stopped, the next not
    // yet started). That's no other item: the mark waits for the next one. (Taken there, it was lost, and the episode
    // kept its resume point.)
    if (!itemId) return;
    const was = watched.current;
    watched.current = null;
    if (was && was.next === itemId && Date.now() - was.at < WATCHED_MS)
      void setUserData(ctx, was.item, 'Played', true);
  }, [itemId]);
  const playNext = (): void => {
    if (!next || !item) return;
    memo.current.played = true;
    watched.current = { item: item as BaseItem, next: next.Id, at: Date.now() };
    try {
      manager.nextTrack(snap.player);
    } catch {
      // a player that can't: this episode plays out
    }
  };

  /** One look at the position: skips what skips itself, and works out what to show. Set as each render has the props. */
  const look = useRef<() => void>(() => undefined);
  look.current = () => {
    let show = NOTHING;
    let cardDue = false;
    if (data && started && snap.canSeek) {
      // In a group as jellyfin-web has it this moment: the player's own word (`group`) comes from a poll, and lags.
      const together = group || !!manager.syncPlayEnabled;
      const m = memo.current;
      const now = Date.now();
      let pos = position();
      const { durationMs } = snap;
      const action = (s: Segment): SegmentAction => (m.asks.includes(s) ? 'AskToSkip' : data.actions[s.type]);
      const step = autoSkip(
        m.skip,
        pos,
        now,
        data.segments.filter((s) => action(s) === 'Skip'),
        !snap.mediaSource?.[MEDIA_SEGMENTS.hasSegments]
          ? 0
          : snap.playMethod === 'Transcode' && snap.mediaSource.TranscodingSubProtocol !== 'hls'
            ? RESTART_BACKSTOP_MS
            : BACKSTOP_MS,
      );
      m.skip = step.state;
      if (step.asks) m.asks.push(step.asks);
      if (step.skipped) {
        const { segment } = step.skipped;
        m.asks.push(segment);
        // Watching together, a seek is everyone's: Lumen makes none by itself, and the segment gets the Skip button
        // (a press is a member's own doing, as any seek). jellyfin-web's own skip, where it makes one, is still told.
        if (step.seekMs === undefined || !together) {
          if (step.seekMs !== undefined) {
            seek(skipTo(segment, durationMs));
            pos = position(); // where that went: the segment's button mustn't show on the way
          }
          // Credits skipped to the end: the video is over, with nothing to go back to and no time for the card.
          if (segment.endMs < durationMs - CREDITS_END_MS) setSkipped(step.skipped);
          else m.dismissed = true;
        }
      }
      // jellyfin-web's own up-next card can only be hidden where Lumen knows its box: without it Lumen draws no card
      // of its own (the takeover reports the missing selector).
      const when =
        data.nextInfo && document.querySelector(STOCK_SELECTORS.upNext.selector)
          ? cardPlan(data.segments, action, durationMs)
          : null;
      // Whatever is next in the queue by now (above).
      cardDue = !!when && pos >= when.fromMs;
      const plan = next ? when : null;
      const credits = plan && endCredits(data.segments, action, durationMs);
      // Gone once its episode is on its way (Play now, the countdown): no Skip Credits shows in its place meanwhile.
      const card = !!plan && !m.dismissed && !m.played && pos >= plan.fromMs;
      // With autoplay, the next episode starts in the credits' place once the countdown is out. Not for a group: one
      // member's countdown would start it for another who chose Watch credits.
      const counts = card && autoplay && !together;
      m.left = counts && plan.credits ? countDown(m.left, now - m.at, snap.paused) : null;
      m.at = now;
      if (m.left !== null && m.left <= 0) playNext();
      show = {
        // The card is the credits' prompt: Play now skips them.
        prompt: promptSegment(data.segments, (s) => action(s) === 'AskToSkip' && s !== credits, pos),
        card: card && !m.played,
        seconds: counts ? secondsLeft(m.left, pos, durationMs) : null,
      };
    }
    setShown((was) =>
      was.prompt === show.prompt && was.card === show.card && was.seconds === show.seconds ? was : show,
    );
    setDue(cardDue);
  };
  useEffect(() => {
    const timer = setInterval(() => look.current(), POLL_MS);
    return () => clearInterval(timer);
  }, []);
  useLayoutEffect(() => look.current(), [data, next, started, autoplay]);

  // TV: the Skip button, or the card's Play now, takes the remote's focus as it comes up (OK presses it), but never
  // from something in use: a menu or dialog, the seek bar or another control while the controls are up, or another of
  // the prompts' own buttons (Watch credits, Undo: OK there mustn't press Play now). Then it takes it once the
  // controls have gone. As what has the focus here goes, focus returns to where it was (or to Play), so the remote
  // isn't left on nothing.
  const root = useRef<HTMLDivElement>(null);
  const before = useRef<HTMLElement | null>(null);
  const held = useRef(false);
  /** The remote's arrows brought the focus here: it's the prompts' to hand back too, with nowhere it was taken from. */
  const entered = (): void => {
    if (!held.current) before.current = null;
    held.current = true;
  };
  const focusOn = shown.prompt ?? shown.card;
  useLayoutEffect(() => {
    const target = root.current!.querySelector<HTMLElement>('.lmn-seg__primary');
    const active = document.activeElement as HTMLElement | null;
    if (!tv || root.current!.contains(active)) return;
    // Nothing has focus: the prompt that had it has just gone, or nothing ever did.
    const free = !active || active === document.body;
    if (target && !busy && (free || idle || !active.closest(CONTROLS)) && !document.querySelector(OPEN)) {
      if (!free) before.current = active;
      else if (!held.current) before.current = null;
      held.current = true;
      target.focus();
    } else if (held.current) {
      held.current = false;
      // Elsewhere, the user has moved it.
      if (free)
        (before.current?.isConnected
          ? before.current
          : root.current!.parentElement!.querySelector<HTMLElement>('.lmn-player__controls button')
        )?.focus();
    }
  }, [tv, focusOn, skipped, busy, idle]);

  const image = shown.card && next ? resolveImage(next, ['Primary', 'Thumb', 'Backdrop']) : null;
  return (
    <div ref={root} class="lmn-seg" onFocusIn={entered}>
      <div class={`lmn-seg__skipped${skipped ? ' is-shown' : ''}`}>
        {/* Always there, so a screen reader announces what lands in it. */}
        <span role="status">{skipped && segmentStrings.skipped(skipped.segment.type)}</span>
        {skipped && (
          <button
            type="button"
            class="lmn-button"
            onClick={() => {
              seek(undoTarget(skipped));
              setSkipped(null);
            }}
          >
            {segmentStrings.undo}
          </button>
        )}
      </div>
      {shown.prompt && (
        <button
          type="button"
          class="lmn-button lmn-button--primary lmn-seg__primary"
          onClick={() => {
            seek(skipTo(shown.prompt!, snap.durationMs));
            look.current();
          }}
        >
          {segmentStrings.skip(shown.prompt.type)}
          <Icon name={icon} size={20} />
        </button>
      )}
      {shown.card && next && (
        <section class="lmn-next" aria-label={segmentStrings.nextEpisode}>
          {image && (
            <img
              class="lmn-next__image"
              src={imageUrl(ctx.client, image, { width: 160, height: 90 })}
              alt=""
              onError={(e) => e.currentTarget.remove()}
            />
          )}
          <div class="lmn-next__text">
            <p class="lmn-next__eyebrow">
              {shown.seconds === null ? segmentStrings.nextEpisode : segmentStrings.playingIn(shown.seconds)}
            </p>
            <p class="lmn-next__title">{segmentStrings.episode(next)}</p>
            {/* A row to jellyfin-web's D-pad: Left and Right stay between the two, wherever the controls' buttons are. */}
            <div class="lmn-next__actions focuscontainer-x">
              <button
                type="button"
                class="lmn-button lmn-button--primary lmn-seg__primary"
                onClick={() => {
                  playNext();
                  look.current();
                }}
              >
                {segmentStrings.playNow}
              </button>
              <button
                type="button"
                class="lmn-button"
                onClick={() => {
                  memo.current.dismissed = true;
                  look.current();
                }}
              >
                {segmentStrings.watchCredits}
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
