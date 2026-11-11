/**
 * Lumen's mark, the red ribbon "J" (assets/lumen-j.svg), as markup. This module is the one place code gets it from:
 * the <LumenMark> component (nav, admin page), the loading veil and the tab icon. Stylesheets reference the same file
 * with url('../assets/lumen-j.svg'), and the PWA icons are rendered from it. To change the logo, change that file.
 *
 * The file is minified by hand, because it ships twice (here as text, in lumen.css as a data URL) and nothing minifies
 * either copy. Its three paths, in order: the stem, a back ribbon with a gently curved end, darkening toward the fold;
 * the shadow the front ribbon casts on the stem, darkest at the crease; the front ribbon, which folds across the stem
 * and sweeps round into the bowl, lit from the top right.
 */
import svg from '../assets/lumen-j.svg?raw';

export const MARK_SVG: string = svg;
