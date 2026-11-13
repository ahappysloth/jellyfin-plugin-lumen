# Lumen — Push notifications when a request is ready

- **Date:** 2026-11-12
- **Status:** Approved by the owner 2026-11-12; this note records what was investigated, the decisions, and how they
  were built.
- **Builds on:** the [request progress note](2026-11-12-request-progress-design.md) (the request list, its cache, and
  the once-only "ready to watch" pop-up) and the home-screen app (`/Lumen/Manifest`, scope `/web/`).

## 1. What it is

A user can turn on, per device, a notification for when something they requested through Seerr is ready to watch.
It arrives with the app closed: "Dune is ready to watch", with the artwork where the platform shows pictures, and a
tap opens Lumen on that title. It uses the Web Push standard, which iOS 16.4 and later supports for web apps added
to the Home Screen (the owner's case), and which Chrome, Edge, Firefox and Safari support on desktop and Android.

Off by default. Nothing is registered, asked for or downloaded on a device until its user taps the switch.

## 2. The service worker

### What jellyfin-web 12.4 has

- It registers `serviceworker.js` (relative to `/web/index.html`, so `/web/serviceworker.js`, scope `/web/`) at
  startup, except in its TV layout, on Xbox, and in the Cordova and Android apps.
- That file is a webpack chunk (`(self.webpackChunk=…).push([[82798],{…}])`) with no webpack runtime beside it in the
  worker, so its code never runs: the `notificationclick` and `activate` handlers in it are never added. There is no
  `push` handler in it at all.
- jellyfin-web's own notifications (chunk 44184) are shown from the page through
  `navigator.serviceWorker.ready.then(r => r.showNotification(…))`, which only needs that registration to exist.

### Options

1. **Wrap or extend jellyfin-web's worker** through the plugin's middleware (as `index.html` is injected): serve
   `/web/serviceworker.js` with Lumen's handlers and `importScripts` of the original. Lumen's worker would then
   control the pages and could navigate them, but it would depend on a jellyfin-web file that is already broken,
   that isn't registered at all on TVs and in the apps, and whose name, scope and update cycle are jellyfin-web's.
   Every jellyfin-web update could break push, silently.
2. **Lumen's own worker, at its own scope.** A service worker's scope is where its script is served from. A push
   subscription belongs to a registration, and a browser delivers a push to that registration's worker whatever
   pages it controls. So a worker that controls no page at all can do everything push needs. (Firebase's default
   web push worker works this way, at `/firebase-cloud-messaging-push-scope`, on iOS too.)

### Decision: option 2

- The worker (`client/src/views/push/pushWorker.js`, built to `lumen-push-sw.js`) is served by the plugin at
  `<server>/Lumen/Push/sw.js` (`PushController.GetWorker`), anonymously and with `Cache-Control: no-cache`, like any
  worker script. Its scope is `<server>/Lumen/Push/`. Under a base URL both sit under it.
- It handles `push` and `notificationclick` and nothing else: no `fetch` handler, no cache. It controls no page.
- jellyfin-web's registration at `/web/` is untouched, and `navigator.serviceWorker.ready` on the page still resolves
  to it. **Lumen depends on nothing of jellyfin-web's worker**, so there is no compat-registry entry for it. The one
  thing of jellyfin-web's the worker knows is the routes a notification opens (`#/details?id=`, `#/home?title=`,
  `#/home?lumen=requests`), which are the registry's; `pushWorker.test.ts` checks the worker's copies against
  `detailsHash`, `titleHash` and `MY_REQUESTS_HASH`.
- A worker that doesn't control a page can't navigate it. So on a tap: if a Lumen window is open, the worker posts
  `{ type: 'lumen-push-open', hash }` to it and focuses it, and the page goes to the hash (only `#/…` hashes are
  followed); otherwise it opens `<server>/web/index.html#…`, which is inside the home-screen app's scope.
- The worker always shows something for a push, even one it can't read ("Something you requested is ready to
  watch"): browsers withdraw the permission from sites whose pushes show nothing.
