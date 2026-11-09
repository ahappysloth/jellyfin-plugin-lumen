import { PREFERENCES_HASH } from '../../compat/jellyfin';
import { Icon } from '../../components/icons';
import { strings } from '../../strings';
import type { SettingsPage } from '../../takeover/routes';

/**
 * The title bar Lumen lays over a stock settings page (under its nav): back to Lumen's settings menu, and the page's
 * name. The page itself stays jellyfin-web's, restyled by lumen.css (html.lmn-skin-settings).
 */
export function SettingsFrame({ page }: { page: SettingsPage }) {
  const [title, hint] = strings.settings[page];
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
