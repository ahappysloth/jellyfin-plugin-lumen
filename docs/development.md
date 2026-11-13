# Developing Lumen

Lumen has two halves: a Preact/TypeScript client (`client/`) built with Vite, and a .NET 10 Jellyfin plugin (`src/`) that embeds the client bundle and injects it into jellyfin-web. End-to-end tests (`e2e/`) drive a real Jellyfin server with Playwright.

There are two ways to run it. Both work on **macOS** (Apple silicon or Intel) and **Linux** (x64 or arm64, including **WSL2**):

| | Docker loop | Native loop |
|---|---|---|
| Needs | Docker only | Node 24; the setup script installs the rest |
| Jellyfin runs | in the official `jellyfin/jellyfin` image (same as CI) | as a portable server under `~/.local/share/lumen-dev` |
| Best for | trying Lumen out, matching CI, sharing on your LAN | fast edit/rebuild cycles, debugging the server |

Both serve Jellyfin at **http://localhost:8096**, so run only one at a time.

## Docker loop

Prerequisites: [Docker Desktop](https://www.docker.com/products/docker-desktop/) on macOS, or Docker Engine on Linux/WSL2.

```sh
./scripts/docker-dev.sh          # build client + plugin in containers, start Jellyfin with Lumen installed
./scripts/docker-dev.sh e2e      # same, then run the Playwright suite (also creates the test users and libraries)
./scripts/docker-dev.sh test     # client lint/typecheck/tests and server tests, in containers
./scripts/docker-dev.sh logs     # follow Jellyfin's logs
./scripts/docker-dev.sh down     # stop the server (its data in artifacts/docker/ is kept)
```

- Run `up` again after changing code: it rebuilds and restarts the container with the new plugin.
- The first `up` generates fixture media into `artifacts/docker/media`, mounted at `/media` in the container. If you skip `e2e`, Jellyfin opens on its setup wizard; when it asks for libraries, add `/media/movies` (Movies) and `/media/tv` (Shows).
- After `e2e`, sign in as `admin` / `lumen-admin` or as the restricted user `kid` / `kid-pass`. E2E hides the admin from the login screen, so type the name in by hand.
- `JELLYFIN_IMAGE=jellyfin/jellyfin:unstable ./scripts/docker-dev.sh` tests against another server version (the nightly CI job runs `12.1`, `12.4`, `latest` and `unstable`).
- The Jellyfin container can reach services on your machine at `host.docker.internal`, e.g. a local Seerr at `http://host.docker.internal:5055`.
- To start fresh, run `./scripts/docker-dev.sh down && rm -rf artifacts/docker`.
- `e2e` runs against this same server and **resets Lumen's settings** (sections, hero, Seerr connection) as it goes. Re-enter anything you set by hand afterwards.

## Native loop

Prerequisites:
- **Node 24**, e.g. `nvm install 24` (or `brew install node@24` on macOS).
- `curl` and `tar`. These come with macOS and with most Linux distributions.

One-time setup (no sudo):

```sh
./scripts/setup-dev.sh
```

This installs the .NET 10 SDK into `~/.dotnet`, plus portable builds of Jellyfin 12.4 and jellyfin-ffmpeg for your OS and CPU into `~/.local/share/lumen-dev`. Set `LUMEN_DEV_HOME` to put them elsewhere, or `JELLYFIN_VERSION` to pick another server version (delete `$LUMEN_DEV_HOME/jellyfin` first). `scripts/env.sh` sets up `PATH` and `DOTNET_ROOT`. The other scripts source it, and you can too: `source scripts/env.sh` puts `dotnet` on your path.

Day to day:

```sh
./scripts/dev.sh               # build the plugin (and client), deploy it, (re)start Jellyfin on :8096
./scripts/gen-test-media.sh    # write fixture media to e2e/fixtures/media (done for you by e2e-local.sh)
./scripts/e2e-local.sh         # dev.sh + the Playwright suite; extra args go to `playwright test`
```

- `dev.sh` builds the client automatically, running `npm ci` the first time, so you don't need a separate client build.
- Server logs are in `~/.local/share/lumen-dev/log/`. `console.log` there captures stdout.
- On a fresh server, add `e2e/fixtures/media/movies` and `e2e/fixtures/media/tv` as libraries, or run `e2e-local.sh` once to set everything up (users: `admin` / `lumen-admin`, `kid` / `kid-pass`).
- The first time, Jellyfin's setup wizard may ask for a metadata language. Any choice works, because the fixtures carry their own NFO metadata.
- macOS: the first time Jellyfin starts, macOS may ask whether to allow incoming connections. Allow them if you want other devices to reach it.
- WSL2: the global-setup and dev scripts expect to run *inside* WSL. The repo should live on the Linux filesystem (e.g. `~/src`), not `/mnt/c`, because builds are much faster there.

## Seerr in tests

The request features talk to Seerr. End-to-end tests never use a real one: Playwright starts `e2e/support/stub-seerr.mjs` on port 5055, which fakes the few Seerr endpoints Lumen calls and TMDB's image CDN. The Jellyfin server reaches it at `LUMEN_E2E_SEERR_URL` (`host.docker.internal:5055` when Jellyfin runs in Docker), and `LUMEN_TMDB_IMAGE_BASE` points Lumen's image proxy at it. The stub also stands in for Trakt's charts and lists behind the Top 10 rows, Top charts and the other Trakt rows (`/trakt/…`), where `LUMEN_TRAKT_API_BASE` points Lumen's Trakt client. And it stands in for YouTube's embedded player (`/embed/…`, speaking the player's postMessage protocol) behind the YouTube trailer previews: `LUMEN_YOUTUBE_EMBED_BASE` tells the browser to load the player from there instead of youtube-nocookie.com. That one is the browser's address for the stub (`http://localhost:5055`), not the server's, and only an https origin or plain http on this machine is accepted. `docker-dev.sh e2e` and `e2e-local.sh` set all of these, and `docker-dev.sh` restarts the server without the image, Trakt and YouTube overrides afterwards. Port 5055 must be free while the tests run, or set `LUMEN_STUB_SEERR_PORT` to run the stub on another port (and point `LUMEN_E2E_SEERR_URL`, `LUMEN_TMDB_IMAGE_BASE`, `LUMEN_TRAKT_API_BASE`, `LUMEN_YOUTUBE_EMBED_BASE` and `LUMEN_PUSH_TEST_ENDPOINT` at it).

