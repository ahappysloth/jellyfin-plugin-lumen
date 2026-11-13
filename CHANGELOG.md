# Changelog

All notable changes to Lumen are documented here. Versions follow SemVer; Jellyfin sees them as `MAJOR.MINOR.PATCH.0`.

## [0.6.2] - 2026-11-13

### Added
- My requests has a search box that filters by title as you type, and filter chips with counts: All, Pending
  (waiting for approval), Downloading (approved, downloading or being added, a show partly there included),
  Available, and Declined or failed. Each says when it has nothing to show, with a way back.
- Administrators can turn on **Everyone's requests** in My requests: every user's recent requests, each with who
  asked (their Jellyfin name and picture, or their Seerr name), searchable by that name too. The switch is kept per
  device; nobody else sees it, and the server refuses everyone else the list.

## [0.6.1] - 2026-11-13

### Changed
- Trailers scrolled out of view (or left in a background tab) pause where they are, and carry on at once when they're
  back, instead of starting over after the delay. One that stays away for a minute is let go.
- Trailers start as soon as their delay is up: the video loads during the delay instead of after it. On title pages
  the delay is 1 second (was 1.5).
- Online trailers play in 1080p where the screen needs it (phones, desktops and TVs), 720p in a small window or with
  the browser's data saver on. IMDb's 720p looked soft on a phone, which shows the middle third of it full-height.

### Fixed
- On title pages, YouTube's trailer takes over again when IMDb's won't play in the browser (0.6.0 never sent it along).

## [0.6.0] - 2026-11-13

### Added
- Online trailers start in about a second: a title without a local trailer previews its trailer from IMDb, a plain
  720p video the browser plays straight from IMDb's video servers (nothing stored on or streamed through your
  server), before YouTube's, which take several seconds. They play like a local trailer, in the home banner and behind
  title pages, TVs included (YouTube's still don't on TVs).
- Seerr's title pages (titles you can request) play the title's trailer behind their header, with Pause and Mute, as
  library title pages do.
- A Health check that IMDb trailer lookups work while online trailers are on.

### Changed
- "Use YouTube trailers when there's no local one" is now "Use online trailers when there's no local one (IMDb, then
  YouTube)". A server that had it on keeps it on, IMDb's trailers included. The viewer's browser then also contacts
  IMDb's video servers.

## [0.5.2] - 2026-11-13

### Fixed
- Swiping the home banner on an iPhone no longer flickers: the leaving slide went black and the arriving one lost its
  shading and text for a moment. The slide now glides frame by frame, as it does under your finger.

## [0.5.1] - 2026-11-13

### Added
- "Ready to watch" push notifications: turn them on in My requests (on iPhone and iPad, from the Home Screen app) and
  a notification arrives when a title you requested can be played; tapping it opens the title. Lumen checks Seerr
  every 2 minutes, at once with Seerr's webhook set up. A device that can't be reached is tried again, then the
  in-app pop-up shows instead. Administrators see the devices in Lumen's settings (Requests → Notifications).
- Skip Intro and Skip Credits in the player, from Jellyfin's media segments (set them up with Intro Skipper or
  SkipMe.db: docs/skip-intro-setup.md), following Settings → Playback → Media Segment Actions (ask, skip or none),
  and a next-episode card with a countdown as the credits start. Watch together gets buttons, never automatic skips.
- A Health tab in Lumen's settings in place of Diagnostics: each check (Jellyfin version, updates, custom CSS, proxy
  caching, HTTPS, Seerr and its Radarr/Sonarr, Trakt, Skip Intro, Quick Connect, notifications, devices) says what's
  wrong in plain words with one fix. "Copy report" gives a summary without addresses or keys.
- YouTube trailers for the muted previews in the home banner and behind title pages, for titles without a local
  trailer ("Use YouTube trailers when there's no local one", off by default). The backdrop shows until the trailer
  plays, with no YouTube controls; a slide with one stays until it ends. Not in the TV layout.
- A Back and Home pill on title, person and Seerr title pages: Home shows once you're two or more pages in.

