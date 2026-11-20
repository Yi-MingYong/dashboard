import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = 'http://localhost:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    // `npm run dev:api` runs the Worker on :8787. Its CSRF check compares Origin with its own origin.
    proxy: { '/api': { target: API, changeOrigin: true, headers: { origin: API } } },
  },
  // Mirror the production security headers locally (vite preview), so CSP problems show up before deploy.
  preview: {
    headers: {
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'",
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          echarts: ['echarts/core', 'echarts/charts', 'echarts/components', 'echarts/renderers'],
        },
      },
    },
  },
});
