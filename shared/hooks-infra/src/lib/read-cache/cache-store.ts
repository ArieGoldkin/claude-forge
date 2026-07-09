/**
 * Per-session JSONL cache store for the delta cache.
 *
 * Each session's reads are persisted as one JSON record per line under
 * `<cache-root>/<sanitized-session-id>/reads.jsonl`, where `<cache-root>`
 * defaults to `~/.claude/cache/token-compress` and is overridable via
 * the `TOKEN_COMPRESS_CACHE_DIR` env var (used by tests to isolate state).
 *
 * Key design choices:
 *
 * - **Append-only JSONL** rather than a full-rewrite JSON blob — keeps
 *   write latency O(1) under the lock and survives partial writes
 *   (a torn line is just one bad record, not corrupted state).
 * - **Locked appends** via the shared `acquireLock`/`releaseLock`
 *   helper. Two hook invocations writing concurrently would otherwise
 *   interleave bytes mid-line.
 * - **Most-recent-wins reads** — `readEntry` returns the *last* matching
 *   line for a given absolute path, so the cache's effective state is
 *   always the latest successful append.
 * - **Mode 0o700** on the session directory — read records contain full
 *   file content and must not be world-readable on shared hosts.
 *
 * @module lib/read-cache/cache-store
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { acquireLock, releaseLock } from '../lock.js';
import { logWarn } from '../logging.js';
import { CREDENTIAL_PATTERNS, ENV_PATTERNS, SSH_PATTERNS } from '../path-utils.js';
import type { CachedRead } from './types.js';

/**
 * Secret-bearing file patterns whose *content* must never be persisted to the
 * on-disk cache. Reuses the security layer's env/ssh/credential definitions
 * (filename-based, so they match anywhere — unlike the system-dir patterns,
 * which would also flag harmless temp files under `/var`). Defense-in-depth:
 * the security-blocker already denies Write/Edit to most of these at
 * PreToolUse, but the cache is the one place that copies full file bodies to
 * `~/.claude/cache`, so it filters independently.
 */
const SECRET_BEARING_PATTERNS: readonly RegExp[] = [
  ...ENV_PATTERNS,
  ...SSH_PATTERNS,
  ...CREDENTIAL_PATTERNS,
];

/** True if the path looks like a secret-bearing file (env / ssh key / credential). */
function isSecretBearingPath(absPath: string): boolean {
  return SECRET_BEARING_PATTERNS.some((pattern) => pattern.test(absPath));
}

/** Default eviction threshold for old session directories: 48 hours. */
const DEFAULT_MAX_AGE_MS = 48 * 60 * 60 * 1000;

/**
 * Resolve the cache root directory.
 *
 * Pure function — no I/O, safe to call repeatedly. Honors
 * `TOKEN_COMPRESS_CACHE_DIR` so tests can isolate per-suite state.
 */
export function getCacheRoot(): string {
  const override = process.env['TOKEN_COMPRESS_CACHE_DIR'];
  if (override && override.length > 0) {
    return override;
  }
  return path.join(os.homedir(), '.claude', 'cache', 'token-compress');
}

/**
 * Sanitize a session ID for safe use as a directory name.
 *
 * Replaces any character outside `[A-Za-z0-9_-]` with `_`. This neutralizes
 * path-traversal attempts (`..`, `/`) and shell-meaningful characters
 * (`$`, backticks, etc.) without any context-dependent escaping rules.
 */
function sanitizeSessionId(sessionId: string): string {
  return sessionId.replace(/[^A-Za-z0-9_-]/g, '_');
}

/**
 * Resolve the current session ID from env vars.
 * Prefers CLAUDE_CODE_SESSION_ID (CC v2.1.132+); falls back to CLAUDE_SESSION_ID.
 * Returns undefined when neither is set.
 *
 * Extracted as a tiny helper so callers don't carry the `||` chain inline
 * (which costs cognitive-complexity points).
 */
function currentSessionIdFromEnv(): string | undefined {
  return process.env['CLAUDE_CODE_SESSION_ID'] || process.env['CLAUDE_SESSION_ID'];
}

/**
 * Get the per-session directory path under the cache root.
 *
 * Pure — does not create the directory. Use {@link ensureSessionDir}
 * before any write that depends on existence.
 */
