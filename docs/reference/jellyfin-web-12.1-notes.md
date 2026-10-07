# jellyfin-web 12.1 internals: notes for Lumen

Sources (read 2026-10-06):
- `jellyfin/jellyfin-web@v12.1` (package.json `12.1.0`). Paths below are relative to `src/` unless prefixed.
- `jellyfin/jellyfin-apiclient-javascript@v1.11.0`. jellyfin-web pins `"jellyfin-apiclient": "1.11.0"`. Prefix `apiclient:`.
- `jellyfin/jellyfin@v12.1` (server). Prefix `server:`.
- `n00bcodr/Jellyfin-Enhanced` (default branch), abbreviated JE. `IAmParadox27/jellyfin-plugin-home-sections`, abbreviated HSS.
- `docs/reference/jellyfin-openapi-12.1.0.json`.

Anything marked UNVERIFIED was inferred and not confirmed in source or in a running build.

---

## 1. Routing

- **Hash router.** `RootAppRouter.tsx` calls `createHashRouter([...])` from `react-router-dom` 6.30.4. Routes come from either `apps/modern/routes/routes.tsx` or `apps/legacy/routes/routes.tsx`. The choice is `layoutManager.modern`, read **once at module load**, so changing the layout needs a reload.
- **Home.** `#/home`. `#/home?tab=1` is the Favorites tab (`appRouter.showFavorites()`). `#/` redirects to `/home` with `<Navigate replace>`, and `#!/...` goes to `BangRedirect`. Full URL: `<origin>[/<baseUrl>]/web/#/home`.
- **Details.** From `components/router/appRouter.js` `getRouteUrl()`:
  - Default and most types: `#/details?id=<itemId>&serverId=<serverId>`.
  - Series, Season, Episode: `#/details?id=<id>[&context=<ctx>]&serverId=<sid>`. The `context` comes from `options.context`.
  - `item.IsFolder` types not in the explicit list go to `#/list?parentId=<id>&serverId=<sid>`, **not** details.
  - Explicit details types: Playlist, TvChannel, Program, BoxSet, MusicAlbum, MusicGenre, Person, Recording, MusicArtist.
  - Ids are 32-hex strings with no dashes.
- Which page renders each route:
  - Modern home: React async route `apps/modern/routes/home.tsx`, loaded lazily.
  - Legacy home: ViewManager view `apps/legacy/controllers/home.html` + `home.js`.
  - Details in **both** layouts: legacy ViewManager view `apps/legacy/controllers/itemDetails/index.html` + `index.js`. Route defined in `apps/{modern,legacy}/routes/legacyRoutes/user.ts`, path `details`.
- **Navigation events:**
  - The router navigates with `history.pushState`. **Programmatic navigation fires neither `hashchange` nor `popstate`.**
  - Browser back/forward fires `popstate`. Assigning `location.hash` manually fires `popstate` and `hashchange`, and the router follows it.
  - `hashchange` on back/forward between pushState entries: UNVERIFIED, so do not rely on it.
  - JE's working answer (`js/core/navigation.js`): patch `history.pushState`/`replaceState` once and dispatch a synthetic event, listen to `hashchange` + `popstate`, and dedupe on `location.href`.
  - Internal option. `components/router/routerHistory.ts` subscribes to the router and runs `Events.trigger(document, 'HISTORY_UPDATE', [routerState])` on every router state change. `window.Events` is the same module (`utils/events.ts`, exposed in `index.jsx`), so `window.Events.on(document, 'HISTORY_UPDATE', (e, state) => state.location /* {pathname, search} */)` works. It fires on every state change, including loading states, so dedupe it.
- **Page-show events.** These are DOM `CustomEvent`s with `bubbles: true`, dispatched **on the page element**, so they reach `document` and `window`.
  - React `components/Page.tsx`, used by modern home `#indexPage`, dispatches `viewbeforeshow`, `pagebeforeshow`, `viewshow`, `pageshow` in a `useEffect` on mount.
    - `detail = {isRestored:false, options:{enableMediaControl, supportsThemeMedia}}`. There are **no params**.
    - It also calls `viewManager.hideView()`, which hides the active legacy view.
  - ViewManager (`components/viewManager/viewManager.js`, used by details and all legacy views) dispatches:
    - `viewbeforehide`/`pagebeforehide` and `viewhide`/`pagehide` on the old view.
    - `viewinit`/`pageinit` (first time only), `viewbeforeshow`/`pagebeforeshow`, `viewshow`/`pageshow` on the new one.
    - `detail = {type, properties, params:{id, serverId, ...query}, isRestored, state, options}`.
    - `dispatchPageEvents(true)` is set, so the `page*` twins always fire.
  - These are the same events in Modern and Legacy layouts. Caveat: the custom `pageshow` bubbles to `window` too, so it can collide with native bfcache `pageshow` listeners.
  - The `viewshow` listeners themselves (`appRouter`, `themeMediaPlayer`) are on `document`.
