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
  errors a failure to try again. A message too long for one record is a failure too, never the subscription's
  fault: nothing is removed for it.

### Subscriptions

- `PushSubscriptionStore`: a JSON file in Jellyfin's data folder (`lumen/push-subscriptions.json`), per Jellyfin user,
  one subscription per device (Jellyfin's device id for the sign-in), at most 10 devices per user. A push address
  belongs to one user: subscribing from a browser another user subscribed from moves it.
- Removed when: the user turns it off; the push service answers 404 or 410; it refuses three times running (a
  subscription made for other keys, say); the user signs out of the device (checked against Jellyfin's device list
  before each send); the user is deleted; the keys are reset. Whatever was counted against a push address (its
  refusals, its failing streak) is forgotten with it, so turning notifications off and on starts clean.
- Nothing but the push address, the browser's two keys, the device's id and name and the date is stored. (A
  `Locale` was, for a number's digit grouping that could never show: the request list covers 50 requests.)

### Endpoints

All under `Lumen/Push`, for the signed-in user. The user comes from the authenticated principal, and the device is
the one the request's access token was issued to, looked up in Jellyfin's device list (`ISignedInDevices.ForToken`).
Jellyfin's own device id claim isn't used for that: it repeats the `DeviceId` of the request's `Authorization` header,
so one of a user's sessions could name another of their devices. Nobody can read, replace or remove another user's
subscription, nor one session another device's. An API key, which is no device's token, has no subscription.

| | |
|---|---|
| `GET Status` | whether the user has request features, the public key, and the address stored for this device |
| `POST Subscription` | stores the browser's subscription for this device; rate-limited per user: 20 stored per minute (429 with `Retry-After`) |
| `DELETE Subscription` | removes this device's (always allowed) |
| `POST Test` | sends this device a test; rate-limited per user: one per 10 s, five per 10 minutes (429 with `Retry-After`) |
| `GET sw.js` | the worker (anonymous) |
| `POST Seerr` | Seerr's webhook (anonymous; checks the secret, in constant time). A body over 64 KB is answered 413, and a call there's no room to act on (256 checks already waiting) 503 with `Retry-After`, logged once |

Admin only, under `Lumen/Admin/Push`: `GET` (devices, users, whether the job runs, the last send, the webhook's
path and secret) and `POST ResetKeys`, both `Cache-Control: no-store`.

## 4. When it's sent

Seerr doesn't push to Lumen by itself, so a background job asks it (`ReadyPushJob`, an `IHostedService`):

- **Every 2 minutes**, for users who have notifications on somewhere **and** a request Lumen is watching that may
  be ready any time (seen in flight, or filed through Lumen: `ReadyAnnouncements`). Nobody else costs Seerr
  anything.
- **Every 15th pass (half an hour)**, the other users with notifications on too, once each: to find requests they
  filed in Seerr's own interface (without this, such a request would only be noticed when its user next opened
  Lumen), and to look in on requests that have **only been waiting for over a day**, for an admin's approval or
  for a release (a title that isn't out yet). Those can wait for months; once one is downloading it's asked about
  every pass again.
- A request is watched only while Seerr still lists it in flight or ready. One that was deleted in Seerr, removed
  from the server, declined, or pushed out of the newest 50 by later requests is forgotten at the next answer, so
  it can't keep its user being asked about every 2 minutes for ever.
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
- **Each device is owed the notification on its own.** One whose push service took it has it. One whose push service
  failed (a network error, a timeout, 429, 5xx) or refused is sent it again: three attempts in all, the second no
  sooner than a pass (2 minutes) after the first and the third 4 minutes after that, however often the job is woken
  meanwhile, and nothing later than 10 minutes after the first. A device that got it is never sent it twice.
- The request stays taken while that goes on: an open page shows no pop-up for it and doesn't wake the job (it used
  to, at the page's polling rate).
- Then the job **gives up**. If some device got the notification, the user was told, and that's all. If none did,
  the request is **left to the pop-up** (`Release`): the user hears of it the next time Lumen is open, though they
  still "have notifications on", and it isn't pushed late after that.
- If no device is left at all (every one gone, signed out or turned off), the request is given back as before: for
  the pop-up, or for a push to a device turned on later.
- A device that can't be reached is logged once, when its trouble starts, and once when it's reachable again: not
  per attempt, and not per request.
- What's still owed when Jellyfin stops is given back, and sent after the restart.
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
"Test" button gets a 204. A call that can't be queued gets a 503, never a 204 for something dropped: no pass would
announce a request only the webhook named.

## 5. What a notification says

The payload is small JSON the worker reads (`PushMessage`): `title`, `body`, what to open (`item`: a Jellyfin item
id, or `key`: a catalog title, or `page: "requests"`), `image`, `icon`, `tag`.

- **Title:** "Dune is ready to watch". **Body:** "It's in your library now."
- **Tap:** the title's library page when it's in the library for this user, else its catalog page.
- **Picture:** the title's wide artwork through Lumen's image proxy, where the platform shows one (Chrome on
  desktop and Android; not iOS, which ignores it).
- **Locale:** Lumen's strings are English only, so the text is. The one number, in "5 of your requests…", is at
  most 50 (what the request list covers), so no language would write it differently, and none is stored.
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
- **Self-repair:** a device that has notifications on checks, once per page load when the browser is idle, that the
  server still has the browser's very subscription. If it doesn't (its keys were reset, or it dropped the device
  because the push service said the subscription was gone or kept refusing it), the browser's subscription is given
  up and a new one made, quietly, as the permission still stands. The old one is never posted back: the server
  dropped it as dead, and the switch would say "on" for a device nothing reaches. The switch's tap does the same.
  If another user is signed in on that browser now, it unsubscribes; if the permission was withdrawn, it has the
  server forget the device. A device that never turned notifications on downloads nothing for any of this (one
  `localStorage` read), and shows off whatever its browser still holds.
- **Without request features** (Seerr taken away, or the user's account there) the switch is hidden, unless the
  server still has this device: then it shows on, so it can be turned off, and goes away once it is.

## 7. The admin page

In the Requests card, once Seerr is set up: how many devices of how many users have notifications on, how the last
notification sent went, the webhook's address and secret, and **Reset notification keys** (after a confirmation):
new keys and secret, every subscription dropped. Devices subscribe again by themselves when they next open Lumen.

## 8. Security and privacy

- Subscriptions are per user and device, managed only by that user on that device (§3).
- The server posts to whatever address a subscription names, so only the push services browsers use are accepted,
  by their exact hosts (https, default port): a signed-in user can't make the server post into its own network, nor
  to another service of the same companies.
  - Google's FCM: `fcm.googleapis.com`, and `jmt17.google.com`, FCM's staging host, which Chromium's source names
    beside it and Chrome's Canary and Dev channels subscribe at.
  - Apple's: `web.push.apple.com`, and any subdomain of `push.apple.com` (Apple's documentation says to allow
    `*.push.apple.com`).
  - Mozilla's: `updates.push.services.mozilla.com`.
  - Microsoft's WNS, which Edge on Windows uses: any subdomain of `notify.windows.com` (one per data centre, like
    `wns2-by3p.notify.windows.com`).
- The tests' stub is allowed through an environment variable a real server never sets (`LUMEN_PUSH_TEST_ENDPOINT`),
  compared with the address as it will be requested, so `…/push/../…` isn't under the prefix.
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
  signed-out devices, each device's own result, one log line per failing streak); the job with the real request
  list, announcement list and sender behind it (once per request on every path, push instead of the pop-up, the
  retries and their waits, two devices at 201 and 503, giving up to the pop-up, who is polled and how often); the
  endpoints (ownership, the device from the token, validation, the rate limits, the webhook's secret, size and
  full queue); the keys in the configuration (made once, never in JSON, surviving saves and resets).
- **Client:** the states, the tap's order (permission first), re-subscribing, the self-repair on load, the toggle,
  the worker (evaluated as a browser would, with its routes checked against the registry), the admin block.
- **End to end**, with the stub Seerr also standing in for a push service: the toggle in a real Chromium with the
  real worker registered (only `pushManager.subscribe` is stood in for, as no push service is behind a test
  browser), a test notification decrypted by the test as the browser would and shown by the worker, a tap taking
  the open app to the title, a request turning ready pushed once (by the webhook with no page open, and by an
  open page's check) with no pop-up, a push service answering 503 (three attempts, then the pop-up), two devices
  at 201 and 503, a session naming another device through Jellyfin's real sign-in, re-subscribing after a key
  reset and after a 410 with the key unchanged, the permission prompt coming only from the tap, 410 cleanup, the
  rate limit, the admin block and its reset. The tests' server runs the job's pass an hour apart
  (`LUMEN_PUSH_TEST_PASS_SECONDS`), so a pass can't be what sent a notification a test waits for, and retries
  after seconds (`LUMEN_PUSH_TEST_RETRY_SECONDS`).

## 11. What needs a real iPhone

Playwright has no push service behind its browsers and no iOS, so these are unconfirmed: that the Home Screen app
shows the permission prompt from the tap; that Apple's push service accepts the subscription, the VAPID token and
the message; that the notification arrives with the app closed; and that a tap opens the app on the title
(`clients.openWindow` with a hash inside the app's scope), both with the app closed and in the background.
