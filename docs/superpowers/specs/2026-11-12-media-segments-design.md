# Lumen — Skip Intro/Credits from media segments, and a next-episode card

- **Date:** 2026-11-12
- **Status:** Approved by the owner 2026-11-12; this note records the decisions and how they were built.
- **Builds on:** Lumen's player (`client/src/views/player`), which draws its own controls over jellyfin-web's playback
  manager, and its 10 s skips (#122), whose seek path this reuses.

## 1. What it is

The last stock-looking parts of watching a show were jellyfin-web's skip prompt and its up-next card, left clickable
above Lumen's player. Lumen now draws its own:

1. **A Skip button**, bottom right, while the video is inside a segment the user has set to *Ask To Skip*: **Skip
   Intro**, **Skip Recap**, **Skip Credits**, **Skip Preview**, **Skip Ad**. It shows with the controls hidden too
   (lower, in their place), and goes 3 s before the segment ends. A press seeks to the segment's end.
2. **"Skipped intro" with Undo**, for a segment set to *Skip*: it skips itself as playback reaches it, and the notice
   stays 6 s. Undo goes back into the segment, which then plays (with the Skip button).
3. **A next-episode card** for an episode with one after it: the next episode's picture, "S2 · E4 · Title", "Playing in
   10", **Play now** and **Watch credits**.

jellyfin-web's own prompts are hidden while Lumen draws these, and show as before when it can't (§6).

## 2. Data and settings

- **Segments:** `GET /MediaSegments/{itemId}` for the playing media source (as jellyfin-web asks), all types; times are
  ticks. It is what segment provider plugins (Intro Skipper and others) feed, so any provider works. Types: Intro,
  Recap, Outro (credits), Preview, Commercial; "Unknown" and segments without a length are ignored. One request per
  item played; no segments, no button.
- **What each type does** is jellyfin-web's per-user setting (Settings → Playback → Media Segment Actions), which it
  keeps only in localStorage: `${userId}-segmentTypeAction__${type}` = `None` | `AskToSkip` | `Skip`. Unset, jellyfin-web's
  defaults apply: Intro and Outro ask, the rest do nothing. Lumen reads them as each item starts.
- **Next-episode autoplay** is the user's `Configuration.EnableNextEpisodeAutoPlay` on the server (Settings → Playback →
  "Play next episode automatically"). **"Show next video info during playback"** (localStorage
  `enableNextVideoInfoOverlay`, on unless `false`) switches the card off, as it does jellyfin-web's.
- All of jellyfin-web's names are in `client/src/compat/registry.ts` (`MEDIA_SEGMENTS`, `STOCK_SELECTORS.skipIntro` and
  `.upNext`); the evidence is in `docs/reference/jellyfin-web-12.1-notes.md`.

## 3. The Skip button

- Visible from the segment's start until 3 s before its end (jellyfin-web also never prompts for a segment under 3 s).
- Seeks through the player's own skip path (`PlayerView` `seekTo`): the target is remembered while the seek is on its
  way, so the position reads as the target at once (jellyfin-web's stays stale until the video plays on), the button
  goes immediately, and the 10 s skips go on from there. Credits that run to the end seek to 1 s short of it, as the
  10 s skip does, so the video ends by itself and counts as watched.
- **TV:** it takes the remote's focus as it comes up, unless a menu or Playback info is open (then once that closes), or
  a jellyfin-web dialog is. OK presses it. As it goes, focus returns to where it was (or to Play/Pause), so the remote
  is never left on nothing.
- **Touch:** one tap, with the controls hidden too (the player's "a tap that wakes the controls does only that" rule
  covers the bars only).
- Lumen's own `.lmn-button` look, so it matches Play everywhere else and gets the TV layout's focus ring.

## 4. Segments that skip themselves, and jellyfin-web's own segment manager

jellyfin-web's `MediaSegmentManager` keeps running under Lumen's player and can't be reached or switched off. Where the
playing media source has `HasSegments`, it makes the *Skip* seeks itself, on the first `timeupdate` inside the segment:
before Lumen's poll (every 250 ms) even sees the position. Two actors seeking to the same place would restart a
converted stream twice, so:

- **With `HasSegments`**, Lumen doesn't seek. It watches for that skip to land (the position jumping to the segment's
  end from just before or inside it) and shows the notice. If playback instead runs 1.5 s into the segment (jellyfin-web
  ignored it, or its own request failed), Lumen makes the skip. The wait is by position, not the clock: while a
  converted stream restarts, the position stands still.
- **Without it**, Lumen seeks as soon as playback is inside the segment.
- As in jellyfin-web, a segment playback starts inside is skipped, and one the user **seeks back into** isn't: from then
  on it asks (the Skip button). The same after a skip: seeking back, or Undo, plays it.