## Push notifications in tests

Lumen only stores a push subscription whose address is at a real push service (Google's, Apple's, Mozilla's or Microsoft's, by their exact hosts), because the server posts to whatever address a subscription names. The stub Seerr also stands in for one (`POST /push/<id>`, read back with `GET /__stub/push`; an id starting with `gone` answers 410, `refused` 403, `down` 503), and the test server accepts its addresses because it runs with `LUMEN_PUSH_TEST_ENDPOINT=<stub>/push/`, which the scripts and CI set. Never set it on a real server.

Two more variables, also for the test server only, set the push job's timing (`ReadyPushTimings`). A server started with any of the three says so once in its log, as a warning, when the push job starts:

- `LUMEN_PUSH_TEST_PASS_SECONDS=3600`: the job's own pass, every 2 minutes on a real server, is an hour apart. No pass runs during a test, so a notification a test sees was caused by what the test did (Seerr's webhook, or an open page's check), not by a pass that happened to come first.
- `LUMEN_PUSH_TEST_RETRY_SECONDS=2`: a send the push service didn't take is tried again after 2 s, then 4 s, instead of 2 and 4 minutes, so the test of a failing push service takes seconds.

- `e2e/support/push.ts` plays the browser: it makes a subscription's keys, and decrypts what arrives (RFC 8291) to check the notification inside and its VAPID signature.
- `push.spec.ts` covers the server's side with those. `push-device.spec.ts` covers the toggle and Lumen's service worker in a browser: it runs in Chromium itself rather than the headless shell (which always refuses notifications), stands in for `pushManager.subscribe` only (no push service is behind a test browser), and dispatches `push` and `notificationclick` in the real worker.
- "Send a test notification" is limited to five per user in ten minutes, and every spec signs in as the same admin: a new test that sends one takes from the same five.
- What only a real device shows is in `docs/manual-test-checklist.md`.

