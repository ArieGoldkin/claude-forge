/**
 * Plugin-tree state snapshots (#82).
 *
 * WHY THIS EXISTS. Every candidate mechanism for a silent plugin unload — the
 * in-use sweep, the marketplace catalog, the registration cache — is recorded on
 * disk only as CURRENT STATE. `.last_inuse_sweep` is one overwritten timestamp;
 * `installed_plugins.json` carries one `lastUpdated`; a directory carries one
 * `mtime`. Correlating seven measured outages against those artifacts therefore
 * proves nothing in either direction: `mtime` is last-write-wins, so a directory
 * touched during one outage and touched again a week later shows only the later
 * stamp. **The instruments record a state; the question is about a history.**
 *
 * That is why the 2026-07-29 investigation ended "trigger unidentified", and why
 * a second pass over the same artifacts ended the same way. This module stops
 * mining the past and starts recording: one compact snapshot per session start,
 * so the NEXT occurrence has a real before/after instead of a single overwritten
 * stamp.
 *
 * WHAT IT CAN AND CANNOT CATCH. The snapshot is written by a ctk hook, so it
 * only runs when ctk is loaded. That is sufficient and is the point: measured
 * outages begin MID-session, so the session-start snapshot is the healthy
 * "before". Comparing it against live state at the moment an outage is noticed
 * brackets the onset. It cannot capture a session that started already broken —
 * nothing ctk owns can, since nothing of ctk's runs.
 *
 * COST. Directories only, bounded depth, plus a few small files. ~1.2k entries
 * on a five-plugin install, well inside SessionStart's budget. Every entry point
 * is failure-tolerant: a snapshot must never delay or break a session start.
 *
 * @module lib/plugin-state-snapshot
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/** Depth below the plugins root to record. 4 reaches `cache/<mkt>/<plugin>/<version>/<sub>`. */
export const DEFAULT_MAX_DEPTH = 4;

/** Hard cap so a pathological tree cannot stall a session start. */
export const MAX_ENTRIES = 5000;

/** Small state files worth capturing whole-ish. The catalog is large — size only. */
const STATE_FILES = [
  'installed_plugins.json',
  'known_marketplaces.json',
  'plugin-catalog-cache.json',
  '.last_inuse_sweep',
] as const;

export interface DirEntry {
  /** mtime, epoch ms */
  m: number;
  /** number of directory entries */
  n: number;
}

export interface FileEntry {
  size: number;
  m: number;
  /** Present only for files small enough to be worth reading. */
  content?: string;
}

export interface PluginStateSnapshot {
  version: 1;
  capturedAt: string;
  sessionId: string;
  /** relative path → mtime + entry count */
  dirs: Record<string, DirEntry>;
  /** file name → size/mtime, and content when small */
  files: Record<string, FileEntry>;
  /** true when the walk hit MAX_ENTRIES and is therefore incomplete */
  truncated: boolean;
}

/**
 * Walk the plugin tree and record directories.
 *
 * Never throws: an unreadable directory is skipped, and a completely unreadable
 * root yields an empty snapshot rather than an exception.
 */
export function capturePluginState(
  pluginsRoot: string,
  opts: {
    sessionId?: string;
    capturedAt?: string;
    maxDepth?: number;
    maxEntries?: number;
    /** Absolute path to exclude — normally the snapshot output dir itself. */
    snapshotDir?: string;
  } = {}
): PluginStateSnapshot {
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxEntries = opts.maxEntries ?? MAX_ENTRIES;
  const dirs: Record<string, DirEntry> = {};
  const files: Record<string, FileEntry> = {};
  let truncated = false;
  let dirCount = 0; // tracked directly: Object.keys().length inside the walk is O(n^2)

  // The snapshot directory normally lives INSIDE the tree being snapshotted
  // (~/.claude/plugins/data/<ctk-mkt>/plugin-state). Capture runs before the
  // write, so without this exclusion the write itself makes the tree differ and
  // `identical: true` — the verdict /doctor documents as exit 0 — is unreachable.
  const excluded = opts.snapshotDir ? path.resolve(opts.snapshotDir) : null;

  const walk = (abs: string, rel: string, depth: number): void => {
    if (truncated) return;
    if (excluded && path.resolve(abs) === excluded) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    try {
      dirs[rel || '.'] = { m: Math.round(fs.statSync(abs).mtimeMs), n: entries.length };
    } catch {
      return;
    }
    dirCount++;
    if (dirCount >= maxEntries) {
      truncated = true;
      return;
    }
    if (depth >= maxDepth) return;
    for (const e of entries) {
      if (e.isDirectory())
        walk(path.join(abs, e.name), rel ? `${rel}/${e.name}` : e.name, depth + 1);
    }
  };

  walk(pluginsRoot, '', 0);

  for (const name of STATE_FILES) {
    const p = path.join(pluginsRoot, name);
    try {
      const st = fs.statSync(p);
      const entry: FileEntry = { size: st.size, m: Math.round(st.mtimeMs) };
      // The catalog cache is hundreds of KB — size and mtime are enough for it.
      if (st.size <= 64 * 1024) entry.content = fs.readFileSync(p, 'utf8');
      files[name] = entry;
    } catch {
      /* absent is itself information: the key simply does not appear */
    }
  }

  return {
    version: 1,
    capturedAt: opts.capturedAt ?? new Date().toISOString(),
    sessionId: opts.sessionId ?? 'unknown',
    dirs,
    files,
    truncated,
  };
}

