import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { BaseItem, ItemsResult } from '../../api/types';
import type { PlaybackManager } from '../../compat/playbackManager';
import { MEDIA_SEGMENTS, STOCK_SELECTORS } from '../../compat/registry';
import { Icon, type IconPath } from '../../components/icons';
import { imageUrl, resolveImage } from '../../components/images';
import { playItem } from '../../playback/play';
import type { ViewContext } from '../context';
import type { PlayerSnapshot } from './playerState';
import {
  autoSkip,
  cardPlan,
  countDown,
  CREDITS_END_MS,
  endCredits,
  parseSegments,
  promptSegment,
  readActions,
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
/** Set on <html> while Lumen draws the prompts: styles/segments.css hides jellyfin-web's own. */
export const SEGMENTS_CLASS = 'lmn-segments';

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
  /** In jellyfin-web's play queue (it queues the following episodes when autoplay is on); otherwise found on the server. */
  queued: boolean;
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
export function SegmentPrompts({ ctx, manager, snap, started, position, seek, busy, icon }: SegmentsProps) {
  const item = snap.item;
  const itemId = item?.Id;
  const sourceId = snap.mediaSourceId ?? itemId;
  const tv = ctx.layout === 'tv';

  const get = (path: string, params?: Record<string, unknown>): Promise<unknown> =>
    ctx.client.ajax({ type: 'GET', url: ctx.client.getUrl(path, params), dataType: 'json' });

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
    get(`MediaSegments/${sourceId}`)
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

  // The episode after this one: the next in the play queue, or (with autoplay off jellyfin-web queues nothing) the
  // one the server lists after it, into the next season too.
  const [nextUp, setNextUp] = useState<NextUp | null>(null);
  useEffect(() => {
    if (!itemId || item?.Type !== 'Episode') return;
    let cancelled = false;
    const found = (next: unknown, queued: boolean): void => {
      if (!cancelled && (next as BaseItem | undefined)?.Id)
        setNextUp({ after: itemId, item: next as BaseItem, queued });
    };
    manager
      .getPlaylist(snap.player)
      .catch(() => [])
      .then((list) => {
        const queued = snap.playlistIndex >= 0 ? list[snap.playlistIndex + 1] : undefined;
        if (queued) return found(queued, true);
        if (!item.SeriesId) return;
        const from = { userId: ctx.userId, startItemId: itemId, limit: 2, isMissing: false };
        return get(`Shows/${item.SeriesId}/Episodes`, from).then((result) => {
          const episodes = (result as ItemsResult | null)?.Items;
          // The list starts at this episode, on a server that knows startItemId.
          if (episodes?.[0]?.Id === itemId) found(episodes[1], false);
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [itemId, snap.playlistIndex]);
  const next = nextUp && nextUp.after === itemId ? nextUp : null;

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

  const playNext = (): void => {
    if (!next) return;
    memo.current.played = true;
    try {
      if (next.queued) manager.nextTrack(snap.player);
      else void playItem(ctx.api, ctx.client, next.item.Id, undefined, manager).catch(() => undefined);
    } catch {
      // a player that can't: this episode plays out
    }
  };

  /** One look at the position: skips what skips itself, and works out what to show. Set as each render has the props. */
  const look = useRef<() => void>(() => undefined);
  look.current = () => {
    let show = NOTHING;
    if (data && started && snap.canSeek) {
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
        !!snap.mediaSource?.[MEDIA_SEGMENTS.hasSegments],
      );
      m.skip = step.state;
      if (step.asks) m.asks.push(step.asks);
      if (step.skipped) {
        const { segment } = step.skipped;
        m.asks.push(segment);
        if (step.seekMs !== undefined) {
          seek(skipTo(segment, durationMs));
          pos = position(); // where that went: the segment's button mustn't show on the way
        }
        // Credits skipped to the end: the video is over, with nothing to go back to and no time for the card.
        if (segment.endMs < durationMs - CREDITS_END_MS) setSkipped(step.skipped);
        else m.dismissed = true;
      }
      // jellyfin-web's own up-next card can only be hidden where Lumen knows its box: without it Lumen draws no card
      // of its own (the takeover reports the missing selector).
      const plan =
        next && data.nextInfo && !m.played && document.querySelector(STOCK_SELECTORS.upNext.selector)
          ? cardPlan(data.segments, action, durationMs)
          : null;
      const credits = plan && endCredits(data.segments, action, durationMs);
      const card = !!plan && !m.dismissed && pos >= plan.fromMs;
      // With autoplay, the next episode starts in the credits' place once the countdown is out.
      m.left = card && autoplay && plan.credits ? countDown(m.left, now - m.at, snap.paused) : null;
      m.at = now;
      if (m.left !== null && m.left <= 0) playNext();
      show = {
        // The card is the credits' prompt: Play now skips them.
        prompt: promptSegment(data.segments, (s) => action(s) === 'AskToSkip' && s !== credits, pos),
        card: card && !m.played,
        seconds: card && autoplay ? secondsLeft(m.left, pos, durationMs) : null,
      };
    }
    setShown((was) =>
      was.prompt === show.prompt && was.card === show.card && was.seconds === show.seconds ? was : show,
    );
  };
  useEffect(() => {
    const timer = setInterval(() => look.current(), POLL_MS);
    return () => clearInterval(timer);
  }, []);
  useLayoutEffect(() => look.current(), [data, next, started, autoplay]);

  // TV: the Skip button, or the card's Play now, takes the remote's focus as it comes up (OK presses it), unless a menu
  // has it. As it goes, focus returns to where it was (or to Play), so the remote isn't left on nothing.
  const root = useRef<HTMLDivElement>(null);
  const focusOn = shown.prompt ?? shown.card;
  useLayoutEffect(() => {
    const target = root.current?.querySelector<HTMLElement>('.lmn-seg__primary');
    if (!tv || !target || busy || document.querySelector('.dialogContainer .dialog.opened')) return;
    const before = document.activeElement as HTMLElement | null;
    const osd = target.closest('.lmn-osd');
    target.focus();
    return () => {
      // Focus falls to <body> as the focused button goes; elsewhere, the user has moved it.
      if (document.activeElement !== document.body) return;
      const back = before && before.isConnected && before !== document.body ? before : null;
      (back || osd!.querySelector<HTMLElement>('.lmn-player__controls button'))?.focus();
    };
  }, [tv, focusOn, busy]);

  const image = shown.card && next ? resolveImage(next.item, ['Primary', 'Thumb', 'Backdrop']) : null;
  return (
    <div ref={root} class="lmn-seg">
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
            <p class="lmn-next__title">{segmentStrings.episode(next.item)}</p>
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
