# Changelog

All notable changes to Lumen are documented here. Versions follow SemVer; Jellyfin sees them as `MAJOR.MINOR.PATCH.0`.

## [Unreleased]

### Added
- Movies and Shows library pages: a poster grid that loads as you scroll, with All / Unwatched / Watched, genre and
  sort (recently added, title, release date, rating). Back from a title returns to the same spot.
- Favorites page (Movies, Shows and Episodes tabs) and a Favorites link in the nav.
- "Replace the Movies, Shows and Favorites pages" admin switch.
- The hero can be swiped (touch) or dragged (mouse) between slides.
- The ribbon "J" mark in the header and as the browser tab icon.

### Changed
- The nav pill is centred at the top of the page on wider screens.
- The hero keeps rotating while hovered or focused by the page; only keyboard navigation inside it pauses it.
- Popular Genres keeps the most popular genres but lists them alphabetically.

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
