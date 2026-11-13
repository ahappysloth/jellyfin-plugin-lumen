# Lumen — Health check

- **Date:** 2026-11-13
- **Status:** Approved by the owner 2026-11-12; this note records the decisions and how they were built.
- **Replaces:** the settings page's Diagnostics card, which listed only clients whose compatibility check failed, in raw
  ids (`selector.upNext`) with no explanation or next step.

## 1. What it is

A **Health** tab on Lumen's settings page, after Settings and Storage, with the same tab pattern (#127): a tablist,
arrows / Home / End, a D-pad that isn't sent round from either end on a TV, and the open tab remembered for the browser
tab in sessionStorage (not in the URL, so jellyfin-web's kept page isn't replaced). `&tab=health` in a link opens it.

It's a list of checks, grouped, each with a status: **OK**, **Warning**, **Problem** or **Not applicable** (a feature
that's off, or nothing to check yet). Each says in plain words what's wrong and, where there's something to do, offers
one fix: a link to a Dashboard page, a button that opens a card on the Settings tab (focus on its first control), or a
link to help. The status is a word beside an icon, never colour or shape alone; each fix is one tab stop. While any row
or device is a Problem, the tab shows a red count, and its name says it ("Health 2 problems": the visible text, then words for screen
readers).

## 2. The checks

