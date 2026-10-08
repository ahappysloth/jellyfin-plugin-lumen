# Lumen — Foundation + Home & Details UI (Sub-project 1)

- **Date:** 2026-10-04
- **Status:** Draft, awaiting review
- **Target:** Jellyfin Server / jellyfin-web 12.1+ (built against `Jellyfin.Controller` 12.1.0, plugin `targetAbi` 12.1.0.0; latest stable is 12.2, a bugfix release with no plugin-relevant changes)
- **Repo:** `ahappysloth/jellyfin-plugin-lumen` (GPL-3.0)

## 1. Purpose

Lumen is a public Jellyfin plugin that gives Jellyfin a polished, streaming-service-style experience: a cinematic home screen with a rotating hero, personalized rows, and a redesigned details page. It is built as one self-contained plugin, without depending on other plugins.

This spec covers **sub-project 1**: the plugin foundation plus the Home and Details UI. Later sub-projects, each with its own spec, are:

2. Media-server request integration (Seerr proxy, browse/request pages)
3. Skip intro/credits (media-segment-based skip UI, optionally a detector)
4. Resume-tracking improvements
5. Recommendation provider (`IRemoteSimilarItemsProvider`; works on all clients)

### 1.1 Users and clients

- **Primary user:** the author, using a desktop browser, the official Jellyfin iOS app, and a Google TV running the official Android TV app, roughly evenly.
- **Secondary users:** anyone installing Lumen from its public plugin repository.

| Client | Runs jellyfin-web? | Gets Lumen UI? |
|---|---|---|
| Desktop/mobile browsers | Yes | Yes |
| Official Jellyfin iOS / Android mobile apps | Yes (web wrapper) | Yes |
| Jellyfin Media Player / desktop | Yes | Yes |
| LG webOS, Xbox apps | Yes (believed to load the server-hosted web client; unverified) | Best-effort |
| Samsung Tizen app | No. It bundles its own copy of jellyfin-web and never loads the server's `index.html`. | No |
| Official Android TV app, Swiftfin, Roku, Infuse, Streamyfin | No (native) | No. Server-side features from later sub-projects only. |

### 1.2 Success criteria

1. With Lumen enabled, `#/home` shows the Lumen home (hero + configured rows) in the browser and in the official iOS app.
2. Movie and Series details pages show the Lumen details view. Playback started from Lumen uses Jellyfin's own player (resume position, subtitles, device profiles intact).
3. An admin can enable, disable, reorder, add, and configure home sections from the Jellyfin dashboard without editing files.
4. Any Lumen failure (server error, jellyfin-web DOM change, bad config) degrades to the stock Jellyfin UI. It never produces a blank or broken page.
5. Installing and updating works through a standard Jellyfin plugin repository URL.
6. CI catches breakage against Jellyfin's unstable build before users hit it.

### 1.3 Design principles

These apply to every decision in this and later sub-projects:

- **Maintainable:** small, single-purpose units behind interfaces. All jellyfin-web coupling is isolated in one compatibility module.
- **Simple to modify:** behavior is data-driven (section definitions in config). New row types are one class plus one registration, with no admin-page or client changes.
- **Optimized:** one request per home load, server-side parallelism and caching, minimal DTO fields, sized and lazy-loaded images, and a client bundle budget of 60 KB gzipped.
- **Public interfaces only:** use Jellyfin's plugin interfaces and public HTTP API. Never mutate jellyfin-web's React-managed DOM, and never reach into jellyfin-web internals beyond the documented globals listed in §4.2.
- **Fail open:** when in doubt, show the stock UI.
- **No brand imitation:** no third-party product names in code, CSS, routes, IDs, or docs. All identifiers use the `lmn-` / `Lumen` prefix.

### 1.4 Non-goals (this sub-project)

- Seerr integration, intro/credit skipping, resume-tracking changes, recommendation providers
- Changes to the video player OSD, library grid pages, search, or settings pages
- Per-user home customization (the layout is admin-controlled. Row *contents* are still personalized.)
- Localization: row titles and UI strings are English-only in v1. Strings are centralized for later i18n.
- Native client support (Android TV, Swiftfin, Roku)
- Playback/transcoding changes (playback compatibility is a documentation topic in the README)

## 2. Architecture

