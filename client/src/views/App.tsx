import { ErrorBoundary } from '../components/ErrorBoundary';
import type { TakeoverRoute } from '../takeover/routes';
import type { ViewContext } from './context';
import { DetailsView } from './details/DetailsView';
import { HomeView } from './home/HomeView';

export function App({ route, ctx }: { route: TakeoverRoute; ctx: ViewContext }) {
  return (
    <ErrorBoundary fallback={null} onError={ctx.onFallback}>
      {route.kind === 'home' ? (
        <HomeView ctx={ctx} />
      ) : (
        <DetailsView key={route.id} id={route.id} ctx={ctx} />
      )}
    </ErrorBoundary>
  );
}
