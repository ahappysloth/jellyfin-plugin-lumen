import { loadStyles } from '../../util/loadStyles';

type TrailerInfoModule = typeof import('./TrailerInfo');

let loading: Promise<TrailerInfoModule> | null = null;

/**
 * The Trailer section of Media info is a file of its own (./TrailerInfo.tsx) with its stylesheet, loaded as Media info
 * or Trailer info opens: only the item menu imports this, so it costs nothing at startup or on the item menu's own
 * download. A failed load is asked for again next time; meanwhile Media info shows as jellyfin-web has it.
 */
export function loadTrailerInfo(): Promise<TrailerInfoModule> {
  loading ??= Promise.all([import('./TrailerInfo'), loadStyles('lumen-trailerinfo.css')]).then(
    ([module]) => module,
    (error: unknown) => {
      loading = null;
      throw error;
    },
  );
  return loading;
}

/**
 * jellyfin-web is done opening a movie's Media info (it's up, or failed to open): the Trailer section's watch for it
 * ends (TrailerInfo.tsx settleMediaInfo), so another title's Media info can't get this one's section.
 */
export function settleMediaInfo(): void {
  void loading?.then(
    (module) => module.settleMediaInfo(),
    () => undefined,
  );
}
