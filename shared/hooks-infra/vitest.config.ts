import * as os from 'node:os';
import * as path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      // Issue #105: this was the ONE config of six with no CLAUDE_CONFIG_DIR, so
      // shared-suite logs landed in the developer's real ~/.claude/logs/plugin/
      // (1026 fabricated review rows, which #106's command read as real data).
      // The five plugin configs already isolate this; logging.ts now honors it.
      CLAUDE_CONFIG_DIR: path.join(os.tmpdir(), 'ctk-test-config-shared-hooks-infra'),
      CLAUDE_PLUGIN_NAME: 'plugin',
    },
    globals: true,
    environment: 'node',
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
    testTimeout: 10000,
    hookTimeout: 10000,
  },
});
