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
    // IMPORTANT: ../public also stores runtime assets (audio, portraits, sfx). Do not wipe it on build.
    emptyOutDir: false,
    sourcemap: true,
    // Increase chunk size warning limit (we're optimizing but some chunks may be large)
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Manual chunk splitting for optimal caching and load times
        manualChunks: {
          // Core React vendor chunk - cached across all pages
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],

          // UI icons chunk
          'vendor-icons': ['lucide-react'],

          // Socket chunk
          'vendor-socket': ['socket.io-client']
        }
      }
    }
  }
});
