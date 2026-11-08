# Lumen for Jellyfin

Lumen gives Jellyfin a cinematic home screen and redesigned movie/series details pages:
- a rotating hero with optional muted trailer previews, under a floating pill nav to your libraries, search and settings
- personalized rows of landscape cards: Because You Watched, daily genre picks, New For You, curated collections, playlists, or tags, plus Popular Genres tiles
- "Recently added", "New episode" and "New season" badges on cards
- details pages built around one-click play and resume, with the local trailer playing behind them

It is a single, self-contained server plugin, with no other plugins required. Whenever anything goes wrong, Jellyfin's stock UI takes over automatically.

## Requirements

- Jellyfin **12.1 or newer** (tested on 12.2, plus nightly runs against the latest and unstable builds)

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

Lumen injects its own script and hides only the stock home and details pages while it shows its own. It can run next to plugins that use the File Transformation plugin, but plugins that also redesign the home screen will be hidden while Lumen's home is showing. If you use one of those, turn off "Replace the home screen" in Lumen's settings.

## Playback tips

Lumen starts playback in Jellyfin's own player, so codecs and transcoding behave exactly as they do without it. For smooth playback:
- enable hardware transcoding (Dashboard → Playback → Transcoding)
- prefer clients that direct-play your files

## Troubleshooting

If Lumen doesn't appear:
1. Hard-reload the page.
2. Check Dashboard → Plugins → Lumen → **Diagnostics**. It lists clients whose compatibility check failed. Please include it in bug reports.

Privacy note: trailer previews (like stock Jellyfin media URLs) carry your access token in the request URL, so if you run a reverse proxy, redact the `ApiKey` query parameter from its access logs.

## Development

Works on macOS and Linux, including WSL2. See [docs/development.md](docs/development.md) for the full guide.

- **Docker only:** `./scripts/docker-dev.sh` builds everything in containers and starts Jellyfin with Lumen at http://localhost:8096, which other devices on your network can also reach. Use `docker-dev.sh e2e` to also run the end-to-end tests, or `docker-dev.sh test` for the unit tests.
- **Native:** with Node 24 installed, run `./scripts/setup-dev.sh` once. It installs the .NET 10 SDK, a portable Jellyfin and ffmpeg into your home directory, with no sudo or Docker needed. Then `./scripts/dev.sh` builds the plugin and (re)starts the dev server at http://localhost:8096.
- Client tests: `cd client && npm ci && npm test`. Server tests: `source scripts/env.sh && dotnet test`. End-to-end tests: `./scripts/e2e-local.sh`.

## License

GPL-3.0. See [LICENSE](LICENSE).
