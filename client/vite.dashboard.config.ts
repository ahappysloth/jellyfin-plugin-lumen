import { defineConfig } from 'vite';

/**
 * The admin pages' stylesheet (src/styles/dashboard.css → dist/lumen-dashboard.css). Separate from lumen.css so
 * Lumen's own pages don't carry it; the server links it only when "Restyle Jellyfin's sign-in, settings and Dashboard pages"
 * is on.
 */
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      input: { 'lumen-dashboard': 'src/styles/dashboard.css' },
      output: { assetFileNames: '[name][extname]' },
    },
  },
});
