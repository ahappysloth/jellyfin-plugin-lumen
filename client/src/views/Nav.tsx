import { useEffect, useState } from 'preact/hooks';
import type { BaseItem } from '../api/types';
import markSvg from '../assets/lumen-j.svg?raw';
import {
  FAVORITES_HASH,
  getServerName,
  HOME_HASH,
  libraryHash,
  PREFERENCES_HASH,
  SEARCH_HASH,
} from '../compat/jellyfin';
import { Icon, type IconName } from '../components/icons';
import { strings } from '../strings';
import { rememberVeilName } from '../veil/veil';
import type { ViewContext } from './context';

const MAX_LIBRARIES = 4;
const LIBRARY_ICONS: Record<string, IconName> = { movies: 'film', tvshows: 'tv', music: 'music' };

/** Which pill item is current: 'home', 'favorites', 'search', 'profile', or a library's id. */
export type NavActive = string;

interface NavData {
  serverName: string | null;
  libraries: BaseItem[];
}

/** Per-user cache, so navigating home again doesn't refetch or flash an empty nav. */
const cache = new Map<string, NavData>();

async function loadNavData(ctx: ViewContext): Promise<NavData> {
  const [serverName, views] = await Promise.all([
    getServerName(ctx.client),
    ctx.api.getUserViews().catch(() => ({ Items: [] as BaseItem[] })),
  ]);
  return { serverName, libraries: views.Items.slice(0, MAX_LIBRARIES) };
}

/**
 * Lumen's floating header on its own pages: the server name on the left, and centred, a pill with Home, the user's
 * libraries, Favorites, search and settings. jellyfin-web's app bar is hidden while it shows (see lumen.css).
 */
export function Nav({ ctx, active = 'home' }: { ctx: ViewContext; active?: NavActive }) {
  const [data, setData] = useState<NavData | null>(() => cache.get(ctx.userId) ?? null);

  // While the nav shows, phones get the tab bar: lumen.css pads pages and lifts jellyfin-web's now-playing bar.
  useEffect(() => {
    document.documentElement.classList.add('lmn-has-tabbar');
    return () => document.documentElement.classList.remove('lmn-has-tabbar');
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadNavData(ctx)
      .then((fresh) => {
        cache.set(ctx.userId, fresh);
        if (fresh.serverName) rememberVeilName(fresh.serverName);
        if (!cancelled) setData(fresh);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [ctx.userId]);

  return (
    <header class="lmn-nav">
      <a class="lmn-nav__brand" href={HOME_HASH}>
        <span class="lmn-nav__mark" aria-hidden="true" dangerouslySetInnerHTML={{ __html: markSvg }} />
        <span class="lmn-nav__name">{data?.serverName ?? 'Lumen'}</span>
      </a>
      <nav class="lmn-nav__pill focuscontainer-x" aria-label="Main">
        <NavItem href={HOME_HASH} icon="home" label={strings.home} current={active === 'home'} />
        {data?.libraries.map((view) => (
          <NavItem
            key={view.Id}
            href={libraryHash(view)}
            icon={LIBRARY_ICONS[view.CollectionType ?? ''] ?? 'folder'}
            label={view.Name}
            current={active === view.Id}
          />
        ))}
        <NavItem
          href={FAVORITES_HASH}
          icon="heart"
          label={strings.favorites}
          current={active === 'favorites'}
        />
        <span class="lmn-nav__divider" aria-hidden="true" />
        <a
          class={`lmn-nav__item lmn-nav__item--icon${active === 'search' ? ' is-active' : ''}`}
          href={SEARCH_HASH}
          aria-label={strings.search}
          aria-current={active === 'search' ? 'page' : undefined}
        >
          <Icon name="search" size={18} />
        </a>
        <a
          class={`lmn-nav__item lmn-nav__item--icon${active === 'profile' ? ' is-active' : ''}`}
          href={PREFERENCES_HASH}
          aria-label={strings.profile}
          aria-current={active === 'profile' ? 'page' : undefined}
        >
          <Icon name="user" size={18} />
        </a>
      </nav>
      {/* Phones: search sits alone at the top right; the destinations move to the tab bar below. */}
      <a
        class={`lmn-nav__search${active === 'search' ? ' is-active' : ''}`}
        href={SEARCH_HASH}
        aria-label={strings.search}
        aria-current={active === 'search' ? 'page' : undefined}
      >
        <Icon name="search" size={20} />
      </a>
      <nav class="lmn-tabbar" aria-label={strings.tabs}>
        <Tab href={HOME_HASH} icon="home" label={strings.home} current={active === 'home'} />
        {data?.libraries.slice(0, MAX_TAB_LIBRARIES).map((view) => (
          <Tab
            key={view.Id}
            href={libraryHash(view)}
            icon={LIBRARY_ICONS[view.CollectionType ?? ''] ?? 'folder'}
            label={view.Name}
            current={active === view.Id}
          />
        ))}
        <Tab href={FAVORITES_HASH} icon="heart" label={strings.favorites} current={active === 'favorites'} />
        <Tab href={PREFERENCES_HASH} icon="user" label={strings.me} current={active === 'profile'} />
      </nav>
    </header>
  );
}

/** Home, up to two libraries, Favorites and Me: five tabs at most fit a phone. */
const MAX_TAB_LIBRARIES = 2;

function Tab({
  href,
  icon,
  label,
  current,
}: {
  href: string;
  icon: IconName;
  label: string;
  current: boolean;
}) {
  return (
    <a
      class={`lmn-tab${current ? ' is-active' : ''}`}
      href={href}
      aria-current={current ? 'page' : undefined}
    >
      <Icon name={icon} size={22} />
      <span class="lmn-tab__label">{label}</span>
    </a>
  );
}

function NavItem({
  href,
  icon,
  label,
  current,
}: {
  href: string;
  icon: IconName;
  label: string;
  current: boolean;
}) {
  return (
    <a
      class={`lmn-nav__item${current ? ' is-active' : ''}`}
      href={href}
      aria-current={current ? 'page' : undefined}
      aria-label={label}
      title={label}
    >
      <Icon name={icon} size={17} />
      <span class="lmn-nav__label" aria-hidden="true">
        {label}
      </span>
    </a>
  );
}