```
┌──────────────────────── Jellyfin Server 12.1 ────────────────────────┐
│  Lumen plugin (Jellyfin.Plugin.Lumen.dll, .NET 10)                   │
│                                                                      │
│  IStartupFilter → IndexHtmlMiddleware ──uses──> HtmlInjector (pure)  │
│                                                                      │
│  LumenController                                                     │
│    GET  /Lumen/ClientConfig  → enable flags + UI settings            │
│    GET  /Lumen/Home          → HomeService → IHomeSectionProvider[]  │
│    GET  /Lumen/Assets/{file} → embedded client bundle                │
│    POST /Lumen/Diagnostics   → DiagnosticsStore                      │
│  AdminController (RequiresElevation)                                 │
│    GET/POST /Lumen/Admin/Config, GET /Lumen/Admin/SectionTypes,      │
│    GET /Lumen/Admin/Diagnostics                                      │
│                                                                      │
│  HomeService ── HomeCache (IMemoryCache)                             │
│  Configuration: PluginConfiguration, ConfigMigrator, ConfigValidator │
│  Admin page (IHasWebPages)                                           │
└──────────────────────────────────────────────────────────────────────┘
            ▲ index.html with <script>/<link> to /Lumen/Assets
            │
┌─────────── jellyfin-web 12.1 (browser / iOS app / desktop) ──────────┐
│  Lumen client bundle (TypeScript + Preact)                           │
│    compat/   selectors + startup self-test                           │
│    takeover/ hash-route watcher, #lmn-root mount, html.lmn-active    │
│    api/      typed calls via window.ApiClient                        │
│    views/    HomeView, DetailsView (Movie, Series)                   │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.1 Server components

| Unit | Responsibility | Depends on |
|---|---|---|
| `Plugin` | Plugin metadata, config holder, `IHasWebPages` for the admin page | Jellyfin `BasePlugin<T>` |
| `ServiceRegistrator` | Registers all services, providers, startup filter | `IPluginServiceRegistrator` |
| `LumenStartupFilter` | Adds `IndexHtmlMiddleware` to the pipeline | `IStartupFilter` |
| `IndexHtmlMiddleware` | Intercepts only `GET …/web/` and `…/web/index.html` (the path still includes any BaseUrl, because the filter runs before `Map(BaseUrl)`). Strips `Accept-Encoding`, `If-None-Match`, `If-Modified-Since`, and `Range` from the request so the inner static-file middleware returns a full, uncompressed 200. Buffers the response, calls `HtmlInjector`, resets `Content-Length`, and replaces `ETag`/`Last-Modified` with a content-hash ETag. Serves the original on any error. | `HtmlInjector`, `AssetCatalog` |
| `HtmlInjector` | Pure function: `string Inject(string html, AssetVersion v)`. Inserts `<!-- lumen -->` marker, `<link>`, and `<script defer>` before `</head>`. No-op if marker present or `</head>` missing. | none |
| `LumenController` | HTTP endpoints. `/ClientConfig`, `/Home`, and `/Diagnostics` require an authenticated user. Assets are anonymous. | services below |
| `HomeService` | Resolves the user, runs enabled section providers in parallel with per-provider timeout and exception isolation, assembles the response | providers, `HomeCache`, `HeroService` |
| `HeroService` | Selects hero items from the configured source and resolves local trailer IDs | `ILibraryManager` |
| `IHomeSectionProvider` (×7) | One row type each (§3.2) | Jellyfin managers |
| `HomeCache` | Per-user response cache and invalidation (§6) | `IMemoryCache`, `IUserDataManager`, `ILibraryManager` events |
| `ConfigMigrator` | Upgrades stored config from older `SchemaVersion`s (pure) | none |
| `ConfigValidator` | Validates config on save. Rejects unknown types and missing or invalid params. | provider registry |
| `DiagnosticsStore` | Keeps the latest compatibility report per client (in memory, bounded to 50 entries) for the admin page | none |

### 2.2 Client components

| Unit | Responsibility |
|---|---|
| `compat/` | The only place that knows jellyfin-web selectors, globals, and route shapes. Exposes `selfTest(): CompatReport` and typed accessors. |
| `takeover/` | Watches navigation. jellyfin-web navigates with `history.pushState`, which fires no event, so it patches `pushState`/`replaceState` once and also listens to `popstate` and `hashchange`, deduplicating on `location.href`. On `#/home` or `#/details?id=…` (when enabled and compat OK), adds a route-specific class to `<html>` (`lmn-active lmn-home` / `lmn-details`), mounts the view into `#lmn-root`, and unmounts and removes the classes on navigation away. |
| `api/` | Typed wrappers over `window.ApiClient` (auth, base URL) for `/Lumen/Home` and the stock endpoints in §4.3 |
| `views/home` | `HomeView` → `Hero`, `Row`, `Card` |
| `views/details` | `MovieDetails`, `SeriesDetails`, shared `DetailsHeader`, `EpisodeList`, `CastRow`, `SimilarRow` |
| `components/` | Shared presentational components (buttons, badges, progress bar, focusable card) |
| `styles/` | Theme built on jellyfin-web 12's CSS-variable base theme. All selectors are scoped under `lmn-`. |

