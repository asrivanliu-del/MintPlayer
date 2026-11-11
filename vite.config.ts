import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Use relative base so built index.html references assets with relative paths (works when loaded via file:// in Electron)
  base: './',
  plugins: [react()],
  root: '.',
  build: {
    outDir: 'dist/renderer'
  },
  server: {
    // Bind to 127.0.0.1 to match package.json wait-on and the main process URL
    host: '127.0.0.1',
    port: 5173
  }
});