import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    // theme.test.ts reads the @theme tokens via `index.css?raw`; other CSS stays stubbed.
    css: { include: [/src[\\/]index\.css/] },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
