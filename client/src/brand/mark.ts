/**
 * Lumen's mark, the red ribbon "J" (assets/lumen-j.svg), as markup. This module is the one place code gets it from:
 * the <LumenMark> component (nav, admin page), the loading veil and the tab icon. Stylesheets reference the same file
 * with url('../assets/lumen-j.svg'), and the PWA icons are rendered from it. To change the logo, change that file.
 */
import svg from '../assets/lumen-j.svg?raw';

export const MARK_SVG: string = svg;
