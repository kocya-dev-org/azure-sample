import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // shadcn/ui の部品は `@/components/ui/...` の形で import する（ADR 0009）
      // 先頭の / は Vite のプロジェクトルート（src/frontend）を指す
      '@': '/src',
    },
  },
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
    setupFiles: ['./test/setup.ts'],
  },
});