- **`Emby.Page.onViewShow` hook (JE pattern) is weak in 12.1.** The constructor does `document.addEventListener('viewshow', () => this.onViewShow())`, so an override is called with **no args**. JE falls back to querying the DOM.

## 2. Page container DOM

All of this is rendered into `<div id="reactRoot">`, which comes from `index.html`; `index.jsx` uses `createRoot`. Built from `RootAppRouter.tsx` (`RootAppLayout`), `components/AppHeader.tsx`, `components/AppBody.tsx`, `apps/modern/AppLayout.tsx`, `apps/legacy/AppLayout.tsx`, and `components/Backdrop.tsx`.

**Modern layout** (default in browsers):
```
#reactRoot
  .backdropContainer (position:fixed; z-index:-1) , .backgroundContainer
  div[style="display: none"]            <- AppHeader wrapper (hidden when layoutManager.modern)
     .mainDrawer.hide  .skinHeader.focuscontainer-x  .mainDrawerHandle
  div.MuiBox-root (flex column)
     header.MuiAppBar-root.MuiAppBar-positionFixed.MuiPaper-root  > .MuiToolbar-root   (OffsetAppBar dense; transparent until scrolled)
     div[aria-hidden="true"] (spacer, inline height = app bar height)
     .MuiDrawer-root (only on drawer paths, < md breakpoint)
     main.MuiBox-root
        div.mainAnimatedPages.skinBody   <- legacy ViewManager views (details: div#itemDetailPage.page.libraryPage.itemDetailPage.mainAnimatedPage)
        div.skinBody                      <- React routes (home: div > div#indexPage.page.mainAnimatedPage.homePage.libraryPage...)
body > .appfooter (now playing bar), dialogs (.dialogContainer) also live outside #reactRoot
```

**Legacy layout** (TV, `desktop-legacy`, `mobile-legacy`):
```
#reactRoot
  .backdropContainer , .backgroundContainer
  div > .mainDrawer  .skinHeader (position:fixed; top:0; z-index:999; built by scripts/libraryMenu.js: .headerTop/.headerLeft/.headerRight + .headerTabs.sectionTabs)
        .mainDrawerHandle
  div.mainAnimatedPages.skinBody  <- home (#indexPage) and details (#itemDetailPage) views; up to 3 cached, non-current get .hide
  div.skinBody                    <- empty for ViewManager routes
```
There is no `main` element in the legacy layout.

- **Page hide selector.** Use **`.skinBody`**. It hides both the legacy view host and the React page host, in both layouts, and leaves the header and app bar alone. Scope it to our routes, for example `html.lumen-active #reactRoot .skinBody { display: none !important; }`, toggled when the route is ours.
  - Narrower alternative: `#indexPage, #itemDetailPage`. Both ids are the same in both layouts. JE targets `#itemDetailPage:not(.hide)` and `#indexPage`.
  - `display:none` also makes `focusManager` skip the hidden elements, because it checks `offsetParent !== null`.
- **App bar selectors:**
  - Modern: `.MuiAppBar-root` (fixed variant is `.MuiAppBar-positionFixed`). The toolbar is `.MuiAppBar-root .MuiToolbar-root`. Its height is measured by `OffsetAppBar`: 48px dense by default, taller when the toolbar wraps or `LibraryToolbar` is shown.
  - Legacy: `.skinHeader`, with tabs in `.skinHeader .headerTabs`.
  - JE uses `.skinHeader` + `.MuiAppBar-positionFixed` (`js/plugin.js` around line 807) and `.skinHeader, .MuiAppBar-root` (`js/enhanced/helpers.js:664`).
  - The MUI `Mui*` global class names are emitted in production builds next to the `css-xxxx` hashes. They are the stable hooks, not the hashes.