## jellyfin-web internals

Every jellyfin-web selector, route, global and PlaybackManager method that Lumen's TypeScript depends on is listed once, in `client/src/compat/registry.ts`. The stylesheets can't import it, so they repeat the selectors they need, and `registry.test.ts` checks those still appear in the CSS. Which page each selector is probed on and which stylesheet repeats it are in `registry.meta.ts`, which only the tests import; a new selector needs an entry in both files. Two E2E specs check the registry against a real server, and the nightly job runs them against Jellyfin's `latest` and `unstable` images:
- `stock-probe.spec.ts` opens each page (sign-in, home, Playback and Display settings, the player) and asserts that every selector registered for that page matches.
- `stock-routes.spec.ts` opens every stock route Lumen links to and asserts it isn't jellyfin-web's 404 page.

When a Jellyfin update breaks one of these, fix the name in the registry (and in the CSS, if it's repeated there). `docs/reference/jellyfin-web-12.1-notes.md` has the evidence behind each entry.

At runtime, Lumen reports what it couldn't find to the settings page's Health tab (Devices, in plain words from `client/src/admin/health/devices.ts`; give a new check id its text there): a failed compatibility check (after retrying for 3 s on a cold load), a missing PlaybackManager or missing methods (`playbackManager.*`), and stock elements it hides that weren't there (`selector.*`). It also marks the server version "(untested)" when its major.minor isn't in `client/src/compat/tested-jellyfin.json`. When the E2E suite passes on a release that isn't listed, the job records the version in its summary and raises a warning. Add the release to the list then.

When writing E2E assertions about stock elements Lumen hides, use `expectPresentButHidden` (`e2e/support/stock.ts`), not a bare `toBeHidden()`. `toBeHidden()` also passes when nothing matches, so a renamed selector would go unnoticed.

`login(page, user)` (`e2e/support/login.ts`) signs each user in through jellyfin-web's form once per run, then reuses that sign-in: later tests share its device and Jellyfin session. A test that needs a session of its own (a second viewer, Cast's other browser, or one that joins a SyncPlay group, which the shared session would still be in next test) uses `signIn(page, user)`, which fills in the form. Tests of the sign-in page itself go to `#/login` without either. Wait for what a test is waiting on (`expect`'s retrying assertions, `expect.poll`, a request or response) rather than with `waitForTimeout`. Keep a fixed wait only to show something doesn't happen, as short as shows it, with a comment saying why.

## Unit tests, lint and formatting

```sh
cd client && npm ci            # once, or after dependency changes
npm run lint                   # eslint + prettier --check (CI runs this)
npm run typecheck
npm test                       # vitest
npm run size                   # bundle size budget (CI runs this after build)
npm run compat                 # nothing in the build that Chromium 68 / Safari 13 lack (CI runs this after build)
npm run format                 # fix formatting

dotnet test                    # from the repo root; needs `source scripts/env.sh` for the native .NET
```

Older browsers: the client is built for Chromium 68 (LG webOS 5) and Safari 13 (`client/vite.target.ts`). The build compiles newer syntax down, but not functions or CSS:

- eslint rejects functions those browsers lack (`globalThis`, `Object.fromEntries`, `.flatMap()`, `.at()`…). Lumen's main code would mostly get them from jellyfin-web's core-js, but the inline guard runs before it loads.
- Chromium 68 drops any declaration with `min()`, `max()`, `clamp()` or `env()`: put a plain declaration of the same property before it in the same rule (never after: that would override every browser), or put the rule in an `@supports` block that tests for one of those functions. Where `min(Npx, 100%)` would be the only width, `width: 100%; max-width: Npx` does the same everywhere. Lightning CSS turns `clamp()` into `max(min())` for Safari 13.0, but not in a value with `var()`, so write those as `max(min())` yourself. A custom property needs the same selector to set it again in an `@supports not` block instead (`styles/base.css`). `styles/safe-area.test.ts` checks the source, `npm run compat` the build.
- webOS 4 (Chromium 53) and older can't run Lumen: neither its inline guard nor `lumen.js` parses there, so jellyfin-web's own interface shows.

The .NET build treats warnings as errors and enforces StyleCop. Run `dotnet build` before you push.

## Reaching the dev server from other devices

Both loops listen on all network interfaces. Other devices on the same network can open `http://<this machine's LAN IP>:8096`; `dev.sh` and `docker-dev.sh` print that address when they start. The server also advertises that address (its *published server URL*), so the Jellyfin mobile apps can connect to it, and the Docker loop opens UDP 7359 so those apps can find it automatically.

- **macOS:** if the firewall is on (System Settings → Network → Firewall), allow incoming connections for Docker or for `jellyfin`. The Mac must stay awake for other devices to reach it.
- **WSL2:** by default WSL sits behind NAT, so other devices can't reach it. Enable [mirrored networking](https://learn.microsoft.com/windows/wsl/networking#mirrored-mode-networking) (`networkingMode=mirrored` in `%UserProfile%\.wslconfig`) and allow port 8096 in Windows Defender Firewall. Docker Desktop for Windows publishes ports on the Windows host already.
- If the LAN IP changes, or you use a hostname, set `LUMEN_PUBLISHED_URL=http://my-host.local:8096` for `docker-dev.sh`.

## CI and releases

- `ci.yml` runs on every PR and on pushes to `main`. It does client lint, typecheck, tests, build and size check, then `dotnet test` and publish, then E2E against `jellyfin/jellyfin:12.4` (`e2e.yml`). E2E runs as one job per browser, in parallel: every spec on Chromium, and the specs tagged `@smoke` on Firefox and on WebKit as an iPhone (`webkit-iphone`).
- `nightly.yml` runs every spec on all three browsers against `jellyfin/jellyfin:12.1` (the oldest release Lumen supports), `:12.4`, `:latest` and `:unstable`.
- Run one browser locally with `npx playwright test --project=firefox` (or `webkit-iphone`) in `e2e/`, after `npx playwright install firefox` (or `webkit`). Tag a spec `@smoke` (`test('…', { tag: '@smoke' }, …)`) when it's a cheap check of a whole page or flow that a browser engine could break. Tests with "TV layout" in their title run on Chromium only, and playback tests skip on `webkit-iphone`: jellyfin-web asks an iPhone for HLS, which Playwright's WebKit can't play (`e2e/support/browsers.ts`).
- `release.yml` runs on `v*` tags.
  - It requires a successful `ci.yml` run (including E2E) on the tagged commit, and waits for one that's still running.
  - It re-runs the client and server checks, then builds the plugin zip.
  - It creates the GitHub release with the matching `CHANGELOG.md` section.
  - It adds the version to `manifest.json` with `scripts/update-manifest.mjs`. The `targetAbi` comes from the `Jellyfin.Controller` version in `Directory.Packages.props`.
  - Every step can be re-run safely. An existing release is reused, along with its zip, so the manifest checksum matches what users download. The manifest commit is rebuilt on the latest `main` and the push is retried. A manifest that already lists the version is left alone.
- To cut a release:
  1. Bump `<Version>` in `Directory.Build.props` and add a `## [x.y.z] - YYYY-MM-DD` section to `CHANGELOG.md`.
  2. Push to `main` and let CI pass.
  3. Tag `vx.y.z` and push the tag.
- If the release job fails partway through, re-run it.
- The inline scripts change with every release: the guard, and the ES5 definer of Lumen's jellyfin-web plugin (`client/src/compat/webPluginDefiner.js`, copied to `dist/lumen-web-plugin.js` verbatim; the server lists the plugin in `/web/config.json` only while the page it serves carries the definer). Users with a strict Content-Security-Policy need their hashes: after a build, `cd client && npm run guard-hash` prints them (README, "Reverse proxies").

## Further reading

- `docs/manual-test-checklist.md`: what to check by hand before each release.
- `docs/reference/`: notes on the jellyfin-web 12.1 DOM and the Jellyfin 12.1 server APIs that Lumen depends on.
- `docs/superpowers/`: the original design spec and implementation plan (historical).
