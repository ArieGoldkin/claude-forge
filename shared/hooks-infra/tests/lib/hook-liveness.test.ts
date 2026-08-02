/**
 * Tests for lib/hook-liveness — the WRITER half of the #82 detector.
 *
 * `node:fs` is mocked rather than exercised. An earlier revision of this module
 * wrote a machine-global arming flag, and the live install's copy of that flag was
 * corrupted by this repo's own test suite — producing a `/doctor` FAIL on a
 * healthy machine. The flag is gone, but the lesson stands: a detector whose state
 * lives in the real temp directory must not be tested against the real temp
 * directory.
 *
 * The reader ships too, and is tested in `hook-liveness-reader.test.ts`. It lives
 * in its own file because it tail-reads a transcript by descriptor and offset —
 * behaviour a whole-module `node:fs` mock cannot represent honestly — so it needs
 * real files, which this file's mock exists to forbid.
 */

import { renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HOOK_ALIVE_PREFIX,
  getHookLivenessPath,
  stampHookLiveness,
} from '../../src/lib/hook-liveness.js';

vi.mock('node:fs');

const SESSION = 'aaaa1111-2222-3333-4444-555566667777';

beforeEach(() => {
  vi.resetAllMocks();
});

describe('path construction', () => {
  it('keys the marker by session inside the temp directory', () => {
    expect(getHookLivenessPath(SESSION)).toBe(`${tmpdir()}/${HOOK_ALIVE_PREFIX}${SESSION}.txt`);
  });

  it('gives different sessions different markers', () => {
    expect(getHookLivenessPath('aaa')).not.toBe(getHookLivenessPath('bbb'));
  });
});

describe('stampHookLiveness', () => {
  it('records the time and the stamping hook', () => {
    stampHookLiveness(SESSION, 'session-loader');
    const written = String(vi.mocked(writeFileSync).mock.calls[0]?.[1]);
    const record = JSON.parse(written) as { at: string; hook: string };
    expect(record.hook).toBe('session-loader');
    expect(Number.isNaN(Date.parse(record.at))).toBe(false);
  });

  it('writes ATOMICALLY — scratch file then rename onto the target', () => {
    // A torn read parses as absent, and absent is the failure signal, so a
    // non-atomic write would surface as a spurious "no security guardrails"
    // verdict on a healthy session.
    stampHookLiveness(SESSION, 'context-monitor');
    const target = getHookLivenessPath(SESSION);
    expect(vi.mocked(writeFileSync).mock.calls[0]?.[0]).toBe(`${target}.tmp`);
    expect(vi.mocked(renameSync).mock.calls[0]?.[0]).toBe(`${target}.tmp`);
    expect(vi.mocked(renameSync).mock.calls[0]?.[1]).toBe(target);
  });

  it('never writes directly to the target path', () => {
    stampHookLiveness(SESSION, 'x');
    const targets = vi.mocked(writeFileSync).mock.calls.map((c) => c[0]);
    expect(targets).not.toContain(getHookLivenessPath(SESSION));
  });

  it('does not throw when the write fails', () => {
    vi.mocked(writeFileSync).mockImplementation(() => {
      throw new Error('EROFS');
    });
    // A hook must never crash because an observability file failed to write.
    expect(() => stampHookLiveness(SESSION, 'session-loader')).not.toThrow();
  });

  it('does not throw when the rename fails', () => {
    vi.mocked(renameSync).mockImplementation(() => {
      throw new Error('EXDEV');
    });
    expect(() => stampHookLiveness(SESSION, 'session-loader')).not.toThrow();
  });

  it('writes NOTHING under an untrusted fallback id', () => {
    // 'default' and 'unknown' are the two constants the reader and writer layers
    // substitute independently, so a marker under either can never be read as
    // evidence. Writing one only litters the user's temp directory with a file
    // that looks like a real marker.
    for (const untrusted of ['default', 'unknown']) {
      vi.resetAllMocks();
      stampHookLiveness(untrusted, 'session-loader');
      expect(writeFileSync).not.toHaveBeenCalled();
      expect(renameSync).not.toHaveBeenCalled();
    }
  });

  it('touches only session-scoped paths — no machine-global state', () => {
    // Regression pin for the defect adversarial review found: a global latch any
    // process could set, permanently, for every reader on the machine. Asserting
    // that every path touched contains the session id is stronger than asserting
    // one known filename is absent, which would pass even if stamping were
    // deleted outright.
    stampHookLiveness(SESSION, 'session-loader');
    const touched = [
      ...vi.mocked(writeFileSync).mock.calls.map((c) => String(c[0])),
      ...vi.mocked(renameSync).mock.calls.map((c) => String(c[1])),
    ];
    expect(touched.length).toBeGreaterThan(0);
    for (const path of touched) {
      expect(path).toContain(SESSION);
    }
  });
});
