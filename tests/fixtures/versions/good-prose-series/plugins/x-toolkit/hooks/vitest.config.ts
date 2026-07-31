import { defineConfig } from 'vitest/config';

// Fixture config. Tests must run under the PRODUCTION identity — the wrapper's
// CLAUDE_PLUGIN_NAME — because disagreeing here is issue #63 exactly.
export default defineConfig({
  test: {
    env: {
      CLAUDE_PLUGIN_NAME: 'xtk',
    },
  },
});
