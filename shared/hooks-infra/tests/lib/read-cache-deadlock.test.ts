/**
 * Hook-level tests for the delta-cache Read/Edit deadlock fix.
 *
 * Reproduces the deadlock and asserts both halves of the fix:
 * - invalidate-on-edit: after a Write/Edit/MultiEdit, the cache base is
 *   refreshed so the next Read hash-matches and is NOT intercepted with a
 *   stale diff (which, as a denied Read, would never satisfy the harness
 *   read-before-edit gate);
 * - advance-base-on-serve: when the pretool hook DOES serve a diff for an
 *   out-of-band change (e.g. a git branch switch the invalidator can't see),
 *   it advances the base so a second consecutive Read self-heals.
 *
 * State is isolated per test via TOKEN_COMPRESS_CACHE_DIR; source files live
 * in a separate tempdir. See cache-store.test.ts for the isolation rationale.
 *
 * @module tests/lib/read-cache-deadlock
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readCacheHook } from '../../src/hooks/pretool/read-cache.js';
import { readCacheInvalidatorHook } from '../../src/hooks/posttool/read-cache-invalidator.js';
import { readCacheWriterHook } from '../../src/hooks/posttool/read-cache-writer.js';
import { readEntry } from '../../src/lib/read-cache/cache-store.js';
import type { HookInput, HookResult } from '../../src/types.js';

const SESSION = 'deadlock-test-session';

let tmpRoot: string;
let srcDir: string;
let originalCacheDir: string | undefined;
let originalSessionId: string | undefined;
let originalCodeSessionId: string | undefined;

function readInput(file: string): HookInput {
  return { tool_name: 'Read', tool_input: { file_path: file }, session_id: SESSION } as HookInput;
}

function editInput(file: string): HookInput {
  return { tool_name: 'Edit', tool_input: { file_path: file }, session_id: SESSION } as HookInput;
}

function isDeny(result: HookResult): boolean {
  return result.hookSpecificOutput?.permissionDecision === 'deny';
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deadlock-cache-'));
  srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deadlock-src-'));
  originalCacheDir = process.env['TOKEN_COMPRESS_CACHE_DIR'];
  originalSessionId = process.env['CLAUDE_SESSION_ID'];
  originalCodeSessionId = process.env['CLAUDE_CODE_SESSION_ID'];
  process.env['TOKEN_COMPRESS_CACHE_DIR'] = tmpRoot;
  // Inputs carry session_id explicitly; clear env ids so nothing else leaks in.
  delete process.env['CLAUDE_SESSION_ID'];
  delete process.env['CLAUDE_CODE_SESSION_ID'];
});

afterEach(() => {
  if (originalCacheDir === undefined) delete process.env['TOKEN_COMPRESS_CACHE_DIR'];
  else process.env['TOKEN_COMPRESS_CACHE_DIR'] = originalCacheDir;
  if (originalSessionId === undefined) delete process.env['CLAUDE_SESSION_ID'];
  else process.env['CLAUDE_SESSION_ID'] = originalSessionId;
  if (originalCodeSessionId === undefined) delete process.env['CLAUDE_CODE_SESSION_ID'];
  else process.env['CLAUDE_CODE_SESSION_ID'] = originalCodeSessionId;
  for (const dir of [tmpRoot, srcDir]) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
});

describe('delta-cache invalidate-on-edit', () => {
  it('does NOT intercept the next Read after an edit (refreshed base hash-matches)', async () => {
    const file = path.join(srcDir, 'a.ts');
    fs.writeFileSync(file, 'const a = 1;\n');
    await readCacheWriterHook(readInput(file)); // cache V1

    fs.writeFileSync(file, 'const a = 2;\n'); // edit → V2 on disk
    await readCacheInvalidatorHook(editInput(file)); // refresh cache base → V2

    const result = await readCacheHook(readInput(file));
    expect(isDeny(result)).toBe(false);
    expect(result.suppressOutput).toBe(true);
  });

  it('refreshes the cached content to the post-edit bytes', async () => {
    const file = path.join(srcDir, 'd.ts');
    fs.writeFileSync(file, 'old\n');
    await readCacheWriterHook(readInput(file));

    fs.writeFileSync(file, 'new content\n');
    await readCacheInvalidatorHook(editInput(file));

    const entry = await readEntry(SESSION, file);
    expect(entry?.cachedContent).toBe('new content\n');
  });

  it('ignores non-mutating tools (a Read does not trigger invalidation)', async () => {
    const file = path.join(srcDir, 'c.ts');
    fs.writeFileSync(file, 'v1\n');

    const result = await readCacheInvalidatorHook(readInput(file)); // wrong tool
    expect(result.suppressOutput).toBe(true);
    expect(await readEntry(SESSION, file)).toBeNull(); // nothing cached
  });

  it('does not cache secret-bearing files on edit (defense-in-depth)', async () => {
    const file = path.join(srcDir, '.env');
    fs.writeFileSync(file, 'placeholder file body\n');

    const result = await readCacheInvalidatorHook(editInput(file));
    expect(result.suppressOutput).toBe(true);
    expect(await readEntry(SESSION, file)).toBeNull(); // secret content never persisted
  });
});

describe('delta-cache advance-base-on-serve (out-of-band change self-heal)', () => {
  it('serves a diff once, then the next Read is a clean full read', async () => {
    const file = path.join(srcDir, 'b.ts');
    fs.writeFileSync(file, 'x = 1\n');
    await readCacheWriterHook(readInput(file)); // cache V1

    // Simulate an out-of-band change (e.g. git branch switch) — no invalidator.
    fs.writeFileSync(file, 'x = 2\n');

    const first = await readCacheHook(readInput(file));
    expect(isDeny(first)).toBe(true); // intercepted with a diff (V1 → V2)

    const second = await readCacheHook(readInput(file));
    expect(isDeny(second)).toBe(false); // base advanced → no longer intercepted
    expect(second.suppressOutput).toBe(true);
  });
});
