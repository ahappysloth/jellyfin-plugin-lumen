# Lumen — Top charts and Trakt rows

- **Date:** 2026-11-12
- **Status:** Approved by the owner 2026-11-12; this note records the decisions and how they were built.
- **Builds on:** the [Top 10 rows note](2026-11-12-top10-rows-design.md) (the Trakt key, matching, catalog cards,
  caching), and the [requests spec](2026-11-08-lumen-requests-design.md) (catalog cards, the request dialog).

Everything here uses only the admin's Trakt **Client ID**: Trakt's public charts and lists, no user sign-in.

## 1. Top charts page

- **Where:** a Lumen page riding on home like History and My requests: `#/home?lumen=charts&chart=movies|shows&period=
  weekly|monthly|yearly|all` (jellyfin-web renders home and ignores the parameters). It follows the "Home" switch, as
  it's reached from home. A Top 10 row's title links to it (its own chart, This week) with a dim "See all ›" beside the
  title; the link's name is "Top 10 Movies This Week, see all in Top charts". On TV, Up from the row's cards reaches it.
  A Top 10 row showing Seerr's trending list instead (Trakt has none to give yet) has no See all: the server marks such
  a row `Source: "Seerr"`.
- **Without a Trakt key** there's no page: `ClientConfig.Charts` (a Trakt key is saved; never the key) is false, the
  rows have no See all, the route shows "Page not found", and `GET /Lumen/Charts/…` answers 404.
