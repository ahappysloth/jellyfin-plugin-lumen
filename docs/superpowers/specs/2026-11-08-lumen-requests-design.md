# Lumen — Requests: browse and request the whole catalog via Seerr (Sub-project 2)

- **Date:** 2026-11-08
- **Status:** Approved 2026-11-08 (decisions in §10)
- **Target:** Lumen 0.2, Jellyfin 12.1+, Seerr 3.x (the merged Overseerr/Jellyseerr; verified against v3.5.1's `seerr-api.yml` and server source)
- **Builds on:** [Sub-project 1 spec](2026-10-04-lumen-home-ui-design.md). Its principles (§1.3) apply unchanged, especially *fail open* and *public interfaces only*.

## 1. Purpose

Today a user who wants something not on the server leaves Jellyfin, opens Seerr (or Sonarr/Radarr), searches, requests, waits, and comes back. Lumen should make the server feel like one catalog: titles you don't have yet appear alongside the ones you do, and a title you don't have opens a details page with a **Request** button. When Sonarr/Radarr finish and Jellyfin scans the file, the same card becomes playable.

### 1.1 Users and clients

Same as sub-project 1: desktop and mobile browsers, the official iOS/Android mobile apps, and Jellyfin Media Player. Native TV apps are **out of scope** (decided with the owner). No stub files or fake library items are created.

### 1.2 Success criteria

1. With Seerr configured, home can show discover rows (e.g. Trending, Popular Movies) whose cards mix titles the user has (normal, playable Lumen cards) and titles they don't (placeholder cards marked **Request**, **Requested**, or **Downloading**).
2. Opening a title the server doesn't have shows a Lumen details page (poster, backdrop, overview, year, rating, genres, cast, trailer link) with a **Request** button. Shows get a season picker.
3. A request is filed in Seerr **as the signed-in user**. Seerr applies that user's permissions, quota, and auto-approval rules. Lumen implements none of them.
4. Search covers both: matching library titles first, then catalog titles with their request state.
5. If Seerr is unreachable, misconfigured, or the user has no Seerr account, Lumen behaves exactly like 0.1: request features disappear and nothing else breaks.
6. The Seerr API key never reaches a browser.

### 1.3 Non-goals

- Native TV apps, stub/placeholder files in libraries, Plex-style "Discover" inside stock jellyfin-web pages.
- Managing requests (approve/decline), issue reports, or Seerr settings. Admins keep using Seerr for those.
- 4K requests and advanced request options (quality profile, root folder) in v1. These are a possible follow-up.
- Talking to Sonarr/Radarr directly.

## 2. Architecture

```
 browser (Lumen client) ──/Lumen/Requests/*──▶ Lumen plugin ──X-Api-Key + X-Api-User──▶ Seerr ──▶ Sonarr / Radarr
                                                   │                                        │
                                                   └── Jellyfin library (ILibraryManager) ◀──┘ (jellyfinMediaId)
```

- The **Lumen server** is the only component that talks to Seerr. It holds the Seerr URL and admin API key in plugin config (never serialized to `ClientConfig` or any client response).
- **Acting as the user:** Seerr's auth middleware (`server/middleware/auth.ts`) accepts the admin key plus an `X-Api-User: <seerrUserId>` header and then *treats the request as that user*. Every user-facing Seerr call Lumen makes carries `X-Api-User`, so Seerr's own permission checks (`REQUEST`, `REQUEST_MOVIE`/`REQUEST_TV`, `AUTO_APPROVE`, quotas) apply to the real person. Lumen never sends a request as the admin account.
- **User mapping:** `GET /api/v1/user/jellyfin/{jellyfinUserId}` returns the Seerr user for a Jellyfin user (Seerr imports Jellyfin users). Lumen caches the mapping per Jellyfin user (10 min; misses 1 min). The Jellyfin user id always comes from the authenticated principal (`GetJellyfinUserId()`), never from the client.
- **No Seerr account → no catalog at all.** If the lookup 404s, the user gets the 0.1 experience (Lumen will not browse Seerr as the admin on their behalf). The admin page lists unmapped users with a hint to import them in Seerr. A user who *has* a Seerr account but lacks request permission is covered by open question 2.

### 2.1 Server components (new)

| Unit | Responsibility |
|---|---|
| `SeerrClient` | Typed calls to Seerr over `IHttpClientFactory` (named client, 5 s timeout, `X-Api-Key`, optional `X-Api-User`). Only the endpoints in §4. Maps Seerr DTOs to Lumen DTOs. |
| `SeerrUserMap` | Jellyfin user id → Seerr user id (+ the user's request permissions, for hiding the button when Seerr would refuse), cached as above. |
| `CatalogMapper` | Turns Seerr results into `CatalogItemDto` (§3) and, for titles Seerr marks available with a `jellyfinMediaId` the user can see in Jellyfin, swaps in the real Jellyfin item so the card plays like any other. |
| `DiscoverProviders` | New `IHomeSectionProvider`s (§5.1). Same timeout/isolation/caching as existing providers. |
| `RequestsController` | `/Lumen/Requests/*` (§4.1), authenticated users only; 404s the whole surface when Seerr isn't configured. |
| `TmdbImageProxy` | `GET /Lumen/Requests/Image/{size}/{file}`: fetches TMDB artwork server-side so clients only ever talk to the Jellyfin server (works over LAN/Tailscale, no third-party requests from viewers). Strict allowlist: `size ∈ {w185,w300,w780,w1280,original}`, `file` matches `^[A-Za-z0-9]{1,64}\.(jpg|png)$`. Requires an authenticated user with catalog access (the client appends `ApiKey`, as trailer previews already do). Disk-cached under Jellyfin's cache dir, oldest-first trimmed to the configured cap (default 500 MB), `Cache-Control: private, max-age=604800`. `LUMEN_TMDB_IMAGE_BASE` redirects it to the E2E stub. |

### 2.2 Client components (new)

| Unit | Responsibility |
|---|---|
| `CatalogCard` | Placeholder card in the same landscape style (§5 of the redesign). Uses the TMDB backdrop via the image proxy, title + year · type meta line, and a state tab: **Request** (outlined), **Requested**, **Downloading**, **Partly available**. |
| `TitleView` | Details page for a catalog title at `#/home?title=<movie|tv>-<tmdbId>` (route verified: jellyfin-web renders home and ignores the parameter, so Lumen's takeover can own it; a new path like `#/lumen/...` hits jellyfin-web's 404 page). Same header layout as `DetailsHeader`, but with **Request** / state instead of Play. |
| `RequestDialog` | Movie: one confirm step. TV: season checklist with each season's state (available/requested/none), "All seasons" toggle, already-requested seasons disabled. Shows Seerr's outcome: *Requested*, *Requested, waiting for approval*, or Seerr's error message (quota, permission). |
| `SearchView` | Takes over `#/search` when request features are on: one input, library results (Jellyfin `/Items?searchTerm=`) then catalog results (`/Lumen/Requests/Search`). |
| Nav | Search already links to `#/search`. Nothing else changes. |

## 3. Data shapes

`CatalogItemDto` (what the client renders for a title the server may not have):

```jsonc
{
  "Key": "movie-603",            // "<mediaType>-<tmdbId>", stable id for routes and React keys
  "MediaType": "movie",          // movie | tv
  "TmdbId": 603,
  "Title": "…", "Year": 1999, "Overview": "…",
  "Rating": 8.2,                 // TMDB voteAverage, one decimal
  "GenreNames": ["Action", "Science Fiction"],
  "Poster": "/Lumen/Requests/Image/w300/abc.jpg",   // null if none
  "Backdrop": "/Lumen/Requests/Image/w780/def.jpg",
  "State": "None",               // None | Requested | Downloading | PartlyAvailable | Available | Blocklisted
  "JellyfinItemId": null         // set when State = Available and the user can see the item
}
```

State comes from Seerr's `mediaInfo.status` (`server/constants/media.ts`): 1 Unknown → `None`, 2 Pending → `Requested`, 3 Processing → `Downloading`, 4 Partially available → `PartlyAvailable`, 5 Available → `Available`, 6 Blocklisted → `Blocklisted` (no Request button), 7 Deleted → `None`. A missing `mediaInfo` → `None`.

Discover rows carry a single ordered list `Entries: [{ "Item": BaseItemDto } | { "Catalog": CatalogItemDto }]` so the client keeps Seerr's ranking while rendering owned titles as normal Jellyfin cards. Their `Items` is empty, so older clients render nothing for them; existing rows are unchanged and never use `Entries`.

## 4. Seerr API usage (all under `/api/v1`, verified in `seerr-api.yml` v3.5.1)

| Lumen need | Seerr call | As |
|---|---|---|
| Health/version | `GET /status` | admin key |
| User mapping | `GET /user/jellyfin/{jellyfinUserId}` | admin key |
| Discover rows | `GET /discover/trending`, `/discover/movies`, `/discover/tv`, `/discover/movies/upcoming`, `/discover/tv/upcoming` (`page`, `language`) | user |
| Search | `GET /search?query=&page=` | user |
| Title details | `GET /movie/{id}`, `GET /tv/{id}` (includes `mediaInfo`, seasons, credits, related videos) | user |
| Request | `POST /request` `{ mediaType, mediaId, seasons? }` | user (`X-Api-User`) |
| My requests row | `GET /user/{seerrUserId}/requests?take=20` | user |

Lumen never sets `userId` in the request body; acting via `X-Api-User` is what makes Seerr enforce *that* user's permissions and quota.

### 4.1 Lumen endpoints

- `GET /Lumen/Requests/Status` → `{ Enabled, CanRequestMovies, CanRequestTv }` for the current user (all false when Seerr is off or the user is unmapped). The client checks this once per session to decide whether to show request UI.
- `GET /Lumen/Requests/Search?query=&page=` → `CatalogItemDto[]` (library-owned titles have `JellyfinItemId`).
- `GET /Lumen/Requests/Title/{mediaType}/{tmdbId}` → `CatalogItemDto` plus `Cast`, `Seasons: [{ Number, Name, EpisodeCount, State }]`, `TrailerUrl` (YouTube link from Seerr's related videos; opened in a new tab, never embedded).
- `POST /Lumen/Requests` `{ MediaType, TmdbId, Seasons?: number[] | "all" }` → `{ State, NeedsApproval }` or Seerr's error passed through as `{ Error }` (403/409 → 4xx with Seerr's message).
- `GET /Lumen/Requests/Image/{size}/{file}`: the image proxy.

All validate input (`mediaType ∈ {movie,tv}`, `tmdbId` positive int, season numbers ≥ 0, query ≤ 100 chars) and require an authenticated Jellyfin user.

## 5. UI

### 5.1 Home rows (new section types, admin-configurable like the rest)

| Type | Default title | Source |
|---|---|---|
| `CatalogTrending` | Trending | `/discover/trending` |
| `CatalogPopularMovies` | Popular Movies | `/discover/movies` |
| `CatalogPopularShows` | Popular Shows | `/discover/tv` |
| `CatalogUpcoming` | Coming Soon | `/discover/movies/upcoming` + `/discover/tv/upcoming`, merged by date |
| `MyRequests` | My Requests | `/user/{id}/requests`; hidden when empty |

Existing installs get none of these automatically. New installs get only `MyRequests` in their default sections (it renders nothing until Seerr is configured and the user has requests); the catalog rows are opt-in from the section editor. Rows are computed per user (state and permissions are per user) and cached with the home response. Seerr results are also cached server-wide for 10 minutes per endpoint+page, since discover lists are global and only `mediaInfo` is merged per call.

### 5.2 Cards and states

- **Available:** the existing Lumen card (plays, details page).
- **None:** catalog card with an outlined **Request** tab; click → `TitleView`.
- **Requested / Downloading / Partly available:** catalog card with a filled tab in the accent colour; click → `TitleView` showing the state (and **Request more seasons** for partly available shows).
- **Blocklisted:** card shown without a tab; `TitleView` explains it can't be requested.

### 5.3 Title page and request flow

`TitleView` header mirrors `DetailsHeader`: backdrop, title (TMDB has no logos via Seerr), star rating · year · runtime, genres, overview, then **Request** (primary) and **Trailer** (opens YouTube in a new tab). Below: cast (TMDB profile images via the proxy) and "You may like" from Seerr's recommendations (`/movie/{id}/recommendations`, `/tv/{id}/recommendations`).

Request → `RequestDialog` → `POST /Lumen/Requests` → the dialog shows the outcome; the page and any card for that title update their state in place. When Jellyfin later scans the file, the next home load shows it as a normal card (the 60 s home cache and library events already handle freshness).

### 5.4 Search

With request features on, Lumen takes over `#/search` (stock search otherwise). The query is debounced 300 ms. Results: **In your library** (Jellyfin items, normal cards) then **More to request** (catalog cards excluding titles already listed above). With them off, the stock search page is untouched.

## 6. Admin

New **Requests** fieldset in Lumen's dashboard page:

- Seerr URL, API key (write-only field; shown as "set"), **Test connection** (calls `/status`, shows Seerr version).
- Enable request features (master switch).
- Image cache size.
- A table of Jellyfin users without a Seerr account, with a link to Seerr's user import page.
- A check that Seerr is linked to *this* Jellyfin server: Lumen compares Seerr's `GET /settings/jellyfin` `serverId` with its own `SystemId` (keeping only the name and id; that response also holds Seerr's Jellyfin API key). If they differ, accounts can never match, so the page says so instead of suggesting an import.

Section types from §5.1 appear in the existing section editor automatically (data-driven).

## 7. Errors, security, performance

- **Fail open.** Seerr timeouts/errors drop the affected row or show an inline message on the title page; home, details, playback, and the stock UI never depend on Seerr. Request features hide after 3 consecutive Seerr failures for 1 minute (simple circuit breaker) to keep home fast.
- **Secrets.** API key only in plugin config. Excluded from `ClientConfig`, admin GET returns `ApiKeySet: true` instead of the value, and logs never print it.
- **SSRF.** Lumen only calls the admin-configured Seerr base URL and `image.tmdb.org`. Paths are built from validated components, never from client-supplied URLs.
- **Authorization.** Seerr enforces request permissions and quotas per user via `X-Api-User`. A mapped user without `REQUEST` still browses the catalog (cards, title pages, search) but sees no Request button; Lumen hides it when Seerr reports the permission missing.
- **Cost.** Discover lists are shared-cached (10 min). Per-user work is only the `mediaInfo`/permission merge. Images are proxied once and disk-cached.

## 8. Testing

| Layer | What |
|---|---|
| C# unit | `SeerrClient` against a fake `HttpMessageHandler` (headers: API key, `X-Api-User`; status mapping; error passthrough), `SeerrUserMap` caching, `CatalogMapper` (available → Jellyfin item only when the user can see it), image proxy allowlist and cache cap, controller validation. |
| Client unit | `CatalogCard` states, `TitleView`, `RequestDialog` (movie, seasons, all, disabled seasons, outcomes), `SearchView`, route parsing for `#/home?title=`. |
| E2E | A **stub Seerr** (tiny Node server in `e2e/support/`, started by the test workflow) implementing just the §4 endpoints with fixture data, so CI needs no internet or real Seerr. Specs: discover row mixes a library title and catalog titles; requesting a movie and a season of a show; unmapped user sees no request UI; Seerr down → home still renders. |
| Manual | Against a real Seerr: request lands in Seerr as the right user; an auto-approve user's request goes straight to Sonarr/Radarr; quota exceeded message. |

## 9. Delivery plan (each step shippable on its own)

1. ✅ Server foundation: config + admin fieldset, `SeerrClient`, user map, `/Lumen/Requests/Status`, image proxy, stub Seerr for E2E.
2. ✅ Title page + request dialog (reachable from search first).
3. ✅ Search takeover (Lumen's search page shipped first for the library; catalog results added with step 2). TV
   requests always name their seasons rather than sending "all", so seasons Seerr adds later aren't requested.
4. ✅ Discover and My Requests home rows with mixed cards, the shared 10-minute discover cache, and the circuit
   breaker (§7). Catalog sections get a 6 s provider timeout (longer than Seerr's 5 s) so a hung Seerr trips the
   breaker instead of being cancelled first.

## 10. Decisions (owner, 2026-11-08)

1. **Default rows:** new installs get only **My Requests**; Trending, Popular Movies/Shows and Coming Soon are opt-in.
2. **Browsing without request permission:** allowed. Users with a Seerr account but no `REQUEST` permission see the catalog without Request buttons. Users with *no* Seerr account see no catalog (§2).
3. **4K requests:** not in v1.