export interface SnapshotDiff {
  dirsAdded: string[];
  dirsRemoved: string[];
  dirsTouched: string[];
  filesChanged: string[];
  /** true when nothing at all differs */
  identical: boolean;
}

/**
 * Compare two snapshots, oldest first.
 *
 * `dirsRemoved` is the field that matters for #82: a plugin directory that
 * existed at session start and is gone when the outage is noticed is the
 * strongest possible evidence for the sweep hypothesis, and is exactly what no
 * retained artifact could show before this.
 */
export function diffSnapshots(
  before: PluginStateSnapshot,
  after: PluginStateSnapshot
): SnapshotDiff {
  const b = before.dirs;
  const a = after.dirs;
  const dirsAdded = Object.keys(a)
    .filter((k) => !(k in b))
    .sort();
  const dirsRemoved = Object.keys(b)
    .filter((k) => !(k in a))
    .sort();
  const dirsTouched = Object.keys(a)
    .filter((k) => k in b && (b[k]?.m !== a[k]?.m || b[k]?.n !== a[k]?.n))
    .sort();
  const names = new Set([...Object.keys(before.files), ...Object.keys(after.files)]);
  const filesChanged = [...names]
    .filter((n) => {
      const x = before.files[n];
      const y = after.files[n];
      if (!x || !y) return true;
      return x.size !== y.size || x.m !== y.m;
    })
    .sort();
  return {
    dirsAdded,
    dirsRemoved,
    dirsTouched,
    filesChanged,
    identical:
      dirsAdded.length === 0 &&
      dirsRemoved.length === 0 &&
      dirsTouched.length === 0 &&
      filesChanged.length === 0,
  };
}

/**
 * Keep the newest `keep` snapshots, delete the rest. Returns how many were
 * removed. Never throws — pruning failure must not affect a session.
 */
export function pruneSnapshots(dir: string, keep: number): number {
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch {
    return 0;
  }
  // Filenames are ISO-prefixed, so lexicographic order is chronological.
  const doomed = names.sort().slice(0, Math.max(0, names.length - keep));
  let removed = 0;
  for (const n of doomed) {
    try {
      fs.unlinkSync(path.join(dir, n));
      removed++;
    } catch {
      /* a snapshot we cannot delete is not worth failing over */
    }
  }
  return removed;
}

/**
 * Resolve the snapshot directory. **Both the writer and the reader must call
 * this** — they previously derived it independently and disagreed.
 *
 * The writer used `<config>/logs/continuity/plugin-state` for the legacy case
 * while the reader looked in `<config>/logs/plugin-state`, so the legacy branch
 * described a read that never happened. And picking `candidates[0]` off an
 * unsorted `readdir` reintroduced the coin-flip that `resolveLogDir`'s own
 * comment records as a bug: a machine predating the claude-dev-kit -> claude-forge
 * rebrand has more than one `ctk-*` data directory.
 *
 * Preference order: an explicit `CLAUDE_PLUGIN_DATA`; then the discovered data
 * directory that ALREADY holds snapshots (so an existing history is never
 * orphaned by a rebrand); then the lexicographically last candidate; then legacy.
 */
export function resolvePluginStateDir(
  configDir: string,
  env: NodeJS.ProcessEnv = process.env
): { dir: string; legacy: boolean } {
  const explicit = env['CLAUDE_PLUGIN_DATA'];
  if (explicit) return { dir: path.join(explicit, 'plugin-state'), legacy: false };

  const dataRoot = path.join(configDir, 'plugins', 'data');
  let candidates: string[] = [];
  try {
    candidates = fs
      .readdirSync(dataRoot)
      .sort()
      .filter((n) => n.startsWith('ctk-') || n.startsWith('continuity'))
      .map((n) => path.join(dataRoot, n));
  } catch {
    candidates = [];
  }
  const populated = candidates.find((c) => {
    try {
      return fs.readdirSync(path.join(c, 'plugin-state')).some((f) => f.endsWith('.json'));
    } catch {
      return false;
    }
  });
  const chosen = populated ?? candidates[candidates.length - 1];
  if (chosen) return { dir: path.join(chosen, 'plugin-state'), legacy: false };

  return { dir: path.join(configDir, 'logs', 'continuity', 'plugin-state'), legacy: true };
}

/** Snapshot filename: ISO timestamp first so lexicographic === chronological. */
export function snapshotFilename(capturedAt: string, sessionId: string): string {
  const stamp = capturedAt.replace(/[:.]/g, '-');
  return `${stamp}_${(sessionId || 'unknown').slice(0, 8)}.json`;
}

/**
 * Capture and persist in one call. Returns the written path, or null on any
 * failure — a session start must never break because a diagnostic could not
 * write.
 */
export function writePluginStateSnapshot(
  pluginsRoot: string,
  outDir: string,
  opts: { sessionId?: string; capturedAt?: string; keep?: number } = {}
): string | null {
  try {
    // mkdir BEFORE capture. Excluding the snapshot directory is not enough on
    // its own: CREATING it changes its parent's mtime and entry count, so a
    // first run would still diff against itself. Creating it first means the
    // capture already sees the final tree shape, and the file write that follows
    // only touches the excluded directory.
    fs.mkdirSync(outDir, { recursive: true });
    const snap = capturePluginState(pluginsRoot, { ...opts, snapshotDir: outDir });
    const file = path.join(outDir, snapshotFilename(snap.capturedAt, snap.sessionId));
    fs.writeFileSync(file, JSON.stringify(snap), 'utf8');
    pruneSnapshots(outDir, opts.keep ?? 20);
    return file;
  } catch {
    return null;
  }
}
