import type { UserInfo } from '../../api/types';
import { appSupports, canSelectServer, canSignOut, supportsMultiServer } from '../../compat/jellyfin';
import { APP_FEATURES } from '../../compat/registry';
import { registerSessionCache } from '../../util/sessionCaches';
import type { ViewContext } from '../context';

/** Who is signed in, and the server settings the account menu depends on. */
export interface Account {
  user: UserInfo;
  /** The server has Quick Connect switched on. */
  quickConnect: boolean;
  /** This client can switch servers (jellyfin-web's AppFeature.MultiServer). */
  multiServer: boolean;
}

/** Per user, for the session: the nav asks on every page, and none of this changes while signed in. */
const cache = new Map<string, Promise<Account>>();
registerSessionCache(() => cache.clear());

/** The signed-in account (cached; a failed load is asked for again next time). */
export function loadAccount(ctx: ViewContext): Promise<Account> {
  let account = cache.get(ctx.userId);
  if (!account) {
    account = Promise.all([
      ctx.api.getCurrentUser(),
      // As jellyfin-web: no answer means no Quick Connect link.
      ctx.api.getQuickConnectEnabled().catch(() => false),
      supportsMultiServer(),
    ]).then(([user, quickConnect, multiServer]) => ({ user, quickConnect, multiServer }));
    account.catch(() => cache.delete(ctx.userId));
    cache.set(ctx.userId, account);
  }
  return account;
}

/**
 * Which of jellyfin-web's user-menu entries (components/toolbar/AppUserMenu.tsx, and its settings page) this user and
 * this client get. The account menu and the profile page both follow it.
 */
export interface AccountAccess {
  /** Dashboard and Metadata manager. */
  admin: boolean;
  quickConnect: boolean;
  selectServer: boolean;
  signOut: boolean;
  /** The official apps' own screens and Exit (never in a browser). */
  clientSettings: boolean;
  downloadManager: boolean;
  exitApp: boolean;
}

export function accountAccess(account: Account | null, win: Window = window): AccountAccess {
  return {
    admin: !!account?.user.Policy?.IsAdministrator,
    quickConnect: !!account?.quickConnect,
    selectServer: !!account?.multiServer && canSelectServer(win),
    signOut: canSignOut(win),
    clientSettings: appSupports(APP_FEATURES.clientSettings, win),
    downloadManager: appSupports(APP_FEATURES.downloadManagement, win),
    exitApp: appSupports(APP_FEATURES.exitMenu, win),
  };
}

/** Avatar pixels for a CSS size on 2x screens. */
export function avatarUrl(ctx: ViewContext, user: UserInfo, cssPx: number): string | null {
  if (!user.PrimaryImageTag) return null;
  return ctx.client.getUrl(`Users/${user.Id}/Images/Primary`, {
    tag: user.PrimaryImageTag,
    fillWidth: cssPx * 2,
    fillHeight: cssPx * 2,
    quality: 90,
  });
}
