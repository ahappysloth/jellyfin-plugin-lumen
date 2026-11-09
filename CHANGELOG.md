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
- A loading veil (black, the mark and server name, a red edge) covers jellyfin-web's splash logo and spinner on a
  cold load, then rises like a curtain once the page is ready.
- Right-click (or long-press on touch) any card for Play/Resume, More info, Open in new tab, favorite and watched.
- Custom dropdowns for genre, sort and season.

### Changed
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
