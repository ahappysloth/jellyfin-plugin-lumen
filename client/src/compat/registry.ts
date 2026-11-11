/**
 * Every jellyfin-web internal Lumen's TypeScript depends on: DOM selectors, hash routes, globals and PlaybackManager
 * methods. The rest of the client reads them from here, and the e2e suite probes them against a real server
 * (e2e/specs/stock-probe.spec.ts checks each selector matches on its page; stock-routes.spec.ts checks no route
 * Lumen links to is jellyfin-web's 404 page). When jellyfin-web changes, fix it here.
 *
 * The CSS (styles/base.css, player.css, stock-skin.css, dashboard.css, nav.css) can't import this module, so it repeats
 * the selectors it needs; `css` names the stylesheet that does, and registry.test.ts checks the selector text really
 * occurs there.
 * Evidence for each entry: docs/reference/jellyfin-web-12.1-notes.md.
 *
 * Pure data: no DOM access and no imports, so the inline guard and the e2e suite can import it cheaply.
 */

/** A page the e2e probe opens to look for a selector; null means it can't be probed reliably (transient UI). */
export type ProbePage =
  | 'login'
  | 'home'
  | 'settings'
  | 'display'
  | 'player'
  | 'dashboard'
  | 'dashboard-settings'
  | 'metadata'
  | 'plugins'
  | 'notFound';

export interface StockSelector {
  selector: string;
  probe: ProbePage | null;
  /** The stylesheet that repeats this selector, if any. */
  css?: 'base.css' | 'player.css' | 'stock-skin.css' | 'dashboard.css' | 'nav.css';
}

