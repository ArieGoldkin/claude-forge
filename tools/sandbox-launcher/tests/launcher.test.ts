/**
 * Launcher lifecycle + crash-injection tests (T2 / issue #45).
 *
 * These run entirely against `FakeProvider`. They prove the launcher's
 * SEQUENCING — that a sandbox is recorded before it can be lost, and that a
 * failure anywhere still leaves the system in a reapable state. They prove
 * nothing about Vercel's runtime behaviour; that is T4's job.
 *
 * @module tests/launcher
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  hasRecords,
  readRegistry,
} from '../../../shared/hooks-infra/src/lib/sandbox/registry.js';
import { launch, teardown, withSandbox } from '../src/launcher.js';
import { FakeProvider } from '../src/providers/fake.js';

let projectDir: string;
let provider: FakeProvider;

const TIMEOUT_MS = 45 * 60 * 1000;

function opts(overrides: Record<string, unknown> = {}) {
  return {
    projectDir,
    sessionId: 'sess_test',
    timeoutMs: TIMEOUT_MS,
    ...overrides,
  };
}

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbx-launcher-'));
  provider = new FakeProvider();
});

afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

// =============================================================================
// HAPPY PATH
// =============================================================================

describe('withSandbox', () => {
  it('provisions, runs the workload, and destroys the sandbox', async () => {
    const result = await withSandbox(provider, opts(), async (handle) => {
      const out = await provider.exec(handle, 'npm', ['test']);
      return out.stdout;
    });

    expect(result).toBe('ran: npm test');
    expect(provider.liveIds()).toEqual([]);
  });

  it('records the sandbox while the workload is running', async () => {
    let duringRun: ReturnType<typeof readRegistry> = [];

    await withSandbox(provider, opts(), async () => {
      duringRun = readRegistry(projectDir);
    });

    expect(duringRun).toHaveLength(1);
    expect(duringRun[0]?.provider).toBe('fake');
    expect(duringRun[0]?.status).toBe('running');
    expect(duringRun[0]?.session_id).toBe('sess_test');
  });

  it('deregisters the sandbox afterwards', async () => {
    await withSandbox(provider, opts(), async () => undefined);
    expect(hasRecords(projectDir)).toBe(false);
  });

  it('derives expires_at from timeoutMs', async () => {
    const before = Date.now();
    let expiresAt = 0;

    await withSandbox(provider, opts(), async () => {
      expiresAt = new Date(readRegistry(projectDir)[0]?.expires_at ?? 0).getTime();
    });

    expect(expiresAt).toBeGreaterThanOrEqual(before + TIMEOUT_MS - 5_000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + TIMEOUT_MS + 5_000);
  });
});

// =============================================================================
// CRASH INJECTION — the reason this design exists (R1 / #51)
// =============================================================================

describe('failure handling', () => {
  it('tears down and deregisters even when the workload throws', async () => {
    await expect(
      withSandbox(provider, opts(), async () => {
        throw new Error('workload exploded');
      })
    ).rejects.toThrow('workload exploded');

    expect(provider.liveIds()).toEqual([]);
    expect(hasRecords(projectDir)).toBe(false);
  });

  it('still destroys the sandbox when stop() fails', async () => {
    provider.failAt('stop');

    await withSandbox(provider, opts(), async () => undefined);

    expect(provider.liveIds()).toEqual([]);
    expect(hasRecords(projectDir)).toBe(false);
  });

  it('RETAINS the registry row when destroy() fails, so a later reap retries', async () => {
    provider.failAt('destroy');

    await withSandbox(provider, opts(), async () => undefined);

    expect(provider.liveIds()).toHaveLength(1);
    expect(hasRecords(projectDir)).toBe(true);
  });

  it('records the sandbox before the workload can fail', async () => {
    // Simulates the R1 failure mode: execution stops dead partway through, so
    // nothing after this point ever runs. The row must already exist.
    const handle = await launch(provider, opts());

    expect(readRegistry(projectDir).map((r) => r.sandbox_id)).toEqual([handle.id]);
    expect(provider.liveIds()).toEqual([handle.id]);
  });

  it('leaves no record when provisioning itself fails', async () => {
    provider.failAt('provision');

    await expect(launch(provider, opts())).rejects.toThrow(/injected failure at provision/);
    expect(hasRecords(projectDir)).toBe(false);
  });
});

// =============================================================================
// TEARDOWN IS TWO OPERATIONS (Phase-2 finding against the real SDK types)
// =============================================================================

describe('teardown', () => {
  it('both stops and destroys — a stopped-but-undeleted sandbox still bills storage', async () => {
    const handle = await launch(provider, opts());

    await teardown(provider, handle, projectDir);

    const sbx = provider.sandboxes.get(handle.id);
    expect(sbx?.stopped).toBe(true);
    expect(sbx?.destroyed).toBe(true);
  });

  it('is idempotent', async () => {
    const handle = await launch(provider, opts());

    await teardown(provider, handle, projectDir);
    await expect(teardown(provider, handle, projectDir)).resolves.toBe(true);
    expect(hasRecords(projectDir)).toBe(false);
  });

  it('reports failure without dropping the record when the provider is unreachable', async () => {
    const handle = await launch(provider, opts());
    provider.failAt('destroy');

    await expect(teardown(provider, handle, projectDir)).resolves.toBe(false);
    expect(readRegistry(projectDir).map((r) => r.sandbox_id)).toEqual([handle.id]);
  });
});