- **Header overlap.** Both headers are `position: fixed`, so our root needs a top offset equal to the header height. MUI z-index for the app bar is 1100 and `.skinHeader` is 999.
- **Which layout is active:**
  - Internal flag `layoutManager.modern` (`components/layoutManager.js`). It is **not on window and not reflected in any class.**
  - Persisted value: `localStorage['layout']` (`appSettings`, no user prefix). Allowed values (`constants/layoutMode.ts`): `auto`, `desktop`, `desktop-legacy`, `modern`, `mobile`, `mobile-legacy`, `tv`.
  - Legacy set: `desktop-legacy`, `mobile-legacy`, `tv`. Everything else is modern.
  - Empty or `auto` means: `browser.tv ? 'tv' : appHost.getDefaultLayout()`. In a browser that is `'modern'`. With NativeShell it is `NativeShell.AppHost.getDefaultLayout()`.
  - **DOM detection (recommended):**
    - Modern ⇔ `document.querySelector('#reactRoot .MuiAppBar-root')` exists and `.skinHeader`'s parent is `display:none`.
    - Legacy ⇔ `.skinHeader` is visible.
    - Exception: the dashboard (`/dashboard...`) also uses an MUI app bar and hides `.skinHeader`. That doesn't matter for `/home` and `/details`.

## 3. Layout classes

- **Classes on `<html>`, set by `layoutManager.js` `setLayout()`:** `layout-tv`, `layout-mobile`, `layout-desktop`. Exactly one is present.
  - `modern` → `layout-mobile` if `browser.mobile`, else `layout-desktop`.
  - `desktop` and `desktop-legacy` → `layout-desktop`. `mobile*` → `layout-mobile`. `tv` → `layout-tv`.
  - So the class tells you the form factor, not Modern vs Legacy.
- **Other `<html>` classes and attributes:**
  - `transparentDocument` (backdrop, `components/backdrop/backdrop.js`).
  - `data-theme="<themeId>"` (`scripts/themeManager.js`), which is also the MUI color-scheme selector.
  - `dir` attribute.
- **`<body>` classes (transient):** `dashboardDocument`, `withSectionTabs`, `mouseIdle`, `noScroll`, `hide-scroll`, `force-scroll`, `bodyWithPopupOpen`, `screensaver-noScroll`.
- **Native hosts:**
  - iOS (`jellyfin/jellyfin-expo` `assets/js/NativeShell.staticjs`) and Android (`jellyfin-android` `app/src/main/assets/native/nativeshell.js`): `getDefaultLayout()` returns `'mobile'`, giving **Modern + `layout-mobile`**. Both load the server-hosted web UI, so server-side `index.html` injection applies. That loading behaviour is believed but UNVERIFIED in code.
  - Tizen (`jellyfin/jellyfin-tizen` `tizen.js`): `getDefaultLayout()` returns `'tv'` and `browser.tv` is true, giving **Legacy + `layout-tv`**.
  - **RISK, Tizen:** jellyfin-tizen bundles a locally built jellyfin-web (`gulpfile.babel.js` copies `WEB_DIR/index.html`). The server-served `index.html` is never loaded there, so **our injected script will not run on Tizen**.
  - webOS: UNVERIFIED.

## 4. `window.ApiClient`

- **Where it's defined.** The class is `ApiClient` from the npm package `jellyfin-apiclient@1.11.0` (`apiclient:src/apiClient.js`), **not** a file in jellyfin-web.
  - jellyfin-web wraps construction in `utils/jellyfin-apiclient/createApiClient.ts`. That wrapper URL-encodes appName, appVersion, deviceName and deviceId.
  - `lib/jellyfin-apiclient/ServerConnections.js` adds `getMaxBandwidth`, `normalizeImageOptions`, `subscribe` (the SDK websocket) and `_sdk`.
  - `window.ApiClient = apiClient` is set in `ServerConnections.setLocalApiClient()` (line 95).
- **Methods.** Line numbers are from `apiclient:src/apiClient.js`. Everything that does a request returns a Promise.

