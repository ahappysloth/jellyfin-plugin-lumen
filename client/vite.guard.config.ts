import { defineConfig } from 'vite';

/** The tiny inline guard (src/veil/guard.ts): no Preact, inlined into index.html by the server. */
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'es2020',
    lib: {
      entry: 'src/veil/guard.ts',
      formats: ['iife'],
      name: 'LumenGuard',
      fileName: () => 'lumen-guard.js',
    },
  },
});
