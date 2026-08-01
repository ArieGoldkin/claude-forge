import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'bin/run-hook.ts',
    'bin/detect-hook-outages.ts',
    'src/statusline/context-percentage.ts',
  ],
  format: ['esm'],
  dts: false,
  clean: true,
  sourcemap: true,
  target: 'node22',
  platform: 'node',
  minify: false,
  splitting: false,
  treeshake: true,
  outDir: 'dist',
  shims: false,
  esbuildOptions(options) {
    options.preserveSymlinks = true;
  },
});