| Method | Notes |
|---|---|
| `getCurrentUserId()` (401) | Returns `string \| null`. `null` until `setAuthenticationInfo(token, userId)` sets `_loggedIn`. |
| `accessToken()` (406) | Returns `string \| null`, with the same `_loggedIn` gate. |
| `deviceId()` (206) | Returns a string, **URL-encoded** (see §10 risk). |
| `deviceName()`, `appName()`, `appVersion()` | Return strings, encoded. |
| `serverAddress(val?)` (213) | Returns a string, e.g. `https://host/jellyfin`. Setter if `val` is given. |
| `serverId()` (411), `serverName()` | Return `serverInfo().Id` / `.Name`. Can be undefined before connect. |
| `getUrl(name, params?, serverAddress?)` (246) | Returns a string. Prepends `/` if missing. `params` are encoded and null, undefined and `''` values are dropped. |
| `fetch(request, includeAuthorization=true)` (336) | Adds the `Authorization: MediaBrowser Client=..., Token=...` header. `ServerConnections` sets `enableAutomaticNetworking=false`, so this is always a direct `fetch`. |
| `ajax({type, url, dataType?, data?, contentType?, headers?}, includeAuth?)` (422) | Wraps `fetch`. Return value depends on the request (see the two bullets after this table). |
| `getJSON(url, includeAuth?)` (698) | Same as `fetch({type:'GET', dataType:'json'})`. Returns `Promise<object>`. |
| `get(url)` (691) | GET with no dataType. |
| `getItem(userId, itemId)` (846) | Uses `Users/{userId}/Items/{itemId}` when `userId` is given, else `Items/{itemId}`. Returns `Promise<BaseItemDto>`. |
| `getCurrentUser(enableCache?)` (433) | Returns `Promise<UserDto>`. **Rejects with no value** when not logged in. The user is cached on `_currentUser`. |
| `getPluginConfiguration(id)` (1679) | GET `Plugins/{id}/Configuration`. Returns `Promise<object>`. |
| `updatePluginConfiguration(id, config)` (2813) | POST with `JSON.stringify(config)` and `application/json`. Returns `Promise<Response>` (204). |
| `getSessions(query)` (2114) | Returns `Promise<SessionInfoDto[]>`. |
| `sendPlayCommand(sessionId, options)` (3423) | POST `Sessions/{id}/Playing?<options>`. |
| `getImageUrl(itemId, {type,index,...})` (2495), `getScaledImageUrl(itemId, opts)` (2521) | Return a string. `getScaledImageUrl` multiplies sizes by `devicePixelRatio`. |
| `getItems`, `getResumableItems`, `getUserViews`, `getLatestItems`, `getNextUpEpisodes`, `markPlayed`, `markUnplayed`, `updateFavoriteStatus`, `getPublicSystemInfo`, `getSystemInfo` | Available. |
| `isLoggedIn()`, `setAuthenticationInfo(token, userId)` | Available. |

- **`ajax` return value on success:**
  - With `dataType:'json'` it resolves to parsed JSON.
  - Otherwise it resolves to text when the Content-Type starts with `text/`, and to the raw `Response` for anything else.
- **`ajax` and errors:**
  - A status of 400 or above **rejects with the `Response`** and fires `Events.trigger(apiClient,'requestfail',[{url,status,errorCode}])`. The only side effect in the web app is a 403 `ParentalControl` causing a forced logout (`appRouter.onRequestFail`).
  - If `data` is an object it is form-encoded. If it is a string it is sent raw, so pass `contentType`.
- **Legacy routes.** `Users/{userId}/Items/{itemId}`, `/Users/{userId}/Items/Resume`, `/Latest` and similar are **absent from the 12.1 OpenAPI**, but still exist on the server as `[Obsolete][ApiExplorerSettings(IgnoreApi=true)]` (`server:Jellyfin.Api/Controllers/UserLibraryController.cs:117`, `ItemsController.cs:721,1027`). They work in 12.1 but could be removed later. Prefer `/Items/{id}?userId=`, `/UserItems/Resume`, `/UserViews` and `/Items/Latest` through `ajax`/`getJSON`.
- **When `window.ApiClient` appears.** `index.jsx init()` → `await appHost.init()` → `ServerConnections.initApiClient(serverUrl)`.
  - It exists **before login**, whenever the server URL is known, which is always true when served by the server. It does not exist synchronously when our script starts.
  - Before login, `getCurrentUserId()` returns `null`.
  - The user is set by `setAuthenticationInfo`: from saved credentials during `connect` (`lib/jellyfin-apiclient/connectionManager.js:609`), or on login (`:186`).
- **Login events.** `Events.trigger(ServerConnections, 'localusersignedin', [user])` (`connectionManager.js:211`) and `'localusersignedout'`, plus `'apiclientcreated'`. **`ServerConnections` is not exposed on `window`**, so a plugin can't subscribe to these.
  - The apiclient's own events (`apiclient:src/events.js`) use the same `obj._callbacks` storage as `window.Events`, so `window.Events.on(window.ApiClient, 'requestfail', fn)` interoperates.
- **How JE waits:**
  - `js/plugin.js` `initialize()` polls every `INIT_POLL_INTERVAL_MS = 50` until `typeof ApiClient !== 'undefined' && ApiClient.getCurrentUserId?.()`. It also checks `ApiClient._serverInfo?.Id` / `serverId()` against the expected server.
  - For user switches, `js/core/session.js` wraps `setAuthenticationInfo` on the prototype chain, re-checks on every navigation, and runs a 5 s reconcile interval because `window.ApiClient` can be replaced when switching servers.
