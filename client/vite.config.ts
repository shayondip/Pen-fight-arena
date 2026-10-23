import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The dev server proxies /api and /socket.io to the game server, so there is
 * exactly one URL to open and no CORS setup for local play. Two browser tabs
 * on this address are two real clients talking to one authoritative server.
 */
const SERVER_PORT = Number.parseInt(process.env.SERVER_PORT ?? '4000', 10);
const CLIENT_PORT = Number.parseInt(process.env.CLIENT_PORT ?? '5173', 10);
const target = `http://127.0.0.1:${Number.isFinite(SERVER_PORT) ? SERVER_PORT : 4000}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number.isFinite(CLIENT_PORT) ? CLIENT_PORT : 5173,
    strictPort: false,
    host: true,
    proxy: {
      '/api': { target, changeOrigin: true },
      '/socket.io': { target, ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          r3f: ['@react-three/fiber', '@react-three/drei'],
        },
      },
    },
  },
});
