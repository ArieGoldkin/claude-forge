/**
 * Tests for logging library
 *
 * These tests verify the logging functions produce the correct log format,
 * respect log levels, handle file rotation, and create proper audit trails.
 *
 * Note: these tests exercise real file I/O rather than mocking it, but against a
 * per-test temp HOME — never the developer's actual ~/.claude/logs. See the
 * beforeEach for why that isolation is load-bearing rather than tidiness.
 *
 * @module tests/lib/logging
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createLogger,
  createScopedLogger,
  getCurrentLogLevel,
  getHookLogPath,
  getLogDir,
  getPermissionLogPath,
  logDebug,
  logError,
  logInfo,
  logPermission,
  logPermissionEntry,
  logWarn,
  resetLogDir,
  resetLogLevel,
} from '../../src/lib/logging.js';
import type { PermissionLogEntry } from '../../src/types.js';

// =============================================================================
// PLUGIN IDENTITY
// =============================================================================

/**
 * This file is symlinked into every plugin's tests/lib/, so it runs six times,
 * once per tree, each with its own CLAUDE_PLUGIN_NAME from that tree's
 * vitest.config.ts. logging.ts derives both the log-level env var and the log
 * directory from that name.
 *
 * The table is keyed by TREE (the directory the suite runs in), not by
 * CLAUDE_PLUGIN_NAME. Keying it by the env var would make it un-falsifiable: a
 * vitest.config.ts that set the wrong name would simply select a different row
 * and pass. Keyed by tree, the expected identity is a fixed statement about this
 * repo, so a misconfigured CLAUDE_PLUGIN_NAME fails `identity matches the tree`
 * below — which is what the five per-plugin copies of this file used to catch by
 * hardcoding their own literals, and what a recomputed
 * `process.env['CLAUDE_PLUGIN_NAME']` cannot catch at all.
 *
 * Adding a plugin? Add its directory here. The throw is deliberate: an unmapped
 * tree should stop the suite, not fall back to a guess.
 *
 * DRIFT RESOLVED (#63, 2026-07-27). `ai-toolkit` and `frontend-toolkit` used to
 * test under `ai-toolkit`/`frontend-toolkit` while their wrappers exported
 * `ai`/`frontend`, so this table recorded the TEST values with a drift note. The
 * vitest configs now set the production names and the table states them, so all
 * five trees are self-consistent again.
 *
 * What the investigation found, and why the fix was larger than the issue's
 * recommended option: there were THREE names per plugin, not two. Each CLAUDE.md
 * documented a THIRD form (`AI_TOOLKIT_LOG_LEVEL`, `FRONTEND_TOOLKIT_LOG_LEVEL`)
 * that matched neither production nor the tests — and the docs are what users
 * follow. Measured: those documented names appeared in ZERO files repo-wide,
 * against 6/3/2 for the three plugins whose names never drifted. Aligning the
 * tests alone would have left users exporting a variable nothing reads, so the
 * docs were corrected in the same change.
 *
 * CORRECTED 2026-07-30 (#75): that comparison originally read "17/8/7". Those
 * were symlink PATHS — `grep -R` follows this repo's directory symlinks and
 * inflates counts ~2.8×. Distinct blobs (`git grep -l`) are 6/3/2. The asymmetry
 * the argument rests on survives (0 vs 6/3/2). Note also that "appears in 0
 * files" is not "nothing reads it": `logging.ts` builds the name dynamically, so
 * a literal census measures DOCUMENTATION, not behaviour.
 *
 * Deriving the env var separately from the directory was considered and is not
 * needed — but that was originally decided against only ONE of two derivation
 * sites. A second lived in `getHookEnvironment()` in `types.ts`: public API of
 * all five plugins, zero tests, zero callers, and already divergent (it neither
 * lower-cased nor validated). #74 single-sourced it (etk 2.16.1), which is why
 * the conclusion holds now; it did not hold for the reason first given.
 *
 * THE LOG-DIRECTORY INVARIANT, recorded because the wrong version of it is
 * dangerous (#75): the production log directory is safe **iff
 * `run-hook-wrapper.sh` is unchanged** — NOT because `CLAUDE_PLUGIN_DATA` takes
 * precedence. Nothing in this repo sets that variable (Claude Code supplies it),
 * its own docstring calls it optional, and the fallback branch has demonstrably
 * executed. The `CLAUDE_PLUGIN_DATA` reasoning would have given identical false
 * reassurance had #63 been resolved the other way — by changing the wrappers to
 * match the tests — which WOULD have relocated real users' logs.
 */
interface TreeIdentity {
  /** Expected CLAUDE_PLUGIN_NAME for this tree. */
  pluginName: string;
  /** Expected log-level env var — stated, never recomputed from pluginName. */
  logLevelEnv: string;
  /** Expected trailing path segment of the log directory. */
  logDirName: string;
}