- The file is plain ES5, copied to the build as written (like the web plugin's definer). Its paths (icon, artwork)
  arrive relative and are resolved against the worker's own address, and never leave it: a message can't make the
  worker load anything from another origin.

## 3. The server

### Keys

- A VAPID key pair (P-256) and a webhook secret, made by Lumen itself the first time they're needed
  (`ILumenConfigStore.GetPushSecrets`) and stored in the plugin's configuration, next to the Seerr and Trakt keys.
- All three are `[JsonIgnore]`: they're never in `GET /Lumen/Admin/Config`, nor in Jellyfin's own
  `GET /Plugins/{id}/Configuration`, and a posted configuration can't set them. Saves and "Reset to defaults" keep
  them (every device's subscription is tied to the public key). Only the public key ever reaches a client
  (`GET /Lumen/Push/Status`), and the webhook secret only the admin page.
- They aren't made on a server without Seerr.

### Web Push, with .NET's own crypto (no new package)

- `WebPushEncryption` (RFC 8291, `aes128gcm` of RFC 8188): ECDH on P-256 (`ECDiffieHellman.DeriveRawSecretAgreement`),
  HKDF-SHA-256 (`HKDF.DeriveKey`) and AES-128-GCM (`AesGcm`), one record, a new sender key and salt per message. Tested
  against RFC 8291's own example, byte for byte.
- `VapidKeys` (RFC 8292): an ES256 JWT (`ECDsa.SignData` in IEEE P1363 form) with `aud` (the push service's origin),
  `exp` (12 hours ahead; push services take at most 24) and `sub`. Lumen has no address of the operator's to give
  as `sub`, and Apple refuses made-up ones, so it's the project's page.
- `WebPushClient` (RFC 8030): `POST` to the subscription's address with `Content-Encoding: aes128gcm`, `TTL` (3 days
  for "ready", a minute for a test), `Urgency: normal` and `Authorization: vapid t=…, k=…`. 10 s timeout, no
  redirects. 2xx is sent; 404 and 410 mean the subscription is gone; other 4xx refused; 429, 5xx and network
  errors a failure to try again.

### Subscriptions

- `PushSubscriptionStore`: a JSON file in Jellyfin's data folder (`lumen/push-subscriptions.json`), per Jellyfin user,
  one subscription per device (Jellyfin's device id for the sign-in), at most 10 devices per user. A push address
  belongs to one user: subscribing from a browser another user subscribed from moves it.
- Removed when: the user turns it off; the push service answers 404 or 410; it refuses three times running (a
  subscription made for other keys, say); the user signs out of the device (checked against Jellyfin's device list
  before each send); the user is deleted; the keys are reset.

### Endpoints

All under `Lumen/Push`, for the signed-in user. The user and the device come from the authenticated principal, never
from the request, so nobody can read, replace or remove another user's subscription, or another device's.

| | |
|---|---|
| `GET Status` | whether the user has request features, the public key, and the address stored for this device |
| `POST Subscription` | stores the browser's subscription for this device |
| `DELETE Subscription` | removes this device's (always allowed) |
| `POST Test` | sends this device a test; rate-limited per user: one per 10 s, five per 10 minutes (429 with `Retry-After`) |
| `GET sw.js` | the worker (anonymous) |
| `POST Seerr` | Seerr's webhook (anonymous; checks the secret) |

Admin only, under `Lumen/Admin/Push`: `GET` (devices, users, whether the job runs, the last send, the webhook's
path and secret) and `POST ResetKeys`.

## 4. When it's sent

Seerr doesn't push to Lumen by itself, so a background job asks it (`ReadyPushJob`, an `IHostedService`):

- **Every 2 minutes**, for users who have notifications on somewhere **and** a request Lumen is watching (seen in
  flight, or filed through Lumen: `ReadyAnnouncements`). Nobody else costs Seerr anything.
- **Every 15th pass (half an hour)**, the other users with notifications on too, once each, to find requests they
  filed in Seerr's own interface. (Without this, such a request would only be noticed when its user next opened
  Lumen.)
- **At once** when an open page's own check finds a ready request for a user with notifications on, and when Seerr's
  webhook says something became available.

Each check is the request list's own cached, shared Seerr call (`RequestProgressService`: one call per user per 8 s
at most, failures cached, through Seerr's circuit breaker), so the job adds no new kind of load and backs off with
everything else when Seerr is down.

### Once per request, and never with the pop-up

- The job **takes** a ready request before sending (`IReadyAnnouncements.Claim`, one step under the list's lock), so
  whoever asks next, on any path, isn't given it.
- For a user with notifications on, `GET /Lumen/Requests/Mine` never marks a request for the pop-up: it wakes the
  job instead. **Push first; the pop-up never shows for the same request.** A user without notifications gets the
  pop-up exactly as before.
- If no device took the push (push service down, or every device gone), the request is given back: it's due again
  at the next pass, or, once no device is left, for the pop-up.
- The pop-up stays for everyone while the job isn't running.
- A title is announced when all of it that was in flight is ready, as with the pop-up: a show with another season
  still downloading waits for that one, and gets one notification.
- Up to three titles ready at once get a notification each; more get one ("5 of your requests are ready to
  watch"), opening My requests.
- A request that was ready before Lumen ever saw it in flight is never announced (as with the pop-up), unless
  Seerr's webhook names it.

### Seerr's webhook (optional, for instant delivery)

In Seerr: Settings → Notifications → Webhook, with **Request Available** ticked:

- **Webhook URL:** `<Jellyfin's address as Seerr reaches it>/Lumen/Push/Seerr`
- **Authorization Header:** the secret shown in Lumen's settings (Requests → Notifications)
- **JSON Payload:** Seerr's default.

Lumen reads `notification_type` and `request.request_id` from it and nothing else. On `MEDIA_AVAILABLE` it checks
every user with notifications on straight away, and announces the named request to its owner even if Lumen never saw
it in flight. What's ready, and for whom, is still read from Seerr itself, so a forged call could at most make Lumen
look early. A request Seerr names twice is announced once (the list remembers what each user was told). Seerr's
"Test" button gets a 204.

## 5. What a notification says

The payload is small JSON the worker reads (`PushMessage`): `title`, `body`, what to open (`item`: a Jellyfin item
id, or `key`: a catalog title, or `page: "requests"`), `image`, `icon`, `tag`.

- **Title:** "Dune is ready to watch". **Body:** "It's in your library now."
- **Tap:** the title's library page when it's in the library for this user, else its catalog page.
- **Picture:** the title's wide artwork through Lumen's image proxy, where the platform shows one (Chrome on
  desktop and Android; not iOS, which ignores it).
- **Locale:** Lumen's strings are English only, so the text is. The one thing formatted is the count in "1,234 of
  your requests…", written as the device's language writes it (the browser's `navigator.language`, stored with the
  subscription).
- **Tag:** one notification per title; a second about the same title replaces the first.

## 6. The client

- **Where:** "Notify me when requests are ready", on My requests and on the profile page (the account settings
  area), under a "Notifications" heading.
- **States:** on; off; blocked (the browser refuses notifications for the site: the switch is out of use and says
  to allow them in the browser's settings); and, on an iPhone or iPad in Safari, no switch but why: notifications
  need the Home Screen app (`navigator.standalone`, or `display-mode: standalone`).
- **Hidden** when Seerr isn't set up or the user has no Seerr account, when the browser has no Push API (TVs,
  Safari 13, iOS before 16.4, a page not on https), in the TV layout whatever the browser, and for a server on
  another origin than the page.
- **Send a test notification** while it's on, with the server's reason if it doesn't arrive.
- **The permission prompt** comes from the switch's tap and nowhere else, first thing, before anything asynchronous
  (Safari only allows it during the tap).
- **Self-repair:** a device that has notifications on checks, once per page load when the browser is idle, that its
  subscription still stands, and subscribes again quietly if the server's keys were reset or the browser's
  subscription changed. If another user is signed in on that browser now, it unsubscribes; if the permission was
  withdrawn, it has the server forget the device. A device that never turned notifications on downloads nothing for
  any of this (one `localStorage` read).

## 7. The admin page

In the Requests card, once Seerr is set up: how many devices of how many users have notifications on, how the last
notification sent went, the webhook's address and secret, and **Reset notification keys** (after a confirmation):
new keys and secret, every subscription dropped. Devices subscribe again by themselves when they next open Lumen.

## 8. Security and privacy

- Subscriptions are per user and device, managed only by that user on that device (§3).
- The server posts to whatever address a subscription names, so only the push services browsers use are accepted
  (Google's, Apple's, Mozilla's and Microsoft's, https, default port): a signed-in user can't make the server post
  into its own network. The tests' stub is allowed through an environment variable a real server never sets
  (`LUMEN_PUSH_TEST_ENDPOINT`).
- A message is encrypted for the one browser; the push service sees its size and timing, not its content. It holds
  no secret anyway: a title, and at most the user's artwork token, which opens TMDB artwork and nothing else.
- The VAPID private key and the webhook secret never leave the server (the secret only to the admin page). Logs
  name a push service's host and status, never an address or key.
- Signing out of a device ends its notifications.

### Behind a reverse proxy (Nginx Proxy Manager, https)

- Web Push needs https (or localhost): on plain http there's no Push API, and the switch doesn't show.
- Nothing in a notification depends on the server knowing its public address: the worker resolves every path
  against its own, which is the address the user opened.
- The proxy must pass `/Lumen/Push/sw.js` without a login of its own, as it does `/web/` and `/Lumen/Manifest`.
  With a Content-Security-Policy, `worker-src` (or `script-src`) must allow `'self'`.
- The server itself must reach the push services over https (outbound).
- Seerr's webhook can use Jellyfin's internal address.

## 9. Size

- Startup: +0.2 KB (the loader and one `localStorage` read): 70.3 KB of 72 KB.
- A new chunk for the toggle with its stylesheet, with its own budget: 3.6 KB of **4 KB**. Fetched on My requests
  and the profile page, and at idle on a device with notifications on.
- The worker: 1.8 KB of its own **2 KB** budget. No page waits for it.

## 10. Tests

- **Server:** the encryption against RFC 8291's example (and a round trip through a browser-side decryption); the
  VAPID JWT (verified with the public key); the subscription store; the sender (404/410 cleanup, three refusals,
  signed-out devices); the job with the real request list and announcement list behind it (once per request on
  every path, push instead of the pop-up, given back when undelivered, who is polled); the endpoints (ownership,
  validation, the rate limit, the webhook's secret); the keys in the configuration (made once, never in JSON,
  surviving saves and resets).
- **Client:** the states, the tap's order (permission first), re-subscribing, the self-repair on load, the toggle,
  the worker (evaluated as a browser would, with its routes checked against the registry), the admin block.
- **End to end**, with the stub Seerr also standing in for a push service: the toggle in a real Chromium with the
  real worker registered (only `pushManager.subscribe` is stood in for, as no push service is behind a test
  browser), a test notification decrypted by the test as the browser would and shown by the worker, a tap taking
  the open app to the title, a request turning ready pushed once (by the webhook with no page open, and by an
  open page's check) with no pop-up, 410 cleanup, the rate limit, the admin block and its reset.

## 11. What needs a real iPhone

Playwright has no push service behind its browsers and no iOS, so these are unconfirmed: that the Home Screen app
shows the permission prompt from the tap; that Apple's push service accepts the subscription, the VAPID token and
the message; that the notification arrives with the app closed; and that a tap opens the app on the title
(`clients.openWindow` with a hash inside the app's scope), both with the app closed and in the background.
