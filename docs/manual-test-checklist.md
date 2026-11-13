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
- [ ] The round buttons over artwork (Back, the hero's Pause, a trailer's Pause and Mute, the rows' arrows) are frosted
      glass, and turn into a white disc with a dark icon under the pointer, when pressed, and with Tab's focus (a ring
      too). The player's buttons are bare at rest and turn white the same way.
- [ ] Home → a movie: the pill at the top left holds Back only. → a cast member → one of their titles: Back and Home.
      Back, a page at a time, drops Home again one page from where you set out. Home opens Lumen's home, and the
      browser's Back then returns to the page Home was pressed on, with Home still in its pill. A reload two pages in
      keeps Home; a details page opened from a bookmark has Back only.
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

## Online trailers ("Use online trailers when there's no local one (IMDb, then YouTube)")

- [ ] Off (the default): nothing loads from imdb-video.media-imdb.com or youtube-nocookie.com on home, a details page
      or a Seerr title page (the Network tab).
- [ ] An existing server that had "Use YouTube trailers" on shows the new setting on after the update.
- [ ] On, a title without a local trailer that IMDb has a trailer for (most movies and shows with an IMDb id): on its
      hero slide, behind its details page and behind a Seerr title page (a title not in the library), the backdrop
      first, then the trailer fades in as "Seconds before the trailer starts" ends (1 s on title pages), with Pause,
      and Mute on title pages. The Network tab shows the MP4 from imdb-video.media-imdb.com starting to load up to 3 s
      before then (ranges, not the whole file), and nothing for slides passed by. A 1080p file (`…1080p…` in its name,
      or the video's resolution in Safari's Web Inspector) on a phone, a desktop browser and a TV; 720p in a small
      window. Also on an iPhone (Safari and the Home Screen app), and on a TV (webOS): IMDb's trailers play there,
      YouTube's don't.
- [ ] Scroll a playing trailer out of view (a title page's, or the home banner's) and back: it paused meanwhile, and
      carries on at once from where it was, with no new request in the Network tab. Same for switching to another
      app or tab and back. After more than a minute away it starts again after the delay (the banner's where it was).
      Also on an iPhone's Home Screen app.
- [ ] The Health tab's Trailers row says IMDb answers. Blocking api.graphql.imdb.com on the server (a DNS filter)
      turns it into a problem, and titles fall back to YouTube's trailers within 5 minutes.

## YouTube trailers (online trailers, for a title IMDb has none for)

- [ ] On, a title without a local trailer: the backdrop first, then its trailer fades in on its hero slide and behind
      its details page, with no YouTube title, logo, pause button or captions at any point, also on a phone. Pause
      brings the backdrop back and Play resumes about where it was; a swipe or a tab in the background removes it.
- [ ] A title with a local trailer still plays that one. The TV layout shows the backdrop only.
- [ ] With "Let trailers finish" on, the slide stays until the trailer ends and fades out before YouTube's end screen.

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
- [ ] Open Lumen, then stop Seerr (or block it) and open a chart Lumen hasn't shown in the last ten minutes: the titles
      on the server show, with "Some titles couldn't be loaded. Try again" above them. Start Seerr again: Try again
      brings the rest into their places by rank, and the note goes.
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
- [ ] As a user Seerr has no account for (Seerr set up, the user not imported): the network panel shows no GET
      /Lumen/Requests/Mine at all, and the console no 404.
- [ ] TV layout: from the account menu, Down reaches My requests; on it the arrows reach every request.
- [ ] My requests: typing in the search box narrows the list at once (a phone's keyboard Search key closes the
      keyboard); each chip shows its count and only its requests; a chip or search with nothing says so.
- [ ] As an administrator, against a real Seerr (and once against Overseerr or Jellyseerr if you can): Everyone's
      requests lists other users' requests with their names (Jellyfin users by their Jellyfin name and picture),
      and Lumen's log shows no "Seerr returned HTTP 400". It stays on after a reload, on that device only. A user who
      isn't an administrator has no switch.
- [ ] TV layout: from the first request, Up reaches the chips, then the search box and the Everyone's requests switch.
- [ ] TV layout: when the "ready to watch" pop-up shows, the remote's focus is on Open (OK opens the title); Right is
      Dismiss, and after it (or when the pop-up goes by itself) focus is back where it was.
- [ ] A phone on its side: the pop-up sits just above the tab bar, not over the page's title or sort buttons.

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
- [ ] With the server cut off from the internet (so no push service answers), a request that becomes ready shows no
      pop-up at first; some minutes later (three attempts: at once, 2 and 6 minutes on) opening Lumen shows the
      pop-up for it, and Jellyfin's log has one warning for the device, not one per attempt.
- [ ] In Edge on Windows, and in Firefox, the switch turns on (their push services, `*.notify.windows.com` and
      `updates.push.services.mozilla.com`, are among the hosts Lumen takes) and a test arrives.

## Skip Intro and the next-episode card (a server with a segment provider, e.g. Intro Skipper)

Automated tests answer the segments API themselves; only a real server shows a provider's segments, a converted
stream, and real episode lengths.

- [ ] An episode with an intro: **Skip Intro** comes up bottom right as the intro starts, stays when the controls hide
      (in the same place), goes about 3 s before the intro ends, and a click lands on the intro's end. The 10 s
      skip buttons go on from there. jellyfin-web's own skip button never shows beside it.
- [ ] Settings → Playback → Media Segment Actions: with Intro on *Skip*, the intro is skipped once as playback reaches
      it, with "Skipped intro" and **Undo**; Undo goes back into the intro, which then plays, with the Skip button.
      Seeking back into a skipped intro doesn't skip it again (rewinding to before it does: jellyfin-web skips it as
      playback reaches it). With *None* there is no button. Recap, Preview and Commercial say "Skip Recap", "Skip
      Preview" and "Skip Ad" when set to ask.