const IDENTITY_BY_TREE: Record<string, TreeIdentity> = {
  'shared/hooks-infra': {
    pluginName: 'plugin',
    logLevelEnv: 'PLUGIN_LOG_LEVEL',
    logDirName: 'plugin',
  },
  'continuity-toolkit/hooks': {
    pluginName: 'continuity',
    logLevelEnv: 'CONTINUITY_LOG_LEVEL',
    logDirName: 'continuity',
  },
  'devops-toolkit/hooks': {
    pluginName: 'devops',
    logLevelEnv: 'DEVOPS_LOG_LEVEL',
    logDirName: 'devops',
  },
  'ai-toolkit/hooks': {
    pluginName: 'ai',
    logLevelEnv: 'AI_LOG_LEVEL',
    logDirName: 'ai',
  },
  'frontend-toolkit/hooks': {
    pluginName: 'frontend',
    logLevelEnv: 'FRONTEND_LOG_LEVEL',
    logDirName: 'frontend',
  },
  'engineering-toolkit/hooks': {
    pluginName: 'engineering',
    logLevelEnv: 'ENGINEERING_LOG_LEVEL',
    logDirName: 'engineering',
  },
};

/** vitest runs with cwd at the package root, so the last two segments identify the tree. */
const TREE_KEY = path.join(
  path.basename(path.dirname(process.cwd())),
  path.basename(process.cwd())
);

const mappedIdentity = IDENTITY_BY_TREE[TREE_KEY];
if (!mappedIdentity) {
  throw new Error(
    `logging.test.ts: no identity mapped for tree "${TREE_KEY}" (cwd ${process.cwd()}). Add an entry to IDENTITY_BY_TREE in this file.`
  );
}
const IDENTITY = mappedIdentity;
const LOG_LEVEL_ENV = IDENTITY.logLevelEnv;

// =============================================================================
// TEST HELPERS
// =============================================================================

/**
 * Read last N lines from a file
 */
function readLastNLines(filePath: string, n: number): string[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.trim().split('\n').filter(Boolean);
  return lines.slice(-n);
}

/**
 * Read last line from a file
 */
function readLastLine(filePath: string): string {
  const lines = readLastNLines(filePath, 1);
  return lines[0] || '';
}

/**
 * Get initial line count from a file
 */