## 3. Home screen

### 3.1 Section model

Stored in `PluginConfiguration.Sections` as an ordered list:

```jsonc
{
  "id": "6f1c…",                 // stable GUID
  "type": "RecentlyAdded",       // provider key
  "enabled": true,
  "title": null,                 // null → provider default title
  "params": { "libraryId": "…" } // provider-specific, validated
}
```

```csharp
public interface IHomeSectionProvider
{
    string Type { get; }
    string DisplayName { get; }
    IReadOnlyList<SectionParameter> Parameters { get; }                         // drives admin form + generic validation
    IReadOnlyList<string> Validate(SectionDefinition definition);              // provider-specific rules (e.g. "exactly one source")
    Task<IReadOnlyList<HomeRow>> GetRowsAsync(HomeContext context, SectionDefinition definition, CancellationToken ct);
}
```

A section yields zero or more rows. An empty list means it is omitted. `BecauseYouWatched` and `Genre` yield several. Parameters are stored as a list of `{ Name, Value }` string pairs, because plugin configuration is XML-serialized and cannot hold dictionaries.

- `HomeContext` carries the `User`, a `DtoOptions` with minimal fields, the current date (injected `TimeProvider`), and the shared item limit (20).
- `SectionParameter` declares `Name`, `Label`, `Kind` (`Library`, `Collection`, `Playlist`, `Text`, `Integer`), `Required`, `DefaultValue`, and for integers `Min`/`Max`. The admin page renders inputs from this, and `ConfigValidator` validates against it.

**Default sections** on first install: Continue Watching, Next Up, Because You Watched, New For You, Recently Added (one per movie/TV library), Genre.

### 3.2 Section providers

| Type | Params | Logic |
|---|---|---|
| `ContinueWatching` | none | User's resumable Movie and Episode items (`IsResumable`), ordered by `DatePlayed` desc |
| `NextUp` | none | `ITVSeriesManager.GetNextUp` for the user |
| `RecentlyAdded` | `libraryId` (optional; empty = all of the user's libraries) | Latest items in the library, ordered by `DateCreated` desc. Episodes are grouped to their series (one card per series, like stock "Latest"). |
| `BecauseYouWatched` | `maxRows` (default 2) | Movies: `ISimilarItemsManager.GetMovieRecommendationsAsync`. Series: seed = most recently played series not yet used as a seed this response; `GetSimilarItemsAsync(seed)`. Played items are excluded. Each seed produces one titled row ("Because you watched {Name}"). Rows are emitted alternating movie/series until `maxRows`. |
| `Genre` | `genreCount` (default 3) | Genre weights = count of the user's plays per genre over the last 90 days (+1 smoothing for all genres present in the user's libraries). Pick `genreCount` genres by weighted sampling with an RNG seeded by `hash(userId, UTC date)`, so the selection is stable within a day and rotates daily. Items: unplayed, ordered by `CommunityRating` desc, top 40, then a seeded shuffle down to 20. One row per genre. |
| `NewForYou` | `days` (default 14) | Union of (a) episodes created within `days` whose series has at least one played episode for this user, grouped to series, and (b) movies created within `days` in the user's top-3 genres (same weights as `Genre`). Unplayed only, ordered by `DateCreated` desc. |
| `Curated` | `collectionId` \| `playlistId` \| `tag` (exactly one) | Items from the source, in source order (tag: `SortName`) |

All queries run as the requesting user, so library access and parental controls are enforced by Jellyfin. Providers that emit multiple rows (`BecauseYouWatched`, `Genre`) return them in order. The response is a flat list of rows.

