import type { ChartPeriod } from '../../takeover/routes';
import { formatNumber } from '../../util/locale';

/** Strings only the Top charts page uses: they come with its own file (lazyCharts.tsx), not the core's strings.ts. */
export const chartsStrings = {
  intro: 'What people watched most, from Trakt.',
  type: 'Movies or shows',
  movies: 'Movies',
  shows: 'Shows',
  period: 'Period',
  periods: {
    weekly: 'This week',
    monthly: 'This month',
    yearly: 'This year',
    all: 'All time',
  } satisfies Record<ChartPeriod, string>,
  /** The periods on a phone, where four chips share the screen's width (the full names stay the buttons' names). */
  periodsShort: {
    weekly: 'Week',
    monthly: 'Month',
    yearly: 'Year',
    all: 'All time',
  } satisfies Record<ChartPeriod, string>,
  /** The grid's name: "Top movies this week". */
  listLabel: (type: string, period: string) => `Top ${type.toLowerCase()} ${period.toLowerCase()}`,
  /** The visible rank on a card. */
  rank: (rank: number) => formatNumber(rank),
  /** Seerr couldn't describe some of the chart's titles this time, so they're left out. */
  partial: 'Some titles couldn’t be loaded.',
  empty: 'Nothing here yet',
  emptyHint: "None of this chart's titles are on this server.",
};
