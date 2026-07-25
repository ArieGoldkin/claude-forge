/**
 * Reaper tests (T2 / issue #45).
 *
 * The reaper's input is always the same thing: a registry row whose owning
 * process died before it could clean up. These tests construct that state
 * directly rather than simulating a crash, because the crash is exactly what
 * R1 showed we cannot rely on observing.
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

function opts() {
  return { projectDir, sessionId: 'sess_test', timeoutMs: TIMEOUT_MS };
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
    expect(result).toEqual({ reaped: [], expired: [], failed: [], unknownProvider: [] });
  });

  it('destroys and deregisters an orphaned sandbox', async () => {
    // A sandbox launched but never torn down — the R1 failure mode.
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

  it('retains the row when the provider is unreachable, so a later run retries', async () => {
    const handle = await launch(provider, opts());
    provider.failAt('destroy');

    const result = await reap({ projectDir, providers });

    expect(result.failed).toEqual([handle.id]);
    expect(readRegistry(projectDir).map((r) => r.sandbox_id)).toEqual([handle.id]);
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

  it('treats an already-gone sandbox as reaped — that IS the desired end state', async () => {
    await addRecord(projectDir, {
      sandbox_id: 'sbx_ghost',
      provider: 'fake',
      created_at: '2026-07-25T10:00:00Z',
      expires_at: '2026-07-25T23:00:00Z',
      session_id: 'sess_old',
      status: 'running',
    });

    const result = await reap({ projectDir, providers });

    expect(result.reaped).toEqual(['sbx_ghost']);
    expect(hasRecords(projectDir)).toBe(false);
  });

  it('drops an expired row even when destroy fails — the provider already terminated it', async () => {
    // Without this, expired rows accumulate forever and every future reap
    // retries corpses. The sandbox must be one the fake knows, so destroy fails
    // for the INJECTED reason rather than not-found.
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

    const result = await reap({
      projectDir,
      providers,
      now: new Date('2026-07-25T12:00:00Z'),
    });

    expect(result.expired).toEqual([handle.id]);
    expect(hasRecords(projectDir)).toBe(false);
  });

  it('does NOT drop an unexpired row that failed to destroy', async () => {
    const handle = await launch(provider, opts());
    await addRecord(projectDir, {
      sandbox_id: handle.id,
      provider: 'fake',
      created_at: '2026-07-25T10:00:00Z',
      expires_at: '2026-07-25T23:00:00Z',
      session_id: 'sess_old',
      status: 'running',
    });
    provider.failAt('destroy');

    const result = await reap({
      projectDir,
      providers,
      now: new Date('2026-07-25T12:00:00Z'),
    });

    expect(result.failed).toEqual([handle.id]);
    expect(hasRecords(projectDir)).toBe(true);
  });

  it('leaves rows for a provider it has no implementation for', async () => {
    await addRecord(projectDir, {
      sandbox_id: 'sbx_vercel',
      provider: 'vercel',
      created_at: '2026-07-25T10:00:00Z',
      expires_at: '2026-07-25T23:00:00Z',
      session_id: 'sess_old',
      status: 'running',
    });

    const result = await reap({ projectDir, providers });

    expect(result.unknownProvider).toEqual(['sbx_vercel']);
    expect(hasRecords(projectDir)).toBe(true);
  });
});
