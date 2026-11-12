import { ConfirmHost } from '../components/ConfirmDialog';
import { ContextMenuHost } from '../components/ContextMenu';
import { useEffect, useRef } from 'preact/hooks';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { ToastHost } from '../components/Toast';
import { liftVeil } from '../veil/veil';
import { routeKey, type TakeoverRoute } from '../takeover/routes';
import { strings } from '../strings';
import { FavoritesView } from './browse/FavoritesView';
import { GenreView } from './browse/GenreView';
import { LibraryView } from './browse/LibraryView';
import type { ViewContext } from './context';
import { LazyTitleView } from './catalog/lazyTitle';
import { DetailsView } from './details/DetailsView';
import { HomeView } from './home/HomeView';
import { LazyPlayer, loadPlayer } from './player/lazyPlayer';
import { LoadingScreen } from './player/LoadingScreen';
import { clearStarting, useStarting } from '../playback/starting';
import { LazyProfileView, LazySettingsFrame } from './profile/lazyProfile';
import { LazySecondary, prefetchSecondary } from './secondary/lazySecondary';
import { Nav, type NavActive } from './Nav';
import { PageError, useFailedPage } from './pageError';
import { usePageChange } from './usePageChange';

function navActive(route: TakeoverRoute): NavActive {
  if (route.kind === 'library') return route.id;
  if (route.kind === 'genre') return route.parentId ?? 'home';
  // The account menu's pages light its button (the Me tab on phones).
  if (route.kind === 'settings' || route.kind === 'history') return 'profile';
  // A title's own page isn't one of the nav's places (the nav shows there only when the page couldn't load).
  if (route.kind === 'details' || route.kind === 'title') return null;
  return route.kind;
}

function Page({ route, ctx }: { route: TakeoverRoute; ctx: ViewContext }) {
  switch (route.kind) {
    case 'home':
      return <HomeView ctx={ctx} />;
    case 'library':
      return (
        <LibraryView
          key={`${route.id}:${route.tab}`}
          id={route.id}
          collection={route.collection}
          tab={route.tab}
          ctx={ctx}
        />
      );
    case 'favorites':
      return <FavoritesView ctx={ctx} />;
    case 'genre':
      return (
        <GenreView
          key={`${route.facet ?? 'genre'}:${route.id}:${route.parentId ?? ''}`}
          id={route.id}
          parentId={route.parentId}
          facet={route.facet}
          ctx={ctx}
        />
      );
    case 'search':
      return <LazySecondary ctx={ctx} view={(m) => <m.SearchView initialQuery={route.query} ctx={ctx} />} />;
    case 'profile':
      return <LazyProfileView ctx={ctx} />;
    case 'history':
      return <LazySecondary ctx={ctx} view={(m) => <m.HistoryView ctx={ctx} />} liftOnLoad />;
    case 'settings':
      return <LazySettingsFrame page={route.page} />;
    case 'player':
      return <LazyPlayer ctx={ctx} />;
    case 'details':
      return <DetailsView key={route.id} id={route.id} ctx={ctx} />;
    case 'notFound':
      return <PageError ctx={ctx} title={strings.pageNotFoundTitle} message={strings.pageNotFound} />;
    case 'title':
      return (
        <LazyTitleView
          key={`${route.mediaType}-${route.tmdbId}`}
          mediaType={route.mediaType}
          tmdbId={route.tmdbId}
          ctx={ctx}
        />
      );
  }
}

export function App({ route, ctx }: { route: TakeoverRoute; ctx: ViewContext }) {
  // Lumen giving the page back (e.g. its player controls are off) ends a loading screen still up from a Play click.
  useEffect(() => clearStarting, []);
  // Home and details lift the veil when their data lands, a genre once it's known to be Lumen's; the library pages
  // draw their header at once (History once its file is in: views/secondary).
  useEffect(() => {
    if (route.kind === 'library' || route.kind === 'favorites' || route.kind === 'notFound') liftVeil();
  }, [route.kind]);
  // The pages most visits never open come in a file of their own: fetch it once this one is up, so they open at once.
  useEffect(prefetchSecondary, []);
  // Lumen's own pages are the document's main content (jellyfin-web's, empty, is hidden: base.css). The player and
  // settings pages frame jellyfin-web's, which keep its main and its title.
  const framed = route.kind === 'player' || route.kind === 'settings';
  const main = useRef<HTMLElement>(null);
  usePageChange(main, routeKey(route), route.kind === 'search' ? strings.search : '', ctx);
  // Details and catalog titles draw their own header instead, unless they couldn't load (pageError.tsx).
  const failed = useFailedPage();
  const ownHeader = route.kind === 'details' || route.kind === 'title';
  return (
    <ErrorBoundary fallback={null} onError={ctx.onFallback}>
      {route.kind !== 'player' && (!ownHeader || failed) && (
        <ErrorBoundary fallback={null}>
          <Nav ctx={ctx} active={navActive(route)} />
        </ErrorBoundary>
      )}
      {framed ? (
        <Page route={route} ctx={ctx} />
      ) : (
        <main ref={main} class="lmn-main">
          <Page route={route} ctx={ctx} />
        </main>
      )}
      {route.kind !== 'player' && <StartingScreen ctx={ctx} />}
      <ContextMenuHost />
      <ConfirmHost />
      <ToastHost />
    </ErrorBoundary>
  );
}

/** From a Play click until the player opens: the same loading screen the player shows until its first frame. */
function StartingScreen({ ctx }: { ctx: ViewContext }) {
  const starting = useStarting();
  // Playback is starting: fetch the player's code while jellyfin-web prepares the stream.
  useEffect(() => {
    if (starting) loadPlayer().catch(() => undefined);
  }, [starting !== null]);
  return starting ? (
    <div class="lmn-starting">
      <LoadingScreen ctx={ctx} snap={null} starting={starting} />
    </div>
  ) : null;
}