### Changed
- Lumen's round buttons are frosted glass and turn white with a dark icon on hover, press and remote focus.
- On a TV the "ready to watch" pop-up's Open takes the remote (never from an open dialog or list); Top charts says
  when some titles couldn't be loaded, with Try again; the Home sections editor fits phones down to 320 px and its
  save errors name the section; the pop-up clears the toolbar on a phone held sideways.

### Fixed
- My requests, download progress on posters, the "ready" pop-up and notifications failed against a real Seerr ("Seerr
  returned HTTP 400": Lumen sent a parameter Seerr doesn't take). My requests now stays in the menu if Seerr can't
  give the list, with Try again, and Lumen's log quotes Seerr's reason when it refuses a call.
- Users without a Seerr account no longer get a failed request on every page load.
- An episode left with Play now on the next-episode card is marked watched even when the switch is quick.

## [0.5.0] - 2026-11-12

### Added
- Quick Connect with a QR code. "Use Quick Connect" on the sign-in page opens Lumen's own screen: the code in large
  digits with a QR code beside it, and how to approve it ("on your phone or computer, open Lumen → Quick Connect and
  enter this code, or scan"). Scanning opens the approve page with the code filled in. The screen gets a new code
  when the server says the old one has expired, twice (about half an hour), then stops and offers "Get a new code";
  it stops asking the server as soon as it's closed or the page changes. On a TV the code is big enough to read from
  the sofa, the remote moves between the buttons and Back closes it, and Quick Connect is the sign-in page's main
  button. Wherever Lumen can't run it, jellyfin-web's own Quick Connect dialog shows as before.
- Quick Connect's approve page (account menu → Quick Connect) is Lumen's: one six-digit field that takes a pasted
  "123 456", the account the other device will be signed in as, and a warning to approve only a code shown on a
  screen in front of you. A code from a link or QR code is only filled in, never approved without a tap, and leaves
  the address bar. Administrators can still sign the device in as another user. Each of the server's answers gets
  its own message: signed in, wrong or expired code, already used, Quick Connect turned off (with a pointer to
  Dashboard → General for administrators), or your own sign-in expired.
- "Public address for QR codes" in Lumen's settings (General): the address phones reach the server at, with its base
  path, for TVs that reach it by a LAN address. Empty, the QR code uses the address the TV or computer itself uses.
- Top charts: a page of the most watched movies or shows on Trakt this week, month, year or of all time, up to 100
  with their Trakt rank, opened with "See all" from the Top 10 rows. Titles you don't have are request cards when
  Seerr is set up.
- Box Office, Most Anticipated Movies and Shows, Trending Movies and Shows, and Trakt list (any public list) home
  rows, with the Trakt key. The settings card is now "Trakt" and names everything the key powers.

### Changed
- Home sections in Lumen's settings are compact rows you can drag (or move with the keyboard or remote) into order,
  rename in place, and open for their settings; an ⓘ says what each type shows.
- jellyfin-web's Delete confirmation and its other confirm dialogs have Lumen's look at every size and on TVs.
- The sign-in page's restyle is no longer CSS only: Quick Connect there is Lumen's (above).

## [0.4.3] - 2026-11-12

### Fixed
- Lumen's settings page now updates with Lumen. Behind a proxy that caches scripts by itself (Nginx Proxy Manager's
  "Cache Assets"), browsers could keep the previous version's settings page for hours after an update, without the
  Storage tab or the Top 10 card.

## [0.4.2] - 2026-11-12

### Added
- Request progress (with Seerr): your requests say where they stand (Requested, Queued, Downloading, Processing,
  Ready, or Declined/Failed) on their posters in every row and on their title page, with a progress bar and the time
  left while they download (from Radarr's and Sonarr's queues, when Seerr is connected to them); a show counts its
  episodes. A title page updates while it's open.
- My requests in the account menu (and on the Me page on phones) lists your requests, newest first.
- A pop-up says when something you requested is ready to watch, with Open, once per title across your devices.
- Lumen settings in the account menu (and the Me page) for administrators: Lumen's settings page in one click,
  instead of Dashboard → Plugins → Lumen.

## [0.4.1] - 2026-11-12

### Added
- Top 10 Movies and Top 10 Shows home rows: what Trakt's users watched most this week, ranked, with a Request button
  under titles you don't have yet when Seerr is set up (without Seerr, only titles on the server are shown). Without a Trakt key they rank Seerr's trending titles instead. Add them under
  Home sections; a Top 10 card in Lumen's settings takes the Trakt key and checks it.
- Discard in the settings save bar puts back the settings as last saved.
- Storage has a tab of its own on Lumen's settings page, and only measures once it's opened. The page remembers the
  open tab across a reload, and unsaved settings stay (with the save bar) while you look at Storage.
- Pointing at, tapping or arrowing through a part of a library's storage bar shows its codec or resolution, size,
  file count and share.

### Changed
- The home banner's pager is thin bars again, with Pause on their right (first on TVs).
- Rows scroll freely and stay where you let go; a quick mouse flick glides a little.
- A home section type that would only repeat the same row (Continue Watching, Next Up, …) can be added once.
- Storage's headline sizes are in the normal text colour rather than grey.

### Fixed
- "You May Like" cards no longer overlap on details pages.
- Undoing a change in the settings by hand (a switch toggled back, a section moved back, a value or key typed and
  deleted) no longer leaves "Unsaved changes" showing.

## [0.4.0] - 2026-11-12

### Added
- Install Lumen as a home-screen app: adding the server to a phone's home screen gives a "Lumen" app with Lumen's
  icon, no browser bars and a status bar that blends in. An admin setting can name it after the server instead.
  Re-add an existing home-screen icon to pick this up.
- An account menu in the nav, with a History page (what you watched, by day) and Watch together.
- A More (⋯) menu on details pages and cards with jellyfin-web's item actions (edit metadata and images, identify,
  refresh, add to a collection or playlist, delete, …). Deleted titles leave every list.
