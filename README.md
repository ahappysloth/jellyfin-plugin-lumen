# Lumen for Jellyfin

Lumen gives Jellyfin's web interface a cinematic redesign:
- **Home:** a swipeable rotating hero with optional muted trailer previews, under a floating pill nav to your libraries, favorites, search and settings; personalized rows of landscape cards (Because You Watched, daily genre picks, New For You, curated collections, playlists or tags, plus Popular Genres tiles); "Recently added", "New episode" and "New season" badges.
- **Details:** movie and series pages built around one-click play and resume, with the local trailer playing behind them; collection pages (the collection's titles, oldest first) and people pages (photo, biography and their titles in your library).
- **Browsing:** Movies, Shows and Collections pages with an endless poster grid, watched/genre filters and sorting; genre pages (All / Movies / Shows); and a Favorites page.
- **Search:** results grouped by Movies, Shows, Episodes and People as you type.
- **Requests (optional, with Seerr):** search also finds titles the server doesn't have, with a title page and a request dialog; home rows for My Requests, Trending, Popular and Coming Soon. Requests are filed as the signed-in user, so their Seerr permissions and quotas apply.
- **Player:** Lumen's controls over Jellyfin's own video player (quality, audio and subtitle tracks, speed, next episode, picture in picture, AirPlay). Playback itself stays Jellyfin's.
- **Sign-in and settings:** Jellyfin's sign-in page and its user settings pages wear Lumen's look (CSS only; the forms stay Jellyfin's), and "Add to Home Screen" installs with Lumen's icon.

It is a single, self-contained server plugin, with no other plugins required. Whenever anything goes wrong, Jellyfin's stock UI takes over automatically.

## Requirements

- Jellyfin **12.1 or newer** (tested on 12.4: CI and a nightly run on 12.4, plus nightly runs against the latest and unstable builds; the list is in [`client/src/compat/tested-jellyfin.json`](client/src/compat/tested-jellyfin.json))

## Install

1. Dashboard → Plugins → Manage Repositories → **+**, then add
   `https://raw.githubusercontent.com/ahappysloth/jellyfin-plugin-lumen/main/manifest.json`.
2. Dashboard → Plugins → Catalog → **Lumen** → Install. Restart Jellyfin.
3. Dashboard → Plugins → **Lumen** to configure the hero and home sections.

## Where Lumen appears

Lumen changes Jellyfin's *web* interface, so it appears wherever that interface runs:

| Client | Lumen |
|---|---|
| Desktop and mobile browsers | ✅ |
| Official Jellyfin iOS and Android **mobile** apps | ✅ |
| Jellyfin Media Player / desktop app | ✅ |
| LG webOS, Xbox | Best effort (not regularly tested) |
| Samsung Tizen app | ❌ (it ships its own copy of the web interface) |
| Android TV / Google TV, Apple TV (Swiftfin), Roku, Infuse, Streamyfin | ❌ (native apps) |

## Running alongside other plugins

Lumen injects its own script and hides only the stock pages it replaces (home, details, the Movies, Shows and Collections libraries, genre lists, Favorites, search and the settings menu) while it shows its own. It can run next to plugins that use the File Transformation plugin, but plugins that also redesign the home screen will be hidden while Lumen's home is showing. If you use one of those, turn off "Replace the home screen" in Lumen's settings.

Links Lumen shares carry a couple of extra URL parameters that Jellyfin's own pages ignore: a Seerr title opens as `#/home?title=movie-<id>`, and the Collections library as `#/list?parentId=<id>&collectionType=boxsets`. Where Lumen isn't active (switched off for that user or page, or after a failed compatibility check), the same link shows Jellyfin's home or its plain list of the library instead.

## Reverse proxies

- **Content Security Policy.** Lumen adds a small inline script to Jellyfin's `index.html` so its loading screen and sign-in look appear before the page paints. A proxy that sends a CSP with `script-src 'self'` blocks it: Lumen still loads, but without the loading veil and the sign-in look. Either allow `'unsafe-inline'` for scripts, or add the script's hash. The browser console's CSP error shows the exact `'sha256-…'` value to add; it changes with every Lumen release and with the "Restyle Jellyfin's sign-in, settings and Dashboard pages" setting (from a checkout, `cd client && npm run build && npm run guard-hash` prints both). Lumen's tab icon and a few images are `data:` URLs, so `img-src` needs `data:` too.
- **jellyfin-web served by the proxy.** Lumen adds itself to the web client that Jellyfin serves (`/web/`). If your proxy serves its own copy of jellyfin-web (with Jellyfin's hosted web client turned off), nothing injects Lumen into it, and the stock UI is shown.

## Playback tips

Lumen starts playback in Jellyfin's own player, so codecs and transcoding behave exactly as they do without it. For smooth playback:
- enable hardware transcoding (Dashboard → Playback → Transcoding)
- prefer clients that direct-play your files

## Troubleshooting

If Lumen doesn't appear:
1. Hard-reload the page.
2. Check Dashboard → Plugins → Lumen → **Diagnostics**. It lists clients where Lumen fell back to the stock UI and why: a failed compatibility check, jellyfin-web's player not being found (`playbackManager…`), or a stock element Lumen hides that wasn't there (`selector…`). The server version is marked "(untested)" when Lumen's test suite hasn't run against that Jellyfin release yet. Please include it in bug reports.

Privacy note: trailer previews (like stock Jellyfin media URLs) carry your access token in the request URL, so if you run a reverse proxy, redact the `ApiKey` query parameter from its access logs.

## Development

Works on macOS and Linux, including WSL2. See [docs/development.md](docs/development.md) for the full guide.

- **Docker only:** `./scripts/docker-dev.sh` builds everything in containers and starts Jellyfin with Lumen at http://localhost:8096, which other devices on your network can also reach. Use `docker-dev.sh e2e` to also run the end-to-end tests, or `docker-dev.sh test` for the unit tests.
- **Native:** with Node 24 installed, run `./scripts/setup-dev.sh` once. It installs the .NET 10 SDK, a portable Jellyfin and ffmpeg into your home directory, with no sudo or Docker needed. Then `./scripts/dev.sh` builds the plugin and (re)starts the dev server at http://localhost:8096.
- Client tests: `cd client && npm ci && npm test`. Server tests: `source scripts/env.sh && dotnet test`. End-to-end tests: `./scripts/e2e-local.sh`.

## License

GPL-3.0. See [LICENSE](LICENSE).
