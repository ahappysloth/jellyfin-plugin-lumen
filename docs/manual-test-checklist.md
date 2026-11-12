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
- [ ] As an administrator, More on a movie, series, season (the ⋯ beside the season picker) and episode lists
      jellyfin-web's actions; Edit metadata, Identify, Edit images, Edit subtitles, Media info, Add to collection, Add
      to playlist and Refresh metadata each open jellyfin-web's own dialog, and a saved edit shows on the page without
      a reload. Copy stream URL puts the file's link on the clipboard. As a restricted user, More shows only what their
      policy allows. A card's right-click menu ends in "More actions…" with the same list.
- [ ] Delete a collection from its card's "More actions…": the card leaves the grid, and stays gone after opening
      another title and coming Back. Delete one from its own page: Back lands on the grid without it.
- [ ] Delete two titles on home within a few seconds (one from its card, one from its page): Home shows neither, even
      though the server takes up to 30 s to notice. Rename one: Home shows the new name at once.
- [ ] Switch seasons on a series page: the ⋯ beside the picker always opens the season shown (its title is in the menu).
- [ ] Unticking "Replace the home screen" in the dashboard restores the stock home after a reload.

## Safari (macOS or iOS)

- [ ] With an MKV trailer (H.264, HEVC or AV1): no preview on home (the backdrop stays, and the Dashboard shows no
      stream); on details the preview plays through the server as HLS (remuxed for H.264, else transcoded). The
      Dashboard shows the stream, and it ends within seconds of leaving the page, closing the tab or reloading.
- [ ] In Low Power Mode (iOS): no preview, and the backdrop stays (no stuck first frame).

## Firefox

- [ ] With an MKV trailer holding H.264: no preview on home; on details it starts promptly (remuxed to MP4, not the
      whole file loaded first).

## Top 10 rows (Trakt and Seerr)

Add Top 10 Movies and Top 10 Shows under Home sections first.

- [ ] With a real Trakt Client ID (trakt.tv/oauth/applications) in Settings → Top 10, Check key names this week's most
      watched movie; a mistyped key says Trakt rejected it. The field never shows the saved key, only "Saved", and
      Remove key + Save clears it.
- [ ] Home shows both rows with big numerals beside the posters, in Trakt's order. Titles the server has open their
      details page and play; with Seerr, the rest show Request under the card, and Request opens the request dialog on
      home (a show lists its seasons). After requesting, the card says Requested and the button goes.
- [ ] Without Seerr, only titles the server has show, numbered 1, 2, 3… with no gaps. Without a Trakt key (but with
      Seerr), the rows rank Seerr's trending movies and shows. With neither, the rows don't appear.
- [ ] A user with parental controls or limited library access never sees a library card they can't open.
- [ ] TV layout: the arrows reach every card, and Down from an unowned card reaches its Request button. A screen reader
      reads each card as "1, Title", not the numeral on its own.

## Request progress (a real Seerr connected to Radarr/Sonarr)

Automated tests use a stub Seerr; only a real one shows Radarr's and Sonarr's queues as Seerr passes them on.

- [ ] Request a movie as a user whose requests are auto-approved: its card, the title page and My requests (account
      menu, or the Me tab on a phone) say Queued, then Downloading with a bar, a percentage and the time left once
      Radarr grabs it (Seerr syncs every minute), then Processing, then Ready. The title page moves on by itself every
      ~10 s while it downloads; it then offers Open in library.
- [ ] A season pack and a show downloading episode by episode: the progress reads "N of M episodes" and doesn't go
      backwards as episodes are imported.
- [ ] As a user who needs approval: Requested, then (after an admin approves in Seerr) Queued. Decline one in Seerr:
      it says Declined. A request Radarr couldn't add says Failed.
- [ ] When something requested is ready, a pop-up says "<title> is ready to watch" with Open, once: not again after a
      reload, nor on another browser or phone signed in as the same user.
- [ ] Another user's request for the same title shows only as the card's plain state (no bar, no time left), and
      their requests never appear in this user's My requests.
- [ ] With nothing in flight, the browser's network panel shows one GET /Lumen/Requests/Mine per page load and no
      more. With a request in flight, one about every 45 s (10 s on its title page or My requests while it
      downloads), and none while the tab is in the background.
- [ ] Seerr without Radarr/Sonarr connected: the statuses show without a bar or time left.
- [ ] TV layout: from the account menu, Down reaches My requests; on it the arrows reach every request.

## Home-screen app (iPhone Safari, Android Chrome)

Automated tests check the page's tags, the manifest and the icons, and the layout with a simulated status bar; only a
real phone shows what the installer and the launch do.

- [ ] iPhone: Share → Add to Home Screen proposes "Lumen" with the red J on a dark tile. The app opens full screen,
      the launch screen is dark (no white flash), and the clock and battery sit over Lumen's nav, which starts below
      them. The Dashboard's app bar and a settings page clear the status bar too; rotating to landscape works.
- [ ] iPhone app: a library editor (Dashboard → Libraries → Add Media Library, or Edit metadata) has its back arrow
      below the clock.
- [ ] iPhone app: open a photo, swipe through, close the slideshow; Lumen's nav still starts below the clock (no reload).
- [ ] Android: ⋮ → Install app (or Add to Home screen) proposes "Lumen" with the J; the splash is dark with the icon,
      and the status bar is Lumen's near-black.
- [ ] With Lumen switched off, a fresh install proposes Jellyfin's name and icon.

## Official iOS app

- [ ] Home and details render; buttons are easy to tap; layout stacks on narrow screens.
- [ ] Playback starts in the native player from Lumen's Play buttons.

## TV layout (desktop browser with Display → Layout = TV)

- [ ] Focus starts on the hero's Play button, and arrow keys move through rows and buttons.
- [ ] Returning home restores focus to the last selected card.
- [ ] Details: More is reachable with the arrow keys, its menu opens with Enter, and Back closes a dialog it opened,
      with focus back on More.
- [ ] Delete a card with the remote: focus moves to the card after it (the one before, if it was the last). Delete a
      title from its page: Back focuses the card next to where it was.
- [ ] On a real TV browser, a home card's "More actions…" opens the title's page (jellyfin-web hasn't loaded its item
      menu on home there); that page's More has the actions.

## Admin

- [ ] Reorder, add, and remove sections; save; the result is reflected on home.
- [ ] An invalid setting (collection hero source with no collection) shows an error and saves nothing.
- [ ] The save bar slides up with the first change and stays at the bottom of the window wherever you scroll, on a phone too (clear of the home indicator); after Save it says "Settings saved." and slides away. A failed save keeps it up.
- [ ] The Diagnostics section lists any reported compatibility failures.
- [ ] Install a plugin from Dashboard → Plugins → Catalog: a banner slides down under the app bar ("Restart Jellyfin to
      finish installing …") and stays at the top while scrolling, on a phone too. Restart Jellyfin → Restart now
      restarts the server and reloads the page, which then shows no banner. With "Restyle Jellyfin's sign-in, settings
      and Dashboard pages" off, there's no banner.
