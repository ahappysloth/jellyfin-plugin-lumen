import { PIGGY_BACKED_PARAMS } from '../../compat/registry';
import type { ChartPeriod, ChartType } from '../../takeover/routes';

export const CHART_PERIODS: readonly ChartPeriod[] = ['weekly', 'monthly', 'yearly', 'all'];

const queryOf = (hash: string): URLSearchParams => {
  const queryStart = hash.indexOf('?');
  return new URLSearchParams(queryStart < 0 ? '' : hash.slice(queryStart + 1));
};

/** Whether a URL is the Top charts page's (whichever chart): not one on the way to another page. */
export const isChartsHash = (hash: string): boolean =>
  queryOf(hash).get(PIGGY_BACKED_PARAMS.lumenPage) === 'charts';

/**
 * The chart and period a Top charts URL asks for (takeover/routes.ts chartsHash): Movies and This week unless it says
 * otherwise. Read here, in the page's own file, rather than by parseRoute, which the inline guard carries.
 */
export function chartFromHash(hash: string): { chart: ChartType; period: ChartPeriod } {
  const query = queryOf(hash);
  const period = query.get('period') as ChartPeriod | null;
  return {
    chart: query.get('chart') === 'shows' ? 'shows' : 'movies',
    period: period && CHART_PERIODS.indexOf(period) >= 0 ? period : 'weekly',
  };
}
