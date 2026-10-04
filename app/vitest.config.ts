import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Default environment is node (fast; server/BFF helpers need nothing else).
// Files that need a DOM opt in with a `// @vitest-environment jsdom` docblock.
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
