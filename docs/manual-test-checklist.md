# Manual test checklist (before each release)

Run against the release build on the latest stable Jellyfin.

## Desktop browser (Chrome or Firefox)

- [ ] Home: hero rotates (and the pause button stops it), a trailer preview plays after the delay, and the rows load.
- [ ] The pill nav's Home, library, search and settings links open the right pages; the header turns solid on scroll.
- [ ] Popular Genres tiles show artwork and open the stock list for that genre.
- [ ] New titles show a "Recently added" badge; a series with a new episode shows "New episode".
- [ ] Clicking a Continue Watching card resumes playback in the stock player.
- [ ] Movie details: the trailer plays muted behind the header and the mute toggle works; Back returns to the previous
      page; Play/Resume, Trailer, My List, and Watched all work; You may like opens another title.
- [ ] Series details: smart play label is correct, switching seasons works, and clicking an episode plays it.
- [ ] Back from details returns to home at the same scroll position.
- [ ] Unticking "Replace the home screen" in the dashboard restores the stock home after a reload.

## Safari (macOS or iOS)

- [ ] With an MKV trailer holding H.264: the preview plays on home and on details (remuxed to HLS).
- [ ] With an HEVC-in-MKV or AV1 trailer: no preview on home (the backdrop stays); on details the preview plays,
      transcoded to HLS. The Dashboard shows the transcode, and it ends within seconds of leaving the page, closing the
      tab or reloading.

## Firefox

- [ ] With an MKV trailer holding H.264: the preview starts promptly (remuxed to MP4, not the whole file loaded first).

## Official iOS app

- [ ] Home and details render; buttons are easy to tap; layout stacks on narrow screens.
- [ ] Playback starts in the native player from Lumen's Play buttons.

## TV layout (desktop browser with Display → Layout = TV)

- [ ] Focus starts on the hero's Play button, and arrow keys move through rows and buttons.
- [ ] Returning home restores focus to the last selected card.

## Admin

- [ ] Reorder, add, and remove sections; save; the result is reflected on home.
- [ ] An invalid setting (collection hero source with no collection) shows an error and saves nothing.
- [ ] The Diagnostics section lists any reported compatibility failures.
