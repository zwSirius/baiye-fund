import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    target: 'esnext'
  },
  define: {
    // 简单处理环境变量，防止报错，实际部署时 Vercel 会注入 process.env
    'process.env': {} 
  }
});