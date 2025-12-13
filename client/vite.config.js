import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/storyteller/',
  server: {
    port: 5101,
    proxy: {
      '/api': {
        target: 'http://localhost:5100',
        changeOrigin: true
      },
      '/socket.io': {
        target: 'http://localhost:5100',
        ws: true
      }
    }
  },
  build: {
    outDir: '../public',
    emptyOutDir: true,
    sourcemap: true  // Enable source maps for debugging
  }
});
