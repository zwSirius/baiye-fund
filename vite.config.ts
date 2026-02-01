import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '');
  
  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, './src')
      }
    },
    build: {
      outDir: 'dist',
      target: 'esnext'
    },
    define: {
      'process.env.API_KEY': JSON.stringify(process.env.API_KEY || env.API_KEY || '')
    }
  };
});