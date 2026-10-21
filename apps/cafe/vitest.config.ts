import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Edition-level unit tests (nav composition, proxy matcher). Core's own tests run
// in packages/pos-core.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['node_modules/**', 'e2e/**', '.next/**'],
    restoreMocks: true,
  },
});
