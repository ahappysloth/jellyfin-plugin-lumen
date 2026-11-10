import definerSource from '../src/compat/webPluginDefiner.js?raw';

/** The ES5 definer's source, exactly as the server inlines it. */
export const DEFINER_SOURCE = definerSource;

/** Runs the definer as the inline script would, against `win` (its `window`). */
export function runDefiner(win: Window): void {
  new Function('window', definerSource)(win);
}