Watch history (recently played movies and episodes with their series and genres) is computed at most once per home build and shared by `Genre`, `NewForYou`, and `BecauseYouWatched`. Played/unplayed filtering uses `IUserDataManager.GetUserDataBatch`.

### 3.3 Hero

Config: `HeroSource` (`RecentlyAdded` | `TopRatedUnplayed` | `Collection` + `collectionId`), `HeroCount` (default 5), `HeroIntervalSeconds` (default 8), `TrailerPreview` (default on), `TrailerDelaySeconds` (default 4).

- Prefer items with both a Backdrop and a Logo image. Fall back to items with a Backdrop only, rendered with title text.
- Each hero item includes `trailerItemId` when it has a local trailer, and `overview`.
- **Client behavior:**
  - Crossfade every `HeroIntervalSeconds`, pausing rotation on hover/focus.
  - After `TrailerDelaySeconds` on a slide with `trailerItemId`, play a muted `<video>` with `preload="none"` from `/Videos/{trailerItemId}/stream?static=true`.
  - Stop and unload the video when the slide changes, the hero leaves the viewport (`IntersectionObserver`), or `document.hidden` becomes true.
  - On any `<video>` error, stay on the backdrop silently.
  - Skip trailers when `prefers-reduced-motion: reduce` or `TrailerPreview` is off.

### 3.4 `GET /Lumen/Home` response

Lumen's API uses Jellyfin's default PascalCase JSON, matching `BaseItemDto`.

```jsonc
{
  "ConfigVersion": 7,
  "Hero": [ { "Item": BaseItemDto, "TrailerItemId": "…" | null } ],
  "Rows": [ { "Id": "…", "Type": "Genre", "Title": "Sci-Fi", "Items": [BaseItemDto] } ]
}
```

UI settings are not repeated here. They come from `GET /Lumen/ClientConfig`:

```jsonc
{
  "Enabled": true, "HomeTakeover": true, "DetailsTakeover": true,
  "AccentColor": "#f5a524",   // default: warm amber
  "HeroIntervalSeconds": 8, "TrailerPreview": true, "TrailerDelaySeconds": 4,
  "BuildHash": "…"
}
```

`BaseItemDto`s are produced with `IDtoService` using `DtoOptions` limited to `PrimaryImageAspectRatio`, image tags, `UserData`, and series/season names. `Overview` is included only for hero items.

## 4. Route takeover and details page

### 4.1 Takeover mechanics

1. On bundle load, poll every 100 ms (for up to 60 s) until `window.ApiClient?.getCurrentUserId()` returns a user. `window.ApiClient` exists before login but has no user. After that, re-check the user on every navigation, because `window.ApiClient` can be replaced when switching servers or users.
2. Fetch `GET /Lumen/ClientConfig` once after sign-in. It decides whether home and details takeover are enabled, before any home data is loaded. `/Lumen/Home` is fetched only when the home route is visited.
3. Run `compat.selfTest()`. If any required check fails: never take over, `console.warn`, and `POST /Lumen/Diagnostics` (once per session).
4. On a matching route: add `lmn-active` plus the route class to `<html>` and render into `#lmn-root`, an element appended to `<body>` that we own.
   - CSS `html.lmn-active #reactRoot .skinBody, html.lmn-active .backdropContainer { display: none !important; }` hides stock content in both the Modern and Legacy layouts. The stock page keeps running hidden, which duplicates some API traffic; that is accepted.
   - `#lmn-root` has an opaque background and a top offset equal to the app bar's height (`.MuiAppBar-root` in Modern, `.skinHeader` in Legacy). Both are `position: fixed`.
   - jellyfin-web's app bar stays visible and is styled transparent over the hero.
5. On a non-matching route: unmount and remove the classes.

### 4.2 Allowed jellyfin-web touchpoints

All live in `compat/` and are checked by `selfTest()`:

- `window.ApiClient`: auth, base URL, `getCurrentUserId()`, `deviceId()`, `getItem`, `getUrl`, `ajax`
- `window.Emby.Page`: optional, for `showItem` navigation. The hash fallback is always available.
- Hash routes `#/home` and `#/details?id=`
- `#reactRoot .skinBody` and `.backdropContainer` (used only in CSS to hide them)
- App bar: `.MuiAppBar-root` (Modern) or `.skinHeader` (Legacy), read only to measure its height
- Layout classes on `<html>`: exactly one of `layout-tv`, `layout-mobile`, `layout-desktop`
- `history.pushState` / `history.replaceState` (wrapped once to emit a navigation event)
- Server version from `ApiClient.getPublicSystemInfo()` for diagnostics (`ApiClient.appVersion()` reports the native app's version under the iOS app, so it is not used)

### 4.3 Playback and actions

- **Play / Resume / Episode click:** look up the own session (`GET /Sessions?deviceId=<decodeURIComponent(ApiClient.deviceId())>`; `ApiClient.deviceId()` is URL-encoded but the server stores the decoded value; fall back to the raw value). If no single session matches, show an inline "Couldn't start playback" message. Then `POST /Sessions/{sessionId}/Playing?playCommand=PlayNow&itemIds=…&startPositionTicks=…`. Jellyfin's own player handles playback.
- **Watched:** `POST`/`DELETE /UserPlayedItems/{id}`. **Favorite:** `POST`/`DELETE /UserFavoriteItems/{id}`.
- **Item fetch:** `GET /Items/{id}?userId=`. The `/Users/{userId}/Items/{id}` form used by `ApiClient.getItem` is obsolete and hidden from the 12.1 OpenAPI.
- **Known behavior:** if the user has a cast/remote player selected in jellyfin-web, playback goes there. For a single episode with next-episode autoplay on, the server queues the following episodes.
- **Trailer:** play the local trailer item via the same Play mechanism.

### 4.4 Details views

**Routing:**
- Movie and Series → Lumen views.
- Season → the Lumen series view with that season selected.
- Every other item type → the stock page.
- To avoid a flash of the stock page, the details route is hidden immediately and revealed if the fetched item type is unsupported.

**Movie:**
- Header: backdrop and logo (or title), metadata line, overview.
  - Metadata line: year, official rating, runtime, and 4K / HDR / Dolby Vision / Atmos badges derived from `MediaStreams`.
- Actions: Play or Resume (with progress bar), Trailer (if a local trailer exists), Watched, Favorite.
- Cast row from `People`.
- More Like This from `GET /Items/{id}/Similar`.

**Series:**
- Same header.
- Smart Play button:
  - "Resume S{s}:E{e}" if a resumable episode exists
  - else "Play S{s}:E{e}" from `GET /Shows/NextUp?seriesId=`
  - else "Play S1:E1"
- Season selector (`GET /Shows/{id}/Seasons`).
- Episode list (`GET /Shows/{id}/Episodes?seasonId=`): thumbnail with progress bar, number, title, runtime, overview. Click = play.
- More Like This.

**Responsive and input behavior:**

| Context | Behavior |
|---|---|
| Desktop | Hover states and keyboard focus |
| Under 600px (iOS app) | Stacked layout, touch targets at least 44px |
| `layout-tv` | Visible focus rings and arrow-key/D-pad navigation; rows scroll the focused card into view |

## 5. Admin dashboard page

An embedded HTML/JS page registered via `IHasWebPages`, using the stock dashboard form styles.

- **General:** Enabled (master), Home takeover, Details takeover, accent color.
- **Hero:** source (+ collection picker), count, interval, trailer preview, trailer delay.
- **Sections:** the ordered list with up/down buttons, enabled toggle, and title override.
  - Each section's parameter inputs are generated from the provider's `Parameters`.
  - Also: "Add section" (type picker) and "Reset to defaults" (with confirm).
- **Diagnostics:** the latest compatibility reports (client name, jellyfin-web version, failed checks, timestamp).

The page talks to admin-only endpoints (`Policies.RequiresElevation`):

- `GET /Lumen/Admin/Config`
- `POST /Lumen/Admin/Config`: runs `ConfigValidator`. Returns 400 with `{ Errors: [...] }` and persists nothing if invalid. Otherwise saves and increments `ConfigVersion`.
- `GET /Lumen/Admin/SectionTypes`: each provider's `Type`, `DisplayName`, and `Parameters`
- `GET /Lumen/Admin/Diagnostics`

Library, collection, and playlist pickers use the stock `/Library/VirtualFolders` and `/Items` endpoints.

`PluginConfiguration.SchemaVersion` starts at 1. `ConfigMigrator.Migrate(config)` runs on load and applies ordered pure migration steps.

## 6. Error handling and caching

### 6.1 Error handling

| Failure | Behavior |
|---|---|
| Injection throws, or `</head>` not found | Serve original `index.html`, log a warning once per process |
| A section provider throws or exceeds 3 s | Log a warning with section id and type, omit that section |
| Hero selection fails | Return `hero: []`. The client renders rows without a hero. |
| `/Lumen/Home` fails (after 1 retry, 500 ms backoff) | Client removes `lmn-active` and shows the stock home |
| Client render error | Error boundary per row (drop the row) and per view (fall back to stock) |
| Compat self-test fails | No takeover. Report to Diagnostics. |
| Invalid stored section definition | Skip it at runtime and log. It is rejected at save time. |

### 6.2 Caching

- **Server home response:**
  - Stored in `IMemoryCache` under key `(userId, libraryGeneration, configVersion)` with a 60 s absolute TTL.
  - `IUserDataManager.UserDataSaved` for a user evicts that user's entries (a per-user `CancellationChangeToken`).
  - `ILibraryManager` `ItemAdded` / `ItemRemoved` / `ItemUpdated` increment `libraryGeneration`, debounced to at most once per 30 s.
- **Assets:**
  - URLs are `/Lumen/Assets/{file}?v={buildHash}` with `Cache-Control: public, max-age=31536000, immutable`.
  - The injected `index.html` tags always reference the current hash.
  - The middleware's modified `index.html` gets a content-hash ETag and honors `If-None-Match`.
- **Client:**
  - The last home response is kept in memory. Navigating back to home renders it instantly and revalidates in the background.
  - Images use `loading="lazy"` with `fillWidth` / `fillHeight` / `quality=90` matched to the rendered card size × `devicePixelRatio`.

## 7. Repository, tooling, testing, release

### 7.1 Layout

```
src/Jellyfin.Plugin.Lumen/
  Plugin.cs, ServiceRegistrator.cs
  Injection/      LumenStartupFilter.cs, IndexHtmlMiddleware.cs, HtmlInjector.cs
  Api/            LumenController.cs
  Home/           HomeService.cs, HeroService.cs, HomeCache.cs, IHomeSectionProvider.cs, Models/, Providers/*.cs
  Configuration/  PluginConfiguration.cs, SectionDefinition.cs, ConfigMigrator.cs, ConfigValidator.cs, configPage.html, (admin UI lives in client/src/admin)
  Diagnostics/    DiagnosticsStore.cs
client/           package.json, vite.config.ts, tsconfig.json, src/{compat,takeover,api,views,components,styles}
tests/Jellyfin.Plugin.Lumen.Tests/
e2e/              playwright.config.ts, docker-compose.yml, fixtures/ (generated media), specs/
scripts/          dev.sh, gen-test-media.sh
docs/             superpowers/specs/, reference/jellyfin-openapi-12.1.0.json, manual-test-checklist.md
manifest.json, README.md, LICENSE (GPL-3.0), CHANGELOG.md
```

The client is built by an MSBuild target before `dotnet build` and embedded as `EmbeddedResource`s. Build output is not committed.

### 7.2 Standards

- **C#:**
  - `net10.0`, `<Nullable>enable</Nullable>`, `<TreatWarningsAsErrors>true</TreatWarningsAsErrors>`, and Jellyfin's analyzer set (StyleCop + .NET analyzers).
  - Central package management pinning `Jellyfin.Controller` / `Jellyfin.Model` 12.1.x.
  - `TimeProvider` is injected wherever time matters.
- **TypeScript:**
  - `strict`, ESLint, and Prettier.
  - Preact, chosen for its roughly 4 KB size.
  - The bundle-size budget (≤ 60 KB gzipped JS+CSS) is enforced in CI.
- **Pure logic is separated from I/O** (injector, genre selection, cache keys, migrations, badge derivation) for direct unit testing.
- Conventional commits. `CHANGELOG.md` is maintained by hand (see §7.6).

### 7.3 Testing

| Layer | Tooling | Covers |
|---|---|---|
| C# unit | xUnit, NSubstitute | `HtmlInjector` (idempotent, no `</head>`, pre-modified by File Transformation), each provider with fake library data, `HomeService` timeout/isolation, `HomeCache` invalidation, `ConfigMigrator`, `ConfigValidator`, genre weighting determinism |
| C# integration | ASP.NET `TestServer` | Middleware: gzip/br request handling, 304/ETag, non-index passthrough, error passthrough, coexistence with a second transforming middleware |
| Client unit | Vitest, @testing-library/preact | Components, route matching, takeover mount/unmount, `compat.selfTest` against fixture DOMs (pass and fail) |
| E2E | Playwright + Jellyfin latest stable (12.2): Docker `jellyfin/jellyfin:12.2` in CI, portable tarball locally, with generated sample media | Home renders configured sections; Movie and Series details; Play starts playback; master switch off → stock UI; forced compat failure → stock UI + diagnostics entry; TV-layout keyboard navigation |
| Nightly | Same E2E against `jellyfin/jellyfin:unstable` | Early warning of jellyfin-web changes |
| Manual (per release) | `docs/manual-test-checklist.md` | Desktop browser, official iOS app, TV layout (desktop browser with layout set to TV) |

### 7.4 Release

- **GitHub Actions on `v*` tag:**
  1. lint
  2. test
  3. build the client
  4. `dotnet publish`
  5. zip
  6. create a GitHub Release with the zip
  7. update `manifest.json` (version `Major.Minor.Patch.0`, `targetAbi` `12.1.0.0`, MD5 checksum, changelog) and commit it to `main`
- **Repository URL for users:** `https://raw.githubusercontent.com/ahappysloth/jellyfin-plugin-lumen/main/manifest.json`
- **CI on pull requests:** lint, unit, integration, E2E, and bundle budget.
- Dependabot for NuGet, npm, and Actions.

### 7.5 Local development

The author's WSL environment has no Docker and no sudo, so local development uses user-level installs:

- .NET 10 SDK via Microsoft's `dotnet-install.sh` into `~/.dotnet`.
- Jellyfin portable tarball (`jellyfin_<ver>-amd64.tar.gz`) plus jellyfin-ffmpeg portable, under `~/.local/share/lumen-dev/`, with its own data/config/cache directories.

`scripts/dev.sh`:
1. Builds the plugin.
2. Copies it into `~/.local/share/lumen-dev/data/plugins/Lumen_<ver>/`.
3. Restarts the portable server on port 8097.

`scripts/setup-dev.sh` performs the one-time downloads. Docker is used only in CI.

## 7.6 Plan-time adjustments (2026-10-06)

- No `build.yaml`. The release workflow builds the zip and `manifest.json` directly.
- The dev server runs on Jellyfin's default port 8096.
- The admin page logic is a second Vite bundle (`lumen-admin.js`, TypeScript + Preact, unit-tested). `configPage.html` is a thin shell that loads it from `/Lumen/Assets`.
- Home is served by `HomeController`. `LumenController` serves assets, client config, and diagnostics; `AdminController` serves the admin endpoints.
- Collection/playlist reading and trailer lookup sit behind small adapters (`ILinkedItemsReader`, `ITrailerLookup`), because Jellyfin implements them via static service locators. They are covered by end-to-end tests.
- `CHANGELOG.md` is maintained by hand (Keep a Changelog style). The release workflow publishes the section matching the tag and fails if it's missing.
- `HomeCache.Set` takes a `CacheStamp` captured before building, so responses built across an invalidation are dropped.
- `HomeService` exposes an internal `Timeout` for tests.
- New For You's episode query is scoped to watched series via `AncestorIds`.
- The E2E/CI plugin folder is `Lumen_<Version>`.
- StyleCop SA1402/SA1649 and CA1720 are disabled in `.editorconfig` because the plan groups small types per file and uses API names like `Integer`/`Single`.

## 8. Risks

| Risk | Mitigation |
|---|---|
| jellyfin-web DOM/route changes break takeover | Single `compat/` module, self-test with fail-open, nightly E2E against unstable |
| Conflict with File Transformation or other injectors | Idempotent marker-based injection, explicit coexistence test, no writes to the web directory |
| Jellyfin plugin ABI changes on server upgrade | Pinned packages, `targetAbi`, nightly build against unstable surfaces breakage early |
| Overlap with Jellyfin Enhanced / Home Screen Sections | Lumen differentiates as a unified, cohesive experience; README documents running alongside them (or not) |
| Trailer preview bandwidth or codec failures | Local trailers only, `preload="none"`, silent fallback, admin toggle, reduced-motion respect |
| Tizen app bundles its own jellyfin-web | Documented as unsupported in the README client table |
| Hidden stock pages still fetch data and may play theme music on details | Accepted for v1; documented. The client never touches the stock page. |
