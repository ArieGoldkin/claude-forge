/**
 * Tests for read-cache cache-store.
 *
 * Each test isolates state by pointing TOKEN_COMPRESS_CACHE_DIR at a
 * unique tempdir created in beforeEach. The directory is fully removed
 * in afterEach so suites can run in any order.
 *
 * @module tests/lib/read-cache/cache-store
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
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
} from '../../../src/lib/read-cache/cache-store.js';
import type { CachedRead } from '../../../src/lib/read-cache/types.js';

let tmpRoot: string;
let originalEnv: string | undefined;
let originalSessionId: string | undefined;

function makeEntry(overrides: Partial<CachedRead> = {}): CachedRead {
  const content = overrides.cachedContent ?? 'hello\nworld\n';
  return {
    absPath: '/tmp/example.txt',
    contentHash: computeContentHash(content),
    size: Buffer.byteLength(content, 'utf8'),
    mtimeMs: 1_700_000_000_000,
    cachedContent: content,
    recordedAt: '2026-04-26T00:00:00Z',
    schemaVersion: 1,
    ...overrides,
  };
}

let originalCodeSessionId: string | undefined;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'read-cache-test-'));
  originalEnv = process.env['TOKEN_COMPRESS_CACHE_DIR'];
  originalSessionId = process.env['CLAUDE_SESSION_ID'];
  originalCodeSessionId = process.env['CLAUDE_CODE_SESSION_ID'];
  process.env['TOKEN_COMPRESS_CACHE_DIR'] = tmpRoot;
  delete process.env['CLAUDE_SESSION_ID'];
  // Clear the newer var so tests that set CLAUDE_SESSION_ID see it as the
  // session id; the lookup in cache-store now prefers CLAUDE_CODE_SESSION_ID.
  delete process.env['CLAUDE_CODE_SESSION_ID'];
});

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env['TOKEN_COMPRESS_CACHE_DIR'];
  } else {
    process.env['TOKEN_COMPRESS_CACHE_DIR'] = originalEnv;
  }
  if (originalSessionId === undefined) {
    delete process.env['CLAUDE_SESSION_ID'];
  } else {
    process.env['CLAUDE_SESSION_ID'] = originalSessionId;
  }
  if (originalCodeSessionId === undefined) {
    delete process.env['CLAUDE_CODE_SESSION_ID'];
  } else {
    process.env['CLAUDE_CODE_SESSION_ID'] = originalCodeSessionId;
  }
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

describe('getCacheRoot', () => {
  it('honors TOKEN_COMPRESS_CACHE_DIR when set', () => {
    expect(getCacheRoot()).toBe(tmpRoot);
  });

  it('falls back to ~/.claude/cache/token-compress when env is unset', () => {
    delete process.env['TOKEN_COMPRESS_CACHE_DIR'];
    const expected = path.join(os.homedir(), '.claude', 'cache', 'token-compress');
    expect(getCacheRoot()).toBe(expected);
  });

  it('falls back when env var is set but empty', () => {
    process.env['TOKEN_COMPRESS_CACHE_DIR'] = '';
    const expected = path.join(os.homedir(), '.claude', 'cache', 'token-compress');
    expect(getCacheRoot()).toBe(expected);
  });
});

describe('getSessionDir', () => {
  it('joins root and session id', () => {
    expect(getSessionDir('abc123')).toBe(path.join(tmpRoot, 'abc123'));
  });

  it('sanitizes path-traversal characters', () => {
    expect(getSessionDir('../../etc')).toBe(path.join(tmpRoot, '______etc'));
  });

  it('sanitizes shell-meaningful characters', () => {
    expect(getSessionDir('a$b`c;d')).toBe(path.join(tmpRoot, 'a_b_c_d'));
  });

  it('preserves alphanumeric, underscore, and hyphen', () => {
    expect(getSessionDir('AbC_123-xyz')).toBe(path.join(tmpRoot, 'AbC_123-xyz'));
  });
});

describe('getReadsPath', () => {
  it('returns reads.jsonl path under session dir', () => {
    expect(getReadsPath('s1')).toBe(path.join(tmpRoot, 's1', 'reads.jsonl'));
  });
});

describe('ensureSessionDir', () => {
  it('creates the session directory', () => {
    ensureSessionDir('s1');
    expect(fs.existsSync(path.join(tmpRoot, 's1'))).toBe(true);
  });

  it('is idempotent', () => {
    ensureSessionDir('s1');
    ensureSessionDir('s1');
    expect(fs.existsSync(path.join(tmpRoot, 's1'))).toBe(true);
  });

  it('creates with mode 0o700 on POSIX', () => {
    if (process.platform === 'win32') {
      // chmod semantics differ on Windows; skip the bit-level assertion.
      return;
    }
    ensureSessionDir('s1');
    const stat = fs.statSync(path.join(tmpRoot, 's1'));
    // mask off file-type bits to compare just the permission bits
    const perms = stat.mode & 0o777;
    expect(perms).toBe(0o700);
  });
});

describe('writeEntry / readEntry round-trip', () => {
  it('persists and retrieves a single entry', async () => {
    const entry = makeEntry({ absPath: '/foo/bar.ts' });
    await writeEntry('s1', entry);
    const got = await readEntry('s1', '/foo/bar.ts');
    expect(got).not.toBeNull();
    expect(got?.absPath).toBe('/foo/bar.ts');
    expect(got?.cachedContent).toBe(entry.cachedContent);
    expect(got?.contentHash).toBe(entry.contentHash);
  });

  it('returns the most recent entry when the same path is written twice', async () => {
    await writeEntry('s1', makeEntry({ absPath: '/p.ts', cachedContent: 'first' }));
    await writeEntry('s1', makeEntry({ absPath: '/p.ts', cachedContent: 'second' }));
    const got = await readEntry('s1', '/p.ts');
    expect(got?.cachedContent).toBe('second');
  });

  it('returns null when the JSONL file does not exist', async () => {
    const got = await readEntry('does-not-exist', '/anything');
    expect(got).toBeNull();
  });

  it('returns null when the path was never recorded', async () => {
    await writeEntry('s1', makeEntry({ absPath: '/a.ts' }));
    const got = await readEntry('s1', '/never-seen.ts');
    expect(got).toBeNull();
  });

  it('isolates entries between sessions', async () => {
    await writeEntry('s1', makeEntry({ absPath: '/x.ts', cachedContent: 'one' }));
    await writeEntry('s2', makeEntry({ absPath: '/x.ts', cachedContent: 'two' }));
    const a = await readEntry('s1', '/x.ts');
    const b = await readEntry('s2', '/x.ts');
    expect(a?.cachedContent).toBe('one');
    expect(b?.cachedContent).toBe('two');
  });
});

describe('readEntry malformed-line handling', () => {
  it('skips malformed lines and still returns a valid trailing entry', async () => {
    ensureSessionDir('s1');
    const readsPath = getReadsPath('s1');
    const valid = makeEntry({ absPath: '/good.ts', cachedContent: 'ok' });
    fs.writeFileSync(
      readsPath,
      ['this is not json', '{"partial": ', JSON.stringify(valid)].join('\n') + '\n'
    );
    const got = await readEntry('s1', '/good.ts');
    expect(got).not.toBeNull();
    expect(got?.cachedContent).toBe('ok');
  });

  it('returns null when every line is malformed', async () => {
    ensureSessionDir('s1');
    fs.writeFileSync(getReadsPath('s1'), 'garbage\n{not-json\n');
    const got = await readEntry('s1', '/anything');
    expect(got).toBeNull();
  });

  it('skips JSON lines that are not objects with absPath', async () => {
    ensureSessionDir('s1');
    fs.writeFileSync(
      getReadsPath('s1'),
      [
        JSON.stringify(['array', 'not', 'object']),
        JSON.stringify({ noAbsPath: true }),
        JSON.stringify({ absPath: 12345 }),
      ].join('\n') + '\n'
    );
    const got = await readEntry('s1', '/anything');
    expect(got).toBeNull();
  });
});

describe('evictOldSessions', () => {
  it('removes session dirs older than maxAgeMs', async () => {
    ensureSessionDir('old');
    await writeEntry('old', makeEntry({ absPath: '/o.ts' }));

    // Backdate the directory mtime by 100 hours.
    const past = new Date(Date.now() - 100 * 60 * 60 * 1000);
    fs.utimesSync(path.join(tmpRoot, 'old'), past, past);

    const result = await evictOldSessions(48 * 60 * 60 * 1000);
    expect(result.evictedCount).toBe(1);
    expect(result.freedBytes).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(tmpRoot, 'old'))).toBe(false);
  });

  it('keeps session dirs newer than maxAgeMs', async () => {
    ensureSessionDir('fresh');
    await writeEntry('fresh', makeEntry({ absPath: '/f.ts' }));
    const result = await evictOldSessions(48 * 60 * 60 * 1000);
    expect(result.evictedCount).toBe(0);
    expect(fs.existsSync(path.join(tmpRoot, 'fresh'))).toBe(true);
  });

  it('skips the current session even if it is old', async () => {
    ensureSessionDir('current');
    await writeEntry('current', makeEntry({ absPath: '/c.ts' }));

    const past = new Date(Date.now() - 100 * 60 * 60 * 1000);
    fs.utimesSync(path.join(tmpRoot, 'current'), past, past);

    process.env['CLAUDE_SESSION_ID'] = 'current';
    const result = await evictOldSessions(48 * 60 * 60 * 1000);
    expect(result.evictedCount).toBe(0);
    expect(fs.existsSync(path.join(tmpRoot, 'current'))).toBe(true);
  });

  it('skips the current session under sanitization', async () => {
    // CLAUDE_SESSION_ID with chars sanitized to underscores must still match.
    ensureSessionDir('weird/id');
    await writeEntry('weird/id', makeEntry({ absPath: '/w.ts' }));
    const sanitizedDir = path.join(tmpRoot, 'weird_id');
    expect(fs.existsSync(sanitizedDir)).toBe(true);

    const past = new Date(Date.now() - 100 * 60 * 60 * 1000);
    fs.utimesSync(sanitizedDir, past, past);

    process.env['CLAUDE_SESSION_ID'] = 'weird/id';
    const result = await evictOldSessions(48 * 60 * 60 * 1000);
    expect(result.evictedCount).toBe(0);
    expect(fs.existsSync(sanitizedDir)).toBe(true);
  });

  it('returns zero when the cache root does not exist', async () => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    const result = await evictOldSessions();
    expect(result.evictedCount).toBe(0);
    expect(result.freedBytes).toBe(0);
  });

  it('uses 48h default when no maxAgeMs is given', async () => {
    ensureSessionDir('fresh');
    await writeEntry('fresh', makeEntry());
    const result = await evictOldSessions();
    expect(result.evictedCount).toBe(0);
  });
});

describe('getSessionSizeBytes', () => {
  it('returns 0 when the session directory is missing', async () => {
    const size = await getSessionSizeBytes('never-existed');
    expect(size).toBe(0);
  });

  it('sums file sizes across the session dir', async () => {
    ensureSessionDir('s1');
    const dir = getSessionDir('s1');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a'.repeat(100));
    fs.writeFileSync(path.join(dir, 'b.txt'), 'b'.repeat(50));
    const size = await getSessionSizeBytes('s1');
    expect(size).toBe(150);
  });

  it('includes JSONL written by writeEntry', async () => {
    await writeEntry('s1', makeEntry({ absPath: '/x.ts' }));
    const size = await getSessionSizeBytes('s1');
    expect(size).toBeGreaterThan(0);
  });
});

describe('computeContentHash', () => {
  it('returns a 64-char hex string', () => {
    const h = computeContentHash('hello');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    expect(computeContentHash('xyz')).toBe(computeContentHash('xyz'));
  });

  it('differs for different content', () => {
    expect(computeContentHash('a')).not.toBe(computeContentHash('b'));
  });
});

describe('snapshotFileToCache', () => {
  let srcDir: string;

  beforeEach(() => {
    srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-src-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(srcDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('persists the current file content as a retrievable cache entry', async () => {
    const file = path.join(srcDir, 'a.txt');
    const content = 'line1\nline2\n';
    fs.writeFileSync(file, content);

    const size = await snapshotFileToCache('s1', file);

    expect(size).toBe(Buffer.byteLength(content, 'utf8'));
    const entry = await readEntry('s1', file);
    expect(entry).not.toBeNull();
    expect(entry?.cachedContent).toBe(content);
    expect(entry?.contentHash).toBe(computeContentHash(content));
    expect(entry?.schemaVersion).toBe(1);
  });

  it('advances the base on a second call (most-recent-wins)', async () => {
    const file = path.join(srcDir, 'b.txt');
    fs.writeFileSync(file, 'v1\n');
    await snapshotFileToCache('s1', file);

    fs.writeFileSync(file, 'v2 changed\n');
    const size = await snapshotFileToCache('s1', file);

    expect(size).toBe(Buffer.byteLength('v2 changed\n', 'utf8'));
    const entry = await readEntry('s1', file);
    expect(entry?.cachedContent).toBe('v2 changed\n');
    expect(entry?.contentHash).toBe(computeContentHash('v2 changed\n'));
  });

  it('returns null and writes nothing for a non-existent path', async () => {
    const missing = path.join(srcDir, 'does-not-exist.txt');
    const size = await snapshotFileToCache('s1', missing);
    expect(size).toBeNull();
    expect(await readEntry('s1', missing)).toBeNull();
  });

  it('returns null for a directory (non-regular file)', async () => {
    const size = await snapshotFileToCache('s1', srcDir);
    expect(size).toBeNull();
    expect(await readEntry('s1', srcDir)).toBeNull();
  });

  it('never caches secret-bearing files (env / ssh / credential)', async () => {
    // Content is irrelevant — the path pattern drives the skip; keep it innocuous.
    const body = 'placeholder file body\n';

    // env + credential patterns match by filename regardless of directory
    for (const name of ['.env', '.env.local', 'secrets.yaml', 'credentials.json', '.npmrc', '.netrc']) {
      const file = path.join(srcDir, name);
      fs.writeFileSync(file, body);
      const size = await snapshotFileToCache('s1', file);
      expect(size, `${name} must not be cached`).toBeNull();
      expect(await readEntry('s1', file)).toBeNull();
    }

    // ssh patterns require a .ssh/ path segment
    const sshDir = path.join(srcDir, '.ssh');
    fs.mkdirSync(sshDir);
    const key = path.join(sshDir, 'id_ed25519');
    fs.writeFileSync(key, body);
    expect(await snapshotFileToCache('s1', key)).toBeNull();
    expect(await readEntry('s1', key)).toBeNull();
  });
});
