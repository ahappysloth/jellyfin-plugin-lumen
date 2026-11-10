import preact from '@preact/preset-vite';
import { defineConfig } from 'vitest/config';
import { target } from './vite.target.ts';

export default defineConfig({
  plugins: [preact()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target,
    cssCodeSplit: false,
    // An ES module, so the player and the trailer preview can be separate files that load when they're needed
    // (views/player/lazyPlayer.tsx, views/home/lazyTrailer.tsx).
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
        // One core file: main.tsx and everything it imports, which the later files (the player, the trailer preview)
        // import from. Left to itself, Rolldown puts the code all three share (Preact) in a file of its own, a second
        // download the page waits for before Lumen can start.
        codeSplitting: { groups: [{ name: 'main', test: /[\\/]src[\\/]main\.tsx$/ }] },
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
