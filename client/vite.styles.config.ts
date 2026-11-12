import { defineConfig } from 'vite';
import { target } from './vite.target.ts';

/**
 * Lumen's stylesheets besides lumen.css, each built on its own so a page downloads only the ones it uses:
 * - lumen-secondary.css: the pages in views/secondary's file (styles/secondary.css), linked with that file.
 * - lumen-dashboard.css: the admin pages (styles/dashboard.css), with jellyfin-web's dialogs and menus
 *   (stock-components.css, which it imports). The server links it only when "Restyle Jellyfin's sign-in, settings and
 *   Dashboard pages" is on.
 */
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target,
    rollupOptions: {
      input: {
        'lumen-dashboard': 'src/styles/dashboard.css',
        'lumen-secondary': 'src/styles/secondary.css',
      },
      output: { assetFileNames: '[name][extname]' },
    },
  },
});
