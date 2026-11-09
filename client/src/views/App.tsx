import { ContextMenuHost } from '../components/ContextMenu';
import { useEffect } from 'preact/hooks';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { liftVeil } from '../veil/veil';
import type { TakeoverRoute } from '../takeover/routes';
import { FavoritesView } from './browse/FavoritesView';
import { LibraryView } from './browse/LibraryView';
import type { ViewContext } from './context';
import { TitleView } from './catalog/TitleView';
import { DetailsView } from './details/DetailsView';
import { HomeView } from './home/HomeView';
import { ProfileView } from './profile/ProfileView';
import { SearchView } from './search/SearchView';
import { Nav, type NavActive } from './Nav';

function navActive(route: TakeoverRoute): NavActive {
  if (route.kind === 'library') return route.id;
  return route.kind === 'details' || route.kind === 'title' ? 'home' : route.kind;
}

function Page({ route, ctx }: { route: TakeoverRoute; ctx: ViewContext }) {
  switch (route.kind) {
    case 'home':
      return <HomeView ctx={ctx} />;
    case 'library':
      return <LibraryView key={route.id} id={route.id} collection={route.collection} ctx={ctx} />;
    case 'favorites':
      return <FavoritesView ctx={ctx} />;
    case 'search':
      return <SearchView initialQuery={route.query} ctx={ctx} />;
    case 'profile':
      return <ProfileView ctx={ctx} />;
    case 'details':
      return <DetailsView key={route.id} id={route.id} ctx={ctx} />;
    case 'title':
      return (
        <TitleView
          key={`${route.mediaType}-${route.tmdbId}`}
          mediaType={route.mediaType}
          tmdbId={route.tmdbId}
          ctx={ctx}
        />
      );
  }
}

export function App({ route, ctx }: { route: TakeoverRoute; ctx: ViewContext }) {
  // Home and details lift the veil when their data lands; the library pages draw their header at once.
  useEffect(() => {
    if (route.kind === 'library' || route.kind === 'favorites') liftVeil();
  }, [route.kind]);
  return (
    <ErrorBoundary fallback={null} onError={ctx.onFallback}>
      {route.kind !== 'details' && route.kind !== 'title' && (
        <ErrorBoundary fallback={null}>
          <Nav ctx={ctx} active={navActive(route)} />
        </ErrorBoundary>
      )}
      <Page route={route} ctx={ctx} />
      <ContextMenuHost />
    </ErrorBoundary>
  );
}
