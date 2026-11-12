# Lumen — "Top 10 this week" home rows

- **Date:** 2026-11-12
- **Status:** Approved by the owner 2026-11-12; this note records the decisions and how they were built.
- **Builds on:** the [requests spec](2026-11-08-lumen-requests-design.md) (catalog cards, the request dialog, fail open).

## 1. What it is

Two home section types, **Top 10 Movies** and **Top 10 Shows** (like Popular Movies / Popular Shows), each a ranked
row with a large numeral beside every card. The ranking is what people actually watched this week:

- **Source:** Trakt's weekly most-watched lists, `GET https://api.trakt.tv/movies/watched/weekly?limit=…` and
  `/shows/watched/weekly`, with `trakt-api-version: 2` and `trakt-api-key: <client id>`. Lumen asks for 40, so the
  row still fills after the rules below skip titles.
- **Fallback:** without a Trakt key (or before Trakt has ever answered), the rows use the TMDB trending list Seerr
  already gives Lumen (`/discover/trending`, pages 1 and 2 if needed), filtered to the row's media type.
- **Neither:** no Trakt key and no Seerr access for the user → the rows return nothing and are hidden.

New installs don't get these rows; admins add them under Home sections, like the other catalog rows.

## 2. Matching and cards

- Trakt titles are matched to the library by **TMDB id, then IMDb id**, in one query run **as the viewing user**
  (`InternalItemsQuery(user)` with `HasAnyProviderIds`), so library access and parental controls apply: a restricted
  user never gets a card for an item they can't open.
- **Titles the user has** are normal Lumen poster cards: they open the details page and play from there, with the
  usual card menu and badges.
- **Titles the user doesn't have**, when the user has Seerr access, are catalog cards built from Seerr's (cached) title
  summary, a few lookups at a time within a time budget. If Seerr says a title is on the server and the user can see
  it (an item without provider ids, say), it becomes the library card. A title on the server that the user can't see
  stays a catalog card, exactly as in the catalog rows (requests spec §5.1).
- **Without Seerr** (not configured, or the user has no Seerr account), titles the server doesn't have can be neither
  requested nor pictured, so they're skipped. The row shows the ranked titles the user has.
- Ranks are positions in the final row, **1..n with no gaps**, in Trakt's order.

## 3. Requesting from the row

An unowned title the user may request (Seerr's media-type permission, from `/Lumen/Requests/Status`) and that nobody
has requested yet gets a **Request** button under its card. It opens the **same request dialog** as the title page
(movie: one confirmation; show: the season picker), on the home screen, after loading the title's details; the dialog
code stays in the lazily loaded title chunk. Once Seerr accepts, every card for the title shows the new state and the
button goes. The card itself still opens the catalog title page.

The button is under the card, not over its art, so the TV's D-pad reaches it (Down from the card).

## 4. Look

Lumen's own treatment, not any streaming service's artwork: a tall numeral in Lumen's font beside each poster, lit from
above (white at the top, falling off into a faint silhouette at the poster's foot); focusing or hovering the card lets
that light run into the accent colour. Posters are 172 px wide (124 px on phones). The numeral is decoration
(`aria-hidden`); each card's accessible name starts with its rank ("3, Title").

## 5. The Trakt key

- An admin-only secret stored like the Seerr API key: persisted in the plugin's XML config, never serialized to JSON
  (neither Lumen's admin endpoint nor Jellyfin's own `/Plugins/{id}/Configuration` returns it). The settings page
  learns only whether one is saved (`TraktClientIdSet`).
- A save with a blank field keeps the stored key; **Remove key** sends `ClearTraktClientId` to delete it. It must be
  printable ASCII (it goes in a header).
- Its field sits in its own **Top 10** card on Lumen's settings page, after Requests. The help text says it's a free key
  from trakt.tv/oauth/applications and is only used to fetch the weekly lists. **Check key** asks Trakt for this
  week's top movie with the typed (or saved) key, without saving (`POST /Lumen/Admin/Trakt/Test`).

## 6. Caching and failure

- Each Trakt list is cached server-wide for **3 hours**. A stale list is served at once while one refresh runs in the
  background; only the first load waits, for at most Trakt's **3 s** timeout (the row's own timeout is the catalog
  rows' 6 s).
- On a Trakt error or timeout: the last good list keeps being served (or, with none, the Seerr fallback), Trakt isn't
  asked again for 10 minutes, and the failure is **logged once** (and the recovery once), not per request.
- The Trakt client never follows redirects (the key is a custom header). `LUMEN_TRAKT_API_BASE` overrides its address
  for the end-to-end tests' stub, like `LUMEN_TMDB_IMAGE_BASE`.