- [ ] The same with a stream that's being converted (pick a low Quality): one restart at the intro's end, not two.
- [ ] An episode with credits and a next episode: the card comes up as the credits start, with the next episode's
      picture, "S2 · E4 · Title" and "Playing in 10"; the next episode starts when the countdown is out, or at once on
      **Play now**. Pausing holds the countdown. **Watch credits** puts the card away for the episode. After the
      countdown or Play now, the episode left behind shows as watched (its page, Next Up), with no resume point and not
      in Continue watching, even when its credits started before 90% of it.
- [ ] No credits segment: the card comes up for the last 30 s, counting down to the end. The last episode of a show has
      no card (and its credits get **Skip Credits**); a movie has no card.
- [ ] *Play next episode automatically* off: the card has no countdown, and Play now still plays the next episode.
      *Show next video info during playback* off: no card. Repeat → This episode: no card (Skip Credits instead).
- [ ] Watch together, two members, an episode with credits: the card has no countdown for either, and nothing starts
      by itself; one member's Watch credits isn't overridden by the other waiting; Play now moves the group on. With
      Intro on *Skip*, Lumen doesn't seek for the group by itself.
- [ ] After Play now, when the next episode has no segments Lumen can read (or with Lumen's prompts unavailable):
      nothing unseen blocks the player's buttons (Back works), and jellyfin-web's own prompts work.
- [ ] iPhone, landscape and portrait: one tap on Skip Intro, and on Play now, works with the controls hidden too (a
      real finger: the button mustn't move as the controls come back); the card fits the screen and clears the home
      indicator.
- [ ] TV layout: Skip Intro has the remote's focus as it appears with the controls hidden, and OK skips; when it goes,
      the arrows still move. It doesn't take the focus from an open menu (Quality, Audio & Subtitles, Watch together,
      the cast picker) or from the seek bar while the controls are up, and takes it once they've gone. On the card,
      focus is on Play now; Left/Right move between it and Watch credits. Focus moved to Watch credits stays there when
      the controls hide (OK then watches the credits; it doesn't start the next episode). With the card or Skip Intro
      up, every arrow press from Back, the top buttons and the controls moves the focus somewhere visible.
- [ ] A title without segments has no button. With the segment provider's plugin removed, nothing changes for titles
      that never had segments.

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
- [ ] Details: Up from Play reaches Back, a white disc with a ring while it has focus; two pages in, Right moves to
      Home and Left back, and OK on Home opens home. On a real TV (webOS 5 has no backdrop blur) Back and the hero's
      Pause are a plain dark disc at rest and still read over a bright backdrop; newer TVs blur behind them without
      the page stuttering as it scrolls.

## Admin

- [ ] Reorder, add, and remove sections; save; the result is reflected on home.
- [ ] An invalid setting (collection hero source with no collection) shows an error and saves nothing. A section's
      error names it as the list does, with its row: "Trakt list (row 4): …".
- [ ] On a phone (320 px wide too): every Home section's name shows whole, on two lines or more if it must, and the
      "Choose a section to add…" list stays inside the screen.
- [ ] The save bar slides up with the first change and stays at the bottom of the window wherever you scroll, on a phone too (clear of the home indicator); after Save it says "Settings saved." and slides away. A failed save keeps it up.
- [ ] Health tab (next to Settings and Storage): every group shows, each row with its status in words; the tab is kept
      across a reload in the same browser tab, and shows a red count while a row is a Problem.
- [ ] Health: set Dashboard → Branding → Custom CSS, then Run checks again: "Branding custom CSS" is a Warning with
      Open Branding (and counts any `@import` from another site). Clear it: OK.
- [ ] Health behind Nginx Proxy Manager with **Cache Assets** on for Jellyfin's host: "Caching of Lumen's files" is a
      Problem naming the lifetime it received (about 30 days). Turn Cache Assets off (or open Jellyfin directly): OK.
- [ ] Health over HTTPS: the HTTPS row is OK; over http://localhost, a LAN address or a Tailscale address (100.x or
      *.ts.net), Not applicable with a note.
- [ ] Health: with a wrong Seerr key, fix it from the row's Open Requests settings and Save: back on the Health tab the
      row is OK and the count has gone down, without Run checks again.
- [ ] Health with Seerr: OK when it answers; with a wrong key, a Problem; with Seerr stopped, a Problem that names no
      address. Seerr without Sonarr (Settings → Services): "Radarr and Sonarr" warns.
- [ ] Health → Notifications with Seerr set up: the job is running; over HTTPS the address row is OK (and mentions the
      Home Screen app), over a LAN address Not applicable; the devices row counts the devices with notifications on;
      after "Send a test notification" the last-notification row says it reached the device.
- [ ] Health → Notifications, Seerr's webhook: off, Not applicable; pointed at Lumen with the secret from Requests →
      Notifications and Request Available ticked, OK; with an old secret, a Problem naming neither; without Request
      Available, a Warning. Copy report: no secret in it.
- [ ] Health with Intro Skipper installed: the plugin row is OK; untick it under a TV library's Media segment providers
      and the libraries row names that library; the episodes row counts episodes with intros.
- [ ] Health's Open … buttons: a Dashboard one opens that page; a Settings one opens the Settings tab at its card with
      focus in it.
- [ ] Health → Devices: after a failed compatibility check on another device (or a TV), it names the device and browser,
      what broke, what Lumen did, whether an update would help; Technical details shows the raw ids.
- [ ] Health → Copy report, pasted somewhere: versions, every check and device, and no API key, token or address
      (Seerr's, the public address for QR codes, the server's own).
- [ ] Health in the TV layout: Down from the tabs reaches Run checks again, Down goes from fix to fix (never into the
      Dashboard's drawer) and to each Technical details, and Up from the top buttons goes back to the tabs.
- [ ] Install a plugin from Dashboard → Plugins → Catalog: a banner slides down under the app bar ("Restart Jellyfin to
      finish installing …") and stays at the top while scrolling, on a phone too. Restart Jellyfin → Restart now
      restarts the server and reloads the page, which then shows no banner. With "Restyle Jellyfin's sign-in, settings
      and Dashboard pages" off, there's no banner.
