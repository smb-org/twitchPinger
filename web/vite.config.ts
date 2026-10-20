import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  root: import.meta.dirname,
  plugins: [preact()],
  build: { outDir: '../dist/web', emptyOutDir: true },
  server: { port: 12173, strictPort: true, proxy: { '/api': 'http://localhost:12080' } },
  preview: { port: 12174, strictPort: true },
});