| Group | Id | Where it runs | OK / Warning / Problem / N/A |
|---|---|---|---|
| Server | `server.jellyfin` | browser | tested release (tested-jellyfin.json) / untested release |
| | `server.update` | server (UpdateChecker, kept an hour) | latest / update out or waiting for a restart / – / GitHub didn't answer |
| | `server.customCss` | server (BrandingOptions) | none / set (counts remote `@import`s) |
| Proxy and network | `proxy.cache` | browser | headers as sent / – / a lifetime added / probe didn't arrive |
| | `proxy.https` | browser | HTTPS / – / plain HTTP on a public address / localhost or LAN (a note) |
| Requests (Seerr) | `requests.seerr` | server (Test connection) | answers, key works / linked to another Jellyfin / unreachable, key refused, not saved / requests off |
| | `requests.services` | server (`/settings/radarr`, `/settings/sonarr`) | both / one or none missing / – / Seerr not set up or not answering |
| Notifications | `notifications.service` | server (ReadyPushSignal, config) | job running (keys made, or made when first needed) / – / job not running / requests off or Seerr not set up (every Notifications row) |
| | `notifications.https` | browser | HTTPS / plain HTTP on a public address / – / localhost, LAN or Tailscale (a note) |
| | `notifications.devices` | server (subscription store's counts) | N devices of M users / – / – / none yet |
| | `notifications.lastSend` | server (PushSender.Last) | reached N devices (and any missed) / refused or unreachable / – / nothing sent since start |
| | `notifications.webhook` | server (Seerr `/settings/notifications/webhook`) | calls Lumen with the secret and Request Available / Request Available not ticked / another secret / off, elsewhere, or unreadable |
| Trakt | `trakt.key` | server (Check key, saved key) | works / Trakt down / refused, malformed / no key |
| | `trakt.lists` | server (TraktLists' last fetch) | loaded N ago / failed, last copy served / failed, nothing to serve / no key, nothing loaded yet |
| Skip Intro | `skipIntro.plugins` | server (plugin manager) | Intro Skipper and/or SkipMe.db active / neither, or waiting for a restart / installed but disabled, failed, unsupported / – |
| | `skipIntro.libraries` | server (library options) | providers on in every TV library / one off somewhere (named) / every provider off in a library / no provider, no TV library |
| | `skipIntro.coverage` | server (segment store) | "1,204 of 3,310 episodes" / none yet / – / no episodes, no provider, can't count |
| Quick Connect | `quickConnect.enabled` | server (ServerConfiguration) | on / – / – / off (a choice, so not a warning) |
| | `quickConnect.address` | server (Lumen's config) | set, or not set with the default explained / – / – / Quick Connect off |
| | `quickConnect.reachable` | browser | answers as this server / answers as another server / own address doesn't answer / no address, or another origin it can't read |
| Devices | – | server (DiagnosticsStore) | – / Lumen's page showed but part of Jellyfin's may show through / Lumen gave the page or player back to Jellyfin |

Notes on the less obvious ones:

- **Custom CSS.** jellyfin-web adds Branding's custom CSS to every page, Lumen's included. The owner found Ultrachromic
  there: it changed Lumen's heading fonts, blurred its dialogs and held up startup with 17 CDN `@import`s. It's a
  warning, not a problem (some admins mean it), and the fix is a link to Branding, never a button that clears it.
- **Proxy caching.** Measured from the browser, since only it sees what a proxy did. `GET /Lumen/Assets/cache-probe.js`
  (anonymous, beside Lumen's files so a rule that matches them matches it) answers a known body with exactly the headers
  an unversioned Lumen file gets: `Cache-Control: no-cache`, no `Expires`. The page fetches it with a new query string
  and `cache: 'no-store'`, so neither its cache nor a proxy's answers in Lumen's place, then flags a positive
  `max-age`, `immutable`, a future `Expires`, or no Cache-Control at all. A body that isn't the probe's (a proxy's login
  page) means "couldn't check", not a pass. With no proxy the headers arrive as sent, so it's OK. Checked against an
  nginx set up like Nginx Proxy Manager's `assets.conf` (`proxy_hide_header Cache-Control; expires 30d` for `.js|.css|…`):
  the probe came back with `max-age=2592000` and an Expires a month out, as `lumen.js` did.
- **HTTPS.** Installing Lumen as an app needs a secure address. localhost and private addresses (RFC 1918, link-local,
  `.local`, single-label names) are a note: the admin may be on the LAN while phones use the HTTPS name.
- **Notifications.** Only what's cheap and true: the push job's running flag, whether the public key exists (never the
  keys), the subscription store's counts, and the last send's result since Jellyfin started (no history is kept, so
  no "recent failures" beyond it). The webhook row reads Seerr's own webhook settings with the admin key and compares
  the Authorization header it sends with Lumen's secret as the webhook endpoint does (`PushController.IsWebhookSecret`,
  constant time); neither appears in a message. Seerr has one webhook agent, so one pointed elsewhere (a chat bridge)
  is a note, not a warning: Lumen's 2-minute check still delivers. The HTTPS row is this page's address only, as push
  needs a secure context (iOS: the Home Screen app too); users may come in through another address.
- **Quick Connect address.** Same-origin is always readable; another origin only if that server allows it (Jellyfin
  sends CORS headers, a proxy may not, and an HTTP address from an HTTPS page is blocked). So a failure there is "can't
  check from here", and only the page's own origin not answering is a problem. The answer's `Id` is compared with this
  server's, to catch an address that points at another Jellyfin.
- **Segment counts.** Jellyfin's segment manager only answers per item (thousands of queries), so the count is one
  query on Jellyfin's database (`IDbContextFactory<JellyfinDbContext>`, resolved lazily: if a future server doesn't
  offer it, the row says it can't count) for the ids with an Intro segment, against the library's real episodes.
  Providers are the registered `IMediaSegmentProvider`s by name, which is what `LibraryOptions.DisabledMediaSegmentProviders`
  holds (Jellyfin 12 compares them case-insensitively).
- **Devices.** One row per report: the device and browser read from the layout and user agent (the store now keeps 300
  characters of it, up from 100, which cut off the browser's version), what broke and what Lumen did for each check id
  (`devices.ts`; an unknown id is named, not hidden), and whether an update would help: a Lumen update when the report
  came from an untested Jellyfin, a bug report when it's tested, the browser (or the TV's software) when the check is
  the browser's or the engine is old. The raw ids are in a Technical details toggle.

## 3. Server

`GET /Lumen/Admin/Health[?refresh=true]` (admins only) returns the server's rows, the device reports, the versions and
the saved Quick Connect address. Each check is an `IHealthCheck` (id, group, title, `RunAsync(fresh, ct)`), registered
in `ServiceRegistrator` in page order. `HealthService` runs them all at once, each with 6 s at most (or its own
`TimeLimit`: the Seerr row's is 11 s, two rounds of Seerr's 5 s calls, so a slow Seerr gets its own message), cut off
even if it ignores its token; one that throws or times out becomes a Warning row, never a failed page. The report is
kept for a minute, since the settings page asks on every open (for the badge), but not past a save (it's keyed on
ConfigVersion) or an installed update; the page asks again after either. "Run checks again" asks for a fresh one, and
requests during a run share it; a superseded run that finishes last doesn't replace a newer report. The checks read Jellyfin through
`IJellyfinFacts` (branding, Quick Connect, plugins, segment providers, library options, intro coverage), so each is
unit-tested with stubs; Seerr and Trakt through their existing clients. Test connection's logic moved into
`SeerrConnectionTest`, which the Requests card and the health row share. `TraktLists` records its last fetch.

Messages are plain words with no address or secret: they go into the copied report. Connection errors from .NET name
the host, so `HealthText.Scrub` takes out the endpoint's host and any URL first.

## 4. Copy report

One button copies a plain-text summary for a bug report: the Lumen and Jellyfin versions, each check's status, title,
id and message, and each device's rows. No secret goes in: settings are "set" / "not set"; page-only details (the
address a check tried, the headers it received) are left out; and the whole text goes through `redact()`, which
removes Seerr's address (saved and typed), the Quick Connect address, this page's host, and anything shaped like a URL,
email address, IP address or key (a run of 20+ letters and digits with both in it, so long check ids survive). The
Clipboard API is used where the page is secure, else a selected textarea and the copy command; if both fail, the
report shows in a box to copy by hand.

## 5. TV

The tab is a `focuscontainer-y`: between two fixes, past a row's text, the Dashboard's drawer can be nearer than the
next fix, and jellyfin-web's D-pad would jump there. Up from the top buttons is sent to the tab strip by hand, since
the container keeps it in otherwise. The summary buttons sit on the left under the tabs, so Down from the tabs lands
on them. Technical details' `<summary>` carries `focusable`, as jellyfin-web's D-pad skips elements it doesn't know.

## 6. Adding a check

- **Server:** a class implementing `IHealthCheck` and one line in `ServiceRegistrator`. The page shows it with no
  client change, unless it needs a new group (`GROUPS` in healthModel.ts) or a new fix key (`fixes.ts`; a Dashboard
  route goes in `HEALTH_FIX_ROUTES` in the registry, which stock-routes.spec.ts checks).
- **Browser:** a function in probes.ts, added to `runBrowserChecks`.

Planned once the PRs in flight are on main:

- **Notifications** (#135, `requests.push`): subscribed devices, the last send's result, the webhook set up; a server
  check reading the push subscription store. The HTTPS row's message then names notifications too.
- **Skip Intro** (#134): the help link moves to `docs/skip-intro-setup.md` when it lands (`HELP_LINKS` in fixes.ts);
  `selector.upNext`'s text is already in devices.ts.

## 7. Compatibility

The admin bundle has no size budget; the tab adds about 8 KB gzipped to it (34.6 → 42.2 KB). Chromium 68 / Safari 13: no flex `gap`
(margins), no `color-mix` without a fallback, no `flatMap`; fetch with AbortController (Chromium 66, Safari 12.1).