export function getSessionDir(sessionId: string): string {
  return path.join(getCacheRoot(), sanitizeSessionId(sessionId));
}

/** Get the absolute path of the JSONL reads file for a session. */
export function getReadsPath(sessionId: string): string {
  return path.join(getSessionDir(sessionId), 'reads.jsonl');
}

/**
 * Ensure the per-session cache directory exists.
 *
 * Idempotent — safe to call on every read. Sets mode 0o700 on creation
 * (best-effort on platforms where chmod has limited semantics, e.g. some
 * Windows filesystems; `mkdirSync` honors the mode argument on POSIX).
 */
export function ensureSessionDir(sessionId: string): void {
  const dir = getSessionDir(sessionId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    return;
  }
  // Directory may have been created with a different umask in a previous
  // run. Reapply 0o700 to keep the invariant.
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // Non-POSIX filesystems may reject — not worth failing the hook over.
  }
}

/**
 * Compute SHA-256 hex digest of a string (UTF-8 encoded).
 *
 * Lives here rather than in a separate `hash.ts` because the cache is
 * the only consumer; co-locating keeps the import graph flat.
 */
export function computeContentHash(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Parse a single JSONL line into a `CachedRead`, or `null` if malformed.
 *
 * We only require that the parsed value is an object with a string
 * `absPath`. Anything else is skipped with a warning — a torn write or a
 * future schema bump shouldn't crash the hook.
 */
function parseEntryLine(line: string): CachedRead | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'absPath' in parsed &&
      typeof (parsed as { absPath: unknown }).absPath === 'string'
    ) {
      return parsed as CachedRead;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Read the most recent cached entry for an absolute path in a session.
 *
 * Scans the JSONL file once, retaining only the last record whose
 * `absPath` matches. Returns `null` if the file is missing, the path
 * was never read, or every matching line is malformed.
 *
 * Malformed lines are logged at WARN level (so an operator can spot a
 * corrupt cache during incident review) but never throw.
 */
export async function readEntry(sessionId: string, absPath: string): Promise<CachedRead | null> {
  const readsPath = getReadsPath(sessionId);
  if (!fs.existsSync(readsPath)) {
    return null;
  }

  let raw: string;
  try {
    raw = fs.readFileSync(readsPath, 'utf8');
  } catch {
    return null;
  }

  const lines = raw.split('\n');
  let latest: CachedRead | null = null;
  let sawMalformed = false;

  for (const line of lines) {
    if (line.length === 0) continue;
    const entry = parseEntryLine(line);
    if (entry === null) {
      sawMalformed = true;
      continue;
    }
    if (entry.absPath === absPath) {
      latest = entry;
    }
  }

  if (sawMalformed) {
    logWarn(
      'read-cache.cache-store',
      `Skipped malformed line(s) in reads.jsonl (sessionId=${sessionId} path=${readsPath})`
    );
  }

  return latest;
}

/**
 * Append a cache entry to the per-session JSONL file.
 *
 * Acquires a per-session mkdir lock so concurrent hook invocations from
 * the same Claude session don't interleave bytes mid-record. The lock
 * lives next to the JSONL file (`reads.jsonl.lock`) so it is naturally
 * scoped to the session and cleaned up when the session dir is evicted.
 */
export async function writeEntry(sessionId: string, entry: CachedRead): Promise<void> {
  ensureSessionDir(sessionId);
  const readsPath = getReadsPath(sessionId);
  const lockPath = `${readsPath}.lock`;

  const acquired = await acquireLock(lockPath);
  if (!acquired) {
    logWarn(
      'read-cache.cache-store',
      `Failed to acquire cache write lock (sessionId=${sessionId} path=${readsPath})`
    );
    return;
  }
  try {
    const line = `${JSON.stringify(entry)}\n`;
    fs.appendFileSync(readsPath, line, { encoding: 'utf8', mode: 0o600 });
  } finally {
    releaseLock(lockPath);
  }
}

/**
 * Snapshot a file's current on-disk content into the per-session cache.
 *
 * Stats the file, reads its bytes, and appends a fresh {@link CachedRead}
 * entry whose hash/size/content reflect the file *as it exists right now*.
 * Because the store is most-recent-wins, this becomes the new base that a
 * subsequent `Read` diffs against.
 *
 * Shared by two callers:
 * - the PostToolUse `Read` writer — records the file after Claude reads it;
 * - the PostToolUse `Write|Edit|MultiEdit` invalidator — refreshes the base
 *   after a mutation so the next `Read` hash-matches and proceeds as a full
 *   read instead of being intercepted with a diff against a now-stale base
 *   (the cause of the post-edit Read/Edit deadlock).
 *
 * Best-effort: returns the byte size persisted on success, or `null` if the
 * path is not a regular file, looks secret-bearing (see
 * {@link isSecretBearingPath}), or any stat/read/write step fails. Never
 * throws — a failed cache refresh must not break the user's tool call.
 */
export async function snapshotFileToCache(
  sessionId: string,
  absPath: string
): Promise<number | null> {
  // Defense-in-depth: never copy a secret-bearing file's body into the cache,
  // regardless of which tool triggered the snapshot (read writer, edit
  // invalidator, or pretool advance-on-serve).
  if (isSecretBearingPath(absPath)) {
    return null;
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(absPath);
  } catch {
    return null;
  }
  if (!stat.isFile()) {
    return null;
  }

  let content: string;
  try {
    content = fs.readFileSync(absPath, 'utf8');
  } catch {
    return null;
  }

  const entry: CachedRead = {
    absPath,
    contentHash: computeContentHash(content),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    cachedContent: content,
    recordedAt: new Date().toISOString(),
    schemaVersion: 1,
  };

  try {
    ensureSessionDir(sessionId);
    await writeEntry(sessionId, entry);
  } catch {
    return null;
  }

  return stat.size;
}

/** Best-effort recursive size calculation for a directory tree. */
function dirSizeBytes(dir: string): number {
  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    try {
      if (entry.isDirectory()) {
        total += dirSizeBytes(full);
      } else if (entry.isFile()) {
        total += fs.statSync(full).size;
      }
    } catch {
      // Best-effort — skip unreadable entries.
    }
  }
  return total;
}

