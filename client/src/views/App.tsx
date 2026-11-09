import { ContextMenuHost } from '../components/ContextMenu';
import { useEffect } from 'preact/hooks';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { ToastHost } from '../components/Toast';
import { liftVeil } from '../veil/veil';
import type { TakeoverRoute } from '../takeover/routes';
import { FavoritesView } from './browse/FavoritesView';
import { GenreView } from './browse/GenreView';
import { LibraryView } from './browse/LibraryView';
import type { ViewContext } from './context';
import { TitleView } from './catalog/TitleView';
import { DetailsView } from './details/DetailsView';
import { HomeView } from './home/HomeView';
import { PlayerView } from './player/PlayerView';
import { ProfileView } from './profile/ProfileView';
import { SettingsFrame } from './profile/SettingsFrame';
import { SearchView } from './search/SearchView';
import { Nav, type NavActive } from './Nav';

function navActive(route: TakeoverRoute): NavActive {
  if (route.kind === 'library') return route.id;
  if (route.kind === 'genre') return route.parentId ?? 'home';
  if (route.kind === 'settings') return 'profile';
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
    case 'genre':
      return (
        <GenreView
          key={`${route.id}:${route.parentId ?? ''}`}
          id={route.id}
          parentId={route.parentId}
          ctx={ctx}
        />
      );
    case 'search':
      return <SearchView initialQuery={route.query} ctx={ctx} />;
    case 'profile':
      return <ProfileView ctx={ctx} />;
    case 'settings':
      return <SettingsFrame page={route.page} />;
    case 'player':
      return <PlayerView ctx={ctx} />;
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
    if (route.kind === 'library' || route.kind === 'favorites' || route.kind === 'genre') liftVeil();
  }, [route.kind]);
  return (
    <ErrorBoundary fallback={null} onError={ctx.onFallback}>
      {route.kind !== 'details' && route.kind !== 'title' && route.kind !== 'player' && (
        <ErrorBoundary fallback={null}>
          <Nav ctx={ctx} active={navActive(route)} />
        </ErrorBoundary>
      )}
      <Page route={route} ctx={ctx} />
      <ContextMenuHost />
      <ToastHost />
    </ErrorBoundary>
  );
}
