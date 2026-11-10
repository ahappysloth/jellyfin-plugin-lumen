import { STOCK_ROUTES, STOCK_SELECTORS } from '../compat/registry';
import { CHECK_UPDATES_QUERY } from '../admin/updatesLink';

export const UPDATES_BUTTON_ID = 'lmn-check-updates';
/** Lumen's settings page, checking for updates as it opens (admin/UpdatesSettings.tsx). */
export const LUMEN_UPDATES_HASH = `#${STOCK_ROUTES.configurationPage}?name=Lumen&${CHECK_UPDATES_QUERY}`;

function hashPath(hash: string): string {
  const value = hash.replace(/^#!?/, '');
  const q = value.indexOf('?');
  return (q < 0 ? value : value.slice(0, q)).toLowerCase().replace(/\/$/, '');
}

/**
 * "Check for Lumen updates" on jellyfin-web's Plugins page, in front of Manage Repositories. It copies that button's
 * classes, so it looks like it whatever the theme, and links to Lumen's settings page, which runs the check. The page
 * is React and renders after navigating, so the button is (re)added whenever it's missing while the page is open; if
 * jellyfin-web changes the page so Manage Repositories can't be found, there is simply no button.
 */
export function createPluginsButton(doc: Document): { sync: (hash: string) => void; stop: () => void } {
  let observer: MutationObserver | null = null;

  const ensure = (): void => {
    if (doc.getElementById(UPDATES_BUTTON_ID)) return;
    const repositories = doc.querySelector<HTMLAnchorElement>(STOCK_SELECTORS.manageRepositories.selector);
    if (!repositories) return;
    const button = doc.createElement('a');
    button.id = UPDATES_BUTTON_ID;
    button.className = repositories.className;
    button.href = LUMEN_UPDATES_HASH;
    button.textContent = 'Check for Lumen updates';
    repositories.before(button);
  };
  const stop = (): void => {
    observer?.disconnect();
    observer = null;
  };

  return {
    sync(hash) {
      if (hashPath(hash) !== STOCK_ROUTES.plugins) {
        stop();
        return;
      }
      ensure();
      if (!observer && doc.body) {
        observer = new MutationObserver(ensure);
        observer.observe(doc.body, { childList: true, subtree: true });
      }
    },
    stop,
  };
}