- "Mark as unwatched" asks first, since it also removes the title from History.
- A Storage card on Lumen's settings page: space by library, video codec and resolution, the H.264 1080p+ files worth
  re-encoding, and the biggest movies and series.
- An admin setting to let home banner trailers finish before the next slide.
- Lumen's look for jellyfin-web's own dialogs, menus and notifications on every page, and a centred layout with
  section cards and Lumen tabs for the Dashboard's admin pages.
- A restart banner with a Restart button on the admin pages; the settings save bar slides up when there are changes.
- Lumen's own "Page not found", and clearer error pages ("You don't have access to this", "The server had a
  problem", "The server didn't answer") with Try again.

### Changed
- Player on touch screens: a tap shows or hides the controls instead of pausing; menus scroll and every option is
  reachable; a double tap on either side skips; Android goes landscape in full screen.
- Skip back and forward are both exactly 10 seconds (buttons, double tap, arrow keys and J/L), whatever Jellyfin's
  own skip settings say.
- New outline icons throughout (Lucide), a little bigger; the volume icon shows the level.
- Inter on Linux, Windows, Android and TVs (Apple devices keep San Francisco), loaded behind the loading screen.
- A smaller startup download (about 72 KB → 65 KB): less-used pages, the stock pages' and admin pages' styles load
  where they're used.
- The server's accent colour applies to every restyled jellyfin-web page, not only the Dashboard; destructive buttons
  stay Lumen's red.
- On TVs the account menu and profile hide Dashboard and Metadata manager, as jellyfin-web does.

### Fixed
- Dragging the volume slider no longer jumps back and forth.
- Many TV remote fixes: dropdowns no longer trap the D-pad, the nav and the hero's Pause are reachable, History's days
  can be navigated, and a page that finishes loading no longer steals focus from an open menu.
- Music genres go back to jellyfin-web without a flash; the music now-playing bar sits above the phone tab bar.

## [0.3.7] - 2026-11-10

### Added
- Trailer previews now play in Safari, Firefox and on iOS: when a browser can't play a trailer as is, the details
  page plays a converted copy (at most 720p). The home banner only plays trailers the browser can play directly.
- Trailers can be paused, on the home banner and on details pages.
- Cards have a More button (on hover or keyboard focus) for their actions; they're also real links now, so they can
  be opened in a new tab.
- Dates and numbers follow each user's Jellyfin display language and date format.
- Setting: "Load Jellyfin's web app faster" (on by default). See Changed.

