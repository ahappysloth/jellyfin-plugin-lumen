import { useEffect } from 'preact/hooks';
import { PREFERENCES_HASH, SELECTORS } from '../../compat/jellyfin';
import { Icon } from '../../components/icons';
import { strings } from '../../strings';
import type { SettingsPage } from '../../takeover/routes';
import { enhanceStockSelects } from './stockSelects';

/**
 * The title bar Lumen lays over a stock settings page (under its nav): back to Lumen's settings menu, and the page's
 * name. The page itself stays jellyfin-web's, restyled by lumen.css (html.lmn-skin-settings).
 */
export function SettingsFrame({ page }: { page: SettingsPage }) {
  const [title, hint] = strings.settings[page];
  // jellyfin-web renders the settings page itself; give its selects Lumen's dropdown while this frame is up.
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(SELECTORS.reactRoot);
    return root ? enhanceStockSelects(root) : undefined;
  }, [page]);
  return (
    <div class="lmn-settings-frame">
      <a class="lmn-settings-frame__back" href={PREFERENCES_HASH}>
        <Icon name="back" size={16} />
        {strings.settingsMenu}
      </a>
      <h1 class="lmn-settings-frame__title">{title}</h1>
      <p class="lmn-settings-frame__hint">{hint}</p>
    </div>
  );
}
