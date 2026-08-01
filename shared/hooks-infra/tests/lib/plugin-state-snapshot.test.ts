/**
 * Tests for plugin-tree state snapshots (#82).
 *
 * These run against a REAL temp directory tree rather than a mocked filesystem.
 * The whole value of this module is what it observes about a real tree at a real
 * moment, so a mock would test the mock.
 *
 * @module tests/lib/plugin-state-snapshot
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_DEPTH,
  capturePluginState,
  diffSnapshots,
  pruneSnapshots,
  snapshotFilename,
  writePluginStateSnapshot,
} from '../../src/lib/plugin-state-snapshot.js';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ctk-snap-'));
});
afterEach(() => {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

/** Build `cache/<mkt>/<plugin>/<version>/<sub>` the way CC lays plugins out. */
function makePlugin(plugin: string, version: string, subs = ['hooks', 'skills']): void {
  for (const s of subs) {
    fs.mkdirSync(path.join(root, 'cache', 'claude-forge', plugin, version, s), { recursive: true });
  }
}

describe('capturePluginState', () => {
  it('records directories with mtime and entry count', () => {
    makePlugin('ctk', '2.16.0');
    const snap = capturePluginState(root, {
      sessionId: 'sess1234',
      capturedAt: '2026-08-01T00:00:00.000Z',
    });
    expect(snap.version).toBe(1);
    expect(snap.sessionId).toBe('sess1234');
    expect(Object.keys(snap.dirs)).toContain('cache/claude-forge/ctk');
    const d = snap.dirs['cache/claude-forge/ctk'];
    expect(d?.n).toBe(1); // one version directory
    expect(typeof d?.m).toBe('number');
  });

  it('captures small state files with content, large ones by size only', () => {
    fs.writeFileSync(path.join(root, 'installed_plugins.json'), '{"plugins":{}}');
    fs.writeFileSync(path.join(root, '.last_inuse_sweep'), '2026-08-01T00:00:00.000Z');
    // > 64 KB: content must be omitted so a snapshot stays small.
    fs.writeFileSync(path.join(root, 'plugin-catalog-cache.json'), 'x'.repeat(70 * 1024));
    const snap = capturePluginState(root);
    expect(snap.files['installed_plugins.json']?.content).toBe('{"plugins":{}}');
    expect(snap.files['.last_inuse_sweep']?.content).toContain('2026-08-01');
    expect(snap.files['plugin-catalog-cache.json']?.content).toBeUndefined();
    expect(snap.files['plugin-catalog-cache.json']?.size).toBe(70 * 1024);
  });

  it('omits absent state files rather than inventing empty ones', () => {
    const snap = capturePluginState(root);
    expect(snap.files['installed_plugins.json']).toBeUndefined();
  });

  it('respects maxDepth', () => {
    makePlugin('ctk', '2.16.0', ['hooks']);
    fs.mkdirSync(path.join(root, 'cache/claude-forge/ctk/2.16.0/hooks/src/lib/deep'), {
      recursive: true,
    });
    const shallow = capturePluginState(root, { maxDepth: 2 });
    expect(Object.keys(shallow.dirs)).not.toContain('cache/claude-forge/ctk/2.16.0');
    const deep = capturePluginState(root, { maxDepth: DEFAULT_MAX_DEPTH });
    expect(Object.keys(deep.dirs)).toContain('cache/claude-forge/ctk/2.16.0');
  });

  it('marks the snapshot truncated when it hits the entry cap', () => {
    for (let i = 0; i < 30; i++) makePlugin(`p${i}`, '1.0.0');
    const snap = capturePluginState(root, { maxEntries: 10 });
    expect(snap.truncated).toBe(true);
    // Truncation must be visible, not silent — a partial snapshot compared
    // against a full one would otherwise read as mass directory removal.
    expect(Object.keys(snap.dirs).length).toBeGreaterThan(0);
  });

  it('never throws on an unreadable or missing root', () => {
    expect(() => capturePluginState(path.join(root, 'does-not-exist'))).not.toThrow();
    const snap = capturePluginState(path.join(root, 'does-not-exist'));
    expect(Object.keys(snap.dirs)).toHaveLength(0);
  });
});