### Changed
- Faster loading:
  - Jellyfin's web app downloads about half as much on a first visit: its files are compressed once at the highest
    level and, where their names prove their content, cached for a week.
  - Lumen's own files, and its home and request data, are compressed (also over HTTPS).
  - The player and trailer previews load only when needed.
  - Faster home page queries (Continue Watching, Recently Added), and playback starts one request sooner from
    details pages.
  - Images are requested at the size they're shown, so they're sharp on phones and in wide grids.
- Lumen finds Jellyfin's player through the web app's plugin hook, so jellyfin-web updates are less likely to break it.
- Older TV browsers (webOS TVs with Chrome 68, Safari 13) can run Lumen; on phones in landscape, controls and pages
  clear the notch.

### Fixed
- TV remotes: Back closes Lumen's menus and dialogs instead of leaving the page, and the first Back in the player
  leaves it; episode details links are reachable; a show's Play button gets focus; Books, Music Videos and Playlists
  open in every layout.
- Keyboard and screen readers: the player's volume slider no longer seeks; its panels, page headings and landmarks are
  announced properly; buttons are named as they read; Space presses the focused player button.
- Lumen no longer turns off until a reload when its settings fail to load once at startup.
- Play buttons can no longer stay stuck on "Starting…".
- Scrubbing after the next episode starts on its own shows that episode's thumbnails.
- The arrow keys in the player seek from where the video is, even with the controls hidden.

## [0.3.6] - 2026-11-10

### Fixed
- Lumen's settings page no longer sometimes stays on "Loading Lumen settings…".
- After installing an update, Restart now waits for Jellyfin to come back and reloads the page.
- Starting playback no longer flashes the loading screen a second time.

## [0.3.5] - 2026-11-10

### Added
- Details: Start over beside Resume.
- Plugin pages: a status chip above the name (Enabled / Disabled, click to toggle), Settings and Uninstall under the
  description, and the revision history as separate cards.

### Changed
- The loading screen (title backdrop, name, spinner) appears the moment Play is clicked, and stays until the first
  frame.
- Player: Watch together moved into the settings (gear) panel.
- Jellyfin's notices (e.g. SyncPlay) drop from the top as a pill, like the volume pill.
- A redrawn heart; the watched button reads "Mark watched" until it's watched.
- Dashboard: destructive buttons (Restart, Shutdown, Delete, Uninstall) in Lumen's red; a tidier server card at the
  top of the drawer.

### Fixed
- Clicking the server card in the Dashboard no longer flashes Jellyfin's own home page.
- Settings panel rows no longer touch the divider.

## [0.3.4] - 2026-11-10

### Added
- Player: Watch together as a pill next to Quality, with the same menu as the nav.
- Player: Cast, next to picture-in-picture and AirPlay, when Jellyfin can see another place to play (cast devices,
  other Jellyfin apps). It moves what's playing there, from the same position.
- Player: "Ends at" opposite the elapsed time, at the current speed.
- Player: a settings (gear) pill with Repeat (movies: Off / Repeat; episodes: Off / This episode / All episodes) and
  Playback info (direct play or transcode and why, codecs, resolution, container, bitrate, encode speed).
- Player: a loading screen (the title's backdrop, its name and a spinner) until the video starts, and a spinner when
  playback stalls.

## [0.3.3] - 2026-11-10

### Added
- Check for updates: on Lumen's settings page, and as "Check for Lumen updates" on Jellyfin's Plugins page. It reads
  Lumen's releases on GitHub straight away, shows the new version's notes, installs it through Jellyfin's own
  installer and offers to restart Jellyfin.

### Changed
- Admin pages: room under the top bar for page titles; the Dashboard's Activity and Paths widgets and the Tasks list
  as cards; neutral disk-usage bars; rounded user cards; quieter field hints.
- Dependency updates (Vite, Vitest, Playwright, GitHub Actions, test packages). Preact stays on 11.1: 11.2 breaks
  rendering under jellyfin-web.

## [0.3.2] - 2026-11-09

### Added
- Dashboard look: the admin Dashboard, the metadata manager and plugin settings pages take Lumen's colours, accent,
  type and shapes (drawer, cards, buttons, tables, dialogs, inputs), with Lumen's mark in the drawer. Restart,
  Shutdown, Delete and Uninstall are outlined in red so they never look like the accent. CSS only, behind the
  (renamed) "Restyle Jellyfin's sign-in, settings and Dashboard pages" switch.

### Changed
- Settings pages use the settings menu's width, so titles, fields and the menu line up.
- Checkboxes on settings and admin pages: a smaller rounded box centred on its label, the accent with a white tick.
- Save and other primary buttons darken on hover.
- The "Switching to …" note stays up while a restarted stream is still loading (slow server transcodes took over
  20 s and left a frozen picture that looked paused).

### Fixed
- The Watch together button in the nav looks like the other nav items.
- Opening a dropdown on a long settings page no longer removes the scrollbar and shifts the page sideways.
- No blue hover glow or blue focus border on checkboxes.

## [0.3.1] - 2026-11-09

### Added
- Watch together (SyncPlay): a button in the nav and a row on the Me page list the groups you can join with who's in
  them, create a group, and in a group show its members, Leave group and Start/Stop group playback. The player shows
  who you're watching with, and Jellyfin's notices take Lumen's toast look.
- Trickplay: hovering or dragging the seek bar shows the server's thumbnail for that time (when the library has
  trickplay images).
