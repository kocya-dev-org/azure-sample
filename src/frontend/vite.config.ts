import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // ローカル開発時は Azure Functions Core Tools の API に転送する
      '/api': 'http://localhost:7071',
    },
  },
  build: {
    outDir: 'dist',
  },
  test: {
    name: 'frontend',
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
