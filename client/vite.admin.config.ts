import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [preact()],
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'es2020',
    lib: {
      entry: 'src/admin/main.tsx',
      formats: ['iife'],
      name: 'LumenAdmin',
      fileName: () => 'lumen-admin.js',
    },
  },
});