- A volume pill drops down from the top of the player when the volume changes (scroll wheel, keys, mute), without
  bringing back the controls.

### Changed
- Play and Resume show "Starting…" until the player opens.
- Picking the quality, audio or subtitle track that's already selected does nothing. When a change restarts the
  stream, the last frame stays up with "Switching to …" until playback is going again.

### Fixed
- The seek bar stays where you click instead of snapping back to the old position while the player seeks.
- Jellyfin's volume card no longer pops up over the player.
- The scroll wheel no longer brings back the player controls.

## [0.3.0] - 2026-11-09

### Added
- Episode pages: the episode's still, its show (linking to that season) and number, air date, runtime and overview,
  Play/Resume, Favorite and Watched, previous/next episode across seasons, guest stars and cast, and the rest of the
  season as a row. More info on an episode card opens it, and each row of a season's episode list links to it.
- Library tabs on Movies and Shows, in Jellyfin's tab order: Suggestions (continue watching, latest, and Jellyfin's
  recommendations such as "Because you watched…"), Upcoming (Shows, by air day), Favorites (Movies), Collections,
  Genres and Studios (tiles opening that genre or studio within the library), and Episodes (Shows, newest first).
- Studio pages (`#/list?studioId=…`), like the genre pages.

### Changed
- Lumen is tested on Jellyfin 12.4 only; CI and the nightly run on 12.4. Older 12.x servers still work and show as
  untested in diagnostics.

## [0.2.4] - 2026-11-09

### Fixed
- Play starts in the tab you pressed it in. With more than one Jellyfin tab open in a browser, it could start in
  another tab instead, leaving the current one unchanged.
- Seerr artwork URLs no longer carry your Jellyfin access token (which could end up in proxy logs and browser
  history). They use a per-user token that only opens catalog artwork.

## [0.2.3] - 2026-11-09

### Changed
- Back returns to the same spot in a grid, and only Back: opening Movies, Shows, a genre or Favorites from the nav
  loads them fresh. Favoriting or marking a title watched no longer resets the grids you scrolled.
- Errors are never silent: a failed play, favorite or watched change shows a short message on every page, and pages
  that fail to load offer Try again. Search says when it failed instead of "No results".
- Jellyfin's start page (index.html) is served compressed.
- The admin page is organised into sections; a failed save, reset or lookup says what happened without hiding the
  rest of the page.
- The release workflow waits for CI on the tagged commit and can be re-run safely.

### Fixed
- The Seerr API key is never sent to another host when Seerr answers with a redirect (for example behind a sign-in
  proxy); Lumen reports the redirect instead.
- If Lumen hits an error while preparing Jellyfin's start page, the stock page is served instead of an error page.
- Saving Lumen's settings through Jellyfin's own plugin-settings endpoint keeps the Seerr key, validates and refreshes
  caches, like the Lumen admin page.
- Seerr's discover lists and titles are no longer shared between users with different language or region settings.
  Home shows a new request straight away, and Test connection works even while Seerr requests are paused after errors.
