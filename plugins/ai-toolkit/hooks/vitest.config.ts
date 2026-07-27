import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    preserveSymlinks: true,
  },
  test: {
    globals: true,
    environment: 'node',
    env: {
      CLAUDE_PLUGIN_NAME: 'ai',
    },
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'cobertura'],
      exclude: ['node_modules', 'dist', 'tests', '**/*.d.ts', '**/*.config.ts', '**/index.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
    reporters: ['default', 'junit'],
    outputFile: {
      junit: 'junit.xml',
    },
    testTimeout: 10000,
    hookTimeout: 10000,
  },
});
