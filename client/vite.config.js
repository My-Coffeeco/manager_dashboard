import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/admin': {
        target: 'http://localhost:3113',
        changeOrigin: true,
      },
      '/webhooks': {
        target: 'http://localhost:3113',
        changeOrigin: true,
      },
      '/healthz': {
        target: 'http://localhost:3113',
        changeOrigin: true,
      }
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