- **Undo** seeks to where the skip began, at least 0.3 s into the segment: a position a hair before its start would
  have jellyfin-web skip it again as it plays in.
- Credits set to *Skip* that run to the end go straight to the end (the next episode, with autoplay): no notice (there
  is nothing to undo to) and no card.

The rules are `autoSkip` in `segments.ts`, a pure function of the last and current position.

## 5. The next-episode card

- **Which episode:** the next item in jellyfin-web's play queue; with autoplay off jellyfin-web queues nothing after an
  episode, so then the one the server lists after it (`/Shows/{series}/Episodes?startItemId=…&limit=2`, into the next
  season). Episodes only; movies get none.
- **When:**
  - as the credits start, when an Outro segment (not set to *None*) runs to within 3 s of the end. It stands in for
    Skip Credits, which isn't shown;
  - with no such segment, for the last 30 s (the second half of anything under a minute); after an Outro that stops
    short of the end (a scene after the credits), which gets Skip Credits, only once it's over.
- **Countdown, with autoplay on:** from the credits, 10 s by the clock (held while paused; a skip forward doesn't cut it
  short), then Lumen starts the next episode in the credits' place. Without credits to go by, the card counts down
  to the end of the episode and jellyfin-web starts the next one itself, as it always has: Lumen doesn't cut an
  ending it can't see.
- **With autoplay off:** no countdown, "Next episode" and the two buttons. Play now plays the next episode.
- **Watch credits** puts the card away for the rest of the episode (and no Skip Credits takes its place).
- **TV:** Play now takes the remote's focus; Left and Right move between the two buttons (`focuscontainer-x`), after
  the first press, which jellyfin-web's video page takes to bring its (hidden) controls back, as everywhere in the TV
  player.
- A Skip button and the card can be up together (a preview before the end): one above the other.

## 6. Never two, and falling back

- `html.lmn-segments` is set only while Lumen has the segments and the settings for the playing item;
  `styles/segments.css` hides `.skip-button-container` and `.upNextContainer` under it. Without the class, or the
  stylesheet, they stay above Lumen's player as before (`player.css`).
- Lumen draws nothing, and hides nothing, when: the segments request fails or its answer isn't the known shape; a
  stored action isn't one of the three (a jellyfin-web that changed what the settings mean); localStorage can't be
  read; or the prompts' file or stylesheet didn't load.
- Lumen draws no card when `.upNextContainer` isn't in the page: it couldn't hide jellyfin-web's. The takeover's probe
  reports it to Diagnostics as `selector.upNext`.
- Probes (`e2e/specs/stock-probe.spec.ts`, run nightly against newer Jellyfin): `.upNextContainer` on the player page;
  the Playback settings page's `select`s named for each setting, their three values, their defaults, and that they
  read the localStorage key Lumen reads. `media-segments.spec.ts` checks `.skip-button-container` is there, hidden,
  while Lumen's button shows.

## 7. Size

The prompts are a file of their own, `lumen-chunk-SegmentPrompts-*.js` with `lumen-segments.css`, fetched as the
player opens (`lazySegments.tsx`), with its own budget: **4 KB** gzipped for both (3.9 KB as built). The player's file
keeps its 13.5 KB budget (13.2 KB: the loader, and the seek path the prompts share) and startup its 72 KB (69.4 KB:
the registry's entries).

## 8. Tests

- Unit: `segments.test.ts` (parsing, the settings and their defaults, the button's range, every auto-skip path, Undo's
  target, the card's timing with and without credits, the countdown), `SegmentPrompts.test.tsx` (the button, labels,
  TV focus, auto-skip and Undo with and without jellyfin-web skipping, the card, Play now, the countdown, Watch
  credits, autoplay off, every fallback), `PlayerView.test.tsx` (the shared seek path; a new episode forgets the last
  one's skip).
- E2E: `media-segments.spec.ts`. Jellyfin has no API to add segments, so the tests answer `/MediaSegments` themselves
  (and set `HasSegments` on the playback info to bring jellyfin-web's own manager in): the button on desktop, by touch
  and with a D-pad, auto-skip and Undo both with Lumen and with jellyfin-web making the seek (one seek either way), the
  card with Play now, the countdown, Watch credits and autoplay off, the D-pad on the card, and the fallback to
  jellyfin-web's prompt.

## 9. Not done

- No "Up next" for movies (no sensible next title without a queue).
- The settings stay on jellyfin-web's Playback page; Lumen adds no page of its own for them.
- Not checked against a real segment provider: the test server has none, and it lists only an installed provider's
  segments. The manual checklist has the steps.
