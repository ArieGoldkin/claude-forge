/**
 * Tests for the sandbox registry (T2 / issue #45).
 *
 * The registry is the ONLY thing ctk's zero-dependency hooks know about
 * sandboxes. It must never throw into a hook, and `hasRecords` must be cheap
 * and false for the overwhelmingly common case: an installer who has never
 * provisioned anything.
 *
 * @module tests/lib/sandbox-registry
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addRecord,
  clearRegistry,
  hasRecords,
  readRegistry,
  registryPath,
  removeRecord,
} from '../../src/lib/sandbox/registry.js';
import type { SandboxRecord } from '../../src/lib/sandbox/types.js';

// =============================================================================
// HELPERS
// =============================================================================

let projectDir: string;

function record(overrides: Partial<SandboxRecord> = {}): SandboxRecord {
  return {
    sandbox_id: 'sbx_1',
    provider: 'fake',
    created_at: '2026-07-25T12:00:00Z',
    expires_at: '2026-07-25T12:45:00Z',
    session_id: 'sess_1',
    status: 'running',
    ...overrides,
  };
}

/** Write raw bytes to the registry path, bypassing the API. */
function writeRaw(contents: string): void {
  const p = registryPath(projectDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, contents);
}

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbx-registry-'));
});

afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

// =============================================================================
// PATH
// =============================================================================

describe('registryPath', () => {
  it('resolves under the continuity directory', () => {
    expect(registryPath(projectDir)).toBe(
      path.join(projectDir, '.claude/continuity/sandboxes.json')
    );
  });
});

// =============================================================================
// READ — must never throw into a hook
// =============================================================================

describe('readRegistry', () => {
  it('returns an empty array when the file does not exist', () => {
    expect(readRegistry(projectDir)).toEqual([]);
  });

  it('returns an empty array on corrupt JSON without throwing', () => {
    writeRaw('{ not json at all');
    expect(() => readRegistry(projectDir)).not.toThrow();
    expect(readRegistry(projectDir)).toEqual([]);
  });

  it('returns an empty array when the JSON is not an array', () => {
    writeRaw('{"sandbox_id":"sbx_1"}');
    expect(readRegistry(projectDir)).toEqual([]);
  });

  it('drops entries that are not shaped like a record', () => {
    writeRaw(JSON.stringify([record(), null, 'nope', { no_id: true }]));
    const out = readRegistry(projectDir);
    expect(out).toHaveLength(1);
    expect(out[0]?.sandbox_id).toBe('sbx_1');
  });
});

// =============================================================================
// WRITE
// =============================================================================

describe('addRecord', () => {
  it('creates the continuity directory and round-trips a record', async () => {
    await addRecord(projectDir, record());
    expect(readRegistry(projectDir)).toEqual([record()]);
  });

  it('appends without losing existing records', async () => {
    await addRecord(projectDir, record({ sandbox_id: 'sbx_1' }));
    await addRecord(projectDir, record({ sandbox_id: 'sbx_2' }));
    expect(readRegistry(projectDir).map((r) => r.sandbox_id)).toEqual(['sbx_1', 'sbx_2']);
  });

  it('upserts rather than duplicating the same sandbox_id', async () => {
    await addRecord(projectDir, record({ sandbox_id: 'sbx_1', status: 'provisioning' }));
    await addRecord(projectDir, record({ sandbox_id: 'sbx_1', status: 'running' }));
    const out = readRegistry(projectDir);
    expect(out).toHaveLength(1);
    expect(out[0]?.status).toBe('running');
  });

  it('leaves no .tmp file behind (atomic temp+rename)', async () => {
    await addRecord(projectDir, record());
    const dir = path.dirname(registryPath(projectDir));
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('does not lose records under concurrent writes', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    await Promise.all(ids.map((id) => addRecord(projectDir, record({ sandbox_id: id }))));
    expect(readRegistry(projectDir).map((r) => r.sandbox_id).sort()).toEqual(ids);
  });
});

describe('removeRecord', () => {
  it('removes only the named record', async () => {
    await addRecord(projectDir, record({ sandbox_id: 'sbx_1' }));
    await addRecord(projectDir, record({ sandbox_id: 'sbx_2' }));
    await removeRecord(projectDir, 'sbx_1');
    expect(readRegistry(projectDir).map((r) => r.sandbox_id)).toEqual(['sbx_2']);
  });

  it('is a no-op for an unknown id', async () => {
    await addRecord(projectDir, record({ sandbox_id: 'sbx_1' }));
    await expect(removeRecord(projectDir, 'nope')).resolves.toBe(true);
    expect(readRegistry(projectDir)).toHaveLength(1);
  });

  it('is a no-op when the registry does not exist', async () => {
    await expect(removeRecord(projectDir, 'sbx_1')).resolves.toBe(true);
  });
});

describe('clearRegistry', () => {
  it('empties the registry', async () => {
    await addRecord(projectDir, record());
    await clearRegistry(projectDir);
    expect(readRegistry(projectDir)).toEqual([]);
  });
});

// =============================================================================
// hasRecords — the hook's inertness gate. Must be cheap and must be false
// for an installer who has never provisioned a sandbox.
// =============================================================================

describe('hasRecords', () => {
  it('is false when the registry file does not exist', () => {
    expect(hasRecords(projectDir)).toBe(false);
  });

  it('does not create the registry file merely by asking', () => {
    hasRecords(projectDir);
    expect(fs.existsSync(registryPath(projectDir))).toBe(false);
  });

  it('is false for an empty registry', async () => {
    await addRecord(projectDir, record());
    await clearRegistry(projectDir);
    expect(hasRecords(projectDir)).toBe(false);
  });

  it('is false for corrupt JSON rather than throwing', () => {
    writeRaw('{ not json');
    expect(hasRecords(projectDir)).toBe(false);
  });

  it('is true when a record exists', async () => {
    await addRecord(projectDir, record());
    expect(hasRecords(projectDir)).toBe(true);
  });
});
