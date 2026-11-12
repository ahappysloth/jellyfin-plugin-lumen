# Lumen — Quick Connect with a QR code

- **Date:** 2026-11-12
- **Status:** Approved by the owner 2026-11-12; this note records the decisions and how they were built (0.5.0).
- **From:** the Quick Connect design review of 2026-11-12 (against Lumen 0.4.3, jellyfin-web and Jellyfin server
  12.4), whose tested findings it follows, and the owner's answers to its open questions.

Jellyfin's Quick Connect signs a device in without a password: the device shows a six-digit code, and someone already
signed in approves it. Lumen makes both sides its own: a screen on the sign-in page with the code large and a QR code,
and an approve page at `#/quickconnect`.

## 1. The sign-in side (the new device)

- **Lumen's own flow, not an injection into jellyfin-web's dialog.** The stock dialog only gives the code inside a
  translated sentence (one language has no code in it at all), keeps asking the server every 5 s after it's closed,
  calls an expired code "deactivated" and never gets a new one, and on a TV shows the code in 20 px text.
- **Taking the click:** Lumen listens for clicks on `.btnQuick` on the document in the capture phase, so it hears the
  click (and Enter, and a remote's OK) before jellyfin-web's own listener and stops it, only on `#/login`, only with
  `data-lmn-skin` set (a strict CSP that blocks the inline guard leaves it off, and the stock dialog with it).
- **Pre-flight, every click:** `ApiClient.quickConnect`, `ApiClient.ajax`/`getUrl`, `Dashboard.onServerChanged` and
  `Dashboard.navigate` must be functions, and the page's `serverid`, if any, must be `ApiClient.serverId()` (in the
  official multi-server apps the sign-in page can belong to another server). Anything missing, or the lazy file failing
  to load, and the click goes through to jellyfin-web's dialog. `window.Dashboard` carries an upstream "remove once
  plugins don't need it" comment, so this fallback is required, and the stock probe checks those functions exist.
- **The flow:** `POST /QuickConnect/Initiate`, then `GET /QuickConnect/Connect?secret=` every 3 s, paused while the page
  is hidden; on `Authenticated`, `ApiClient.quickConnect(secret)`, `Dashboard.onServerChanged(userId, token, client)`
  and `Dashboard.navigate(url)`, exactly as jellyfin-web does. `url` is the login page's own parameter (the deep link
  through sign-in), only an in-app path, routed in the app, never assigned to `location`.
- **The secret stays in memory:** never in the QR code, the DOM, a log or diagnostics.
- **Stopping:** Cancel, Escape or a remote's Back (prevented, or jellyfin-web's TV layout would go back a page), and any
  navigation, close the screen and stop the requests for good; an answer still on its way is ignored.
- **Refresh:** only when the server says the code is gone (`Connect` answers 404); the TV's clock is never used. After
  two automatic refreshes (about 30 minutes) it stops and offers "Get a new code", so a signed-out TV doesn't ask for
  codes all night. A 401 means Quick Connect was turned off: the screen says so.
