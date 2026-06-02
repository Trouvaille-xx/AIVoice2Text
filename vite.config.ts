// 仅供 vite 单独启动 renderer 用（开发期浏览器预览/截图）
// 生产构建由 electron.vite.config.ts 驱动
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer'),
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
  plugins: [react()],
  server: {
    port: 5174,
    host: '127.0.0.1',
  },
});
