# Lumen for Jellyfin

Lumen gives Jellyfin's web interface a cinematic redesign:
- **Home:** a swipeable rotating hero with optional muted trailer previews, under a floating pill nav to your libraries, favorites, search and settings; personalized rows of landscape cards (Because You Watched, daily genre picks, New For You, curated collections, playlists or tags, plus Popular Genres tiles); "Recently added", "New episode" and "New season" badges.
- **Details:** movie and series pages built around one-click play and resume, with the local trailer playing behind them; collection pages (the collection's titles, oldest first) and people pages (photo, biography and their titles in your library).
- **Browsing:** Movies, Shows and Collections pages with an endless poster grid, watched/genre filters and sorting; genre pages (All / Movies / Shows); and a Favorites page.
- **Search:** results grouped by Movies, Shows, Episodes and People as you type.
- **Requests (optional, with Seerr):** search also finds titles the server doesn't have, with a title page and a request dialog; home rows for My Requests, Trending, Popular and Coming Soon. Requests are filed as the signed-in user, so their Seerr permissions and quotas apply.
- **Request progress (with Seerr):** each of your requests says where it stands (Requested, Queued, Downloading, Processing, Ready, or Declined/Failed) on its posters in every row and on its title page, with a progress bar and the time left while it downloads (from Radarr's and Sonarr's queues, when Seerr is connected to them); a show counts its episodes. **My requests** in the account menu lists them all, newest first, and a pop-up says when one is ready to watch (once, on any of your devices). Lumen checks only while something is in flight and the page is visible.
- **Top 10 this week (optional):** ranked "Top 10 Movies" and "Top 10 Shows" home rows of what Trakt's users watched most this week (with a free Trakt API key in Lumen's settings), or Seerr's trending titles without one. Titles on the server open and play like any card; with Seerr, the rest can be requested right from the row.
- **Top charts and Trakt rows (optional, with a Trakt key):** a **Top charts** page, opened from a Top 10 row's title, ranks Trakt's 100 most watched movies or shows of the week, month, year or all time, each with its true Trakt rank. Home sections add **Box Office** (this weekend's US top 10), **Most Anticipated** and **Trending** movies and shows, and **Trakt list** (any public list, by its address). Titles on the server open and play; with Seerr, the rest can be requested in place. The key stays on the server; Lumen only reads Trakt's public charts and lists.
- **Player:** Lumen's controls over Jellyfin's own video player (quality, audio and subtitle tracks, speed, next episode, picture in picture, AirPlay). Playback itself stays Jellyfin's.
- **Quick Connect with a QR code:** "Use Quick Connect" on the sign-in page shows the code large with a QR code beside it (made for a TV across the room; on a TV it's the sign-in page's main button). Scan it with a phone, or open Lumen → Quick Connect on any signed-in device and type the code, then tap Approve: the TV signs in by itself. The approve page names the account the device will be signed in as (administrators can pick another), warns to approve only a code shown on a screen in front of you, and never approves a code from a link without a tap. If your TVs reach the server by a LAN address your phones can't use, set **Public address for QR codes** in Lumen's settings (General).
- **Sign-in and settings:** Jellyfin's sign-in page and its user settings pages wear Lumen's look (the forms stay Jellyfin's; Quick Connect there is Lumen's own, above), and "Add to Home Screen" installs with Lumen's icon.

It is a single, self-contained server plugin, with no other plugins required. Whenever anything goes wrong, Jellyfin's stock UI takes over automatically.

## Requirements

- Jellyfin **12.1 or newer** (tested on 12.4: CI and a nightly run on 12.4, plus nightly runs against 12.1 and the latest and unstable builds, in Chromium, Firefox and iPhone WebKit; the list is in [`client/src/compat/tested-jellyfin.json`](client/src/compat/tested-jellyfin.json))

## Install

1. Dashboard → Plugins → Manage Repositories → **+**, then add
   `https://raw.githubusercontent.com/ahappysloth/jellyfin-plugin-lumen/main/manifest.json`.
2. Dashboard → Plugins → Catalog → **Lumen** → Install. Restart Jellyfin.
3. Dashboard → Plugins → **Lumen** to configure the hero and home sections.

To update, use **Check for Lumen updates** on the Plugins page (or **Check for updates** on Lumen's page). It reads
Lumen's releases on GitHub straight away (no waiting for Jellyfin's daily plugin update task), installs the new version
through Jellyfin's own installer, and offers to restart Jellyfin to load it.

The **Storage** card on Lumen's page shows where the space goes, to help decide where re-encoding (e.g. with Unmanic)
or a Radarr/Sonarr profile change would save the most: the total size and file count, each library, the split by video
codec (H.264, HEVC, AV1, other) and resolution (SD, 720p, 1080p, 4K), HDR, the 15 biggest movies and series, and the
usual re-encode pool, "H.264 at 1080p and above". It only reads Jellyfin's library database and never changes a file.
Every version of a title and every part of a multi-part one (cd1, cd2) counts; trailers, extras and videos outside the
libraries (channel plugins) don't; .strm and remote files, and files Jellyfin hasn't measured yet, are counted as "size
unknown". The numbers are computed in the background and kept for 10 minutes (**Refresh** recomputes them).

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

The oldest browsers Lumen is built for are Chromium 68 (LG webOS 5) and Safari 13. On webOS 6 (Chromium 79) and webOS 5 it should load, untested. webOS 4 (Chromium 53) and older can't run it: their browser predates the JavaScript Lumen is written in, so its scripts never start and Jellyfin's own interface shows instead.

## Install as an app

Added to a phone's home screen, Jellyfin opens as **Lumen**: its name and icon, full screen with no browser bars, on Lumen's dark background. While Lumen is on, the server's page offers Lumen's web app manifest, icons and app tags in place of Jellyfin's; switch Lumen off and Jellyfin's come back.

- **iPhone and iPad (Safari):** open your server, tap Share, then **Add to Home Screen**. The app runs full screen, with the status bar over Lumen's dark page.
- **Android (Chrome):** open your server, tap ⋮, then **Add to Home screen** or **Install app**.

**Already have an icon on your home screen?** A home screen keeps the name and icon an app was added with. Remove the old one and add it again to get Lumen's. Your sign-in carries over on Android; on an iPhone, each home-screen app keeps its own sign-in, so sign in again in the new one.

The app is called "Lumen". To name it after your server instead, turn on **Name the home-screen app after this server** in Lumen's settings (then re-add the icon). The official Jellyfin mobile apps aren't affected: they load the same page but don't install it.

## Notifications

With Seerr set up, each user can turn on **Notify me when requests are ready** on a device, in My requests or on their profile page: a notification says when something they requested is ready to watch, even with the app closed, and a tap opens it.

- **iPhone and iPad:** notifications work in the Home Screen app (above), on iOS 16.4 or later. In a Safari tab, Lumen says so instead of showing the switch.
- **Elsewhere:** Chrome, Edge, Firefox and Safari on a computer or on Android. Not on TVs.
- The server must be reached over **https** (browsers have no notifications on plain http, except `localhost`), and must itself be able to reach the browsers' push services over https.
- Lumen asks Seerr every 2 minutes on behalf of users with notifications on. To hear at once, add Seerr's webhook: Dashboard → Plugins → Lumen → Requests → Notifications shows the address and secret to enter in Seerr (Settings → Notifications → Webhook, with "Request Available" ticked).
- A notification's text is encrypted for the one device; the push service that relays it can't read it.

## Running alongside other plugins

Lumen injects its own script, lists itself as a jellyfin-web plugin in `/web/config.json` (this is how it gets Jellyfin's player), and hides only the stock pages it replaces (home, details, the Movies, Shows and Collections libraries, genre lists, Favorites, search and the settings menu) while it shows its own. It can run next to plugins that use the File Transformation plugin, but plugins that also redesign the home screen will be hidden while Lumen's home is showing. If you use one of those, turn off "Replace the home screen" in Lumen's settings.

Links Lumen shares carry a couple of extra URL parameters that Jellyfin's own pages ignore: a Seerr title opens as `#/home?title=movie-<id>`, and the Collections library as `#/list?parentId=<id>&collectionType=boxsets`. Where Lumen isn't active (switched off for that user or page, or after a failed compatibility check), the same link shows Jellyfin's home or its plain list of the library instead.

## Reverse proxies

- **Content Security Policy.** Lumen adds two small inline scripts to Jellyfin's `index.html`: one registers Lumen's jellyfin-web plugin, the other makes its loading screen and the restyled sign-in, settings and Dashboard pages appear before the page paints (it links those pages' stylesheets where they're used). A proxy that sends a CSP with `script-src 'self'` blocks them: Lumen still loads, but without the loading veil, the restyled sign-in and Dashboard pages and jellyfin-web dialogs, and Lumen's Quick Connect screen on the sign-in page (jellyfin-web's own dialog shows instead) (and, rarely, jellyfin-web logs "failed loading plugins" when it reaches Lumen's plugin before Lumen's main script has registered it). Either allow `'unsafe-inline'` for scripts, or add both scripts' hashes. The browser console's CSP errors show the exact `'sha256-…'` values to add; they change with every Lumen release, and the second also with the "Restyle Jellyfin's sign-in, settings and Dashboard pages" setting (from a checkout, `cd client && npm run build && npm run guard-hash` prints all three). Lumen's tab icon and a few images are `data:` URLs, so `img-src` needs `data:` too.
- **Fonts.** Except on Apple devices, which use their own system font, Lumen's pages use Inter, which Lumen serves itself from the same server (`/Lumen/Assets/lumen-font-*.woff2`). A CSP needs `font-src` (or `default-src`) to allow `'self'`.
- **Notifications.** Lumen's service worker is `/Lumen/Push/sw.js` (under the base URL, if any). Browsers fetch it without signing in, so a proxy with its own login must let it through; a CSP needs `worker-src` (or `script-src`) to allow `'self'`. Nothing else about notifications passes through the proxy: the server sends them to the browsers' push services itself.
- **Installing to a home screen.** Phones fetch the app's manifest (`/Lumen/Manifest`) and icons (`/Lumen/Assets/lumen-icon-*.png`) without signing in, so a proxy that asks for its own login must let those through, as it does `/web/`. With a base URL they're under it (`/jellyfin/Lumen/Manifest`). Lumen adds no inline content for this: the manifest and icons come from the same server, so a CSP only needs `manifest-src` (or `default-src`) to allow `'self'`.
- **jellyfin-web served by the proxy.** Lumen adds itself to the web client that Jellyfin serves (`/web/`). If your proxy serves its own copy of jellyfin-web (with Jellyfin's hosted web client turned off), nothing injects Lumen into it, and the stock UI is shown. Serve `index.html` and `config.json` from the same place: Lumen lists its plugin in `config.json` only alongside the `index.html` that defines it.

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

Lumen's interface font is [Inter](https://github.com/rsms/inter) 4.1, Copyright (c) 2016 The Inter Project Authors, under the SIL Open Font License 1.1 (see [client/src/assets/fonts/LICENSE-Inter.txt](client/src/assets/fonts/LICENSE-Inter.txt)). Lumen ships a subset of it (`client/scripts/subset-inter.sh`).

Lumen's icons are [Lucide](https://lucide.dev)'s, under the ISC license (some of them from Feather, MIT). See [LICENSES/lucide.txt](LICENSES/lucide.txt), which the plugin also carries inside its DLL.
