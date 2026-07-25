/**
 * Launcher lifecycle + crash-injection tests (T2 / issue #45).
 *
 * These run against `FakeProvider` and prove the launcher's SEQUENCING — that a
 * sandbox is recorded before it can exist, and that a failure anywhere leaves the
 * system in a reapable state. They prove nothing about Vercel's runtime
 * behaviour; that is T4's job.
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
  registryPath,
} from '../../../shared/hooks-infra/src/lib/sandbox/registry.js';
import {
  RegistryUnavailableError,
  generateSandboxName,
  launch,
  teardown,
  withSandbox,
} from '../src/launcher.js';
import { FakeProvider } from '../src/providers/fake.js';

let projectDir: string;
let provider: FakeProvider;

const TIMEOUT_MS = 45 * 60 * 1000;
const SNAPSHOT_MS = 24 * 60 * 60 * 1000;

function opts(overrides: Record<string, unknown> = {}) {
  return {
    projectDir,
    sessionId: 'sess_test',
    timeoutMs: TIMEOUT_MS,
    snapshotExpirationMs: SNAPSHOT_MS,
    ...overrides,
  };
}

/** Hold the registry lock with a live pid so writes cannot acquire it. */
function holdRegistryLock(): string {
  const lockDir = `${registryPath(projectDir)}.lock`;
  fs.mkdirSync(path.dirname(lockDir), { recursive: true });
  fs.mkdirSync(lockDir);
  fs.writeFileSync(path.join(lockDir, 'pid'), String(process.pid));
  return lockDir;
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

  it('records the sandbox as running while the workload executes', async () => {
    let duringRun: ReturnType<typeof readRegistry> = [];

    await withSandbox(provider, opts(), async () => {
      duringRun = readRegistry(projectDir);
    });

    expect(duringRun).toHaveLength(1);
    expect(duringRun[0]?.status).toBe('running');
    expect(duringRun[0]?.session_id).toBe('sess_test');
  });

  it('deregisters the sandbox afterwards', async () => {
    await withSandbox(provider, opts(), async () => undefined);
    expect(hasRecords(projectDir)).toBe(false);
  });

  it('records the provider-reported expiry, not a local guess', async () => {
    let recorded = 0;
    let reported = 0;

    await withSandbox(provider, opts(), async (handle) => {
      reported = handle.expiresAt.getTime();
      recorded = new Date(readRegistry(projectDir)[0]?.expires_at ?? 0).getTime();
    });

    // Equal to the second — the row must carry the handle's value verbatim.
    expect(Math.abs(recorded - reported)).toBeLessThan(1000);
  });
});

// =============================================================================
// THE PROVISIONING WINDOW — a crash during create must stay recoverable
// =============================================================================

describe('registry reservation', () => {
  it('records the sandbox BEFORE the provider is asked to create it', async () => {
    // The window this closes is VM boot + git clone, the longest in the flow.
    let rowsAtProvisionTime: ReturnType<typeof readRegistry> = [];
    const spy = new FakeProvider();
    const original = spy.provision.bind(spy);
    spy.provision = async (o) => {
      rowsAtProvisionTime = readRegistry(projectDir);
      return original(o);
    };

    await launch(spy, opts());

    expect(rowsAtProvisionTime).toHaveLength(1);
    expect(rowsAtProvisionTime[0]?.status).toBe('provisioning');
  });

  it('reserves under the caller-visible name so the row is reattachable', async () => {
    const handle = await launch(provider, opts({ name: 'adw-fixed-name' }));
    expect(handle.id).toBe('adw-fixed-name');
    expect(readRegistry(projectDir).map((r) => r.sandbox_id)).toEqual(['adw-fixed-name']);
  });

  it('refuses to provision at all when the registry cannot be written', async () => {
    // Provisioning something the registry does not know about creates an orphan
    // nothing can ever find. Refusing is strictly better.
    const lockDir = holdRegistryLock();
    try {
      await expect(launch(provider, opts())).rejects.toBeInstanceOf(RegistryUnavailableError);
      expect(provider.liveIds()).toEqual([]);
    } finally {
      fs.rmSync(lockDir, { recursive: true, force: true });
    }
  });

  it('leaves the reservation behind when provisioning fails, so it can be reaped', async () => {
    provider.failAt('provision');

    await expect(launch(provider, opts())).rejects.toThrow(/injected failure at provision/);

    const rows = readRegistry(projectDir);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('provisioning');
  });
});

// =============================================================================
// TEARDOWN IS TWO OPERATIONS
// =============================================================================

describe('teardown', () => {
  it('calls BOTH stop and destroy, in that order', async () => {
    // Asserted on the ordered call log rather than on a `stopped` flag: an
    // earlier fake set `stopped` inside destroy(), so this test passed with the
    // entire stop() call deleted — the exact cost regression it exists to catch.
    const handle = await launch(provider, opts());

    await teardown(provider, handle, projectDir);

    expect(provider.callsFor(handle.id)).toEqual(['provision', 'stop', 'destroy']);
  });

  it('still destroys when stop fails', async () => {
    provider.failAt('stop');
    const handle = await launch(provider, opts());

    const result = await teardown(provider, handle, projectDir);

    expect(result.destroyed).toBe(true);
    expect(provider.callsFor(handle.id)).toContain('destroy');
    expect(provider.liveIds()).toEqual([]);
  });

  it('reports destroyed and deregistered separately', async () => {
    const handle = await launch(provider, opts());

    await expect(teardown(provider, handle, projectDir)).resolves.toEqual({
      destroyed: true,
      deregistered: true,
    });
  });

  it('reports destroyed-but-not-deregistered rather than plain success', async () => {
    // A destroyed sandbox whose row survives is a real state that must not be
    // reported as success — the row would never clear.
    const handle = await launch(provider, opts());
    const lockDir = holdRegistryLock();
    try {
      await expect(teardown(provider, handle, projectDir)).resolves.toEqual({
        destroyed: true,
        deregistered: false,
      });
    } finally {
      fs.rmSync(lockDir, { recursive: true, force: true });
    }
  });

  it('treats an already-gone sandbox as destroyed', async () => {
    const handle = await launch(provider, opts());
    await teardown(provider, handle, projectDir);

    await expect(teardown(provider, handle, projectDir)).resolves.toEqual({
      destroyed: true,
      deregistered: true,
    });
  });

  it('keeps the row when the provider is unreachable', async () => {
    const handle = await launch(provider, opts());
    provider.failAt('destroy');

    await expect(teardown(provider, handle, projectDir)).resolves.toEqual({
      destroyed: false,
      deregistered: false,
    });
    expect(readRegistry(projectDir).map((r) => r.sandbox_id)).toEqual([handle.id]);
  });
});

// =============================================================================
// FAILURE HANDLING
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
});

// =============================================================================
// NAMING
// =============================================================================

describe('generateSandboxName', () => {
  it('does not collide across rapid successive calls', async () => {
    // A timestamp + per-instance counter collides across processes started in
    // the same millisecond, and the registry upserts by id — so a collision
    // silently deletes the other sandbox's only record.
    const names = new Set(Array.from({ length: 500 }, () => generateSandboxName()));
    expect(names.size).toBe(500);
  });

  it('honours the prefix', () => {
    expect(generateSandboxName('pilot').startsWith('pilot-')).toBe(true);
  });
});