function getLineCount(filePath: string): number {
  if (!fs.existsSync(filePath)) {
    return 0;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  return content.trim().split('\n').filter(Boolean).length;
}

// =============================================================================
// SETUP AND TEARDOWN
// =============================================================================

describe('logging module', () => {
  const originalEnv = { ...process.env };
  let tmpHome: string;
  let _initialHookLogLines: number;
  let _initialPermissionLogLines: number;

  beforeEach(() => {
    // Redirect logging at a temp HOME so this file writes to a log nobody else
    // can touch.
    //
    // Previously these tests read and wrote the REAL ~/.claude/logs/<plugin>/
    // hooks.log and asserted on line-count deltas, so any other worker that
    // logged during the assertion window corrupted the count. That made the
    // file flaky as a function of how vitest happened to schedule workers:
    // measured at 0 failures in 8 runs with 29 test files, and ~40% (6 of 15)
    // once a 30th file existed — including a trivial file doing no I/O at all.
    // The trigger was suite composition, not anything the added file did.
    //
    // The path assertions below are structural (contains `.claude`, contains
    // `logs`, ends with the plugin name), so a temp HOME satisfies them.
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hooks-infra-logs-'));
    process.env['HOME'] = tmpHome;
    delete process.env['CLAUDE_PLUGIN_DATA'];

    resetLogDir();
    resetLogLevel();

    // Record initial line counts to track new entries
    _initialHookLogLines = getLineCount(getHookLogPath());
    _initialPermissionLogLines = getLineCount(getPermissionLogPath());
  });

  afterEach(() => {
    // Restore original environment
    process.env = { ...originalEnv };

    // Reset caches so the next file/test recomputes against the restored env
    resetLogDir();
    resetLogLevel();

    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  // ===========================================================================
  // LOG LEVEL TESTS
  // ===========================================================================

  describe('getCurrentLogLevel', () => {
    it(`should default to warn when ${LOG_LEVEL_ENV} is not set`, () => {
      delete process.env[LOG_LEVEL_ENV];
      resetLogLevel();
      expect(getCurrentLogLevel()).toBe('warn');
    });

    it(`should return debug when ${LOG_LEVEL_ENV}=debug`, () => {
      process.env[LOG_LEVEL_ENV] = 'debug';
      resetLogLevel();
      expect(getCurrentLogLevel()).toBe('debug');
    });

    it(`should return info when ${LOG_LEVEL_ENV}=info`, () => {
      process.env[LOG_LEVEL_ENV] = 'info';
      resetLogLevel();
      expect(getCurrentLogLevel()).toBe('info');
    });

    it(`should return warn when ${LOG_LEVEL_ENV}=warn`, () => {
      process.env[LOG_LEVEL_ENV] = 'warn';
      resetLogLevel();
      expect(getCurrentLogLevel()).toBe('warn');
    });

    it(`should return error when ${LOG_LEVEL_ENV}=error`, () => {
      process.env[LOG_LEVEL_ENV] = 'error';
      resetLogLevel();
      expect(getCurrentLogLevel()).toBe('error');
    });

    it('should default to warn for invalid log level', () => {
      process.env[LOG_LEVEL_ENV] = 'invalid';
      resetLogLevel();
      expect(getCurrentLogLevel()).toBe('warn');
    });

    it('should handle case-insensitive log levels', () => {
      process.env[LOG_LEVEL_ENV] = 'DEBUG';
      resetLogLevel();
      expect(getCurrentLogLevel()).toBe('debug');

      process.env[LOG_LEVEL_ENV] = 'Info';
      resetLogLevel();
      expect(getCurrentLogLevel()).toBe('info');
    });

    it('should cache the log level', () => {
      process.env[LOG_LEVEL_ENV] = 'debug';
      resetLogLevel();
      expect(getCurrentLogLevel()).toBe('debug');

      // Changing env after first call should not affect cached value
      process.env[LOG_LEVEL_ENV] = 'error';
      expect(getCurrentLogLevel()).toBe('debug');
    });
  });

  describe('resetLogLevel', () => {
    it('should clear the cached log level', () => {
      process.env[LOG_LEVEL_ENV] = 'debug';
      resetLogLevel();
      expect(getCurrentLogLevel()).toBe('debug');

      process.env[LOG_LEVEL_ENV] = 'error';
      resetLogLevel();
      expect(getCurrentLogLevel()).toBe('error');
    });
  });

  // ===========================================================================
  // PATH HELPERS TESTS
  // ===========================================================================

  describe('plugin identity', () => {
    // The five per-plugin copies of this file used to catch a misconfigured
    // CLAUDE_PLUGIN_NAME by hardcoding their own literal. This is that check,
    // stated once: IDENTITY comes from the tree on disk, so it does not move
    // when the env var does.
    it(`should run as "${IDENTITY.pluginName}" in tree ${TREE_KEY}`, () => {
      expect(process.env['CLAUDE_PLUGIN_NAME'] ?? 'plugin').toBe(IDENTITY.pluginName);
    });
  });

  describe('getLogDir', () => {
    it(`should return path under HOME/.claude/logs/${IDENTITY.logDirName}`, () => {
      const logDir = getLogDir();
      expect(logDir).toContain('.claude');
      expect(logDir).toContain('logs');
      expect(logDir).toContain(IDENTITY.logDirName);
      expect(logDir.endsWith(IDENTITY.logDirName)).toBe(true);
    });

    it('should return an absolute path', () => {
      const logDir = getLogDir();
      expect(path.isAbsolute(logDir)).toBe(true);
    });

    it('should use CLAUDE_PLUGIN_DATA/logs when env var is set', () => {
      const testPluginDataDir = path.join(tmpHome, 'plugin-data');
      process.env['CLAUDE_PLUGIN_DATA'] = testPluginDataDir;
      resetLogDir();
      try {
        const logDir = getLogDir();
        expect(logDir).toBe(path.join(testPluginDataDir, 'logs'));
        // Asserting the prefix, not the ABSENCE of '.claude': the latter depends
        // on os.tmpdir() and fails under e.g. TMPDIR=~/.claude/tmp.
        expect(logDir.startsWith(testPluginDataDir)).toBe(true);
      } finally {
        delete process.env['CLAUDE_PLUGIN_DATA'];
        resetLogDir();
      }
    });

    it(`should fall back to HOME/.claude/logs/${IDENTITY.logDirName} when CLAUDE_PLUGIN_DATA is not set`, () => {
      delete process.env['CLAUDE_PLUGIN_DATA'];
      resetLogDir();
      const logDir = getLogDir();
      expect(logDir).toContain('.claude');
      expect(logDir).toContain('logs');
      expect(logDir.endsWith(IDENTITY.logDirName)).toBe(true);
    });
  });

  describe('getHookLogPath', () => {
    it('should return path to hooks.log', () => {
      const logPath = getHookLogPath();
      expect(logPath).toContain('hooks.log');
      expect(logPath.endsWith('hooks.log')).toBe(true);
    });

    it('should be under log directory', () => {
      const logPath = getHookLogPath();
      const logDir = getLogDir();
      expect(logPath.startsWith(logDir)).toBe(true);
    });
  });

  describe('getPermissionLogPath', () => {
    it('should return path to permission-feedback.log', () => {
      const logPath = getPermissionLogPath();
      expect(logPath).toContain('permission-feedback.log');
      expect(logPath.endsWith('permission-feedback.log')).toBe(true);
    });

    it('should be under log directory', () => {
      const logPath = getPermissionLogPath();
      const logDir = getLogDir();
      expect(logPath.startsWith(logDir)).toBe(true);
    });
  });

  // ===========================================================================
  // LOG LEVEL FILTERING TESTS
  // ===========================================================================

  describe('log level filtering', () => {
    describe('when log level is debug', () => {
      beforeEach(() => {
        process.env[LOG_LEVEL_ENV] = 'debug';
        resetLogLevel();
        _initialHookLogLines = getLineCount(getHookLogPath());
      });

      it('should log debug messages', () => {
        logDebug('test-hook', 'debug message');
        const lastLine = readLastLine(getHookLogPath());
        expect(lastLine).toContain('[DEBUG]');
        expect(lastLine).toContain('debug message');
      });

      it('should log info messages', () => {
        logInfo('test-hook', 'info message');
        const lastLine = readLastLine(getHookLogPath());
        expect(lastLine).toContain('[INFO]');
        expect(lastLine).toContain('info message');
      });

      it('should log warn messages', () => {
        logWarn('test-hook', 'warn message');
        const lastLine = readLastLine(getHookLogPath());
        expect(lastLine).toContain('[WARN]');
        expect(lastLine).toContain('warn message');
      });

      it('should log error messages', () => {
        logError('test-hook', 'error message');
        const lastLine = readLastLine(getHookLogPath());
        expect(lastLine).toContain('[ERROR]');
        expect(lastLine).toContain('error message');
      });
    });

    describe('when log level is info', () => {
      beforeEach(() => {
        process.env[LOG_LEVEL_ENV] = 'info';
        resetLogLevel();
        _initialHookLogLines = getLineCount(getHookLogPath());
      });

      it('should NOT log debug messages', () => {
        const beforeCount = getLineCount(getHookLogPath());
        logDebug('test-hook', 'debug message should not appear');
        const afterCount = getLineCount(getHookLogPath());
        expect(afterCount).toBe(beforeCount);
      });

      it('should log info messages', () => {
        logInfo('test-hook', 'info message');
        const lastLine = readLastLine(getHookLogPath());
        expect(lastLine).toContain('[INFO]');
      });

      it('should log warn messages', () => {
        logWarn('test-hook', 'warn message');
        const lastLine = readLastLine(getHookLogPath());
        expect(lastLine).toContain('[WARN]');
      });

      it('should log error messages', () => {
        logError('test-hook', 'error message');
        const lastLine = readLastLine(getHookLogPath());
        expect(lastLine).toContain('[ERROR]');
      });
    });

    describe('when log level is warn (default)', () => {
      beforeEach(() => {
        process.env[LOG_LEVEL_ENV] = 'warn';
        resetLogLevel();
        _initialHookLogLines = getLineCount(getHookLogPath());
      });

      it('should NOT log debug messages', () => {
        const beforeCount = getLineCount(getHookLogPath());
        logDebug('test-hook', 'debug message should not appear');
        const afterCount = getLineCount(getHookLogPath());
        expect(afterCount).toBe(beforeCount);
      });

      it('should NOT log info messages', () => {
        const beforeCount = getLineCount(getHookLogPath());
        logInfo('test-hook', 'info message should not appear');
        const afterCount = getLineCount(getHookLogPath());
        expect(afterCount).toBe(beforeCount);
      });

      it('should log warn messages', () => {
        logWarn('test-hook', 'warn message');
        const lastLine = readLastLine(getHookLogPath());
        expect(lastLine).toContain('[WARN]');
      });

      it('should log error messages', () => {
        logError('test-hook', 'error message');
        const lastLine = readLastLine(getHookLogPath());
        expect(lastLine).toContain('[ERROR]');
      });
    });

    describe('when log level is error', () => {
      beforeEach(() => {
        process.env[LOG_LEVEL_ENV] = 'error';
        resetLogLevel();
        _initialHookLogLines = getLineCount(getHookLogPath());
      });

      it('should NOT log debug messages', () => {
        const beforeCount = getLineCount(getHookLogPath());
        logDebug('test-hook', 'debug message should not appear');
        const afterCount = getLineCount(getHookLogPath());
        expect(afterCount).toBe(beforeCount);
      });

      it('should NOT log info messages', () => {
        const beforeCount = getLineCount(getHookLogPath());
        logInfo('test-hook', 'info message should not appear');
        const afterCount = getLineCount(getHookLogPath());
        expect(afterCount).toBe(beforeCount);
      });

      it('should NOT log warn messages', () => {
        const beforeCount = getLineCount(getHookLogPath());
        logWarn('test-hook', 'warn message should not appear');
        const afterCount = getLineCount(getHookLogPath());
        expect(afterCount).toBe(beforeCount);
      });

      it('should log error messages', () => {
        logError('test-hook', 'error message');
        const lastLine = readLastLine(getHookLogPath());
        expect(lastLine).toContain('[ERROR]');
      });
    });
  });

  // ===========================================================================
  // LOG FORMAT TESTS
  // ===========================================================================

  describe('log format', () => {
    beforeEach(() => {
      process.env[LOG_LEVEL_ENV] = 'debug';
      resetLogLevel();
    });

    describe('logDebug', () => {
      it('should format log line with timestamp, level, hook name, and message', () => {
        logDebug('pre-tool-use-security', 'Processing Write tool');
        const lastLine = readLastLine(getHookLogPath());

        // Format: TIMESTAMP [DEBUG] [hook-name] message
        expect(lastLine).toMatch(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[DEBUG\] \[pre-tool-use-security\] Processing Write tool$/
        );
      });

      it('should include ISO8601 timestamp with milliseconds', () => {
        logDebug('test-hook', 'message');
        const lastLine = readLastLine(getHookLogPath());

        // Extract timestamp
        const match = lastLine.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/);
        expect(match).not.toBeNull();

        // Should be a valid date
        const timestamp = match?.[1] ?? '';
        expect(timestamp).not.toBe('');
        expect(() => new Date(timestamp)).not.toThrow();
        expect(new Date(timestamp).toISOString()).toBe(timestamp);
      });
    });

    describe('logInfo', () => {
      it('should format log line correctly', () => {
        logInfo('session-start', 'Session initialized');
        const lastLine = readLastLine(getHookLogPath());

        expect(lastLine).toMatch(/\[INFO\] \[session-start\] Session initialized$/);
      });
    });

    describe('logWarn', () => {
      beforeEach(() => {
        process.env[LOG_LEVEL_ENV] = 'warn';
        resetLogLevel();
      });

      it('should format log line correctly', () => {
        logWarn('pre-tool-use-security', 'Suspicious path pattern detected');
        const lastLine = readLastLine(getHookLogPath());

        expect(lastLine).toMatch(
          /\[WARN\] \[pre-tool-use-security\] Suspicious path pattern detected$/
        );
      });
    });

    describe('logError', () => {
      it('should format log line correctly', () => {
        logError('pre-tool-use-security', 'Failed to parse hook input');
        const lastLine = readLastLine(getHookLogPath());

        expect(lastLine).toMatch(/\[ERROR\] \[pre-tool-use-security\] Failed to parse hook input$/);
      });
    });

    describe('message handling', () => {
      it('should preserve special characters in message', () => {
        logDebug('test', 'Message with <special> & "chars"');
        const lastLine = readLastLine(getHookLogPath());
        expect(lastLine).toContain('Message with <special> & "chars"');
      });

      it('should preserve unicode in message', () => {
        logDebug('test', 'Unicode: \u2714 \u26a0');
        const lastLine = readLastLine(getHookLogPath());
        expect(lastLine).toContain('Unicode: \u2714 \u26a0');
      });

      it('should handle empty message', () => {
        logDebug('test', '');
        const lastLine = readLastLine(getHookLogPath());
        // Format is: TIMESTAMP [DEBUG] [test] (no space after hookName when message is empty)
        expect(lastLine).toMatch(/\[DEBUG\] \[test\]$/);
      });

      it('should handle long messages', () => {
        const longMessage = 'A'.repeat(1000);
        logDebug('test', longMessage);
        const lastLine = readLastLine(getHookLogPath());
        expect(lastLine).toContain(longMessage);
      });
    });

    describe('hook name handling', () => {
      it('should handle various hook names', () => {
        const hookNames = [
          'pre-tool-use-security',
          'auto-approve-safe-bash',
          'post-tool-use-hook',
          'session-start',
          'simple',
        ];

        for (const hookName of hookNames) {
          logDebug(hookName, 'test');
          const lastLine = readLastLine(getHookLogPath());
          expect(lastLine).toContain(`[${hookName}]`);
        }
      });

      it('should handle empty hook name', () => {
        logDebug('', 'message');
        const lastLine = readLastLine(getHookLogPath());
        expect(lastLine).toContain('[] message');
      });
    });
  });

  // ===========================================================================
  // LOG DIRECTORY CREATION TESTS
  // ===========================================================================

  describe('log directory creation', () => {
    beforeEach(() => {
      process.env[LOG_LEVEL_ENV] = 'debug';
      resetLogLevel();
    });

    it('should ensure log directory exists after logging', () => {
      logDebug('test', 'message');

      const logDir = getLogDir();
      expect(fs.existsSync(logDir)).toBe(true);
    });

    it('should create hooks.log file', () => {
      logDebug('test', 'message');

      expect(fs.existsSync(getHookLogPath())).toBe(true);
    });

    it('should create permission-feedback.log file when logging permissions', () => {
      logPermission('allow', 'test', 'Bash', 'sess');

      expect(fs.existsSync(getPermissionLogPath())).toBe(true);
    });
  });

  // ===========================================================================
  // PERMISSION LOGGING TESTS
  // ===========================================================================

  describe('logPermission', () => {
    it('should log permission decision with correct format', () => {
      logPermission('allow', 'Safe read-only command', 'Bash', 'session-123');
      const lastLine = readLastLine(getPermissionLogPath());

      expect(lastLine).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[PERMISSION\] decision=allow tool=Bash session=session-123 reason="Safe read-only command"$/
      );
    });

    it('should log allow decisions', () => {
      logPermission('allow', 'Operation permitted', 'Write', 'sess-1');
      const lastLine = readLastLine(getPermissionLogPath());
      expect(lastLine).toContain('decision=allow');
    });

    it('should log deny decisions', () => {
      logPermission('deny', 'Operation blocked', 'Bash', 'sess-1');
      const lastLine = readLastLine(getPermissionLogPath());
      expect(lastLine).toContain('decision=deny');
    });

    it('should include tool name', () => {
      logPermission('allow', 'reason', 'Edit', 'sess-1');
      const lastLine = readLastLine(getPermissionLogPath());
      expect(lastLine).toContain('tool=Edit');
    });

    it('should include session ID', () => {
      logPermission('allow', 'reason', 'Read', 'unique-session-id');
      const lastLine = readLastLine(getPermissionLogPath());
      expect(lastLine).toContain('session=unique-session-id');
    });

    it('should prefer CLAUDE_CODE_SESSION_ID env var (CC v2.1.132+) when sessionId not provided', () => {
      process.env['CLAUDE_CODE_SESSION_ID'] = 'new-env-session';
      process.env['CLAUDE_SESSION_ID'] = 'old-env-session';
      logPermission('allow', 'reason', 'Glob');
      const lastLine = readLastLine(getPermissionLogPath());
      expect(lastLine).toContain('session=new-env-session');
    });

    it('should fall back to CLAUDE_SESSION_ID env var when CLAUDE_CODE_SESSION_ID not set', () => {
      delete process.env['CLAUDE_CODE_SESSION_ID'];
      process.env['CLAUDE_SESSION_ID'] = 'env-session-id';
      logPermission('allow', 'reason', 'Glob');
      const lastLine = readLastLine(getPermissionLogPath());
      expect(lastLine).toContain('session=env-session-id');
    });

    it('should use "unknown" when no session ID available', () => {
      delete process.env['CLAUDE_CODE_SESSION_ID'];
      delete process.env['CLAUDE_SESSION_ID'];
      logPermission('allow', 'reason', 'Grep');
      const lastLine = readLastLine(getPermissionLogPath());
      expect(lastLine).toContain('session=unknown');
    });

    it('should escape quotes in reason', () => {
      logPermission('deny', 'Cannot access "protected" file', 'Write', 'sess');
      const lastLine = readLastLine(getPermissionLogPath());
      expect(lastLine).toContain('reason="Cannot access \\"protected\\" file"');
    });

    it('should handle empty reason', () => {
      logPermission('allow', '', 'Bash', 'sess');
      const lastLine = readLastLine(getPermissionLogPath());
      expect(lastLine).toContain('reason=""');
    });

    it('should handle reason with special characters', () => {
      logPermission('deny', 'Path: /etc/passwd', 'Read', 'sess');
      const lastLine = readLastLine(getPermissionLogPath());
      expect(lastLine).toContain('reason="Path: /etc/passwd"');
    });

    it('should include agent_id when agentContext provided', () => {
      logPermission('deny', 'blocked', 'Bash', 'sess', {
        agentId: 'sub-agent-1',
      });
      const lastLine = readLastLine(getPermissionLogPath());
      expect(lastLine).toContain('agent_id=sub-agent-1');
    });

    it('should include agent_type when agentContext provided', () => {
      logPermission('allow', 'ok', 'Read', 'sess', {
        agentType: 'Explore',
      });
      const lastLine = readLastLine(getPermissionLogPath());
      expect(lastLine).toContain('agent_type=Explore');
    });

    it('should include both agent_id and agent_type', () => {
      logPermission('deny', 'blocked', 'Write', 'sess', {
        agentId: 'a-1',
        agentType: 'security-reviewer',
      });
      const lastLine = readLastLine(getPermissionLogPath());
      expect(lastLine).toContain('agent_id=a-1');
      expect(lastLine).toContain('agent_type=security-reviewer');
    });

    it('should omit agent fields when agentContext is undefined', () => {
      logPermission('allow', 'ok', 'Bash', 'sess', undefined);
      const lastLine = readLastLine(getPermissionLogPath());
      expect(lastLine).not.toContain('agent_id');
      expect(lastLine).not.toContain('agent_type');
    });

    it('should sanitize newlines in agent fields', () => {
      logPermission('deny', 'blocked', 'Bash', 'sess', {
        agentId: 'evil\nagent',
        agentType: 'bad\rtype',
      });
      const lastLine = readLastLine(getPermissionLogPath());
      expect(lastLine).toContain('agent_id=evil agent');
      expect(lastLine).toContain('agent_type=bad type');
      // Ensure no multi-line log entry
      expect(lastLine).not.toContain('\n');
    });

    it('should always log regardless of log level', () => {
      process.env[LOG_LEVEL_ENV] = 'error';
      resetLogLevel();

      logPermission('allow', 'test', 'Bash', 'sess');
      const lastLine = readLastLine(getPermissionLogPath());
      expect(lastLine).toContain('[PERMISSION]');
    });
  });

  describe('logPermissionEntry', () => {
    it('should log permission entry using PermissionLogEntry interface', () => {
      const entry: PermissionLogEntry = {
        timestamp: new Date().toISOString(),
        decision: 'deny',
        reason: 'Environment file access blocked',
        tool: 'Write',
        sessionId: 'session-456',
        target: '/path/to/.env',
      };

      logPermissionEntry(entry);
      const lastLine = readLastLine(getPermissionLogPath());

      expect(lastLine).toContain('decision=deny');
      expect(lastLine).toContain('tool=Write');
      expect(lastLine).toContain('session=session-456');
      expect(lastLine).toContain('reason="Environment file access blocked"');
    });

    it('should map warn decision to allow', () => {
      const entry: PermissionLogEntry = {
        timestamp: new Date().toISOString(),
        decision: 'warn',
        reason: 'Warning issued',
        tool: 'Bash',
        sessionId: 'sess',
      };

      logPermissionEntry(entry);
      const lastLine = readLastLine(getPermissionLogPath());

      // 'warn' should be mapped to 'allow' for the simple log format
      expect(lastLine).toContain('decision=allow');
    });

    it('should handle allow decision', () => {
      const entry: PermissionLogEntry = {
        timestamp: new Date().toISOString(),
        decision: 'allow',
        reason: 'Safe operation',
        tool: 'Read',
        sessionId: 'sess',
      };

      logPermissionEntry(entry);
      const lastLine = readLastLine(getPermissionLogPath());
      expect(lastLine).toContain('decision=allow');
    });

    it('should handle deny decision', () => {
      const entry: PermissionLogEntry = {
        timestamp: new Date().toISOString(),
        decision: 'deny',
        reason: 'Blocked operation',
        tool: 'Edit',
        sessionId: 'sess',
      };

      logPermissionEntry(entry);
      const lastLine = readLastLine(getPermissionLogPath());
      expect(lastLine).toContain('decision=deny');
    });
  });

  // ===========================================================================
  // LOGGER FACTORY TESTS
  // ===========================================================================

  describe('createLogger', () => {
    beforeEach(() => {
      process.env[LOG_LEVEL_ENV] = 'debug';
      resetLogLevel();
    });

    it('should create a logger with all methods', () => {
      const logger = createLogger('test-hook');

      expect(typeof logger.debug).toBe('function');
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.error).toBe('function');
      expect(typeof logger.permission).toBe('function');
    });

    it('should log debug messages', () => {
      const logger = createLogger('test');
      logger.debug('test-hook', 'debug message');

      const lastLine = readLastLine(getHookLogPath());
      expect(lastLine).toContain('[DEBUG]');
      expect(lastLine).toContain('[test-hook]');
      expect(lastLine).toContain('debug message');
    });

    it('should log info messages', () => {
      const logger = createLogger('test');
      logger.info('test-hook', 'info message');

      const lastLine = readLastLine(getHookLogPath());
      expect(lastLine).toContain('[INFO]');
    });

    it('should log warn messages', () => {
      const logger = createLogger('test');
      logger.warn('test-hook', 'warn message');

      const lastLine = readLastLine(getHookLogPath());
      expect(lastLine).toContain('[WARN]');
    });

    it('should log error messages', () => {
      const logger = createLogger('test');
      logger.error('test-hook', 'error message');

      const lastLine = readLastLine(getHookLogPath());
      expect(lastLine).toContain('[ERROR]');
    });

    it('should log permission entries', () => {
      const logger = createLogger('test');
      logger.permission({
        timestamp: new Date().toISOString(),
        decision: 'allow',
        reason: 'Safe command',
        tool: 'Bash',
        sessionId: 'session-123',
      });

      const lastLine = readLastLine(getPermissionLogPath());
      expect(lastLine).toContain('[PERMISSION]');
      expect(lastLine).toContain('decision=allow');
    });
  });

  describe('createScopedLogger', () => {
    beforeEach(() => {
      process.env[LOG_LEVEL_ENV] = 'debug';
      resetLogLevel();
    });

    it('should create a scoped logger with all methods', () => {
      const log = createScopedLogger('auto-approve-safe-bash');

      expect(typeof log.debug).toBe('function');
      expect(typeof log.info).toBe('function');
      expect(typeof log.warn).toBe('function');
      expect(typeof log.error).toBe('function');
      expect(typeof log.permission).toBe('function');
    });

    it('should automatically use the hook name for debug', () => {
      const log = createScopedLogger('my-hook');
      log.debug('Processing command');

      const lastLine = readLastLine(getHookLogPath());
      expect(lastLine).toContain('[my-hook]');
      expect(lastLine).toContain('Processing command');
    });

    it('should automatically use the hook name for info', () => {
      const log = createScopedLogger('my-hook');
      log.info('Command approved');

      const lastLine = readLastLine(getHookLogPath());
      expect(lastLine).toContain('[my-hook]');
    });

    it('should automatically use the hook name for warn', () => {
      const log = createScopedLogger('my-hook');
      log.warn('Suspicious pattern');

      const lastLine = readLastLine(getHookLogPath());
      expect(lastLine).toContain('[my-hook]');
    });

    it('should automatically use the hook name for error', () => {
      const log = createScopedLogger('my-hook');
      log.error('Failed to process');

      const lastLine = readLastLine(getHookLogPath());
      expect(lastLine).toContain('[my-hook]');
    });

    it('should log permission with parameters', () => {
      const log = createScopedLogger('my-hook');
      log.permission('allow', 'Read-only command', 'Bash', 'session-1');

      const lastLine = readLastLine(getPermissionLogPath());
      expect(lastLine).toContain('decision=allow');
      expect(lastLine).toContain('tool=Bash');
      expect(lastLine).toContain('session=session-1');
      expect(lastLine).toContain('Read-only command');
    });

    it('should allow omitting sessionId in permission call', () => {
      delete process.env['CLAUDE_CODE_SESSION_ID'];
      process.env['CLAUDE_SESSION_ID'] = 'env-session';
      const log = createScopedLogger('my-hook');
      log.permission('deny', 'Blocked', 'Write');

      const lastLine = readLastLine(getPermissionLogPath());
      expect(lastLine).toContain('session=env-session');
    });
  });

  // ===========================================================================
  // FILE WRITING TESTS
  // ===========================================================================

  describe('file writing', () => {
    beforeEach(() => {
      process.env[LOG_LEVEL_ENV] = 'debug';
      resetLogLevel();
    });

    it('should append to existing log file', () => {
      const beforeCount = getLineCount(getHookLogPath());

      logDebug('hook1', 'message 1');
      logDebug('hook2', 'message 2');
      logDebug('hook3', 'message 3');

      const afterCount = getLineCount(getHookLogPath());
      expect(afterCount - beforeCount).toBe(3);

      const lastLines = readLastNLines(getHookLogPath(), 3);
      expect(lastLines[0]).toContain('message 1');
      expect(lastLines[1]).toContain('message 2');
      expect(lastLines[2]).toContain('message 3');
    });

    it('should add newline after each log entry', () => {
      logDebug('test', 'message');

      const content = fs.readFileSync(getHookLogPath(), 'utf8');
      expect(content.endsWith('\n')).toBe(true);
    });

    it('should write to hooks.log for standard log functions', () => {
      logDebug('test', 'debug');
      logInfo('test', 'info');
      logWarn('test', 'warn');
      logError('test', 'error');

      expect(fs.existsSync(getHookLogPath())).toBe(true);
    });

    it('should write to permission-feedback.log for permission logs', () => {
      logPermission('allow', 'test', 'Bash', 'sess');

      expect(fs.existsSync(getPermissionLogPath())).toBe(true);
    });

    it('should keep hooks.log and permission-feedback.log separate', () => {
      const uniqueHookMarker = `hook-marker-${Date.now()}`;
      const uniquePermMarker = `perm-marker-${Date.now()}`;

      logDebug('test', uniqueHookMarker);
      logPermission('allow', uniquePermMarker, 'Bash', 'sess');

      const hookContent = fs.readFileSync(getHookLogPath(), 'utf8');
      const permContent = fs.readFileSync(getPermissionLogPath(), 'utf8');

      expect(hookContent).toContain(uniqueHookMarker);
      expect(hookContent).not.toContain(uniquePermMarker);

      expect(permContent).toContain(uniquePermMarker);
      expect(permContent).not.toContain(uniqueHookMarker);
    });
  });

  // ===========================================================================
  // MULTIPLE LOG ENTRIES TESTS
  // ===========================================================================

  describe('multiple log entries', () => {
    beforeEach(() => {
      process.env[LOG_LEVEL_ENV] = 'debug';
      resetLogLevel();
    });

    it('should maintain order of log entries', () => {
      const startCount = getLineCount(getHookLogPath());

      for (let i = 1; i <= 10; i++) {
        logDebug('test', `message ${i}`);
      }

      const endCount = getLineCount(getHookLogPath());
      expect(endCount - startCount).toBe(10);

      const lastLines = readLastNLines(getHookLogPath(), 10);
      for (let i = 0; i < 10; i++) {
        expect(lastLines[i]).toContain(`message ${i + 1}`);
      }
    });

    it('should handle rapid sequential logging', () => {
      const count = 100;
      const startCount = getLineCount(getHookLogPath());

      for (let i = 0; i < count; i++) {
        logDebug('rapid-test', `entry-${i}`);
      }

      const endCount = getLineCount(getHookLogPath());
      expect(endCount - startCount).toBe(count);
    });

    it('should handle mixed log levels', () => {
      const startCount = getLineCount(getHookLogPath());

      logDebug('test', 'debug');
      logInfo('test', 'info');
      logWarn('test', 'warn');
      logError('test', 'error');

      const endCount = getLineCount(getHookLogPath());
      expect(endCount - startCount).toBe(4);

      const lastLines = readLastNLines(getHookLogPath(), 4);
      expect(lastLines[0]).toContain('[DEBUG]');
      expect(lastLines[1]).toContain('[INFO]');
      expect(lastLines[2]).toContain('[WARN]');
      expect(lastLines[3]).toContain('[ERROR]');
    });
  });

  // ===========================================================================
  // TIMESTAMP TESTS
  // ===========================================================================

  describe('timestamps', () => {
    beforeEach(() => {
      process.env[LOG_LEVEL_ENV] = 'debug';
      resetLogLevel();
    });

    it('should use ISO8601 format', () => {
      logDebug('test', 'message');
      const lastLine = readLastLine(getHookLogPath());

      // ISO8601 format: YYYY-MM-DDTHH:mm:ss.sssZ
      const timestampMatch = lastLine.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/);
      expect(timestampMatch).not.toBeNull();
    });

    it('should include milliseconds', () => {
      logDebug('test', 'message');
      const lastLine = readLastLine(getHookLogPath());

      // Should have .NNN before Z
      expect(lastLine).toMatch(/T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
    });

    it('should use UTC timezone (Z suffix)', () => {
      logDebug('test', 'message');
      const lastLine = readLastLine(getHookLogPath());

      const timestampMatch = lastLine.match(/^([^\s]+)/);
      expect(timestampMatch).not.toBeNull();
      expect(timestampMatch?.[1]?.endsWith('Z')).toBe(true);
    });

    it('should have valid timestamps for sequential logs', () => {
      logDebug('test', 'first');
      // Small delay to ensure different timestamp
      const start = Date.now();
      while (Date.now() - start < 5) {
        // Busy wait
      }
      logDebug('test', 'second');

      const lastLines = readLastNLines(getHookLogPath(), 2);
      const line0 = lastLines[0] ?? '';
      const line1 = lastLines[1] ?? '';
      const ts1Match = line0.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/);
      const ts2Match = line1.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/);

      expect(ts1Match).not.toBeNull();
      expect(ts2Match).not.toBeNull();

      const ts1 = new Date(ts1Match?.[1] ?? '').getTime();
      const ts2 = new Date(ts2Match?.[1] ?? '').getTime();

      expect(ts1).toBeLessThanOrEqual(ts2);
    });
  });
});