- Turning Lumen off now also turns off its home and request endpoints.
- A slow page load retries before falling back to the stock UI, the stock player takes over at once if Lumen can't
  attach to Jellyfin's player, and the sign-in look can no longer stay on after signing in.
- TV layout: browse, search and profile pages start with a focused item.
- Phones: the request dialog fits on iOS and can't be closed mid-request, text buttons keep their text, and poster
  grids show three across.
- Screen readers hear a short result count in search instead of every result.

## [0.2.2] - 2026-11-09

### Added
- Lumen pages for the genre list (home genre tiles: All / Movies / Shows and a sort menu), people (portrait, born and
  died, biography, and their titles in the library), collections (the details header over the collection's titles,
  oldest first) and the Collections library.

### Changed
- A refined J mark: one ribbon width round a true semicircle bowl, purer reds, a back ribbon that darkens toward the
  fold, a soft cast shadow at the crease and gently curved ribbon ends. The nav, loading veil, tab icon, sign-in page,
  settings page, PWA icons (now without the glow) and plugin image all use it.
- One red throughout: the UI accent is now the logo's red (`#e30b17`). Servers still on the old default red move to it;
  a custom accent is kept.
- Player: redrawn ±10 s buttons, and the quality menu shows each preset's bitrate (Jellyfin caps the bitrate and keeps
  the source resolution, as in its own menu).

### Fixed
- The resume bar in the Resume button is centred again, the player's timeline no longer has a grey band behind it, and
  button icons sit level with their labels.

## [0.2.1] - 2026-11-09

### Added
- Lumen's video player controls, over jellyfin-web's player: title and episode top left; **Quality** (Auto or a
  preset, aspect ratio, speed) and **Audio & Subtitles** (tracks side by side, subtitle timing) panels top right; a
  slim scrubber with the time above it; play, ±10 s and volume bottom left; next episode, favorite, picture in
  picture, AirPlay and full screen bottom right. Playback, subtitles, keyboard shortcuts and the skip-intro / up-next
  prompts stay Jellyfin's. Admin switch: "Use Lumen's video player controls".

### Changed
- Settings page: every dropdown uses Lumen's dropdown; each home section explains in a sentence what it shows; the save
  bar reads status on the left and Reset to defaults then Save on the right; browsers and password managers no longer
  fill the Seerr address and API key.
- The plugin catalog image drops the glow behind the mark.
- Jellyfin's settings pages (Playback, Subtitles, Home, Quick Connect, …) use Lumen's dropdown over their own selects,
  which stay in charge of the value; the Display page's menus are restyled to match.
- The bottom tab bar is used below 910px wide (phones, small tablets, narrow windows); the centred pill from 910px.

### Fixed
- Security: the stored Seerr API key is only reused for the saved Seerr address (testing or saving a new address
  needs its key typed again), and it's no longer readable through Jellyfin's own plugin-configuration endpoint.
- Seerr calls use the endpoint the user was mapped against, so a settings change mid-request can't send one Seerr's
  user id to another.
- Seerr resilience: a late success can't close the circuit breaker early; after the pause one probe call decides;
  cached catalog lists are dropped after a request; My Requests returns the titles it has instead of timing out.
- TMDB image cache: interrupted downloads no longer leave temp files; the size cap is enforced on startup and after
  large writes.
- Favorite/watched state is shared by the details page, card menus and the player, sent in order per item, and
  saved grids refresh after a change; a fresh title page replaces an old "Requested" state.
- Library grids keep paging when the library changes mid-scroll; More info from a card menu keeps the grid position.
- Sign-out mid-play can't start playback in the next user's session; per-user caches are cleared on sign-out; a
  details link for another server is left to Jellyfin.
- Phones with more than two libraries get a More tab; the hero's slide dots and pause button work by keyboard (and
  pause shows on phones); drag-scroll and long-press can't get stuck; settings dropdowns respect disabled settings.
- Admin page: edits can't be lost to an in-flight save; the sign-in look comes off even if lumen.js fails to load;
  the loading veil isn't shown when Lumen is switched off; hero images are sized to the screen.
- Route classes on `<html>` are now `lmn-route-*`, so a page's own classes (e.g. the Settings page's `.lmn-profile`)
  no longer also style the whole document.
