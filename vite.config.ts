import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // 加载环境变量 (虽然 Vercel 会自动注入，但本地开发需要)
  // @ts-ignore
  const env = loadEnv(mode, process.cwd(), '');
  
  return {
    plugins: [react()],
    build: {
      outDir: 'dist',
      target: 'esnext'
    },
    define: {
      // 关键修复：Vite 默认不暴露 process.env。
      // 这里我们在构建时将 process.env.API_KEY 的值硬编码替换进去。
      // 优先使用 Vercel 系统变量 process.env.API_KEY，其次是 .env 文件中的变量
      'process.env.API_KEY': JSON.stringify(process.env.API_KEY || env.API_KEY || '')
    }
  };
});