export const STOCK_SELECTORS = {
  /** React's mount point (index.html). */
  reactRoot: { selector: '#reactRoot', probe: 'home', css: 'base.css' },
  /** Routed page content in both the Modern and Legacy layouts. Hidden via CSS only. */
  stockPage: { selector: '#reactRoot .skinBody', probe: 'home', css: 'base.css' },
  /** The Modern layout's (empty) main landmark; Lumen's pages bring their own. The Legacy (TV) layout has none. */
  stockMain: { selector: '#reactRoot main', probe: 'home', css: 'base.css' },
  backdrop: { selector: '.backdropContainer', probe: 'home', css: 'base.css' },
  background: { selector: '.backgroundContainer', probe: 'home', css: 'stock-skin.css' },
  /** The Modern layout's app bar. */
  modernAppBar: { selector: '.MuiAppBar-root', probe: 'home', css: 'base.css' },
  /** The Legacy layout's header (also in the Modern DOM, inside a hidden wrapper). */
  legacyHeader: { selector: '.skinHeader', probe: 'home', css: 'base.css' },
  /** jellyfin-web's cold-load splash and spinner (gone by the time a probe could look). */
  splashLogo: { selector: '.splashLogo', probe: null, css: 'base.css' },
  spinner: { selector: '.docspinner', probe: null, css: 'base.css' },
  /**
   * jellyfin-web's fixed footer (components/appFooter): the music now-playing bar renders inside it, so it's what
   * nav.css lifts above Lumen's phone tab bar. Always in the DOM, empty until something plays.
   */
  appFooter: { selector: '.appfooter', probe: 'home', css: 'nav.css' },
  /** The player's own controls, hidden under Lumen's. */
  videoOsd: { selector: '.videoOsdBottom', probe: 'player', css: 'player.css' },
  /** jellyfin-web's volume card (components/playback/volumeosd.js); Lumen's controls show the volume instead. */
  volumeOsd: { selector: '.volumeOsd', probe: null, css: 'player.css' },
  /** Prompts that stay clickable above Lumen's player (only shown with intro segments / near the end). */
  skipIntro: { selector: '.skip-button-container', probe: null, css: 'player.css' },
  upNext: { selector: '.upNextContainer', probe: null, css: 'player.css' },
  /** The sign-in form (stock-skin.css restyles it). */
  loginForm: { selector: '.manualLoginForm', probe: 'login', css: 'stock-skin.css' },
  submitButton: { selector: '.button-submit', probe: 'login', css: 'stock-skin.css' },
  embyInput: { selector: '.emby-input', probe: 'login', css: 'stock-skin.css' },
  /** Settings pages' selects (views/profile/stockSelects.tsx puts Lumen's dropdown over them). */
  embySelect: { selector: 'select.emby-select, select[is="emby-select"]', probe: 'settings' },
  selectContainer: { selector: '.selectContainer', probe: 'settings', css: 'stock-skin.css' },
  embyCheckbox: { selector: '.emby-checkbox', probe: 'settings', css: 'stock-skin.css' },
  sectionTitle: { selector: '.sectionTitle', probe: 'settings', css: 'stock-skin.css' },
  /** The Display page's MUI inputs. */
  muiInput: { selector: '.MuiFilledInput-root', probe: 'display', css: 'stock-skin.css' },
  /** jellyfin-web's toasts (components/toast/toast.ts), e.g. SyncPlay's "joined the group" notices. */
  toastContainer: { selector: '.toastContainer', probe: null, css: 'stock-skin.css' },
  toast: { selector: '.toastContainer .toast', probe: null, css: 'stock-skin.css' },
  /** jellyfin-web's toast animation states (Lumen's pill drops in and fades out on them). */
  toastShown: { selector: '.toast.toastVisible', probe: null, css: 'stock-skin.css' },
  toastHiding: { selector: '.toast.toastHide', probe: null, css: 'stock-skin.css' },
  /** The admin pages (dashboard.css): the Dashboard's MUI frame, drawer and controls. */
  dashboardDrawer: { selector: '.MuiDrawer-paper', probe: 'dashboard', css: 'dashboard.css' },
  dashboardNavItem: { selector: '.MuiListItemButton-root', probe: 'dashboard', css: 'dashboard.css' },
  dashboardNavHeading: { selector: '.MuiListSubheader-root', probe: 'dashboard', css: 'dashboard.css' },
  dashboardLogo: { selector: "img[src*='icon-transparent']", probe: 'dashboard', css: 'dashboard.css' },
  dashboardCard: { selector: '.MuiCard-root', probe: 'dashboard', css: 'dashboard.css' },
  dashboardButton: { selector: '.MuiButton-containedPrimary', probe: 'dashboard', css: 'dashboard.css' },
  /** Restart and Shutdown: outlined so they never look like the (red by default) accent. */
  dashboardDangerButton: { selector: '.MuiButton-colorError', probe: 'dashboard', css: 'dashboard.css' },
  /** Each admin page's content: dashboard.css centres it as one column, wider on the pages listed by id. */
  dashboardContent: {
    selector: '.page.type-interior .content-primary',
    probe: 'dashboard',
    css: 'dashboard.css',
  },
  dashboardHomePage: { selector: '#dashboardPage', probe: 'dashboard', css: 'dashboard.css' },
  pluginsPage: { selector: '#pluginsPage', probe: 'plugins', css: 'dashboard.css' },
  /** The plugin catalog's filter chips' row: dashboard.css makes it a segmented strip like the tabs. */
  pluginFilters: {
    selector: '#pluginsPage .MuiStack-root > .MuiBox-root > .MuiStack-root',
    probe: 'plugins',
    css: 'dashboard.css',
  },
  /** An MUI settings form's one flat stack (General here): dashboard.css draws a card behind each of its sections. */
  dashboardFormStack: {
    selector: '.content-primary form > .MuiStack-root',
    probe: 'dashboard-settings',
    css: 'dashboard.css',
  },
  /** Device cards without artwork. */
  cardBackground: { selector: '.defaultCardBackground', probe: 'dashboard', css: 'dashboard.css' },
  /** The metadata manager: its library tree, and the editor form (emby-* controls, stock-skin.css). */
  metadataSidebar: { selector: '.editPageSidebar', probe: 'metadata', css: 'dashboard.css' },
  metadataTree: { selector: '.libraryTree', probe: 'metadata', css: 'dashboard.css' },
  metadataTreeIcon: { selector: '.metadataSidebarIcon', probe: 'metadata', css: 'dashboard.css' },
  /**
   * The routed page itself (absolutely positioned in `main`, on every admin page); dashboard.css pushes it down while the
   * restart banner (takeover/RestartBanner.tsx) sits over its top.
   */
  routedPage: { selector: '#reactRoot .skinBody > .page', probe: 'dashboard', css: 'dashboard.css' },
  /**
   * A plugin's page after installing it: "The plugin has been successfully installed. The server will need to be
   * restarted…" (MessagePluginInstalled, routes/plugins/plugin.tsx; the page's only success alert). Hidden while the
   * restart banner says the same. Only there just after an install, so not probed.
   */
  pluginInstalledAlert: {
    selector: '#addPluginPage .MuiAlert-standardSuccess',
    probe: null,
    css: 'dashboard.css',
  },
  /** The Plugins page's Manage Repositories button; "Check for Lumen updates" goes beside it (takeover/pluginsButton.ts). */
  manageRepositories: { selector: 'a[href$="/dashboard/plugins/repositories"]', probe: 'plugins' },
  /**
   * jellyfin-web's "Page not found" page (react-router's catch-all, routes/fallbackRoute). While it holds only its own
   * content Lumen shows its "Page not found" in its place (takeover/bootstrap.ts); e2e uses it as a marker.
   */
  notFoundPage: { selector: '#fallbackPage', probe: 'notFound' },
  /**
   * That page's content: one block with a heading, a message and a Go Home link, nothing else. Anything more (a plugin
   * drawing its own page for a route jellyfin-web doesn't know) and Lumen leaves the page alone (compat/jellyfin.ts).
   */
  notFoundContent: { selector: '#fallbackPage > .padded-left.padded-right', probe: 'notFound' },
  notFoundHomeLink: { selector: '#fallbackPage a.button-link[href="#/home"]', probe: 'notFound' },
} as const satisfies Record<string, StockSelector>;

