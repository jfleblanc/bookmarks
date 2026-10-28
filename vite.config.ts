import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// L'interface est construite dans ./dist, puis servie par le Worker (voir wrangler.jsonc).
// En développement, /api est relayé vers « wrangler dev » (npm run dev:api) sur le port 8787.
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: false } }
  }
});
