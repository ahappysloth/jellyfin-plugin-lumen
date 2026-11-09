# Changelog

All notable changes to Lumen are documented here. Versions follow SemVer; Jellyfin sees them as `MAJOR.MINOR.PATCH.0`.

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

## [0.1.0]

### Added
- Cinematic home screen: rotating hero with optional muted local-trailer previews, a floating pill nav (Home, your
  libraries, search, settings), and admin-configurable rows of landscape cards (Continue Watching, Next Up, Recently
  Added, Because You Watched, Genre, New For You, Curated, Popular Genres tiles).
- "Recently added", "New episode" and "New season" card badges, computed by the server.
- Movie and series details pages with resume, smart play, seasons, cast, and "You may like"; the local trailer plays
  muted behind the header, with a mute toggle.
- Admin dashboard page for sections, hero, and diagnostics.
- Automatic fallback to the stock UI on any error or jellyfin-web incompatibility.