/** The <html> classes jellyfin-web's layoutManager sets. */
export const LAYOUT_CLASSES = {
  tv: 'layout-tv',
  mobile: 'layout-mobile',
  desktop: 'layout-desktop',
} as const;

/**
 * jellyfin-web's hash routes (the path after `#`, lowercase). Lumen takes some over (takeover/routes.ts) and links
 * to others (compat/jellyfin.ts).
 */
export const STOCK_ROUTES = {
  home: '/home',
  details: '/details',
  list: '/list',
  search: '/search',
  video: '/video',
  preferencesMenu: '/mypreferencesmenu',
  dashboard: '/dashboard',
  plugins: '/dashboard/plugins',
  /** A plugin's own settings page (`?name=<plugin>`). */
  configurationPage: '/configurationpage',
  metadata: '/metadata',
} as const;

/**
 * Library pages by CollectionType, mirroring appRouter.getRouteUrl in 12.x. LIBRARY_ROUTES exist in every layout;
 * MODERN_LIBRARY_ROUTES only in the Modern one (apps/modern/routes/asyncRoutes/user.ts; getRouteUrl checks
 * `layoutManager.modern` for them), so the Legacy and TV layouts open those libraries as `#/list?parentId=` like any
 * other. Live TV opens LIVE_TV_ROUTE in every layout.
 */
export const LIBRARY_ROUTES: Record<string, string> = {
  movies: '/movies',
  tvshows: '/tv',
  music: '/music',
};
export const MODERN_LIBRARY_ROUTES: Record<string, string> = {
  musicvideos: '/musicvideos',
  books: '/books',
  playlists: '/playlists',
};
export const LIVE_TV_ROUTE = '/livetv';

/**
 * jellyfin-web's saved layout (`localStorage['layout']`, scripts/settings/appSettings.js) and the values that run the
 * Legacy app (constants/layoutMode.ts LegacyLayoutModes). `tv` also sets LAYOUT_CLASSES.tv; the other two don't show
 * in any class (`desktop-legacy` is `layout-desktop`, like the Modern desktop).
 */
export const LAYOUT_SETTING_KEY = 'layout';
export const LEGACY_LAYOUT_MODES: readonly string[] = ['desktop-legacy', 'mobile-legacy', 'tv'];

/**
 * The library pages' tabs Lumen draws, by jellyfin-web's `?tab=` index (apps/modern/features/libraries/constants/views
 * in 12.4). Tabs not listed (Playlists) stay stock.
 */
export const LIBRARY_TABS = {
  movies: { items: 0, suggestions: 1, favorites: 2, collections: 3, genres: 4, studios: 5 },
  tvshows: { items: 0, suggestions: 1, upcoming: 2, genres: 3, studios: 4, episodes: 5, collections: 6 },
} as const;

