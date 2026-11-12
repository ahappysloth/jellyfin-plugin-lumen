# Lumen — Download progress for requests

- **Date:** 2026-11-12
- **Status:** Approved by the owner 2026-11-12; this note records the decisions and how they were built.
- **Builds on:** the [requests spec](2026-11-08-lumen-requests-design.md) (Seerr as the user, catalog cards, My Requests
  row, fail open) and its §10 decisions.

## 1. What it is

A user who requested a title can see how it's going, wherever the title shows:

1. **The title page** (`#/home?title=…`): the status, a progress bar, the percentage and the time left, moving on by
   itself while the page is open and visible. Once it's ready, the page offers **Open in library**.
2. **Posters in every row** (catalog rows, Top 10, My Requests, search, "You may like"): the card's tab says the status,
   a slim bar runs along the art, and the line under the title says "45% · 12 min left" (or "3 of 8 episodes · …").
3. **My requests** (account menu, and the Me tab's page on phones; `#/home?lumen=requests`, riding on home like
   History): every request, newest first, with its status, progress and time left. A row opens the title's page, or
   its library page once it's ready.
4. **A pop-up** (Lumen's toast, with an **Open** button) when something the user requested is ready to watch, once per
   request, across reloads and devices.

Only the user's own requests: another user's request for the same title shows as the card's plain state, as before.
Admins see their own too; there's no admin-wide view.

## 2. Statuses

| Status | When (Seerr's `/user/{id}/requests`) |
|---|---|
| Requested | request status 1 (waiting for an admin's approval) |
| Queued | approved, nothing in Radarr's/Sonarr's queue yet (or only waiting/paused entries with nothing downloaded) |
| Downloading | a queue entry downloading (or partly downloaded) |
| Processing | every queue entry downloaded (`completed`, or nothing left), or the queue entry left within the last 6 hours: imported, waiting for Seerr's library scan |
| Ready | request status 5 (completed), or the media's status 5 (available) |
| Declined / Failed | request status 3 / 4; also Failed when every queue entry failed |

Seerr's MediaRequestStatus (`server/constants/media.ts`): 1 pending, 2 approved, 3 declined, 4 failed, 5 completed.
Seerr marks a request completed when everything it asked for is available (`MediaSubscriber`).

## 3. Where the progress comes from

Seerr already has it. Every `Media` it loads carries `downloadStatus` and `downloadStatus4k` (an `@AfterLoad` hook,
`server/entity/Media.ts`), filled from Radarr's and Sonarr's `/queue` by its download tracker
(`server/lib/downloadtracker.ts`), which its **Download Sync** job refreshes every minute. Each entry
(`DownloadingItem`): `size`, `sizeLeft`, `status` (queued, paused, downloading, completed, failed, warning, delay…),
`timeLeft`, `estimatedCompletionTime`, `downloadId`, `title`, and for Sonarr `episode` (`seasonNumber`,
`episodeNumber`). `GET /user/{id}/requests` joins each request's media, so **one Seerr call per user** gives every
request's status and queue: no title lookups, no Radarr/Sonarr credentials in Lumen.

Without Radarr/Sonarr connected to Seerr (or with nothing in the queue), the lists are empty: the status shows without
a bar or time left.

- **Bytes:** Sonarr lists a season pack once per episode, each with the whole pack's size, so bytes are summed once per
  `downloadId`. A download that has left the queue (imported) counts as done, so a show's bar never goes backwards.
- **Time left:** from the download that will finish last (`estimatedCompletionTime`). The server sends **seconds
  left**, never a time, so a TV with a wrong clock still counts down correctly; the client counts down from when the
  answer arrived. Estimates in the past (Seerr turns a missing one into the epoch) mean "unknown".
- **Episodes:** a show with more than one episode in the queue says "3 of 8 episodes": the episodes seen in the queue
  so far, and how many of them are downloaded (left the queue, or finished in it).
- **4K:** a 4K request follows `downloadStatus4k` (Lumen files only non-4K requests today).

The server remembers, per request, the downloads and episodes it has seen (in memory, bounded): that's what keeps the
bar from going backwards and tells Processing from Queued once a download has left the queue.

## 4. Load

There's no push from Seerr, so the client polls, and both sides keep it gentle:

- **Server** (`RequestProgressService`): each user's Seerr answer is cached for **8 s**, and calls that arrive while one
  is on its way share it (one Seerr call per user per 8 s at most, whatever their devices and tabs do). Titles and art
  come from the shared 10-minute title cache. Calls go through the Seerr circuit breaker like every user-facing call;
  filing a request through Lumen, or saving Lumen's settings, starts the user's cache over.
- **Client** (`views/catalog/requestProgress.ts`), only where Seerr is set up (`ClientConfig.Requests`, so servers
  without Seerr never ask):
  - one check per page load, once the browser is idle after the first page (never competing with it);
  - then only **while the page is visible** and **something is in flight** (Requested, Queued, Downloading,
    Processing): every **45 s**, or every **10 s** while a title page or My requests shows a download in progress;
  - with nothing in flight, **no more checks** until the user files a request or opens My requests;
  - a 404 (no Seerr account) stops it for the session; a failed first check is tried twice more, then left.
- **Old TVs:** a card subscribes to its own title's entry and re-renders only when that changes; the first check waits
  for idle time; nothing ticks between checks.

## 5. The pop-up, once

`GET /Lumen/Requests/Mine` marks a ready title `Announce: true` when Lumen had seen one of its requests in flight and
nobody has been told yet. The client posts `POST /Lumen/Requests/Announced` and shows the toast (one title: "<title> is
ready to watch" with **Open**; several: "N of your requests are ready to watch" with **My requests**).

The server keeps, per Jellyfin user, the Seerr request ids it has seen in flight (`ReadyAnnouncements`, a small JSON
file in Jellyfin's data folder, at most 200 ids per user, starting over if Seerr's address changes). Only those can
pop up, so requests that were ready before this feature (or before Lumen first looked) never flood the screen; a
request filed through Lumen is watched from the moment it's filed. Marking it announced removes it, so the pop-up shows
on one device and no other. Two devices checking within the same second could both show it; that's the "where
feasible".

## 6. Permissions

Everything is the signed-in user's own: the Jellyfin user id comes from the authenticated principal, its Seerr id
from the existing user map (`SeerrUserMap`), and the Seerr call is made as that user (`X-Api-User`) for that user's own
list (Seerr itself refuses another user's list without request-management permissions). The cache and the announcement
list are keyed by the user. A user without a Seerr account gets a 404, and the client stops asking.

## 7. Size

The store, the card's bar and the toast's button are in the startup bundle (about 2 KB gzipped with their strings and
styles: 66.2 → 68.2 KB of 72 KB). My requests and the title page's progress block load with the catalog title page's
chunk (3.4 → 4.6 KB of 6 KB), which servers without Seerr never download.

## 8. Tests

- **Server:** status mapping for movies and shows (each request status, queue states, 4K), the bytes and episode
  maths (season packs, imported episodes), time left, the cache (TTL, sharing concurrent calls, failures not cached,
  invalidation, settings saves), one user never seeing another's, the announcement list (once, per user, persisted,
  declined forgotten), and the endpoints.
- **Client:** the polling rules (idle first check, none with nothing in flight, 45 s / 10 s, hidden pages, 404,
  retries, a page change mid-check), the pop-up once, cards, the title page following a download, My requests.
- **End to end** (`requests-progress.spec.ts`, with the stub Seerr's `/__stub/progress`): poster bar and label (rows
  and search), the title page moving on its own, My requests in every state and opening titles, the pop-up once
  across a reload and a second browser, request counts with nothing in flight, and the TV D-pad.
