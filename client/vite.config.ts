import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // No proxy: in development the client talks to the game server directly on :2567,
  // because Colyseus's websocket path cannot be proxied alongside Vite's HMR socket.
  server: { port: 5173, host: true },
  build: { outDir: 'dist', sourcemap: true },
});
