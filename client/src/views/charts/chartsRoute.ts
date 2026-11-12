import type { ChartPeriod, ChartType } from '../../takeover/routes';

export const CHART_PERIODS: readonly ChartPeriod[] = ['weekly', 'monthly', 'yearly', 'all'];

/**
 * The chart and period a Top charts URL asks for (takeover/routes.ts chartsHash): Movies and This week unless it says
 * otherwise. Read here, in the page's own file, rather than by parseRoute, which the inline guard carries.
 */
export function chartFromHash(hash: string): { chart: ChartType; period: ChartPeriod } {
  const queryStart = hash.indexOf('?');
  const query = new URLSearchParams(queryStart < 0 ? '' : hash.slice(queryStart + 1));
  const period = query.get('period') as ChartPeriod | null;
  return {
    chart: query.get('chart') === 'shows' ? 'shows' : 'movies',
    period: period && CHART_PERIODS.indexOf(period) >= 0 ? period : 'weekly',
  };
}
