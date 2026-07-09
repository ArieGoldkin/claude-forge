/**
 * PostToolUse Write/Edit/MultiEdit Hook — delta-cache invalidator.
 *
 * After Claude mutates a file, the per-session delta cache still holds the
 * file's *pre-edit* bytes. The companion {@link readCacheHook} keys off that
 * stale base: a later `Read` of the just-edited file sees `cached != disk`,
 * computes a unified diff, and *denies* the `Read` (substituting the diff via
 * `additionalContext`). A denied `Read` never executes, so it cannot satisfy
 * the harness's read-before-edit gate — and the diff is computed against a
 * base that drifts further from reality with every successive edit. That is
 * the post-edit Read/Edit deadlock.
 *
 * This hook refreshes the cache base toward the *post-edit* on-disk content so
 * a subsequent `Read` hash-matches and proceeds as a full read instead of being
 * intercepted. It is wired `async`, so it is best-effort: it shrinks the window
 * but does not by itself guarantee ordering against an immediately following
 * `Read`. The actual guarantee that the deadlock cannot persist comes from the
 * synchronous advance-on-serve in {@link readCacheHook} — a served diff advances
 * the base, so a second `Read` always hash-matches even if this hook raced.
 *
 * Behaviour rules (mirrors {@link readCacheWriterHook}):
 *
 * - Passive: never blocks, never warns, only ever returns silent success.
 * - Skipped for non-mutating tools, missing file paths, and missing sessions.
 * - Secret-bearing files (env / ssh / credential) are never cached — the shared
 *   {@link snapshotFileToCache} filters them, so this hook no-ops for them too.
 * - Every failure path absorbs silently — a failed cache refresh must never
 *   break the user's edit.
 *
 * @module posttool/read-cache-invalidator
 */

import * as path from 'node:path';
import { guardTool, runGuards } from '../lib/guards.js';
import { getFilePath, getSessionId } from '../lib/input.js';
import { logDebug, logWarn } from '../lib/logging.js';
import { outputSilentSuccess } from '../lib/output.js';
import { snapshotFileToCache } from '../lib/read-cache/index.js';
import type { HookInput, HookResult } from '../types.js';

const HOOK_NAME = 'read-cache-invalidator';

/**
 * PostToolUse Write/Edit/MultiEdit hook — refreshes the cache entry for the
 * just-mutated file so the next Read is not intercepted with a stale diff.
 *
 * Always returns silent success: the mutation already completed by the time
 * PostToolUse fires, and we have nothing to surface.
 */
export async function readCacheInvalidatorHook(input: HookInput): Promise<HookResult> {
  try {
    const skipped = runGuards(input, (i) => guardTool(i, 'Write', 'Edit', 'MultiEdit'));
    if (skipped) return skipped;

    const filePath = getFilePath(input);
    const sessionId = getSessionId(input);
    if (!filePath || !sessionId || sessionId === 'unknown') {
      return outputSilentSuccess();
    }

    const absPath = path.resolve(filePath);
    const size = await snapshotFileToCache(sessionId, absPath);
    if (size === null) {
      logDebug(HOOK_NAME, `refresh skipped for ${absPath} (not a regular file or I/O error)`);
      return outputSilentSuccess();
    }

    logDebug(HOOK_NAME, `refreshed cache base for ${absPath} (${size} bytes) after mutation`);
    return outputSilentSuccess();
  } catch (e) {
    // Defensive top-level: cache refresh must never break the session.
    logWarn(HOOK_NAME, `unexpected error: ${e}`);
    return outputSilentSuccess();
  }
}

export default readCacheInvalidatorHook;
