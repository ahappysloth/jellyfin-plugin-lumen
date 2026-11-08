import { useEffect, useState } from 'preact/hooks';
import type { BaseItem } from '../api/types';
import { getServerName, HOME_HASH, libraryHash, PREFERENCES_HASH, SEARCH_HASH } from '../compat/jellyfin';
import { Icon, type IconName } from '../components/icons';
import { strings } from '../strings';
import type { ViewContext } from './context';

const MAX_LIBRARIES = 4;
const LIBRARY_ICONS: Record<string, IconName> = { movies: 'film', tvshows: 'tv', music: 'music' };

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

/** True once the page has scrolled past the top, so the header can turn solid over content. */
function useScrolled(threshold = 24): boolean {
  const [scrolled, setScrolled] = useState(() => window.scrollY > threshold);
  useEffect(() => {
    const update = (): void => setScrolled(window.scrollY > threshold);
    window.addEventListener('scroll', update, { passive: true });
    update();
    return () => window.removeEventListener('scroll', update);
  }, [threshold]);
  return scrolled;
}

/**
 * Lumen's floating header on its own pages: the server name on the left, a pill with Home, the user's libraries,
 * search and settings on the right. jellyfin-web's app bar is hidden while it shows (see lumen.css).
 */
export function Nav({ ctx }: { ctx: ViewContext }) {
  const [data, setData] = useState<NavData | null>(() => cache.get(ctx.userId) ?? null);
  const scrolled = useScrolled();

  useEffect(() => {
    let cancelled = false;
    loadNavData(ctx)
      .then((fresh) => {
        cache.set(ctx.userId, fresh);
        if (!cancelled) setData(fresh);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [ctx.userId]);

  return (
    <header class={`lmn-nav${scrolled ? ' is-scrolled' : ''}`}>
      <a class="lmn-nav__brand" href={HOME_HASH}>
        <span class="lmn-nav__mark" aria-hidden="true" />
        <span class="lmn-nav__name">{data?.serverName ?? 'Lumen'}</span>
      </a>
      <nav class="lmn-nav__pill focuscontainer-x" aria-label="Main">
        <a class="lmn-nav__item is-active" href={HOME_HASH} aria-current="page">
          <Icon name="home" size={15} />
          <span class="lmn-nav__label">{strings.home}</span>
        </a>
        {data?.libraries.map((view) => (
          <a key={view.Id} class="lmn-nav__item" href={libraryHash(view)}>
            <Icon name={LIBRARY_ICONS[view.CollectionType ?? ''] ?? 'folder'} size={15} />
            <span class="lmn-nav__label">{view.Name}</span>
          </a>
        ))}
        <span class="lmn-nav__divider" aria-hidden="true" />
        <a class="lmn-nav__item lmn-nav__item--icon" href={SEARCH_HASH} aria-label={strings.search}>
          <Icon name="search" size={16} />
        </a>
        <a class="lmn-nav__item lmn-nav__item--icon" href={PREFERENCES_HASH} aria-label={strings.profile}>
          <Icon name="user" size={16} />
        </a>
      </nav>
    </header>
  );
}
