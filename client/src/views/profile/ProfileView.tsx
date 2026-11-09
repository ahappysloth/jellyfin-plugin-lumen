import { useEffect, useState } from 'preact/hooks';
import type { UserInfo } from '../../api/types';
import { canSignOut, getServerName, SETTINGS_HASHES, signOut } from '../../compat/jellyfin';
import { Icon, type IconName } from '../../components/icons';
import { strings } from '../../strings';
import { liftVeil } from '../../veil/veil';
import type { ViewContext } from '../context';
import { initials } from '../details/CastRow';

/** Avatar pixels, for 2x screens at its 88px CSS size. */
const AVATAR_PX = 176;

type SettingKey = keyof typeof strings.settings;

interface Entry {
  key: SettingKey;
  icon: IconName;
}

const ACCOUNT: readonly Entry[] = [
  { key: 'profile', icon: 'user' },
  { key: 'quickConnect', icon: 'key' },
];
const PREFERENCES: readonly Entry[] = [
  { key: 'display', icon: 'display' },
  { key: 'home', icon: 'home' },
  { key: 'playback', icon: 'play' },
  { key: 'subtitles', icon: 'subtitles' },
];
const ADMIN: readonly Entry[] = [
  { key: 'dashboard', icon: 'shield' },
  { key: 'metadata', icon: 'edit' },
];

/**
 * Lumen's version of jellyfin-web's settings menu: who you are, then links to the stock settings pages, grouped,
 * plus sign out. The settings pages themselves stay stock.
 */
export function ProfileView({ ctx }: { ctx: ViewContext }) {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [serverName, setServerName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    ctx.api
      .getCurrentUser()
      .then((u) => !cancelled && setUser(u))
      .catch(() => !cancelled && ctx.onFallback())
      .finally(() => liftVeil());
    void getServerName(ctx.client).then((name) => !cancelled && setServerName(name));
    return () => {
      cancelled = true;
    };
  }, [ctx.userId]);

  if (!user) return <div class="lmn-browse lmn-browse__pending" aria-busy="true" />;
  const admin = !!user.Policy?.IsAdministrator;
  // Controls (remote/D-pad settings) only matter on TVs, as in jellyfin-web.
  const preferences =
    ctx.layout === 'tv' ? [...PREFERENCES, { key: 'controls', icon: 'gamepad' } as const] : PREFERENCES;

  return (
    <div class="lmn-browse lmn-profile">
      <header class="lmn-profile__header">
        <a
          class="lmn-profile__avatar"
          href={SETTINGS_HASHES.profile(user.Id)}
          aria-label={strings.settings.profile[0]}
        >
          {user.PrimaryImageTag ? (
            <img
              src={ctx.client.getUrl(`Users/${user.Id}/Images/Primary`, {
                tag: user.PrimaryImageTag,
                fillWidth: AVATAR_PX,
                fillHeight: AVATAR_PX,
                quality: 90,
              })}
              alt=""
            />
          ) : (
            <span aria-hidden="true">{initials(user.Name)}</span>
          )}
        </a>
        <div>
          <h1 class="lmn-browse__title">{user.Name}</h1>
          <p class="lmn-browse__meta">
            {admin && <span class="lmn-profile__tag">{strings.administrator}</span>}
            {serverName ?? user.ServerName}
          </p>
        </div>
      </header>

      <div class="lmn-profile__groups">
        <Group title={strings.account} entries={ACCOUNT} userId={user.Id} />
        <Group title={strings.preferences} entries={preferences} userId={user.Id} />
        {admin && <Group title={strings.administration} entries={ADMIN} userId={user.Id} />}
      </div>

      {canSignOut() && (
        <button
          type="button"
          class="lmn-button lmn-button--secondary lmn-profile__signout"
          onClick={() => signOut()}
        >
          <Icon name="logout" />
          {strings.signOut}
        </button>
      )}
    </div>
  );
}

function Group({ title, entries, userId }: { title: string; entries: readonly Entry[]; userId: string }) {
  return (
    <section class="lmn-profile__group" aria-label={title}>
      <h2 class="lmn-profile__group-title">{title}</h2>
      <ul class="lmn-profile__list">
        {entries.map(({ key, icon }) => {
          const [label, hint] = strings.settings[key];
          return (
            <li key={key}>
              <a class="lmn-profile__link" href={SETTINGS_HASHES[key](userId)}>
                <span class="lmn-profile__icon">
                  <Icon name={icon} size={20} />
                </span>
                <span class="lmn-profile__text">
                  <span class="lmn-profile__label">{label}</span>
                  <span class="lmn-profile__hint">{hint}</span>
                </span>
                <Icon name="chevronRight" size={18} class="lmn-profile__chevron" />
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
