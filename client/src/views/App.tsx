import { ErrorBoundary } from '../components/ErrorBoundary';
import type { TakeoverRoute } from '../takeover/routes';
import { FavoritesView } from './browse/FavoritesView';
import { LibraryView } from './browse/LibraryView';
import type { ViewContext } from './context';
import { DetailsView } from './details/DetailsView';
import { HomeView } from './home/HomeView';
import { Nav, type NavActive } from './Nav';

function navActive(route: TakeoverRoute): NavActive {
  if (route.kind === 'library') return route.id;
  return route.kind === 'favorites' ? 'favorites' : 'home';
}

function Page({ route, ctx }: { route: TakeoverRoute; ctx: ViewContext }) {
  switch (route.kind) {
    case 'home':
      return <HomeView ctx={ctx} />;
    case 'library':
      return <LibraryView key={route.id} id={route.id} collection={route.collection} ctx={ctx} />;
    case 'favorites':
      return <FavoritesView ctx={ctx} />;
    case 'details':
      return <DetailsView key={route.id} id={route.id} ctx={ctx} />;
  }
}

export function App({ route, ctx }: { route: TakeoverRoute; ctx: ViewContext }) {
  return (
    <ErrorBoundary fallback={null} onError={ctx.onFallback}>
      {route.kind !== 'details' && (
        <ErrorBoundary fallback={null}>
          <Nav ctx={ctx} active={navActive(route)} />
        </ErrorBoundary>
      )}
      <Page route={route} ctx={ctx} />
    </ErrorBoundary>
  );
}
