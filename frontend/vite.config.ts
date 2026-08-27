import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // The API server is a separate workspace; proxying keeps the app
      // same-origin in dev so there is no CORS or base-URL configuration.
      '/api': {
        target: `http://127.0.0.1:${process.env.SERVER_PORT ?? 8787}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 3200, // three.js + globe.gl are large by nature
  },
});
