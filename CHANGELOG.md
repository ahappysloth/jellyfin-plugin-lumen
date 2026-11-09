# Changelog

All notable changes to Lumen are documented here. Versions follow SemVer; Jellyfin sees them as `MAJOR.MINOR.PATCH.0`.

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