/**
 * keyCodes jellyfin-web's keyboard navigation (scripts/keyboardNavigation.js `KeyNames`) reads as Back, on top of
 * Escape (27): webOS's Back (461), Tizen's (10009) and an Xbox gamepad's B (196). Its `window` keydown listener (bubble
 * phase, skipped when `defaultPrevented`) then goes back a page; in the TV layout Escape does too.
 */
export const BACK_KEY_CODES: readonly number[] = [27, 196, 461, 10009];

/**
 * A keyCode jellyfin-web's player ignores. Its video OSD plays or pauses on keyCode 32 and takes it from buttons outside
 * the TV layout (controllers/playback/video/index.js onKeyDown), so Lumen's player hands it Space on its own buttons
 * with this keyCode instead. Both its listeners name keys with scripts/keyboardNavigation.js getKeyName, which reads
 * `KeyNames[keyCode] || code`: KeyNames has no 0, so Space reads as its code, 'Space', which neither the OSD's switch nor
 * keyboard navigation handles (checked against 12.4's source).
 */
export const IGNORED_KEY_CODE = 0;

/** jellyfin-web's list page filtered to one studio (`#/list?studioId=`), like its genre list. */
export const LIST_PARAMS = { genre: 'genreId', studio: 'studioId', parent: 'parentId' } as const;

/**
 * jellyfin-web's SyncPlay core (plugins/syncPlay/core/index.js): its default export is `{ Helper, Manager,
 * PlayerFactory, Players: { GenericPlayer } }`, found by those keys. Lumen reads the Manager's state and asks it to
 * start or stop group playback; the syncing itself stays jellyfin-web's. Missing: no Watch together button.
 */
export const SYNCPLAY_CORE_KEYS = ['Helper', 'Manager', 'PlayerFactory', 'Players'] as const;
/**
 * The SyncPlay plugin's type (constants/pluginType.ts PluginType.SyncPlay; 'syncplay' in 10.11 too). jellyfin-web's own
 * UI finds the core as `pluginManager.firstOfType('syncplay').instance`; Lumen does the same when its plugin has
 * caught pluginManager (webPluginDefiner.js), and searches the bundle by SYNCPLAY_CORE_KEYS otherwise.
 */
export const SYNCPLAY_PLUGIN_TYPE = 'syncplay';
export const SYNCPLAY_MANAGER_METHODS = [
  'isSyncPlayEnabled',
  'getGroupInfo',
  'isPlaylistEmpty',
  'isPlaybackActive',
  'resumeGroupPlayback',
  'haltGroupPlayback',
] as const;

/** The stock settings pages Lumen restyles and frames (the page itself stays jellyfin-web's). */
export const SETTINGS_ROUTES = {
  profile: '/userprofile',
  quickConnect: '/quickconnect',
  display: '/mypreferencesdisplay',
  home: '/mypreferenceshome',
  playback: '/mypreferencesplayback',
  subtitles: '/mypreferencessubtitles',
  controls: '/mypreferencescontrols',
} as const;

/**
 * jellyfin-web's admin pages, which Lumen restyles (CSS only; see veil/skin.ts and styles/dashboard.css): each path and
 * everything under it (`/dashboard/users`, …). `/configurationpage` is a plugin's own settings page.
 */
export const ADMIN_ROUTES = ['/dashboard', '/metadata', '/configurationpage'];

/** The MUI theme variable dashboard.css overrides first; the e2e probe checks jellyfin-web still defines it. */
export const DASHBOARD_THEME_VARIABLE = '--jf-palette-primary-main';

/**
 * The server's websocket messages the restart banner listens for (takeover/restartWatch.ts), through
 * `ApiClient.subscribe(types, handler)`: jellyfin-web sets it to its @jellyfin/sdk Api's subscribe when it creates the
 * ApiClient (lib/jellyfin-apiclient/ServerConnections.js, 12.1 and 12.4), and its notifications use it the same way.
 * Jellyfin 12.4 sends the Package* ones after a plugin is installed or uninstalled (both leave a restart pending) but
 * never RestartRequired; it's listened for in case a later server does. Without `subscribe`, the banner still checks on
 * every admin page Lumen sees open.
 */
