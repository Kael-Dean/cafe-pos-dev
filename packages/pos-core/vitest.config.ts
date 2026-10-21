import { defineConfig } from 'vitest/config';

// Default environment is node (fast; server/BFF helpers need nothing else).
// Files that need a DOM opt in with a `// @vitest-environment jsdom` docblock.
// Core imports itself as `@pos/core/...`; that resolves through the workspace
// symlink in the root node_modules, so no alias is needed.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['node_modules/**', '**/node_modules/**'],
    restoreMocks: true,
  },
});