- **What it shows:** a Movies / Shows switch, a period switch (This week, This month, This year, All time: Trakt's
  `/{movies|shows}/watched/{weekly|monthly|yearly|all}`), and a poster grid of up to **100** titles, each with its rank
  on a tab over the poster's corner (the top three in the accent), and the card's title, year and type under it. On a
  phone the period chips say Week, Month, Year and All time (the full names stay the buttons' names), and the grid has
  two columns, so a card has room for its whole meta line and for its rank and its request state ("Requested") side by
  side; the state tab never runs under the rank.
  The rank tab is decoration; each card's name starts with the rank ("4, Title"), as in the Top 10 rows.
- **Cards:** a title the user can watch is its normal Lumen card (opens its page, card menu). A title the server doesn't
  have is a catalog card, with the Top 10 rows' Request button under it (D-pad: Down from the card) and request
  progress, when the user has Seerr.
- **True ranks:** unlike the Top 10 row, which renumbers 1..n, a chart keeps Trakt's rank. Without Seerr, titles not on
  the server are left out and the rest keep their places (4, 9, 23…). A title Seerr can't describe (or not within the
  page's 6 s) also leaves a gap rather than shifting the rest; it's usually there on the next load. Two Trakt titles
  that are one item (matched by TMDB id and by IMDb id, or one through Seerr's link to the server) show once, at the
  better rank.
- **Paging:** `GET /Lumen/Charts/{type}/{period}?startIndex=&limit=` pages over the titles this user can be shown,
  24 at a time (50 at most). Only a page's titles are looked up in Seerr, and the client asks for the next page as the
  grid's end nears the screen (an IntersectionObserver, 1200 px ahead), so a TV never draws or fetches art for 100
  posters at once; their images are lazy too.
- **State:** the chart and period are in the URL, replaced (not pushed) as they change, as Search does with its query,
  so Back from a title returns to the same chart, scrolled to and focused on the card (and put back there should
  jellyfin-web's own page scroll to the top as it shows). Charts loaded this session are kept per user, so going back
  is instant; a copy older than 30 minutes is fetched again on the next visit (not on Back to it), and they're dropped
  when the session ends. A page still loading when the user switches chart lands in its own chart's copy, and coming
  back to that chart waits for it rather than asking again.
- **Code size:** the page is a chunk of its own (`views/charts`, with `lumen-charts.css`), loaded when it first opens,
  rather than more of the secondary views: only servers with a Trakt key have it, and the secondary file is close to
  its 9 KB budget. Its budget is 5 KB (2.9 KB today). Reading the chart and period from the URL happens in that chunk,
  not in `parseRoute`, which the inline guard carries (its 4 KB budget has no room).

## 2. Trakt rows

New home section types, not in the defaults; admins add them under Home sections, where they come through the
section-types API like any other (the editor itself is unchanged). Each is **hidden without a Trakt key**. Cards follow
the Top 10 rows' rules (matching, catalog cards, Request button under the card, owned titles filling gaps when Seerr
can't describe a title), in Trakt's order, as posters **without** the numerals.

| Type | Trakt | Row title | Cards |
|---|---|---|---|
| Box Office | `/movies/boxoffice` | Box Office This Weekend | 10 at most |
| Most Anticipated Movies / Shows | `/{movies,shows}/anticipated` | Most Anticipated Movies / Shows | the home's limit (20) |
| Trending Movies / Shows | `/{movies,shows}/trending` | Trending Movies / Shows | the home's limit (20) |
| Trakt list | `/users/{user}/lists/{list}/items/movie,show` | the list's name on Trakt | the home's limit (20) |

- **Most Anticipated without Seerr: hidden.** Its titles are mostly not out yet, so the server almost never has them;
  without Seerr they can be neither pictured nor requested, and a row of the one or two that are here (if any) would
  say little about what's anticipated. So with no Seerr access for the user, the row isn't shown at all (and Trakt isn't
  even asked). The other rows without Seerr show the titles on the server, like Top 10 (Box Office and Trending often
  have a few).
- **Trakt list** has a Text parameter, the list's address, so (under Lumen's single-use rule) it can be added once per
  list.
  - Addresses: `https://trakt.tv/users/{user}/lists/{list}` and `https://trakt.tv/lists/{id}`, on trakt.tv,
    www.trakt.tv or app.trakt.tv, with or without `https://`, a trailing slash, a query (`?sort=…`) or a fragment.
    Anything else (a watchlist, a title's page, another site, another port, credentials in the URL) is refused **on
    save** with "Enter a public Trakt list's address, like https://trakt.tv/users/name/lists/list-name." User and list
    are Trakt slugs (letters, digits, `.`, `-`, `_`), escaped into the API path, and read in lowercase (Trakt makes its
    slugs lowercase), so one list typed two ways is one cached copy.
  - With no title set, the row is titled with the list's own name from Trakt (`GET /users/{user}/lists/{list}`), or
    "Trakt list" if Trakt gives none.
  - A **private, deleted or missing** list (Trakt's 404, or 401: "OAuth must be provided", which a key alone can't
    give) hides the row and is logged once (and its recovery once); a list that becomes private is dropped rather than
    served stale. A 403 is Trakt refusing the key (invalid, or the app unapproved): "Trakt rejected the API key", and
    the last copy keeps being served, as for every other failure.
  - A list's name and items are asked for at once, so its first load takes one Trakt timeout, not two.
  - Movies and shows mix: titles are matched to the library by TMDB id with their type (movie 5 isn't show 5), then IMDb
    id, in one query as the viewing user.

## 3. Caching, resilience and limits

- **One cache for every list** (`Trakt/TraktLists.cs`, generalised from the Top 10 rows' `Top10Lists`), keyed by the
  query (path, limit, freshness). The Top 10 rows and Top charts' This week are the same query, so one copy serves both
  (it now reads 100 titles, which also gives the Top 10 rows more to skip through).
- **Stale-while-revalidate, back-off, log once:** as before. A stale copy is served at once while one refresh runs; only
  a list's first load waits (3 s per Trakt call). On a failure the last copy keeps being served, that list isn't asked
  again for 10 minutes, and the failure is logged once (and the recovery once). A new key starts over. A list nobody
  has asked for in 24 hours (a row removed, a list's address changed) is forgotten.
- **Freshness:** trending 30 min, user lists 1 h, charts (and Top 10) 3 h, anticipated 6 h, box office 12 h.
- **Pagination:** a list's pages (`?page=&limit=100`) are followed using Trakt's `X-Pagination-Page-Count` until the
  query's limit (100 for charts and lists), 5 pages at most, should Trakt page smaller than asked.
- **Rate limits:** Trakt allows 1000 GETs per 5 minutes per app. Every list is fetched at most once per freshness
  period, or per 10-minute back-off when failing, whatever the number of users: 8 charts, 5 rows and N lists (2 calls
  each) come to a few dozen calls an hour.
- **The key** stays an admin-only secret (never in any JSON, including `ClientConfig`), and the Trakt HTTP client
  still never follows redirects, so the key in its header only ever goes to Trakt.

## 4. Settings

The settings card is now **Trakt** (was "Top 10"): it says the key powers Top charts and the Top 10, Box Office, Most
Anticipated, Trending and Trakt list sections, that without it the Top 10 rows rank Seerr's trending titles and the rest
stay hidden, and that the key is only used from the server to read Trakt's public charts and lists.

## 5. Tests

- Server: list URL parsing (accepted and refused forms), each list type's path and parsing, pagination, list names,
  private/missing lists, per-query freshness and the shared weekly copy, every row type (with and without Seerr or a
  key, mixed lists, default titles, validation), and the charts service and endpoint (true ranks, paging, gaps, 404
  without a key, 503 when Trakt fails).
- Client: the charts page (ranks, owned vs requestable, switches and URL, paging, empty, retry, TV focus), the Trakt
  rows and See all, the route, and the settings card.
- E2E (`specs/trakt.spec.ts`, the stub's `/trakt/…` lists): the charts page by type and period with paging and Back,
  without Seerr, without a key; each row type; a private and a missing list; list address validation; TV D-pad on the
  charts page and to See all.
