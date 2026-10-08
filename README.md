# Lumen for Jellyfin

Lumen gives Jellyfin a cinematic home screen and redesigned movie/series details pages:
- a rotating hero with optional muted trailer previews
- personalized rows: Because You Watched, daily genre picks, New For You, curated collections
- details pages built around one-click play and resume

It is a single, self-contained server plugin, with no other plugins required. Whenever anything goes wrong, Jellyfin's stock UI takes over automatically.

## Requirements

- Jellyfin **12.1 or newer**

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

- Prerequisites: Node 24 and `./scripts/setup-dev.sh`. It installs the .NET 10 SDK and a portable Jellyfin into your home directory; no sudo or Docker needed.
- `./scripts/dev.sh` builds the plugin and (re)starts a dev server at http://localhost:8096.
- Client tests: `cd client && npm test`. Server tests: `dotnet test`. End-to-end tests: `./scripts/e2e-local.sh`.

## License

GPL-3.0. See [LICENSE](LICENSE).