/**
 * Sum on-disk size of every file under a session's cache directory.
 *
 * Used by the 50 MB per-session cap (enforced by callers, not here).
 * Returns 0 if the directory is missing.
 */
export async function getSessionSizeBytes(sessionId: string): Promise<number> {
  const dir = getSessionDir(sessionId);
  if (!fs.existsSync(dir)) {
    return 0;
  }
  return dirSizeBytes(dir);
}

/**
 * Delete session directories whose mtime is older than `maxAgeMs`.
 *
 * Skips the *current* session if `CLAUDE_CODE_SESSION_ID` (CC v2.1.132+)
 * or `CLAUDE_SESSION_ID` (older runtimes) is set — we don't want a
 * long-running session to evict its own cache. Returns the number of
 * directories removed and the bytes reclaimed.
 *
 * Failures (permission denied, race with another evictor) are absorbed
 * silently; eviction is opportunistic, never load-bearing.
 */
export async function evictOldSessions(
  maxAgeMs: number = DEFAULT_MAX_AGE_MS
): Promise<{ evictedCount: number; freedBytes: number }> {
  const root = getCacheRoot();
  if (!fs.existsSync(root)) {
    return { evictedCount: 0, freedBytes: 0 };
  }

  const currentSessionId = currentSessionIdFromEnv();
  const currentSanitized = currentSessionId ? sanitizeSessionId(currentSessionId) : null;

  const now = Date.now();
  let evictedCount = 0;
  let freedBytes = 0;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return { evictedCount, freedBytes };
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (currentSanitized !== null && entry.name === currentSanitized) continue;

    const sessionDir = path.join(root, entry.name);
    let mtimeMs: number;
    try {
      mtimeMs = fs.statSync(sessionDir).mtimeMs;
    } catch {
      continue;
    }

    if (now - mtimeMs <= maxAgeMs) continue;

    const sizeBefore = dirSizeBytes(sessionDir);
    try {
      fs.rmSync(sessionDir, { recursive: true, force: true });
      evictedCount++;
      freedBytes += sizeBefore;
    } catch {
      // Skip this dir; another evictor may have raced us.
    }
  }

  return { evictedCount, freedBytes };
}
