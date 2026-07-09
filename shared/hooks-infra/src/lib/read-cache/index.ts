/**
 * Read cache - barrel exports.
 *
 * Re-exports the public surface of the delta-cache library:
 *
 * - `types.ts`         — persisted record shape and result envelope
 * - `cache-store.ts`   — per-session JSONL persistence and eviction
 * - `unified-diff.ts`  — pure diff renderer with budget gates
 *
 * Consumers should prefer importing from `lib/index.js` which re-exports
 * this module under a flat namespace.
 *
 * @module lib/read-cache
 */

export type { CachedRead, DeltaResult } from './types.js';
export {
  computeContentHash,
  ensureSessionDir,
  evictOldSessions,
  getCacheRoot,
  getReadsPath,
  getSessionDir,
  getSessionSizeBytes,
  readEntry,
  snapshotFileToCache,
  writeEntry,
} from './cache-store.js';
export { computeDelta, MAX_DELTA_CHARS, MAX_DELTA_LINES } from './unified-diff.js';
