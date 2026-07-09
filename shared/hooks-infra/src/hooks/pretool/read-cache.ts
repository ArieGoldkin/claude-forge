/**
 * PreToolUse Read Hook — delta-cache redundant-read interceptor.
 *
 * When Claude re-reads a file it already pulled into context this session,
 * we intercept the call, compute a unified diff against the cached copy,
 * and inject the diff via `additionalContext` while denying the original
 * `Read` call. The deny is a *substitution*, not a refusal — Claude sees
 * the diff and proceeds without paying for the full file body again.
 *
 * Fast paths and bail-outs (in order):
 *
 * 1. Wrong tool / missing path / missing session → silent success.
 * 2. File no longer exists or isn't a regular file → silent success.
 * 3. Cache miss (first read this session) → silent success.
 * 4. Hash matches cached → silent success (covers both unchanged-content
 *    and `touch`/`git-restore` cases). We always read+hash rather than
 *    trusting mtime+size, because filesystem mtime resolution differs
 *    across platforms (Linux ext4 vs macOS APFS) and a same-size in-place
 *    edit within one mtime tick can otherwise slip through undetected.
 * 5. Diff exceeds line/char budgets → silent success (caller falls through
 *    to the standard Read flow and re-pulls the full file).
 * 6. Otherwise → deny with diff in `additionalContext`.
 *
 * Every error path absorbs to silent success: the cache is opportunistic,
 * never load-bearing. A malformed cache, an I/O failure, or a permission
 * error must not break the user's `Read` call.
 *
 * @module pretool/read-cache
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { recordReadEvent } from '../lib/bash-compress/index.js';
import { guardTool, runGuards } from '../lib/guards.js';
import { getFilePath, getSessionId } from '../lib/input.js';
import { logDebug, logInfo, logWarn } from '../lib/logging.js';
import { outputSilentSuccess } from '../lib/output.js';
import {
  type CachedRead,
  computeContentHash,
  computeDelta,
  readEntry,
  snapshotFileToCache,
} from '../lib/read-cache/index.js';
import type { HookInput, HookResult } from '../types.js';

const HOOK_NAME = 'read-cache';

/**
 * PreToolUse Read hook — intercepts redundant reads.
 *
 * Returns silent success on every fast-path and every error path. The only
 * time it returns a non-silent result is when (a) we have a cached copy,
 * (b) the file changed, and (c) the diff fits the budgets.
 */
export async function readCacheHook(input: HookInput): Promise<HookResult> {
  const skipped = runGuards(input, (i) => guardTool(i, 'Read'));
  if (skipped) return skipped;

  const filePath = getFilePath(input);
  const sessionId = getSessionId(input);
  if (!filePath || !sessionId || sessionId === 'unknown') {
    return outputSilentSuccess();
  }

  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    return outputSilentSuccess();
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(absPath);
  } catch (e) {
    logDebug(HOOK_NAME, `stat failed for ${absPath}: ${e}`);
    return outputSilentSuccess();
  }
  if (!stat.isFile()) {
    return outputSilentSuccess();
  }

  let cached: CachedRead | null;
  try {
    cached = await readEntry(sessionId, absPath);
  } catch (e) {
    logWarn(HOOK_NAME, `cache lookup failed: ${e}`);
    return outputSilentSuccess();
  }
  if (!cached) {
    // First read of this file this session — let it proceed normally.
    return outputSilentSuccess();
  }

  // Read + hash to determine whether content actually changed.
  // We deliberately do NOT short-circuit on mtime+size match: filesystem
  // mtime resolution differs across platforms and same-size in-place edits
  // within one mtime tick (common in CI) would otherwise slip through.
  let currentContent: string;
  try {
    currentContent = fs.readFileSync(absPath, 'utf8');
  } catch (e) {
    logWarn(HOOK_NAME, `read failed for ${absPath}: ${e}`);
    return outputSilentSuccess();
  }

  const currentHash = computeContentHash(currentContent);
  if (currentHash === cached.contentHash) {
    logDebug(HOOK_NAME, `unchanged via hash check: ${absPath}`);
    return outputSilentSuccess();
  }

  const delta = computeDelta(cached.cachedContent, currentContent);
  if (delta.kind !== 'delta') {
    if (delta.kind === 'too-large') {
      logInfo(
        HOOK_NAME,
        `delta exceeds ${delta.reason} budget for ${absPath}; falling through to full read`
      );
    }
    return outputSilentSuccess();
  }

  const savedChars = Math.max(0, cached.cachedContent.length - delta.diff.length);
  logInfo(HOOK_NAME, `injecting delta for ${absPath} (saved ~${savedChars} chars)`);

  // Spike A measurement: record the cache hit with the actual byte savings.
  // Best-effort — the recorder swallows failures, but we still wrap to be sure
  // a measurement bug can never break the user's Read flow.
  try {
    recordReadEvent(
      sessionId,
      absPath,
      'cache_hit',
      cached.cachedContent.length,
      delta.diff.length
    );
  } catch (e) {
    logDebug(HOOK_NAME, `measurement record failed: ${e}`);
  }

  // Advance the cache base to the current content before denying. Because the
  // deny substitutes a diff for the Read, the Read never executes — so it can't
  // satisfy the harness read-before-edit gate. By advancing the base here, the
  // *next* Read of this path hash-matches and proceeds as a full read, which
  // both satisfies the gate and self-heals out-of-band changes (e.g. a git
  // branch switch) that this hook can't otherwise observe. Best-effort: this
  // re-reads the file (already warm in the OS page cache) and never throws.
  await snapshotFileToCache(sessionId, absPath);

  const message = [
    `[delta-cache] File ${absPath} was previously read this session.`,
    'Showing unified diff against the cached version. If you need the full file, re-issue the Read explicitly or modify it; large changes auto-fall-through to a full read.',
    '',
    delta.diff,
  ].join('\n');

  return {
    continue: true,
    suppressOutput: false,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason:
        'Delta-cache: redundant Read intercepted; unified diff supplied via additionalContext.',
      additionalContext: message,
    },
  };
}

export default readCacheHook;
