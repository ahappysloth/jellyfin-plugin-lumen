import preact from '@preact/preset-vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [preact()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    cssCodeSplit: false,
    // An ES module, so the player can be a separate file that loads when it's needed (views/player/lazyPlayer.tsx).
    // Library mode: an app build would add Vite's preload helper to lumen.js and have the other files import it back.
    lib: {
      entry: 'src/entry.ts',
      formats: ['es'],
      fileName: () => 'lumen.js',
      cssFileName: 'lumen',
    },
    rolldownOptions: {
      output: {
        // Content-hashed: the server caches them for good (Api/LumenController.cs).
        chunkFileNames: 'lumen-chunk-[name]-[hash].js',
        // Library mode leaves ES output unminified for bundlers downstream; this one goes straight to browsers.
        minify: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // Let tests read the stylesheets as text (`?raw`; compat/registry.test.ts checks the selectors they repeat).
    css: true,
  },
});
