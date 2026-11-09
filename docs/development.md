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
- `JELLYFIN_IMAGE=jellyfin/jellyfin:unstable ./scripts/docker-dev.sh` tests against another server version (the nightly CI job runs `latest` and `unstable`).
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

This installs the .NET 10 SDK into `~/.dotnet`, plus portable builds of Jellyfin 12.2 and jellyfin-ffmpeg for your OS and CPU into `~/.local/share/lumen-dev`. Set `LUMEN_DEV_HOME` to put them elsewhere, or `JELLYFIN_VERSION` to pick another server version (delete `$LUMEN_DEV_HOME/jellyfin` first). `scripts/env.sh` sets up `PATH` and `DOTNET_ROOT`. The other scripts source it, and you can too: `source scripts/env.sh` puts `dotnet` on your path.

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

The request features talk to Seerr. End-to-end tests never use a real one: Playwright starts `e2e/support/stub-seerr.mjs` on port 5055, which fakes the few Seerr endpoints Lumen calls and TMDB's image CDN. The Jellyfin server reaches it at `LUMEN_E2E_SEERR_URL` (`host.docker.internal:5055` when Jellyfin runs in Docker), and `LUMEN_TMDB_IMAGE_BASE` points Lumen's image proxy at it. `docker-dev.sh e2e` and `e2e-local.sh` set both, and `docker-dev.sh` restarts the server without the image override afterwards. Port 5055 must be free while the tests run.

## Unit tests, lint and formatting

```sh
cd client && npm ci            # once, or after dependency changes
npm run lint                   # eslint + prettier --check (CI runs this)
npm run typecheck
npm test                       # vitest
npm run size                   # bundle size budget (CI runs this after build)
npm run format                 # fix formatting

dotnet test                    # from the repo root; needs `source scripts/env.sh` for the native .NET
```

The .NET build treats warnings as errors and enforces StyleCop. Run `dotnet build` before you push.

## Reaching the dev server from other devices

Both loops listen on all network interfaces. Other devices on the same network can open `http://<this machine's LAN IP>:8096`; `dev.sh` and `docker-dev.sh` print that address when they start. The server also advertises that address (its *published server URL*), so the Jellyfin mobile apps can connect to it, and the Docker loop opens UDP 7359 so those apps can find it automatically.

- **macOS:** if the firewall is on (System Settings → Network → Firewall), allow incoming connections for Docker or for `jellyfin`. The Mac must stay awake for other devices to reach it.
- **WSL2:** by default WSL sits behind NAT, so other devices can't reach it. Enable [mirrored networking](https://learn.microsoft.com/windows/wsl/networking#mirrored-mode-networking) (`networkingMode=mirrored` in `%UserProfile%\.wslconfig`) and allow port 8096 in Windows Defender Firewall. Docker Desktop for Windows publishes ports on the Windows host already.
- If the LAN IP changes, or you use a hostname, set `LUMEN_PUBLISHED_URL=http://my-host.local:8096` for `docker-dev.sh`.

## CI and releases

- `ci.yml` runs on every PR and on pushes to `main`. It does client lint, typecheck, tests, build and size check, then `dotnet test` and publish, then E2E against `jellyfin/jellyfin:12.2` (`e2e.yml`).
- `nightly.yml` runs the E2E suite against `jellyfin/jellyfin:latest` and `:unstable`.
- `release.yml` runs on `v*` tags. It builds the plugin zip, creates the GitHub release with the matching `CHANGELOG.md` section, and adds the version to `manifest.json` with `scripts/update-manifest.mjs`, using `targetAbi` 12.1.0.0. To cut a release, bump `<Version>` in `Directory.Build.props`, add a `## [x.y.z]` section to `CHANGELOG.md`, then tag `vx.y.z`.

## Further reading

- `docs/manual-test-checklist.md`: what to check by hand before each release.
- `docs/reference/`: notes on the jellyfin-web 12.1 DOM and the Jellyfin 12.1 server APIs that Lumen depends on.
- `docs/superpowers/`: the original design spec and implementation plan (historical).
