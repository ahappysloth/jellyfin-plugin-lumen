import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';
import { target } from './vite.target';

export default defineConfig({
  plugins: [preact()],
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target,
    lib: {
      entry: 'src/admin/main.tsx',
      formats: ['iife'],
      name: 'LumenAdmin',
      fileName: () => 'lumen-admin.js',
    },
  },
});
