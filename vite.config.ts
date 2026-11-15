import { defineConfig } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: 'src',
  publicDir: resolve(__dirname, 'public'),
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        'background/sw': resolve(__dirname, 'src/background/sw.ts'),
        'pages/manage/manage': resolve(__dirname, 'src/pages/manage/manage.html'),
        'pages/popup/popup': resolve(__dirname, 'src/pages/popup/popup.html'),
        'pages/inject/sku-collector': resolve(__dirname, 'src/pages/inject/sku-collector.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
});
