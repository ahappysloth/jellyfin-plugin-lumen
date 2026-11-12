/**
 * What the tests need to know about each of registry.ts's STOCK_SELECTORS, kept apart so it doesn't ship: the page
 * e2e/specs/stock-probe.spec.ts opens to find it, and the stylesheet that repeats it (registry.test.ts checks the
 * selector text really occurs there). Every selector needs an entry; add one here when you add a selector there.
 */
import type { STOCK_SELECTORS } from './registry';

/**
 * A page the e2e probe opens to look for a selector, or a dialog or menu it opens there (Dashboard > Users: a user's ⋯
 * menu and its Delete confirmation; the header's user menu; API Keys > New API Key). Null means it can't be probed
 * reliably (transient UI).
 */
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
  | 'notFound'
  | 'actionSheet'
  | 'confirmDialog'
  | 'userMenu'
  | 'apiKeyDialog';

export interface StockSelectorMeta {
  probe: ProbePage | null;
  /** The stylesheet that repeats this selector, if any. */
  css?:
    | 'base.css'
    | 'player.css'
    | 'stock-skin.css'
    | 'toasts.css'
    | 'dashboard.css'
    | 'nav.css'
    | 'stock-components.css';
}

export const STOCK_SELECTOR_META = {
  reactRoot: { probe: 'home', css: 'base.css' },
  stockPage: { probe: 'home', css: 'base.css' },
  stockMain: { probe: 'home', css: 'base.css' },
  backdrop: { probe: 'home', css: 'base.css' },
  background: { probe: 'home', css: 'stock-skin.css' },
  modernAppBar: { probe: 'home', css: 'base.css' },
  legacyHeader: { probe: 'home', css: 'base.css' },
  splashLogo: { probe: null, css: 'base.css' },
  spinner: { probe: null, css: 'base.css' },
  appFooter: { probe: 'home', css: 'nav.css' },
  videoOsd: { probe: 'player', css: 'player.css' },
  volumeOsd: { probe: null, css: 'player.css' },
  skipIntro: { probe: null, css: 'player.css' },
  upNext: { probe: null, css: 'player.css' },
  loginForm: { probe: 'login', css: 'stock-skin.css' },
  quickConnectButton: { probe: 'login', css: 'stock-skin.css' },
  submitButton: { probe: 'login', css: 'stock-skin.css' },
  embyInput: { probe: 'login', css: 'stock-skin.css' },
  embySelect: { probe: 'settings' },
  selectContainer: { probe: 'settings', css: 'stock-skin.css' },
  embyCheckbox: { probe: 'settings', css: 'stock-skin.css' },
  sectionTitle: { probe: 'settings', css: 'stock-skin.css' },
  muiInput: { probe: 'display', css: 'stock-skin.css' },
  toastContainer: { probe: null, css: 'toasts.css' },
  toast: { probe: null, css: 'toasts.css' },
  toastShown: { probe: null, css: 'toasts.css' },
  toastHiding: { probe: null, css: 'toasts.css' },
  dialogContainer: { probe: 'actionSheet', css: 'stock-components.css' },
  formDialogHeader: { probe: 'confirmDialog', css: 'stock-components.css' },
  floatingDialog: { probe: 'confirmDialog', css: 'stock-components.css' },
  confirmDialog: { probe: 'confirmDialog', css: 'stock-components.css' },
  cancelButton: { probe: 'confirmDialog', css: 'stock-components.css' },
  deleteButton: { probe: 'confirmDialog', css: 'stock-components.css' },
  actionSheet: { probe: 'actionSheet', css: 'stock-components.css' },
  actionSheetItem: { probe: 'actionSheet', css: 'stock-components.css' },
  muiMenu: { probe: 'userMenu', css: 'stock-components.css' },
  muiModal: { probe: 'userMenu', css: 'stock-components.css' },
  muiDialog: { probe: 'apiKeyDialog', css: 'stock-components.css' },
  dashboardDrawer: { probe: 'dashboard', css: 'dashboard.css' },
  dashboardNavItem: { probe: 'dashboard', css: 'dashboard.css' },
  dashboardNavHeading: { probe: 'dashboard', css: 'dashboard.css' },
  dashboardLogo: { probe: 'dashboard', css: 'dashboard.css' },
  dashboardCard: { probe: 'dashboard', css: 'dashboard.css' },
  dashboardButton: { probe: 'dashboard', css: 'dashboard.css' },
  dashboardDangerButton: { probe: 'dashboard', css: 'dashboard.css' },
  dashboardContent: { probe: 'dashboard', css: 'dashboard.css' },
  dashboardHomePage: { probe: 'dashboard', css: 'dashboard.css' },
  pluginsPage: { probe: 'plugins', css: 'dashboard.css' },
  pluginFilters: { probe: 'plugins', css: 'dashboard.css' },
  dashboardFormStack: { probe: 'dashboard-settings', css: 'dashboard.css' },
  cardBackground: { probe: 'dashboard', css: 'dashboard.css' },
  metadataSidebar: { probe: 'metadata', css: 'dashboard.css' },
  metadataTree: { probe: 'metadata', css: 'dashboard.css' },
  metadataTreeIcon: { probe: 'metadata', css: 'dashboard.css' },
  routedPage: { probe: 'dashboard', css: 'dashboard.css' },
  pluginInstalledAlert: { probe: null, css: 'dashboard.css' },
  manageRepositories: { probe: 'plugins' },
  notFoundPage: { probe: 'notFound' },
  notFoundContent: { probe: 'notFound' },
  notFoundHomeLink: { probe: 'notFound' },
} as const satisfies Record<keyof typeof STOCK_SELECTORS, StockSelectorMeta>;