describe('diffSnapshots — the #82 question', () => {
  it('reports a REMOVED plugin directory, the strongest sweep evidence', () => {
    makePlugin('ctk', '2.16.0');
    makePlugin('ctk', '2.15.0');
    const before = capturePluginState(root);
    fs.rmSync(path.join(root, 'cache/claude-forge/ctk/2.15.0'), { recursive: true, force: true });
    const after = capturePluginState(root);
    const d = diffSnapshots(before, after);
    expect(d.dirsRemoved).toContain('cache/claude-forge/ctk/2.15.0');
    expect(d.identical).toBe(false);
  });

  it('reports an ADDED directory', () => {
    makePlugin('ctk', '2.16.0');
    const before = capturePluginState(root);
    makePlugin('ctk', '2.17.0');
    const d = diffSnapshots(before, capturePluginState(root));
    expect(d.dirsAdded).toContain('cache/claude-forge/ctk/2.17.0');
  });

  it('reports a directory whose CONTENTS changed even though it still exists', () => {
    // The exact case the mtime-only analysis could not distinguish: the version
    // SET is identical before and after, but the directory was rewritten.
    makePlugin('ctk', '2.16.0', ['hooks']);
    const before = capturePluginState(root);
    fs.mkdirSync(path.join(root, 'cache/claude-forge/ctk/2.16.0/agents'));
    const d = diffSnapshots(before, capturePluginState(root));
    expect(d.dirsTouched).toContain('cache/claude-forge/ctk/2.16.0');
    expect(d.dirsRemoved).toHaveLength(0); // set is unchanged — that was the trap
  });

  it('reports a changed state file', () => {
    fs.writeFileSync(path.join(root, 'installed_plugins.json'), '{"plugins":{}}');
    const before = capturePluginState(root);
    fs.writeFileSync(path.join(root, 'installed_plugins.json'), '{"plugins":{"ctk":[]}}');
    expect(diffSnapshots(before, capturePluginState(root)).filesChanged).toContain(
      'installed_plugins.json'
    );
  });

  it('an unchanged tree diffs as identical — the discrimination control', () => {
    makePlugin('ctk', '2.16.0');
    const a = capturePluginState(root);
    const b = capturePluginState(root);
    const d = diffSnapshots(a, b);
    expect(d.identical).toBe(true);
    expect([d.dirsAdded, d.dirsRemoved, d.dirsTouched, d.filesChanged].flat()).toHaveLength(0);
  });
});

describe('snapshotFilename', () => {
  it('is lexicographically chronological', () => {
    const a = snapshotFilename('2026-08-01T09:00:00.000Z', 'aaaaaaaa-1');
    const b = snapshotFilename('2026-08-01T10:00:00.000Z', 'bbbbbbbb-2');
    expect([b, a].sort()).toEqual([a, b]);
  });
  it('has no characters that are awkward in a filename', () => {
    expect(snapshotFilename('2026-08-01T09:00:00.000Z', 'x')).not.toMatch(/[:]/);
  });
});

describe('pruneSnapshots', () => {
  it('keeps the newest N and deletes the rest', () => {
    const dir = path.join(root, 'plugin-state');
    fs.mkdirSync(dir, { recursive: true });
    for (let h = 0; h < 8; h++) {
      const name = snapshotFilename(`2026-08-01T0${h}:00:00.000Z`, 'sess');
      fs.writeFileSync(path.join(dir, name), '{}');
    }
    expect(pruneSnapshots(dir, 3)).toBe(5);
    const left = fs.readdirSync(dir).sort();
    expect(left).toHaveLength(3);
    expect(left[2]).toContain('T07');
  });
  it('is a no-op below the keep count, and on a missing directory', () => {
    const dir = path.join(root, 'plugin-state');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, snapshotFilename('2026-08-01T00:00:00.000Z', 's')), '{}');
    expect(pruneSnapshots(dir, 5)).toBe(0);
    expect(pruneSnapshots(path.join(root, 'nope'), 5)).toBe(0);
  });
});

describe('writePluginStateSnapshot', () => {
  it('writes a readable snapshot and prunes', () => {
    makePlugin('ctk', '2.16.0');
    const out = path.join(root, 'plugin-state');
    const file = writePluginStateSnapshot(root, out, {
      sessionId: 'sess1234',
      capturedAt: '2026-08-01T00:00:00.000Z',
      keep: 2,
    });
    expect(file).not.toBeNull();
    const parsed = JSON.parse(fs.readFileSync(file as string, 'utf8'));
    expect(parsed.sessionId).toBe('sess1234');
    expect(Object.keys(parsed.dirs).length).toBeGreaterThan(0);
  });

  it('returns null instead of throwing when the output dir cannot be created', () => {
    // A file where the directory should be: mkdir must fail.
    const blocked = path.join(root, 'blocked');
    fs.writeFileSync(blocked, 'not a directory');
    expect(() => writePluginStateSnapshot(root, blocked)).not.toThrow();
    expect(writePluginStateSnapshot(root, blocked)).toBeNull();
  });

  it('a failed write must never surface as an exception to SessionStart', () => {
    expect(() =>
      writePluginStateSnapshot('/definitely/not/here', path.join(root, 'x'))
    ).not.toThrow();
  });
});
