import { defineConfig } from 'vite';
import { target } from './vite.target.ts';

/**
 * The admin pages' stylesheet (src/styles/dashboard.css → dist/lumen-dashboard.css), with jellyfin-web's dialogs and
 * menus (stock-components.css, which it imports). Separate from lumen.css so Lumen's own pages don't carry it; the
 * server links it only when "Restyle Jellyfin's sign-in, settings and Dashboard pages" is on.
 */
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target,
    rollupOptions: {
      input: { 'lumen-dashboard': 'src/styles/dashboard.css' },
      output: { assetFileNames: '[name][extname]' },
    },
  },
});
