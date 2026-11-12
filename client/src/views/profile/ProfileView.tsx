import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  appActions,
  getServerName,
  HISTORY_HASH,
  MY_REQUESTS_HASH,
  selectServer,
  SETTINGS_HASHES,
  signOut,
} from '../../compat/jellyfin';
import { Icon, type IconRef } from '../../components/icons';
import { useAutoFocus } from '../../components/useAutoFocus';
import { strings } from '../../strings';
import { liftVeil } from '../../veil/veil';
import { type Account, accountAccess, avatarUrl, loadAccount } from '../account/account';
import type { ViewContext } from '../context';
import { initials } from '../details/CastRow';
import { useSyncPlayState } from '../syncplay/syncPlayState';
import { useMyRequests } from '../catalog/requestProgress';
import { routeEnabled } from '../../takeover/takeover';
import { openWatchTogether } from '../secondary/lazySecondary';
import { PROFILE_ICONS } from './profileIcons';
import { profileStrings } from './profileStrings';

/** The avatar's CSS size. */
const AVATAR_PX = 88;

type SettingKey = keyof typeof strings.settings;

interface Entry {
  key: SettingKey;
  icon: IconRef;
}

const PREFERENCES: readonly Entry[] = [
  { key: 'display', icon: 'display' },
  { key: 'home', icon: 'home' },
  { key: 'playback', icon: 'play' },
  { key: 'subtitles', icon: PROFILE_ICONS.subtitles },
];
const ADMIN: readonly Entry[] = [
  { key: 'dashboard', icon: 'shield' },
  { key: 'metadata', icon: 'edit' },
];

/**
 * Lumen's version of jellyfin-web's settings menu: who you are, History and Watch together, then links to the stock
 * settings pages, grouped, plus sign out. The settings pages themselves stay stock. It offers everything the nav's
 * account menu does (on phones, the Me tab opens this page instead of that menu).
 */