- A long server name truncates instead of running under the centred nav pill.
- A dropdown near the left edge (Genre on phones) no longer opens off screen; lists open toward the side with room.

## [0.2.0] - 2026-11-08

### Added
- Movies and Shows library pages: a poster grid that loads as you scroll, with All / Unwatched / Watched, genre and
  sort (recently added, title, release date, rating). Back from a title returns to the same spot.
- Favorites page (Movies, Shows and Episodes tabs) and a Favorites link in the nav.
- "Replace the Movies, Shows and Favorites pages" admin switch.
- The hero can be swiped (touch) or dragged (mouse) between slides.
- The ribbon "J" mark in the header and as the browser tab icon.
- A loading veil (black, the mark and server name, a red edge) covers jellyfin-web's splash logo and spinner on a
  cold load, then rises like a curtain once the page is ready.
- Right-click (or long-press on touch) any card for Play/Resume, More info, Open in new tab, favorite and watched.
- Custom dropdowns for genre, sort and season.
- Search page: results grouped by Movies, Shows, Episodes and People as you type, and an "Explore your library" grid
  before you do. The query is kept in the URL, so Back returns to it.
- Requests (with Seerr configured): search shows "More to request" titles from Seerr's catalog with their request
  state; a title page (backdrop, rating, runtime, genres, overview, cast, trailer link, recommendations) with a
  Request button; and a request dialog (one step for movies, a season checklist for shows). Requests are filed in
  Seerr as the signed-in user, so their permissions, quota and approval rules apply.
- Jellyfin's sign-in page (a centred card with the mark and server name) and its settings pages (Profile, Quick
  Connect, Display, Home, Playback, Subtitles, Controls) wear Lumen's look; the settings pages get Lumen's nav and a
  back link to the settings menu. CSS only: the forms stay Jellyfin's. Admin switch: "Restyle Jellyfin's sign-in and
  settings pages".
- Catalog home rows (Seerr): My Requests (in the defaults for new installs), and opt-in Trending, Popular Movies,
  Popular Shows and Coming Soon. They mix titles the server has (normal cards) with request cards. Seerr's discover
  lists are cached server-wide for 10 minutes, and a circuit breaker hides request features for a minute after three
  Seerr failures in a row, so home stays fast when Seerr is down.
- Phones: a bottom tab bar (Home, up to two libraries, Favorites, Me) with search as its own button at the top.
- Home rows scroll by click-and-drag with a mouse; their arrows are glass buttons.
- A plugin image for Jellyfin's catalog, and the J mark on Lumen's settings page (one shared `LumenMark` component).
- "Add to Home Screen" installs with Lumen's icon and the server's name (Lumen's web app manifest and touch icon).
- Settings page (the profile button): your avatar and name, grouped links to Jellyfin's settings pages, admin links for
  administrators, and Sign out.

### Changed
- Sign out spans the full width on phones.
- A card's title turns the accent colour on hover.
- The nav pill is centred at the top of the page on wider screens.
- The hero keeps rotating while hovered or focused by the page; only keyboard navigation inside it pauses it.
- Popular Genres keeps the most popular genres but lists them alphabetically.
- Clicking a card always opens its page (an episode opens its season); play from the page or the card menu.
- The hero slides follow the pointer one-to-one while dragging, and auto-advance slides the same way.
- The details "My List" button is now "Favorite", with a heart.
- The header has no bar, only a soft top fade; the nav pill and its labels are a little larger.

### Fixed
- jellyfin-web's own header no longer flashes for a moment before Lumen loads.

## [0.1.0] - 2026-10-07

### Added
- Cinematic home screen: rotating hero with optional muted local-trailer previews, a floating pill nav (Home, your
  libraries, search, settings), and admin-configurable rows of landscape cards (Continue Watching, Next Up, Recently
  Added, Because You Watched, Genre, New For You, Curated, Popular Genres tiles).
- "Recently added", "New episode" and "New season" card badges, computed by the server.
- Movie and series details pages with resume, smart play, seasons, cast, and "You may like"; the local trailer plays
  muted behind the header, with a mute toggle.
- Admin dashboard page for sections, hero, and diagnostics.
- Automatic fallback to the stock UI on any error or jellyfin-web incompatibility.
