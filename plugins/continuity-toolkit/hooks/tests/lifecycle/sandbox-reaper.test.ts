/**
 * Tests for the sandbox-reaper hook (T2 / issue #45).
 *
 * This hook runs on SessionEnd for EVERY ctk installer, so the assertions that
 * matter most are the negative ones: that a user who has never provisioned a
 * sandbox gets zero filesystem writes and zero subprocess spawns.
 *
 * ADR-0001 §3 makes that a hard requirement — sandboxed-ADW dispatch is
 * maintainer tooling, and this plugin ships to people who hold no cloud account
 * and want none. The hook is deliberately incapable of CREATING a sandbox; the
 * worst a bug here can do is fail to clean one up.
 *
 * @module tests/lifecycle/sandbox-reaper
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.hoisted(() => vi.fn(() => ({ unref: vi.fn() })));
vi.mock('node:child_process', () => ({ spawn: spawnMock }));

import { addRecord, registryPath } from '../../src/lib/sandbox/registry.js';
import { sandboxReaper } from '../../src/lifecycle/sandbox-reaper.js';
import type { HookInput } from '../../src/types.js';

let projectDir: string;
let originalProjectDir: string | undefined;

function input(): HookInput {
  return {
    tool_name: '',
    tool_input: {},
    session_id: 'sess_test',
    source: 'clear',
  } as HookInput;
}

/** Create the launcher's on-disk footprint so gate 2 passes. */
function createLauncher(): void {
  const bin = path.join(projectDir, 'tools/sandbox-launcher/node_modules/.bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'tsx'), '#!/bin/sh\n');
  fs.mkdirSync(path.join(projectDir, 'tools/sandbox-launcher/src'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'tools/sandbox-launcher/src/reap.ts'), '');
}

async function seedRegistry(): Promise<void> {
  await addRecord(projectDir, {
    sandbox_id: 'sbx_orphan',
    provider: 'vercel',
    created_at: '2026-07-25T10:00:00Z',
    expires_at: '2026-07-25T23:00:00Z',
    session_id: 'sess_old',
    status: 'running',
  });
}

/** Every path under the project, for asserting the hook wrote nothing. */
function snapshotTree(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      out.push(full);
      if (entry.isDirectory()) {
        walk(full);
      }
    }
  };
  walk(projectDir);
  return out.sort();
}

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbx-reaper-'));
  originalProjectDir = process.env['CLAUDE_PROJECT_DIR'];
  process.env['CLAUDE_PROJECT_DIR'] = projectDir;
  spawnMock.mockClear();
});

afterEach(() => {
  if (originalProjectDir === undefined) {
    delete process.env['CLAUDE_PROJECT_DIR'];
  } else {
    process.env['CLAUDE_PROJECT_DIR'] = originalProjectDir;
  }
  fs.rmSync(projectDir, { recursive: true, force: true });
});

// =============================================================================
// INERTNESS — the guarantee ADR-0001 §3 demands
// =============================================================================

describe('inertness for a normal installer', () => {
  // These install the launcher on purpose. Without it, gate 2 would block the
  // spawn regardless and the assertion would pass even with gate 1 deleted —
  // a test that proves nothing. Installing it makes gate 1 the only thing
  // standing between an empty registry and a subprocess.
  it('spawns nothing when no registry exists', async () => {
    createLauncher();

    await sandboxReaper(input());

    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('writes nothing when no registry exists', async () => {
    createLauncher();
    const before = snapshotTree();

    await sandboxReaper(input());

    expect(snapshotTree()).toEqual(before);
  });

  it('does not create the registry file merely by running', async () => {
    createLauncher();

    await sandboxReaper(input());

    expect(fs.existsSync(registryPath(projectDir))).toBe(false);
  });

  it('spawns nothing for an empty registry', async () => {
    fs.mkdirSync(path.dirname(registryPath(projectDir)), { recursive: true });
    fs.writeFileSync(registryPath(projectDir), '[]\n');
    createLauncher();

    await sandboxReaper(input());

    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('spawns nothing for a corrupt registry', async () => {
    fs.mkdirSync(path.dirname(registryPath(projectDir)), { recursive: true });
    fs.writeFileSync(registryPath(projectDir), '{ not json');
    createLauncher();

    await sandboxReaper(input());

    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('spawns nothing when records exist but the launcher is not installed', async () => {
    // The decisive case: an installer could only reach this state by hand-
    // editing a file into place. Even then, no subprocess runs.
    await seedRegistry();

    await sandboxReaper(input());

    expect(spawnMock).not.toHaveBeenCalled();
  });
});

// =============================================================================
// REAPING — only when a maintainer has genuinely set this up
// =============================================================================

describe('reaping', () => {
  it('spawns the reaper when records exist and the launcher is installed', async () => {
    await seedRegistry();
    createLauncher();

    await sandboxReaper(input());

    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it('spawns detached with stdio ignored so SessionEnd is never blocked', async () => {
    // SessionEnd allows 5 s (hooks.json); a reap needs network I/O. Awaiting it
    // would get the hook killed mid-cleanup.
    await seedRegistry();
    createLauncher();

    await sandboxReaper(input());

    const opts = spawnMock.mock.calls[0]?.[2] as Record<string, unknown> | undefined;
    expect(opts?.['detached']).toBe(true);
    expect(opts?.['stdio']).toBe('ignore');
  });

  it('unrefs the child so the parent can exit', async () => {
    const unref = vi.fn();
    spawnMock.mockReturnValueOnce({ unref } as never);
    await seedRegistry();
    createLauncher();

    await sandboxReaper(input());

    expect(unref).toHaveBeenCalledTimes(1);
  });

  it('passes the project directory to the reaper', async () => {
    await seedRegistry();
    createLauncher();

    await sandboxReaper(input());

    const args = spawnMock.mock.calls[0]?.[1] as string[] | undefined;
    expect(args?.some((a) => a.includes(projectDir))).toBe(true);
  });
});

// =============================================================================
// A SessionEnd HOOK MUST NEVER BLOCK
// =============================================================================

describe('resilience', () => {
  it('succeeds silently even when spawning throws', async () => {
    await seedRegistry();
    createLauncher();
    spawnMock.mockImplementationOnce(() => {
      throw new Error('EAGAIN');
    });

    const result = await sandboxReaper(input());

    expect(result.continue).toBe(true);
  });

  it('returns silent success on the inert path', async () => {
    const result = await sandboxReaper(input());
    expect(result.continue).toBe(true);
  });
});
