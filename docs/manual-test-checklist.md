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

- [ ] With a real Trakt Client ID (trakt.tv/oauth/applications) in Settings → Trakt, Check key names this week's most
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

## Top charts and Trakt rows (Trakt and Seerr)

- [ ] With a Trakt key, a Top 10 row's title reads "… See all ›" and opens Top charts on that row's chart (This week).
      Without a key there's no See all, and `#/home?lumen=charts` says the page isn't found.
- [ ] Top charts: Movies / Shows and This week / This month / This year / All time each show their own chart, ranked
      as on Trakt (compare with trakt.tv/movies/watched/monthly…). All time loads more as you scroll, up to 100. A title
      on the server opens its page; Back returns to the same chart and period.
- [ ] With Seerr, titles the server doesn't have show Request under the card; requesting one turns the card to
      Requested (and to a progress bar once it downloads). Without Seerr, only titles on the server show, at their true
      rank (e.g. 4, 9, 23), not renumbered.
- [ ] Add Box Office, Most Anticipated Movies and Shows, Trending Movies and Shows, and a Trakt list (paste a public
      list's address, e.g. https://trakt.tv/users/…/lists/…) under Home sections. Each row shows posters in Trakt's
      order without numerals; the list row is titled with the list's name unless you give it one.
- [ ] Saving a Trakt list with an address that isn't a list (a watchlist, a movie page, another site) says
      "Enter a public Trakt list's address…". A private or deleted list's row is hidden, and the server log says so once.
- [ ] Without Seerr, Most Anticipated rows are hidden and the others show only titles on the server. Without a Trakt
      key, all of these rows are hidden.
- [ ] Phone (iPhone): Top charts' switches stack and the grid shows three posters a row; the rank tab stays readable.
- [ ] TV layout: from a Top 10 card, Up reaches See all; on Top charts the arrows reach both switches, every card and
      each Request button (Down from its card), and the next page loads as focus moves down the grid.

## Quick Connect (a TV or a computer, and a phone)

Automated tests run both sides in two browser contexts and decode the QR code with jsQR; only real devices show the
camera, the home-screen app and a TV across the room.

- [ ] Signed out on a TV (or Display → Layout = TV): "Use Quick Connect" is the sign-in page's main button, in the
      accent, and doesn't open by itself. OK opens Lumen's screen: the code in large digits ("123 456"), readable from
      the sofa, a QR code beside it, Cancel focused. The arrows stay on the screen's buttons; Back closes it, focus back
      on the button.
- [ ] iPhone camera on the QR code: Safari opens `…/web/#/quickconnect?code=…`. Signed in: the page shows the account,
      the six digits filled in, "This code came from a link or QR code", and waits for Approve. Signed out: sign in, and
      it lands on the same page with the code. After Approve the TV signs in by itself and shows home.
- [ ] The installed home-screen app: account menu → Quick Connect, type the six digits (paste "123 456" works too),
      Approve. The address bar never keeps the code after the page has read it.
- [ ] Lumen's settings → General → Public address for QR codes: a LAN or Tailscale address the phone can reach (e.g.
      `http://tv-box.tailnet.ts.net:8096`) saves, and the TV's QR code opens it; `jellyfin.example.com` (no http) is
      flagged and refused on save. Empty: the QR code opens the address the TV itself uses. Pasted from the address bar
      with `/web/` on the end: the hint shows "QR codes will open: …/web/#/quickconnect" (one `/web/`), and so does the
      QR code.
- [ ] Leave the TV on its Quick Connect screen for over 30 minutes: it gets a new code twice (every 10 minutes), then
      says "That code has expired." with "Get a new code". The network panel shows no more Quick Connect requests after
      Cancel, Back or leaving the page.
- [ ] As an administrator, "Signs in as" offers every user but disabled ones; picking a child's account signs the TV in
      as them. A non-administrator has no picker.
- [ ] Dashboard → General → turn Quick Connect off: the open TV screen says it's turned off; the approve page says so
      too, with "Turn it on in Dashboard → General" for administrators (not on a TV). The sign-in page has no Quick
      Connect button (jellyfin-web hides it), and on a TV Sign In is the main button again. Turn it back on.
- [ ] Unplug the server (or stop it) with the TV on its Quick Connect screen: it asks less and less often, and after
      about 10 minutes says "That code has expired." with "Get a new code".
- [ ] A wrong code says "isn't valid or has expired"; approving the same code twice says "already been used". Typing
      the right code straight after the error replaces the wrong one (no deleting first).

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

## Push notifications (a real iPhone, the server on https, a real Seerr)

The automated tests can't reach a real push service or iOS, so this is the only check of both.

- [ ] In Safari on the iPhone (not the Home Screen app), My requests says notifications need the Home Screen app,
      with no switch.
- [ ] In the Home Screen app, My requests shows "Notify me when requests are ready", off. Tapping it brings up iOS's
      permission prompt at once; after Allow, the switch is on and says "On for this device". Lumen's settings
      (Requests → Notifications) count the device.
- [ ] "Send a test notification" says Sent, and "Notifications are on" arrives within a few seconds, with the app
      open and (send it, then close the app within a second) with it closed.
- [ ] Request something Seerr auto-approves and close the app. When it's ready (within 2 minutes of Seerr saying so;
      at once with Seerr's webhook set up), "<title> is ready to watch" arrives on the lock screen.
- [ ] Tapping it opens the app on that title's page: with the app closed, and with it in the background on
      another page.
- [ ] Opening Lumen afterwards shows no "ready to watch" pop-up for it; a second device without notifications
      doesn't either.
- [ ] On a desktop Chrome with notifications on for the same user, the same request's notification shows the
      artwork, and a click brings the open Lumen tab forward on the title.
- [ ] Turn the switch off: the device leaves the admin count, and the next ready request pops up in the app instead.
- [ ] Deny the permission instead of allowing it: the switch says notifications are blocked.
- [ ] Sign out on the phone: the next ready request sends nothing to it (and the admin count drops).
- [ ] "Reset notification keys" in Lumen's settings asks first, then shows no devices; after opening the app on the
      phone again, the device is back in the count without touching the switch, and a test arrives.
- [ ] Seerr's webhook (Settings → Notifications → Webhook → Test) answers without an error with the secret from
      Lumen's settings, and is refused (401) with a wrong one.

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
