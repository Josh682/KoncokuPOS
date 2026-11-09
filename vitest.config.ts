import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/*.test.{ts,tsx}', 'apps/**/*.test.{ts,tsx}'],
    server: {
      deps: {
        external: ['node:sqlite'],
      },
    },
  },
  resolve: {
    alias: {
      '@koncoku/shared': path.resolve(__dirname, 'packages/shared/src'),
    },
  },
});