- **Layout:** the code in very large digits grouped "123 456" (read digit by digit to a screen reader), the steps ("On
  your phone or computer, open Lumen → Quick Connect and enter this code, or scan the QR code"), Cancel, and the QR code
  on a white tile beside it. On a TV everything scales with the screen's height (the code is about 15% of it); the
  arrows and Tab stay on the screen's one or two buttons. On a phone the QR code is hidden (and so is "or scan").
- **On TVs, "Use Quick Connect" is the sign-in page's main button**, in the accent, with Sign In stepping back
  (stock-skin.css, `html.lmn-signin.layout-tv`). **Owner's decision:** it stays behind the button and doesn't open by
  itself, so a signed-out TV never asks the server for codes unprompted.

## 2. The approve side (`#/quickconnect`)

- **A Lumen page replacing jellyfin-web's**, lazy-loaded. It stays a `settings` route in `routes.ts` and `registry.ts`,
  which the inline guard bundles and already veils on a cold load; the switch from "frame over the stock page" to
  "Lumen's page" is in `takeover.ts` and `App.tsx`, which the guard doesn't include. If the file can't load, the stock
  page shows (it reads `?code=` too).
- **The account it signs in**, name and picture, at the top: Safari and the home-screen app can be signed in as
  different people.
- **One input drawn as six cells**, not six inputs: `inputmode="numeric"`, `pattern="[0-9]*"`, `autocomplete="off"`
  (not `one-time-code`: these codes never arrive by text or email, so all iOS could offer is someone's bank code), no
  `maxlength` (a pasted "123 456" would lose its last digit). Every input keeps digits only, cut to six. One label;
  errors tied to it with `aria-describedby`. A click puts the caret at the end, but a selection (keyboard focus, a
  double click) is kept, so a new code typed over a whole one replaces it.
- **Links are untrusted.** A link with a code in it is the classic device-code phishing vector, and the QR code makes
  following one a habit. So `?code=` only prefills (six digits, or nothing), then leaves the address bar; `userId` in
  the address is ignored; the page never submits on load; and a code from a link adds "This code came from a link or QR
  code." to the warning **"Only approve a code shown on a screen in front of you."**, which is always there. Approving
  for an administrator account adds "That device gets administrator access."
- **Owner's decision: the same rules for everyone.** Administrators may approve from a link like anyone else, with the
  warning; making them type the code wouldn't stop a determined phisher.
- **Owner's decision: administrators keep "sign in as another user"** (the kid's TV into the kid's account), as on
  jellyfin-web's page: an account picker defaulting to themselves.
- **The server's answers** (QuickConnectController.Authorize, 12.4), each announced (`role="status"` for success,
  `role="alert"` for errors):

  | Answer | Message |
  |---|---|
  | 200 | Done: that device is signed in as *name*. |
  | 404 | That code isn't valid or has expired. |
  | 500 | That code has already been used. |
  | 401, and `/QuickConnect/Enabled` is false | Quick Connect is turned off on this server (administrators: "Turn it on in Dashboard → General", `#/dashboard/settings`; not on a TV, which has no Dashboard) |
  | 401 otherwise | Your sign-in has expired. Sign in again. |
  | no answer | Couldn't reach the server. |

  The page also asks `/QuickConnect/Enabled` when it opens and shows the "turned off" state instead of the form.
- A how-it-works note under the form.

## 3. The QR code

- **What it encodes:** `<public base>/web/#/quickconnect?code=NNNNNN`. The code is after `#`, so it never reaches the
  server or a proxy log.
- **Owner's decision: a "Public address for QR codes" setting** (Lumen's settings, General). The owner's TVs reach the
  server over the LAN, and some will use a Tailscale DNS name, where a phone isn't signed in or can't reach it. An
  optional http(s) URL, a base path allowed, no credentials, `?` or `#`, at most 75 bytes (what the QR code holds
  besides `/web/#/quickconnect?code=123456`), checked as it's typed and on save (`ConfigValidator.IsQuickConnectAddress`,
  `util/publicAddress.ts`). Stored trimmed; blank is "not set".
- **Without it**, the address the showing device itself uses (`location.origin + location.pathname`), never the
  server's `LocalAddress`, which on a container is its internal address. Where the page isn't http(s) (an app wrapper),
  or the address is too long, the screen shows the code without a QR code.
- **Exposed before sign-in, safely:** the server puts the address alone in a `lumen-quick-connect-address` meta tag in
  `index.html`, only when the sign-in page is restyled and only a valid address, HTML-encoded. Nothing else about the
  server goes with it, and anyone who can open the sign-in page can reach the server anyway.
- **The encoder** (`views/quickconnect/qr.ts`) is hand-written, no runtime dependency: byte mode, level M (a phone
  pointed at a glossy TV sees glare), versions 1 to 6 (106 bytes), one fixed mask (2) rather than scoring all eight, to
  fit the budget; readers decode any mask. Drawn as one SVG path, black on white with a 4-module quiet zone: sharp on a
  4K TV and the same on Chromium 68 and Safari 13. Unit tests decode every length from 1 to 106 bytes with jsQR, an
  independent decoder (a dev dependency only), and compare two codes module for module with a reference encoder; the
  e2e test decodes a screenshot of the code the page really draws.

## 4. Code and budgets

- One lazy file, `QuickConnect` (approve page, sign-in screen, QR encoder, their strings), with its own stylesheet
  `lumen-quickconnect.css`, loaded the way `lazyCharts.tsx` loads its pair, only when Quick Connect opens.
  `/Lumen/Assets/` is anonymous, so it loads before sign-in.
- **Owner's decision: a new 6 KB budget line** for the pair (check-size.mjs; check-compat.mjs and vite.styles.config.ts
  list them). At release: 5,128 + 922 = 6,050 of 6,144 bytes gzipped. Startup grows by the click listener, the loader
  and the route switch, within its budget.
- **The guard's inputs are untouched:** guard plus web plugin stays at 4,046 of 4,096 bytes. A new route kind in
  `routes.ts` would have pushed it over.
- The compat registry has `.btnQuick` (probed on the sign-in page), and a `QUICK_CONNECT` export (routes, parameters,
  `ApiClient.quickConnect`, the `Dashboard` functions, the meta tag's name) outside what the guard bundles; the stock
  probe checks the functions exist on the sign-in page.
- No flex `gap` or `aspect-ratio` (Chromium 68): margins, and a grid for the cells.

## 5. Not done, and why

- **A QR scanner inside the app:** Safari has no barcode API, and a JavaScript decoder is tens of KB. On an iPhone the
  camera opens links in Safari, not the home-screen app, so typing the code in the app is presented as an equal path.
- **Showing which device was signed in** after approving (`/Sessions` lists it at once): left for later.
- **Translations:** Lumen's pages are English; the stock dialog and page are translated. In line with the rest of
  Lumen.
