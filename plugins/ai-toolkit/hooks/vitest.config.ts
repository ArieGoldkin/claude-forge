import * as os from 'node:os';
import * as path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    preserveSymlinks: true,
  },
  test: {
    globals: true,
    environment: 'node',
    env: {
      // Hermetic: hooks that touch ~/.claude must not write to the real home
      // during tests. session-loader's #82 snapshot wrote 20 files into the
      // developer's plugin-state directory before this existed, and a
      // diagnostic then read them back as if they were evidence.
      CLAUDE_CONFIG_DIR: path.join(os.tmpdir(), 'ctk-test-config'),
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
