import { defineConfig } from 'vite';
import { target } from './vite.target.ts';

/**
 * Lumen's stylesheets besides lumen.css, each built on its own so a page downloads only the ones it uses:
 * - lumen-secondary.css: the pages in views/secondary's file (styles/secondary.css), linked with that file.
 * - lumen-stock.css: jellyfin-web's sign-in, settings and admin pages' controls, and its dialogs and menus on every
 *   page (styles/stock.css), while "Restyle Jellyfin's sign-in, settings and Dashboard pages" is on.
 * - lumen-dashboard.css: the admin pages' own look (styles/dashboard.css), on those pages only.
 * The inline guard links the last two (veil/skin.ts).
 */
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target,
    rollupOptions: {
      input: {
        'lumen-stock': 'src/styles/stock.css',
        'lumen-dashboard': 'src/styles/dashboard.css',
        'lumen-secondary': 'src/styles/secondary.css',
      },
      output: { assetFileNames: '[name][extname]' },
    },
  },
});
