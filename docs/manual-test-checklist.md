# Manual test checklist (before each release)

Run against the release build on the latest stable Jellyfin.

## Desktop browser (Chrome or Firefox)

- [ ] Home: hero rotates, a trailer preview plays after the delay, and the rows load.
- [ ] Clicking a Continue Watching card resumes playback in the stock player.
- [ ] Movie details: Play/Resume, Trailer, Watched, and Favorite all work, and More Like This opens another title.
- [ ] Series details: smart play label is correct, switching seasons works, and clicking an episode plays it.
- [ ] Back from details returns to home at the same scroll position.
- [ ] Unticking "Replace the home screen" in the dashboard restores the stock home after a reload.

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
