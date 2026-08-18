import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 3000,
    proxy: {
      '/api': 'http://127.0.0.1:5000',
      '/health': 'http://127.0.0.1:5000',
      '/ready': 'http://127.0.0.1:5000',
      '/openapi.json': 'http://127.0.0.1:5000',
      '/docs': { target: 'http://127.0.0.1:5000', ws: true },
    },
  },
  build: {
    outDir: '../dist/practice-web',
    emptyOutDir: true,
  },
});