export const RESTART_MESSAGES = {
  installed: 'PackageInstallationCompleted',
  uninstalled: 'PackageUninstalled',
  restartRequired: 'RestartRequired',
  restarting: 'ServerRestarting',
  shuttingDown: 'ServerShuttingDown',
} as const;

/** jellyfin-web's signed-out pages, which Lumen restyles (CSS only; see veil/skin.ts). */
export const SIGN_IN_ROUTES = [
  '/login',
  '/forgotpassword',
  '/forgotpasswordpin',
  '/selectserver',
  '/addserver',
];

/**
 * Query parameters Lumen adds to stock routes, relying on jellyfin-web ignoring parameters it doesn't know. When Lumen
 * doesn't take the route over (switched off for the user, the takeover disabled, or the compatibility check failed),
 * jellyfin-web shows its own page for the rest of the URL:
 * - `#/home?title=movie-<tmdbId>`: a Seerr catalog title. Stock shows home, without the title.
 * - `#/list?parentId=<id>&collectionType=boxsets`: the Collections library. Stock shows its own list of the library.
 */
export const PIGGY_BACKED_PARAMS = { catalogTitle: 'title', collectionType: 'collectionType' } as const;

/** The subset of `window.ApiClient` Lumen can't run without (the compatibility check requires all of them). */
export const API_CLIENT_METHODS = ['getCurrentUserId', 'accessToken', 'deviceId', 'getUrl', 'ajax'] as const;

/**
 * jellyfin-web's display language and date/time locale settings (userSettings.language() / dateTimeLocale(), kept only
 * in localStorage by appSettings, under `${userId}-${name}`), and the globalize functions that resolve them. Lumen
 * formats dates and numbers with them (util/locale.ts). Same in 10.11.11, 12.1 and 12.4.
 */
export const LOCALE_SETTINGS = { language: 'language', dateTimeLocale: 'datetimelocale' } as const;
export const GLOBALIZE_METHODS = {
  language: 'getCurrentLocale',
  dateTimeLocale: 'getCurrentDateTimeLocale',
} as const;

/**
 * webpack's `output.chunkLoadingGlobal` for a build without a `uniqueName` (jellyfin-web 10.11–12.4: its webpack
 * `context` is src/, which has no package.json to take a name from). Lumen finds jellyfin-web's PlaybackManager and
 * SyncPlay through it, and through any `webpackChunk<name>` should jellyfin-web's build ever get a name.
 */
export const WEBPACK_CHUNK_GLOBAL = 'webpackChunk';

/**
 * PlaybackManager methods Lumen's player calls. Every required one must be present or Lumen keeps the stock player;
 * optional ones hide their button when missing.
 */
export const PLAYBACK_MANAGER_METHODS = {
  required: [
    'getCurrentPlayer',
    'getPlayerState',
    'currentTime',
    'duration',
    'paused',
    'playPause',
    'seek',
    'rewind',
    'fastForward',
    'getVolume',
    'setVolume',
    'isMuted',
    'toggleMute',
    'audioTracks',
    'getAudioStreamIndex',
    'setAudioStreamIndex',
    'subtitleTracks',
    'getSubtitleStreamIndex',
    'setSubtitleStreamIndex',
    'getMaxStreamingBitrate',
    'enableAutomaticBitrateDetection',
    'setMaxStreamingBitrate',
    'getSupportedPlaybackRates',
    'getPlaybackRate',
    'setPlaybackRate',
    'getSupportedAspectRatios',
    'getAspectRatio',
    'setAspectRatio',
    'toggleFullscreen',
    'nextTrack',
    'previousTrack',
    'getCurrentPlaylistIndex',
    'getPlaylist',
  ],
  optional: [
    'supportSubtitleOffset',
    'getPlayerSubtitleOffset',
    'setSubtitleOffset',
    'togglePictureInPicture',
    'toggleAirPlay',
    // Starts playback in this tab (playItem). Missing: Play falls back to the server's remote PlayNow.
    'play',
    // The player's settings (gear) panel: Repeat. Missing: no Repeat row.
    'getRepeatMode',
    'setRepeatMode',
    // Cast: the devices playback can move to. Missing: no Cast button.
    'getTargets',
    'trySetActivePlayer',
    'stop',
  ],
} as const;