export function ProfileView({ ctx }: { ctx: ViewContext }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [serverName, setServerName] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const syncPlay = useSyncPlayState(ctx);
  const myRequests = useMyRequests().available === true;
  useAutoFocus(rootRef, account !== null, ctx.layout);

  useEffect(() => {
    let cancelled = false;
    loadAccount(ctx)
      .then((a) => !cancelled && setAccount(a))
      .catch(() => !cancelled && ctx.onFallback())
      .finally(() => liftVeil());
    void getServerName(ctx.client).then((name) => !cancelled && setServerName(name));
    return () => {
      cancelled = true;
    };
  }, [ctx.userId]);

  if (!account) return <div class="lmn-browse lmn-browse__pending" aria-busy="true" />;
  const { user } = account;
  const access = accountAccess(account);
  const avatar = avatarUrl(ctx, user, AVATAR_PX);
  const setting = (key: SettingKey, icon: IconRef, autofocus = false) => (
    <Row
      key={key}
      icon={icon}
      label={strings.settings[key][0]}
      hint={strings.settings[key][1]}
      href={SETTINGS_HASHES[key](user.Id)}
      autofocus={autofocus}
    />
  );

  return (
    <div ref={rootRef} class="lmn-browse lmn-profile">
      <header class="lmn-profile__header">
        <a
          class="lmn-profile__avatar"
          href={SETTINGS_HASHES.profile(user.Id)}
          aria-label={strings.settings.profile[0]}
        >
          {avatar ? <img src={avatar} alt="" /> : <span aria-hidden="true">{initials(user.Name)}</span>}
        </a>
        <div>
          <h1 class="lmn-browse__title">{user.Name}</h1>
          <p class="lmn-browse__meta">
            {user.Policy?.IsAdministrator && <span class="lmn-profile__tag">{strings.administrator}</span>}
            {serverName ?? user.ServerName}
          </p>
        </div>
      </header>

      <div class="lmn-profile__groups">
        <Group label={profileStrings.activity}>
          <Row
            icon="history"
            label={strings.history}
            hint={profileStrings.historyHint}
            href={HISTORY_HASH}
            autofocus
          />
          {myRequests && routeEnabled('requests', ctx.config) && (
            <Row
              icon="download"
              label={strings.myRequests}
              hint={profileStrings.myRequestsHint}
              href={MY_REQUESTS_HASH}
            />
          )}
          {syncPlay.available && (
            <Row
              icon="watchTogether"
              label={strings.watchTogether}
              hint={syncPlay.group ? strings.inGroup(syncPlay.group.GroupName) : strings.syncPlay}
              popup
              onClick={(e) => void openWatchTogether(ctx, syncPlay, e.currentTarget as HTMLElement)}
            />
          )}
        </Group>
        <Group title={strings.account}>
          {setting('profile', 'user')}
          {access.quickConnect && setting('quickConnect', 'key')}
        </Group>
        <Group title={profileStrings.preferences}>
          {PREFERENCES.map(({ key, icon }) => setting(key, icon))}
          {/* Controls (remote/D-pad settings) only matter on TVs, as in jellyfin-web. */}
          {ctx.layout === 'tv' && setting('controls', PROFILE_ICONS.gamepad)}
          {access.clientSettings && (
            <Row
              icon="display"
              label={strings.clientSettings}
              hint={profileStrings.clientSettingsHint}
              onClick={() => appActions.clientSettings()}
            />
          )}
          {access.downloadManager && (
            <Row
              icon="download"
              label={strings.downloadManager}
              hint={profileStrings.downloadManagerHint}
              onClick={() => appActions.downloadManager()}
            />
          )}
        </Group>
        {/* Not on a TV, as in jellyfin-web (see accountAccess). */}
        {access.admin && (
          <Group title={profileStrings.administration}>
            {ADMIN.map(({ key, icon }) => setting(key, icon))}
          </Group>
        )}
      </div>

      {(access.selectServer || access.signOut || access.exitApp) && (
        <div class="lmn-profile__actions">
          {access.selectServer && (
            <button
              type="button"
              class="lmn-button lmn-button--secondary lmn-profile__signout"
              onClick={() => selectServer()}
            >
              <Icon name="server" />
              {strings.selectServer}
            </button>
          )}
          {access.signOut && (
            <button
              type="button"
              class="lmn-button lmn-button--secondary lmn-profile__signout"
              onClick={() => signOut()}
            >
              <Icon name="logout" />
              {strings.signOut}
            </button>
          )}
          {access.exitApp && (
            <button
              type="button"
              class="lmn-button lmn-button--secondary lmn-profile__signout"
              onClick={() => appActions.exit()}
            >
              <Icon name="close" />
              {strings.exitApp}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Group({ title, label, children }: { title?: string; label?: string; children: ComponentChildren }) {
  return (
    <section class="lmn-profile__group" aria-label={title ?? label}>
      {title && <h2 class="lmn-profile__group-title">{title}</h2>}
      <ul class="lmn-profile__list">{children}</ul>
    </section>
  );
}

/** One line of the menu: a link to a page, or a button (Watch together, the app's own screens). */
function Row({
  icon,
  label,
  hint,
  href,
  onClick,
  popup = false,
  autofocus = false,
}: {
  icon: IconRef;
  label: string;
  hint: string;
  href?: string;
  onClick?: (e: MouseEvent) => void;
  /** It opens a menu (Watch together). */
  popup?: boolean;
  /** TV: it takes the starting focus. */
  autofocus?: boolean;
}) {
  const className = `lmn-profile__link${autofocus ? ' lmn-autofocus' : ''}`;
  const content = (
    <>
      <span class="lmn-profile__icon">
        <Icon name={icon} size={22} />
      </span>
      <span class="lmn-profile__text">
        <span class="lmn-profile__label">{label}</span>
        <span class="lmn-profile__hint">{hint}</span>
      </span>
      <Icon name="chevronRight" size={20} class="lmn-profile__chevron" />
    </>
  );
  return (
    <li>
      {href ? (
        <a class={className} href={href}>
          {content}
        </a>
      ) : (
        <button type="button" class={className} aria-haspopup={popup ? 'menu' : undefined} onClick={onClick}>
          {content}
        </button>
      )}
    </li>
  );
}
