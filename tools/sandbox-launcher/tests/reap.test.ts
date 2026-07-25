/**
 * Reaper tests (T2 / issue #45).
 *
 * The reaper's input is always the same: a registry row whose owning process
 * died before it could clean up. These construct that state directly, because
 * the crash is exactly what R1 showed we cannot rely on observing.
 *
 * The central property under test is NEGATIVE — the reaper must never drop the
 * last record of a sandbox that might still be running. A review harness produced
 * exactly that outcome against the previous implementation.
 *
 * @module tests/reap
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addRecord,
  hasRecords,
  readRegistry,
} from '../../../shared/hooks-infra/src/lib/sandbox/registry.js';
import { launch } from '../src/launcher.js';
import type { SandboxProvider } from '../src/provider.js';
import { FakeProvider } from '../src/providers/fake.js';
import { reap } from '../src/reap.js';

let projectDir: string;
let provider: FakeProvider;
let providers: Map<string, SandboxProvider>;

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

/** Insert a row for a sandbox the fake has never heard of. */
async function orphanRow(id: string, overrides: Record<string, unknown> = {}): Promise<void> {
  await addRecord(projectDir, {
    sandbox_id: id,
    provider: 'fake',
    created_at: '2026-07-25T10:00:00Z',
    expires_at: '2026-07-25T10:45:00Z',
    session_id: 'sess_old',
    status: 'running',
    ...overrides,
  } as never);
}

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbx-reap-'));
  provider = new FakeProvider();
  providers = new Map<string, SandboxProvider>([['fake', provider]]);
});

afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

describe('reap', () => {
  it('is a no-op on an empty registry', async () => {
    const result = await reap({ projectDir, providers });
    expect(result.reaped).toEqual([]);
    expect(result.failed).toEqual([]);
  });

  it('destroys and deregisters an orphaned sandbox', async () => {
    const handle = await launch(provider, opts());
    expect(provider.liveIds()).toEqual([handle.id]);

    const result = await reap({ projectDir, providers });

    expect(result.reaped).toEqual([handle.id]);
    expect(provider.liveIds()).toEqual([]);
    expect(hasRecords(projectDir)).toBe(false);
  });

  it('reaps every orphan, not just the first', async () => {
    await launch(provider, opts());
    await launch(provider, opts());
    await launch(provider, opts());

    const result = await reap({ projectDir, providers });

    expect(result.reaped).toHaveLength(3);
    expect(provider.liveIds()).toEqual([]);
  });

  it('drops the row for a sandbox the provider confirms is gone', async () => {
    await orphanRow('sbx_ghost');

    const result = await reap({ projectDir, providers });

    expect(result.reaped).toEqual(['sbx_ghost']);
    expect(hasRecords(projectDir)).toBe(false);
  });
});

// =============================================================================
// THE NEGATIVE PROPERTY — never lose the record of something still alive
// =============================================================================

describe('never drops the record of a live sandbox', () => {
  it('KEEPS the row when destroy fails and the sandbox still exists', async () => {
    const handle = await launch(provider, opts());
    provider.failAt('destroy');

    const result = await reap({ projectDir, providers });

    expect(result.failed).toEqual([handle.id]);
    expect(provider.liveIds()).toEqual([handle.id]);
    expect(readRegistry(projectDir).map((r) => r.sandbox_id)).toEqual([handle.id]);
  });

  it('KEEPS the row for an EXPIRED sandbox that is still alive', async () => {
    // The regression that motivated this rewrite. `expires_at` bounds a session,
    // not the sandbox, and the value can be a stale local guess — so an elapsed
    // expiry is not evidence of absence. The previous implementation dropped the
    // row here, losing the only record of a live, billing sandbox.
    const handle = await launch(provider, opts());
    await addRecord(projectDir, {
      sandbox_id: handle.id,
      provider: 'fake',
      created_at: '2026-07-25T10:00:00Z',
      expires_at: '2026-07-25T10:45:00Z',
      session_id: 'sess_old',
      status: 'running',
    });
    provider.failAt('destroy');

    const result = await reap({ projectDir, providers });

    expect(result.failed).toEqual([handle.id]);
    expect(provider.liveIds()).toEqual([handle.id]);
    expect(hasRecords(projectDir)).toBe(true);
  });

  it('KEEPS the row when the provider is unreachable for the existence check', async () => {
    // Unreachable is not absent.
    const handle = await launch(provider, opts());
    provider.failAt('destroy');
    provider.failAt('exists');

    const result = await reap({ projectDir, providers });

    expect(result.failed).toEqual([handle.id]);
    expect(hasRecords(projectDir)).toBe(true);
  });

  it('recovers on a later run once the provider is reachable again', async () => {
    const handle = await launch(provider, opts());
    provider.failAt('destroy');
    await reap({ projectDir, providers });

    provider.clearFault('destroy');
    const result = await reap({ projectDir, providers });

    expect(result.reaped).toEqual([handle.id]);
    expect(hasRecords(projectDir)).toBe(false);
  });

  it('leaves rows for a provider it has no implementation for', async () => {
    await orphanRow('sbx_vercel', { provider: 'vercel' });

    const result = await reap({ projectDir, providers });

    expect(result.unknownProvider).toEqual(['sbx_vercel']);
    expect(hasRecords(projectDir)).toBe(true);
  });
});

// =============================================================================
// SESSION SCOPING — one session must not destroy another's sandbox
// =============================================================================

describe('session scoping', () => {
  it('reaps only the named session when one is given', async () => {
    const mine = await launch(provider, opts({ sessionId: 'sess_A' }));
    const theirs = await launch(provider, opts({ sessionId: 'sess_B' }));

    const result = await reap({ projectDir, providers, sessionId: 'sess_A' });

    expect(result.reaped).toEqual([mine.id]);
    expect(result.skipped).toEqual([theirs.id]);
    expect(provider.liveIds()).toEqual([theirs.id]);
    expect(readRegistry(projectDir).map((r) => r.sandbox_id)).toEqual([theirs.id]);
  });

  it('reaps everything when no session is given', async () => {
    await launch(provider, opts({ sessionId: 'sess_A' }));
    await launch(provider, opts({ sessionId: 'sess_B' }));

    const result = await reap({ projectDir, providers });

    expect(result.reaped).toHaveLength(2);
    expect(result.skipped).toEqual([]);
  });
});
