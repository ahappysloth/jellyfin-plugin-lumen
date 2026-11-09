/**
 * Every jellyfin-web internal Lumen's TypeScript depends on: DOM selectors, hash routes, globals and PlaybackManager
 * methods. The rest of the client reads them from here, and the e2e suite probes them against a real server
 * (e2e/specs/stock-probe.spec.ts checks each selector matches on its page; stock-routes.spec.ts checks no route
 * Lumen links to is jellyfin-web's 404 page). When jellyfin-web changes, fix it here.
 *
 * The CSS (styles/base.css, player.css, stock-skin.css) can't import this module, so it repeats the selectors it
 * needs; `css` names the stylesheet that does, and registry.test.ts checks the selector text really occurs there.
 * Evidence for each entry: docs/reference/jellyfin-web-12.1-notes.md.
 *
 * Pure data: no DOM access and no imports, so the inline guard and the e2e suite can import it cheaply.
 */

/** A page the e2e probe opens to look for a selector; null means it can't be probed reliably (transient UI). */
export type ProbePage = 'login' | 'home' | 'settings' | 'display' | 'player';

export interface StockSelector {
  selector: string;
  probe: ProbePage | null;
  /** The stylesheet that repeats this selector, if any. */
  css?: 'base.css' | 'player.css' | 'stock-skin.css';
}

export const STOCK_SELECTORS = {
  /** React's mount point (index.html). */
  reactRoot: { selector: '#reactRoot', probe: 'home', css: 'base.css' },
  /** Routed page content in both the Modern and Legacy layouts. Hidden via CSS only. */
  stockPage: { selector: '#reactRoot .skinBody', probe: 'home', css: 'base.css' },
  backdrop: { selector: '.backdropContainer', probe: 'home', css: 'base.css' },
  background: { selector: '.backgroundContainer', probe: 'home', css: 'stock-skin.css' },
  /** The Modern layout's app bar. */
  modernAppBar: { selector: '.MuiAppBar-root', probe: 'home', css: 'base.css' },
  /** The Legacy layout's header (also in the Modern DOM, inside a hidden wrapper). */
  legacyHeader: { selector: '.skinHeader', probe: 'home', css: 'base.css' },
  /** jellyfin-web's cold-load splash and spinner (gone by the time a probe could look). */
  splashLogo: { selector: '.splashLogo', probe: null, css: 'base.css' },
  spinner: { selector: '.docspinner', probe: null, css: 'base.css' },
  /** The player's own controls, hidden under Lumen's. */
  videoOsd: { selector: '.videoOsdBottom', probe: 'player', css: 'player.css' },
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
  /** jellyfin-web's "Page not found" page (react-router's catch-all). Lumen never shows it; e2e uses it as a marker. */
  notFoundPage: { selector: '#fallbackPage', probe: null },
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
  metadata: '/metadata',
} as const;

/** Library pages by CollectionType (mirrors appRouter.getRouteUrl in 12.x). Others open `#/list?parentId=`. */
export const LIBRARY_ROUTES: Record<string, string> = {
  movies: '/movies',
  tvshows: '/tv',
  music: '/music',
  musicvideos: '/musicvideos',
  books: '/books',
  playlists: '/playlists',
};

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

/** webpack's default `output.chunkLoadingGlobal`; Lumen finds jellyfin-web's PlaybackManager through it. */
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
  ],
} as const;
