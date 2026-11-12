import preact from '@preact/preset-vite';
import { defineConfig } from 'vitest/config';
import { target } from './vite.target.ts';

export default defineConfig({
  plugins: [preact()],
  // lumen.css asks for its fonts relative to itself (/Lumen/Assets/, under any base URL), not at the server's root.
  base: './',
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
        // The fonts (styles/fonts.css, which keeps library mode from inlining them) too, and apart from the chunks.
        assetFileNames: (asset) =>
          asset.names[0]?.endsWith('.woff2') ? 'lumen-font-[name]-[hash][extname]' : '[name][extname]',
        // One core file: main.tsx and everything it imports, which the later files (the player, the trailer preview)
        // import from. Left to itself, Rolldown puts the code all three share (Preact) in a file of its own, a second
        // download the page waits for before Lumen can start. veil/stockCss.ts joins it too: the item menu's file and
        // the profile pages' file both import it, and it's too small to be a download of its own.
        codeSplitting: {
          groups: [{ name: 'main', test: /[\\/]src[\\/](main\.tsx|veil[\\/]stockCss\.ts)$/ }],
        },
        // Library mode leaves ES output unminified for bundlers downstream; this one goes straight to browsers.
        minify: true,
        // It also keeps every `/* @__PURE__ */` annotation (there for a downstream bundler's tree-shaking), about
        // 0.5 KB gzipped in the core. Nothing bundles this output again, so drop them, keeping only licence banners.
        comments: { legal: true, annotation: false, jsdoc: false },
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
