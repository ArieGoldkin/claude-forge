/**
 * Structural enforcement of ADR-0001 §3 (T2 / issue #45).
 *
 * The ADR's load-bearing constraint is a posture, and postures rot: "do NOT bake
 * sandbox provisioning into the shared ctk hooks that every installer runs."
 * A comment cannot enforce that. This file can.
 *
 * The concrete risk is small and specific. `@vercel/sandbox` pulls 11 transitive
 * dependencies (zod, undici, jose, tar-stream, @workflow/serde, …). The plugin
 * hook packages today have ZERO runtime dependencies. One convenient import in
 * the wrong file turns five install-and-go plugins into packages that fetch a
 * cloud SDK — and nothing else in the suite would notice.
 *
 * Scope note, stated rather than implied: this checks DECLARED dependencies,
 * built output, and the barrel export. It cannot catch every conceivable route
 * (a deep relative import into `tools/` from a plugin source file would evade
 * the manifest check until it reached `dist/`). It is a net, not a proof — the
 * same honest framing ctk 2.9.0's guard had to be corrected into.
 *
 * @module tests/lib/sandbox-isolation
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../../..');
const PLUGINS_DIR = path.join(REPO_ROOT, 'plugins');

/** The SDK that must never reach a plugin. */
const FORBIDDEN_DEP = '@vercel/sandbox';

function pluginNames(): string[] {
  if (!fs.existsSync(PLUGINS_DIR)) {
    return [];
  }
  return fs
    .readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

function walkFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

describe('ADR-0001 §3 — the provider SDK stays out of every plugin', () => {
  it('finds the plugin tree (guards against this whole file silently passing)', () => {
    // Without this, a bad REPO_ROOT would make every assertion below iterate an
    // empty list and report success. That is precisely how a control no-ops.
    expect(pluginNames().length).toBeGreaterThanOrEqual(5);
  });

  it.each(pluginNames())('%s declares no dependency on the provider SDK', (plugin) => {
    const manifest = path.join(PLUGINS_DIR, plugin, 'hooks/package.json');
    if (!fs.existsSync(manifest)) {
      return;
    }
    const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(Object.keys(pkg.dependencies ?? {})).not.toContain(FORBIDDEN_DEP);
    expect(Object.keys(pkg.devDependencies ?? {})).not.toContain(FORBIDDEN_DEP);
  });

  it.each(pluginNames())('%s ships no built output referencing the provider SDK', (plugin) => {
    const dist = path.join(PLUGINS_DIR, plugin, 'hooks/dist');
    const offenders = walkFiles(dist).filter((file) => {
      // `.map` is deliberately excluded. Source maps are ~79% of dist by bytes
      // (2.2 MB of 2.8 MB), and reading them synchronously in a worker was
      // measurably destabilising the shared suite — it reproduced the
      // logging.test.ts timing flake at roughly 1-in-3, against 0-in-8 without
      // this file. Maps are derived output: if the SDK were ever bundled, the
      // emitted .js would carry the import, so scanning them adds cost without
      // adding coverage.
      if (!/\.(js|cjs|mjs|ts)$/.test(file)) {
        return false;
      }
      return fs.readFileSync(file, 'utf8').includes(FORBIDDEN_DEP);
    });

    expect(offenders).toEqual([]);
  });

  it('shared hooks-infra declares no runtime dependencies at all', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'shared/hooks-infra/package.json'), 'utf8')
    ) as { dependencies?: Record<string, string> };

    expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
  });

  it('does not barrel-export the sandbox registry', () => {
    // Barrel-exporting would pull the registry into all five plugin bundles
    // instead of only ctk, which is the one plugin that reads it.
    const barrel = fs.readFileSync(
      path.join(REPO_ROOT, 'shared/hooks-infra/src/lib/index.ts'),
      'utf8'
    );

    expect(barrel).not.toMatch(/sandbox/);
  });

  it('keeps the launcher outside every plugin directory', () => {
    const launcher = path.join(REPO_ROOT, 'tools/sandbox-launcher/package.json');
    expect(fs.existsSync(launcher)).toBe(true);

    const pkg = JSON.parse(fs.readFileSync(launcher, 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    // The SDK lives here, and only here.
    expect(Object.keys(pkg.dependencies ?? {})).toContain(FORBIDDEN_DEP);
  });
});
