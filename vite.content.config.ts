// Content script 单独构建：Chrome MV3 content_scripts 是 classic script，
// 不能引用 vite 代码分割出的 ESM chunk，因此 import-1688 必须单独打包成自包含文件。
// 必须在主构建（emptyOutDir）之后运行：vite build && vite build -c vite.content.config.ts
import { defineConfig } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: 'src',
  publicDir: false,
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: false,
    sourcemap: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        'pages/inject/import-1688': resolve(__dirname, 'src/pages/inject/import-1688.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        inlineDynamicImports: true,
      },
    },
  },
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
});