- **Other `window` globals** (from `index.jsx`, `utils/dashboard.js` and others): `Events`, `TaskButton`, `Dashboard`, `ServerNotifications`, `LibraryBrowser`, `LibraryMenu`, `Loading` (`show()`/`hide()`), `ItemDetailPage`, `Emby.Page`, and `NativeShell` (native hosts only).
  - `Dashboard` helpers include `navigate(url)`, `getCurrentUserId()`, `getCurrentUser()`, `alert()`, `showLoadingMsg()`, `hideLoadingMsg()`, `capabilities()` and `serverAddress()`.

## 5. `window.Emby.Page` (appRouter)

`components/router/appRouter.js:552-553`: `window.Emby = window.Emby || {}; window.Emby.Page = appRouter`. It is defined when the main bundle evaluates.

- **`show(path, options?)`** returns a Promise.
  - It strips a leading `#` and `!`, adds a leading `/` and removes `baseUrl()`. If the path equals the current pathname (and isn't `/home`) it returns immediately. Otherwise it runs `history.push(path, options)` on a `setTimeout`.
  - The promise resolves on the **next document `viewshow`**. Every `show()` first awaits the previous one, so a route whose page never fires `viewshow` would block later `show()` calls (risk; the stock pages always fire it).
- **`showItem(item | itemId, serverId?, options?)`**.
  - With a string id it fetches the item through react-query (`getItemQuery`) using `ServerConnections.getApiClient(serverId)`, or the current client when `serverId` is falsy, and then recurses.
  - With an object it navigates to `getRouteUrl(item, options)`, using `item.ServerId || options.serverId`.
  - When exactly two args are given, the second is treated as `options`.
- **`getRouteUrl(item, options)`** returns a `'#/details?...'` string. If `item.url` is set it returns that instead.
- **Other methods:**
  - `back()` returns a Promise. `canGoBack(path?)` returns a boolean; it is false on `/home`, `/login` and `/selectserver` unless a `.dialogContainer` exists. `ready()` and `baseUrl()` are also available.
  - Shortcuts: `goHome()`, `showSettings()`, `showSearch()`, `showFavorites()` (`home?tab=1`), `showNowPlaying()`, `showVideoOsd()`, `showGuide()`, `showLiveTV()`, `showRecordedTV()`, `showSelectServer()`, `showLocalLogin(serverId)`.
  - Deprecated: `setTransparency()`.
- `Dashboard.navigate(url, preserveQueryString?)` also exists (`utils/dashboard.js:135`).

## 6. Version at runtime

- `__PACKAGE_JSON_VERSION__`, `__JF_BUILD_VERSION__` and `__COMMIT_SHA__` are **inlined at build time** by webpack `DefinePlugin` (`webpack.common.js:57`). They are not globals. They are only printed in a startup `console.info`.
- `ApiClient.appVersion()`:
  - In a browser it returns `__PACKAGE_JSON_VERSION__` (`'12.1.0'`) via `appHost.appVersion()` (`components/apphost.js:399`).
  - **Under NativeShell it returns the native app's version** (Tizen, iOS, Android), so it is not reliable.
- There is no version meta tag in `index.html`. Bundle URLs carry `?<compilationHash>` (`hash: true`), not a version.
- **Recommended:**
  - Gate on the server version, `ApiClient.getPublicSystemInfo()` → `.Version` (12.1.0). The served web build matches the server.
  - Or have the plugin bake the version into the injected script URL. HSS and JE both do this server-side.

## 7. index.html

- **Template** (`src/index.html`): `<!DOCTYPE html><html dir="ltr"><head>` containing:
  - meta tags: charset, viewport, `<meta id="themeColor" name="theme-color" content="#202020">`, robots, referrer.
  - `<link rel="manifest">`, favicons, `<title>Jellyfin</title>`.
  - An inline `<style>`. It defines `.hide`, `.layout-desktop .hide-desktop`, `.layout-mobile .hide-mobile`, `.layout-tv .hide-tv` (all `display:none!important`), the `mouseIdle` cursor rules, `html{background-color:#101010;color:rgba(255,255,255,.7)}` and `.mainDrawerHandle`.
  - Then `</head><body dir="ltr"><div id="reactRoot"><div class="splashLogo"></div></div></body></html>`.
  - The template has **no `<script>` tags**.
- **Build output.** `HtmlWebpackPlugin` 5.6.8 with `{filename:'index.html', template:'index.html', hash:true, chunks:['main.jellyfin','serviceworker']}`.
  - The v5 defaults (`inject:true` with `scriptLoading:'defer'`) put **`<script defer src="...bundle.js?<hash>">` tags in `<head>`**. There is one per initial chunk, because `splitChunks` produces many `node_modules.*.bundle.js`, plus `main.jellyfin.bundle.js` and `serviceworker.js`. The exact list is UNVERIFIED, since there is no built artifact to inspect.
  - Production minification keeps `</head>` and `</body>`. Evidence: HSS injects with `.Replace("</head>", ...)` and `.Replace("</body>", ...)` (`Helpers/TransformationPatches.cs`), and JE injects before `</body>` (`Services/ScriptInjectionStartupFilter.cs`).
- **Injection approaches.**
  - JE on 12.x: an ASP.NET `IStartupFilter` middleware rewrites the `/web/`, `/web` and `/web/index.html` response at request time. It strips `Accept-Encoding` and `Range`, and drops `ETag` and `Last-Modified`.
  - Its tag is `<script plugin="..." src="../JellyfinEnhanced/script?v=<key>" defer></script>` before `</body>`.
  - A `defer` script after the bundles runs after them in document order. `window.ApiClient` is still async, so poll for it.
- **Service worker** (`src/serviceworker.js`, entry in `webpack.prod.js`).
  - It handles only `notificationclick` and `activate` (`clients.claim()`). There is **no `fetch` handler, so nothing is cached**, and our index.html injection isn't affected.
  - It is registered in `index.jsx registerServiceWorker()` only when `!browser.tv && !browser.xboxOne` and `appMode` is not cordova or android.
  - Server HTTP cache headers on `/web/index.html`: UNVERIFIED.

## 8. CSS variables (theme)

- **MUI CSS-vars theme** (`themes/index.ts`): `createTheme({cssVariables:{cssVarPrefix:'jf', colorSchemeSelector:'[data-theme="%s"]'}, defaultColorScheme:'dark', colorSchemes:{appletv, blueradiance, dark, light, purplehaze, wmc}})`. `<html data-theme>` is set by `themeManager.setTheme`.
- **Variables referenced or defined in `themes/_base/_theme.scss`** (defaults from `_palette.scss` / `_base/theme.ts`):
  - **Background:** `--jf-palette-background-default` (#101010), `--jf-palette-background-paper` (#202020), `--jf-palette-background-defaultImage` (none; custom, on `:root`), `--jf-palette-background-paperChannel` (used in `dark/theme.scss`, e.g. `rgba(var(...)/0.8)`).
  - **Text:** `--jf-palette-text-primary` (#fff), `--jf-palette-text-secondary` (rgba(255,255,255,.7)).
  - **Accent:**
    - `--jf-palette-primary-main` (#00a4dc), `--jf-palette-primary-dark` (#00729a).
    - `--jf-palette-primary-mainChannel` (for `rgb(var(...)/a)`), `--jf-palette-primary-contrastText`.
    - `--jf-palette-secondary-main` (defaults to primary), `--jf-palette-secondary-contrastText`.
  - **Actions and dividers:** `--jf-palette-action-focus` (rgba(255,255,255,.12)), `--jf-palette-action-hover` (.08), `--jf-palette-action-selectedOpacity`, `--jf-palette-divider` (rgba(255,255,255,.12)).
  - **Errors:** `--jf-palette-error-main` (#c62828), `--jf-palette-error-light`, `--jf-palette-error-contrastText`.
  - **App bar:** `--jf-palette-AppBar-defaultBg` (#202020), `--jf-palette-AppBar-transparentBg` (rgba(0,0,0,.4); custom), `--jf-palette-AppBar-gradient` (none; custom).
  - **Cards:** `--jf-card-borderRadius` (0.2em; custom, on `:root`). It is defined but stock `card.scss` still uses a literal `0.2em`.
  - **Misc:** `--jf-palette-common-white`, `--jf-palette-FilledInput-bg`, `--jf-palette-FilledInput-borderColor`, `--jf-palette-Button-inheritContainedBg`, `--jf-palette-SnackbarContent-bg`, `--jf-palette-Alert-infoFilledBg`.
- **Usage.** Always give a fallback, as the stock SCSS does: `var(--jf-palette-background-default, #101010)`.
- **Other MUI-generated variables:** `--jf-shape-borderRadius` (4px), `--jf-font-*`, `--jf-zIndex-appBar` (1100), `--jf-spacing`. These are UNVERIFIED and come from standard MUI CSS-vars output.
- **Fonts:**
  - The MUI theme uses `"Noto Sans", sans-serif`.
  - `styles/fonts.noto.scss` sets `"Noto Sans", "Noto Sans HK|JP|KR|SC|TC", sans-serif`.
  - On TV (non-Android), `fonts.sized.scss` uses system fonts.
  - `html { font-size: 93% }` (`styles/fonts.scss`). `site.scss` falls back to `Arial, Helvetica, sans-serif`.
- **Theme-specific classes:** `.skinHeader-withBackground`, `.detailRibbon`, `.backgroundContainer`, `.defaultCardBackground1..5`.

## 9. TV focus / D-pad

- **Arrow keys are handled only in the TV layout.**
  - `scripts/keyboardNavigation.js enable()` adds a `window` `keydown` listener in the bubble phase.
  - It returns early if `e.defaultPrevented`, if a modifier key is held, or if `!layoutManager.tv && isNavigationKey(key)`.
  - Otherwise it maps keys to `inputManager.handleCommand('left'|'right'|'up'|'down'|'select'|'back'|...)`.
- **`inputManager.handleCommand`** (`scripts/inputManager.js:55`):
  - It first dispatches a cancelable, bubbling `CustomEvent('command', {detail:{command}})` on `document.activeElement` (or the top `.dialogContainer .dialog.opened`). That only happens when someone is registered through `inputManager.on`.
  - Then it calls `focusManager.moveLeft/Right/Up/Down(activeElement)`. For `back` it calls `appRouter.back()`.
- **What counts as focusable** (`components/focusManager.js`):
  - `focusableQuery` = `INPUT:not([type=range]):not([type=file]), TEXTAREA, SELECT, BUTTON, A` (each `:not([tabindex="-1"]):not(:disabled)`) plus **`.focusable`**.
  - "Currently focusable" requires `elem.offsetParent !== null`, so the element must be visible.
- **Spatial navigation** (`nav()`) searches the nearest **focus container** of the active element: `BODY`, `DIALOG`, or an element with class `focuscontainer`, `focuscontainer-x`, `focuscontainer-y`, `focuscontainer-left`, `focuscontainer-right` or `focuscontainer-down`.
  - It is global, works from `document.activeElement`, and has no page registration. **So it works on our own root**, provided the elements are native buttons or anchors, or carry `class="focusable"` plus `tabindex="0"` (a div needs tabindex to actually receive `.focus()`).
  - Hidden stock elements (`display:none`) are skipped automatically.
  - Use `focuscontainer-x` on horizontal rows to stop up/down from leaking sideways. Native `<button>` is enough; `is="emby-button"` isn't required.
- **TV-only global side effects:**
  - `components/scrollManager.js:582` adds a `window` `focusin` capture listener that calls `scrollToElement(e.target)`, centring the focused element in its scrollable parent. **This affects our root**; design rows to work with it, or use our own scroller and accept the centring.
  - `components/autoFocuser.js` remembers the last focused element.
  - The stock pages call `autoFocuser.autoFocus(container)` on show (details `itemDetails/index.js:65`, `hometab.js:35`), which can **steal focus into the hidden stock page**. Hidden elements fail `offsetParent`, so that probably yields nothing (UNVERIFIED). Call `focus()` on our first element after `viewshow`.
- **Handling keys ourselves.** Install a `window` `keydown` listener in the **capture** phase, or one on our root, and call `e.preventDefault()`. The stock handler then skips the event because of its `defaultPrevented` check.

## 10. Playback via own session

- **Handler.** `scripts/serverNotifications.js` (`initializeServerConnections()` is called in `index.jsx init()`) subscribes to `apiClient.subscribe([OutboundWebSocketMessageType.Play], ...)`, which is the SDK websocket.
- **`onPlay`:**
  - `PlayNext` → `playbackManager.queueNext({ids, serverId})`.
  - `PlayLast` → `playbackManager.queue(...)`.
  - Anything else → `playbackManager.play({ids: Data.ItemIds, startPositionTicks: Data.StartPositionTicks, mediaSourceId, audioStreamIndex, subtitleStreamIndex, startIndex, serverId})`.
  - **`startPositionTicks` is honoured.**
- **Server side.** `POST /Sessions/{sessionId}/Playing?playCommand=PlayNow&itemIds=<id>[&startPositionTicks=&mediaSourceId=&audioStreamIndex=&subtitleStreamIndex=&startIndex=]`, with `[Authorize]`, returns 204 (`server:Jellyfin.Api/Controllers/SessionController.cs:119`).
  - `SessionManager.SendPlayCommand` (`server:Emby.Server.Implementations/Session/SessionManager.cs:1339`) checks that the session exists (`ResourceNotFound` otherwise) and that the user has `PlayAccess.Full`.
  - `AssertCanControl` passes for the same user.
  - It sends to `session.SessionControllers`, so it **needs a live websocket controller**.
  - It does **not** check `SupportsMediaControl`. The web client reports `SupportsMediaControl: true` anyway (`utils/dashboard.js capabilities()`).
- **Session lookup.**
  - JE `js/enhanced/bookmarks/bookmarks-library-items.js:347` does `GET /Sessions` (no filter) and then `sessions.find(s => s.DeviceId === ApiClient.deviceId())`.
  - `js/enhanced/player/playback.js:903` and `auto-skip.js:443` use `/Sessions?ControllableByUserId=<userId>` and match on `DeviceId`.
  - The server also supports `GET /Sessions?deviceId=<id>` (`SessionController.cs:55`; also `activeWithinSeconds`).
- **Caveats:**
  - **RISK, deviceId encoding.**
    - The web deviceId is `btoa(userAgent|timestamp).replaceAll('=','1')` (`components/apphost.js:125`), which can contain `+` and `/`.
    - `createApiClient` `encodeURIComponent`s it, so `ApiClient.deviceId()` returns the **encoded** form.
    - The server `WebUtility.UrlDecode`s the auth header (`server:Jellyfin.Server.Implementations/Security/AuthorizationContext.cs:296,313`), so `session.DeviceId` holds the **decoded** form.
    - Match on `decodeURIComponent(ApiClient.deviceId())`, and fall back to the raw value. JE's raw comparison can miss.
  - **Remote player selected.** `playbackManager.play` forwards to `_currentPlayer` when the user has picked a remote or cast target (`components/playback/playbackmanager.js:2118-2125`), so playback starts there instead of locally.
  - **Episodes.** When the user has `EnableNextEpisodeAutoPlay` and a single Episode is sent, the server **expands `ItemIds` to the rest of the season/series** from that episode (`SessionManager.cs:1384-1409`). `startPositionTicks` still applies to the first item, because `startIndex` defaults to 0.
  - **Several tabs in one browser** share a deviceId. The server usually merges them, but an ambiguous match should fail closed (JE `auto-skip.js` comment).
  - The websocket subscription exists as soon as the ApiClient is created. Playback needs `playbackManager` and the player plugins, which `loadPlugins()` loads before `renderApp()`, so they are ready once the UI is up.
- **No in-page shortcut.** `playbackManager` is not on `window`, so the server round-trip is the supported path from a plugin script.

## 11. Card image URLs

- **Endpoint.** `GET /Items/{itemId}/Images/{imageType}` (also `/Items/{itemId}/Images/{imageType}/{imageIndex}`). It is **anonymous**: the OpenAPI has no `security` on this path.
- **Query parameters** (exact names, from `jellyfin-openapi-12.1.0.json`):
  - `maxWidth`, `maxHeight`, `width`, `height`, `quality`, `fillWidth`, `fillHeight`, `blur`, `unplayedCount`, `imageIndex`: int32.
  - `percentPlayed`: double.
  - `tag`, `backgroundColor`, `foregroundLayer`: string.
  - `format`: an `ImageFormat` value: Bmp, Gif, Jpg, Png, Webp, Svg.
- **`ImageType` values:** Primary, Art, Backdrop, Banner, Logo, Thumb, Disc, Box, Screenshot, Menu, Chapter, BoxRear, Profile.
- **Stock card URLs** (`components/cardbuilder/utils/url.ts:160-168`): `getImageApi(api).getItemImageUrlById(itemId, imgType, {fillHeight: ceil(h*dpr), fillWidth: ceil(w*dpr), quality: 96, tag})`, which builds `/Items/{id}/Images/{Type}?fillHeight=&fillWidth=&quality=96&tag=`.
  - The code comment reads "Dimensions must be rounded or the API will reject the request", so always send integers.
  - `apiclient` `getImageUrl` defaults quality to 90, or 80 for Backdrop.
  - Use `item.ImageTags[type]` (or `BackdropImageTags[0]`, `ParentThumbImageTag`, `ParentBackdropImageTags[0]` with `ParentThumbItemId`/`ParentBackdropItemId`) as `tag` for strong caching. Blurhash is in `item.ImageBlurHashes[type][tag]`.

## Side effects of hiding (not removing) stock pages

- The stock controllers keep running behind the hidden page, which duplicates API traffic:
  - Modern home loads `hometab` sections.
  - Details runs `itemDetails/index.js`. It calls `setBackdrops([item])` into **`.backdropContainer`** (position fixed, z-index -1, outside `.skinBody`).
- `themeMediaPlayer.js` plays **theme songs and videos** on any `viewshow` whose `detail.params` has `id` + `serverId`, which includes details, when the user setting allows it.
- Give our root an opaque background, or also hide `.backdropContainer` while active.
- The legacy home header still shows the Home/Favorites tabs (`.skinHeader .headerTabs`). The modern home also adds `noHomeButtonHeader` to `.skinHeader`.
- The now-playing bar lives in `body > .appfooter`, outside `#reactRoot`, so it stays visible.
