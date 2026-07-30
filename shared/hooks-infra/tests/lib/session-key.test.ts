/**
 * Tests for lib/session-key — the shared session-id keying contract.
 *
 * The precedence assertions here are regression pins, not style checks. ctk's
 * context warnings silently never worked because the statusline and the
 * `context-monitor` hook resolved the session id with different precedence, and
 * a missing temp file is indistinguishable from "not configured yet" — so the
 * defect was invisible for as long as the feature existed. Any change that makes
 * `resolveSessionId` prefer the environment over the payload must fail here.
 */

import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SESSION_ID,
  isSafeSessionId,
  isTrustedSessionKey,
  resolveSessionId,
  sessionScopedTmpPath,
} from '../../src/lib/session-key.js';

const ENV_KEY = 'CLAUDE_SESSION_ID';
const ENV_KEY_NEW = 'CLAUDE_CODE_SESSION_ID';
const SAMPLE_UUID = '755bc17d-129e-42f7-87c3-ca350a7ac450';

describe('isSafeSessionId', () => {
  it('accepts a real CC session uuid', () => {
    expect(isSafeSessionId(SAMPLE_UUID)).toBe(true);
  });

  it('accepts dots, dashes and underscores', () => {
    expect(isSafeSessionId('a.b-c_d')).toBe(true);
  });

  it('rejects a traversal segment even though the charset permits dots', () => {
    // The charset test alone would pass `..`; this is why the explicit check exists.
    expect(isSafeSessionId('..')).toBe(false);
    expect(isSafeSessionId('a..b')).toBe(false);
  });

  it('rejects path separators', () => {
    expect(isSafeSessionId('a/b')).toBe(false);
    expect(isSafeSessionId('a\\b')).toBe(false);
  });

  it('rejects the empty string', () => {
    expect(isSafeSessionId('')).toBe(false);
  });

  it('rejects ids longer than 128 characters', () => {
    expect(isSafeSessionId('a'.repeat(128))).toBe(true);
    expect(isSafeSessionId('a'.repeat(129))).toBe(false);
  });

  it('rejects non-string values', () => {
    for (const value of [undefined, null, 42, {}, [], true]) {
      expect(isSafeSessionId(value)).toBe(false);
    }
  });
});

describe('resolveSessionId', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    // A live CC session leaks BOTH names into the test process — and
    // CLAUDE_CODE_SESSION_ID is the one actually set in practice — so these tests
    // must own both outright rather than read whatever is ambient. Relying on the
    // repo's `env -u ...` invocation would make them pass only under that runner.
    for (const key of [ENV_KEY, ENV_KEY_NEW]) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of [ENV_KEY, ENV_KEY_NEW]) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('uses the payload value when it is safe', () => {
    expect(resolveSessionId(SAMPLE_UUID)).toBe(SAMPLE_UUID);
  });

  it('PREFERS THE PAYLOAD OVER THE ENVIRONMENT — the #36 regression pin', () => {
    // Reversing this precedence is the exact defect that made ctk's context
    // warnings dead on arrival: the statusline child has no session-id variable,
    // so a reader preferring the environment keys files differently from a
    // writer preferring the payload.
    process.env[ENV_KEY_NEW] = 'from-environment';
    expect(resolveSessionId(SAMPLE_UUID)).toBe(SAMPLE_UUID);
  });

  it('falls back to the environment when the payload is unusable', () => {
    process.env[ENV_KEY_NEW] = 'from-environment';
    expect(resolveSessionId(undefined)).toBe('from-environment');
    expect(resolveSessionId('has/separator')).toBe('from-environment');
  });

  it('PREFERS CLAUDE_CODE_SESSION_ID over the legacy name', () => {
    // Must match getDefaultSessionId() in lib/input.ts, which is what populates
    // session_id on hook payloads. Disagreeing with it reintroduces exactly the
    // writer/reader split this module exists to prevent.
    process.env[ENV_KEY_NEW] = 'new-name';
    process.env[ENV_KEY] = 'legacy-name';
    expect(resolveSessionId(undefined)).toBe('new-name');
  });

  it('still honours the legacy name when the new one is absent', () => {
    process.env[ENV_KEY] = 'legacy-name';
    expect(resolveSessionId(undefined)).toBe('legacy-name');
  });

  it('falls back to the default when no source is usable', () => {
    expect(resolveSessionId(undefined)).toBe(DEFAULT_SESSION_ID);
  });

  it('ignores an unsafe environment value rather than trusting it', () => {
    process.env[ENV_KEY_NEW] = '../escape';
    expect(resolveSessionId(undefined)).toBe(DEFAULT_SESSION_ID);
  });
});

describe('isTrustedSessionKey', () => {
  it('trusts a real session id', () => {
    expect(isTrustedSessionKey(SAMPLE_UUID)).toBe(true);
  });

  it('distrusts this module’s own fallback constant', () => {
    expect(isTrustedSessionKey(DEFAULT_SESSION_ID)).toBe(false);
  });

  it('distrusts the OTHER layer’s fallback constant', () => {
    // `lib/input.ts` substitutes 'unknown' when it populates a payload that
    // arrived without a session_id. Because the two layers chose different
    // constants, a fully-fallen-back session has its marker written under
    // 'unknown' and sought under 'default' — a mismatch indistinguishable from
    // dead hooks. Both must be distrusted or the detector fires falsely.
    expect(isTrustedSessionKey('unknown')).toBe(false);
  });

  it('distrusts a path-unsafe id', () => {
    expect(isTrustedSessionKey('../escape')).toBe(false);
    expect(isTrustedSessionKey('')).toBe(false);
  });
});

describe('sessionScopedTmpPath', () => {
  it('builds <tmpdir>/<prefix><sessionId>.txt', () => {
    const path = sessionScopedTmpPath('claude-context-pct-', SAMPLE_UUID);
    expect(path).toBe(`${tmpdir()}/claude-context-pct-${SAMPLE_UUID}.txt`);
  });

  it('substitutes the default id rather than building a path from an unsafe one', () => {
    const path = sessionScopedTmpPath('p-', '../../etc/hosts');
    expect(path).toBe(`${tmpdir()}/p-${DEFAULT_SESSION_ID}.txt`);
    expect(path).not.toContain('..');
  });

  it('keys different sessions to different files', () => {
    expect(sessionScopedTmpPath('p-', 'aaa')).not.toBe(sessionScopedTmpPath('p-', 'bbb'));
  });

  it('keys different prefixes to different files for one session', () => {
    expect(sessionScopedTmpPath('a-', SAMPLE_UUID)).not.toBe(
      sessionScopedTmpPath('b-', SAMPLE_UUID)
    );
  });
});
