import { useEffect } from 'preact/hooks';
import { ErrorBoundary } from '../components/ErrorBoundary';
import type { TakeoverRoute } from '../takeover/routes';
import type { ViewContext } from './context';
import { HomeView } from './home/HomeView';

/** Hands the route back to the stock UI. Task 25 replaces it with DetailsView for details routes. */
function StockFallback({ ctx }: { ctx: ViewContext }) {
  useEffect(() => ctx.onFallback(), [ctx]);
  return null;
}

export function App({ route, ctx }: { route: TakeoverRoute; ctx: ViewContext }) {
  return (
    <ErrorBoundary fallback={null} onError={ctx.onFallback}>
      {route.kind === 'home' ? <HomeView ctx={ctx} /> : <StockFallback ctx={ctx} />}
    </ErrorBoundary>
  );
}
