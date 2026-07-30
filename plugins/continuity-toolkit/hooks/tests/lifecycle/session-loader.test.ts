/**
 * Tests for session-loader hook
 *
 * These tests verify that the SessionStart hook correctly:
 * - Initializes continuity structure on first run
 * - Detects stale sessions
 * - Resets dirty tracking
 * - Outputs compact ledger summary
 * - Handles lock acquisition
 * - Keeps output under 1KB
 *
 * @module tests/lifecycle/session-loader
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONTINUITY_DIRS } from '../../src/lib/continuity.js';
import { sessionLoader, shellEscape } from '../../src/lifecycle/session-loader.js';
import type { HookInput } from '../../src/types.js';

// =============================================================================
// TEST HELPERS
// =============================================================================

/**
 * Create a mock HookInput for testing.
 */
/**
 * Session id every test in this file stamps under.
 *
 * `sessionLoader` writes a hook-liveness marker (#82) keyed by session id, into
 * the real temp directory. Without an explicit id here the resolver falls through
 * to `CLAUDE_CODE_SESSION_ID`, which is set in any live Claude Code session — so
 * the suite would write a marker for the DEVELOPER'S OWN session and make
 * `/ctk:doctor` report hooks alive when they might not be. Pinning a distinctive
 * id keeps the pollution inert and lets `afterEach` remove it.
 */
const TEST_SESSION_ID = 'test-session-loader-liveness';

function livenessFile(sessionId: string): string {
  return path.join(os.tmpdir(), `claude-ctk-hook-alive-${sessionId}.txt`);
}

function createMockInput(sessionId: string = TEST_SESSION_ID): HookInput {
  return {
    tool_name: 'SessionStart',
    tool_input: {},
    session_id: sessionId,
  };
}

/**
 * Create a temporary directory for testing.
 */
function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'session-loader-test-'));
}

/**
 * Create full continuity directory structure.
 */
function createFullStructure(projectDir: string): void {
  for (const dir of Object.values(CONTINUITY_DIRS)) {
    fs.mkdirSync(path.join(projectDir, dir), { recursive: true });
  }
}

/**
 * Create a shared-context.json file with specified content.
 */
function createContextFile(projectDir: string, overrides: Record<string, unknown> = {}): string {
  const contextFile = path.join(projectDir, CONTINUITY_DIRS.context, 'shared-context.json');
  const defaultContext = {
    version: '1.0.0',
    session_heartbeat: {
      last_activity: null,
      session_start: null,
      was_cleanly_ended: true,
    },
    dirty_tracking: {
      files_edited_count: 0,
      files_edited_this_session: [],
      last_edit_timestamp: null,
      threshold_warning: 15,
      threshold_auto_suggest: 25,
    },
    ...overrides,
  };
  fs.writeFileSync(contextFile, JSON.stringify(defaultContext, null, 2));
  return contextFile;
}

/**
 * Create a ledger file with realistic content.
 */
function createLedgerFile(
  projectDir: string,
  content = `# Project Ledger: test

## Current State

### Now
- **Branch**: \`main\`
- **Status**: Ready for development

### Done (Recent)
1. Initialized continuity system

### Next
- Begin development work
`
): string {
  const ledgerPath = path.join(projectDir, CONTINUITY_DIRS.ledgers, 'CONTINUITY_test.md');
  fs.writeFileSync(ledgerPath, content);
  return ledgerPath;
}

/**
 * Create a .git directory with HEAD file.
 */
function createGitRepo(projectDir: string, branch = 'main'): void {
  const gitDir = path.join(projectDir, '.git');
  fs.mkdirSync(gitDir, { recursive: true });
  fs.writeFileSync(path.join(gitDir, 'HEAD'), `ref: refs/heads/${branch}\n`);
}

/**
 * Clean up a temporary directory.
 */
function cleanupTempDir(tempDir: string): void {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

// =============================================================================
// TESTS
// =============================================================================

describe('session-loader', () => {
  const originalEnv = { ...process.env };
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    process.env['CLAUDE_PROJECT_DIR'] = tempDir;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    cleanupTempDir(tempDir);

    // Remove the liveness marker this suite stamps into the real temp directory,
    // where the developer's own statusline and `/ctk:doctor` would otherwise read it.
    try {
      fs.unlinkSync(livenessFile(TEST_SESSION_ID));
    } catch {
      // Ignore
    }

    // Clean up any leftover lock directories
    try {
      const lockDir = path.join(tempDir, CONTINUITY_DIRS.context, 'shared-context.json.lock');
      if (fs.existsSync(lockDir)) {
        fs.rmSync(lockDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore
    }
  });

  // ===========================================================================
  // Structure Initialization
  // ===========================================================================

  describe('structure initialization', () => {
    it('should create continuity structure on first run', async () => {
      const result = await sessionLoader(createMockInput());

      expect(result.continue).toBe(true);
      expect(result.systemMessage).toContain('Continuity initialized');

      // Verify directories were created
      expect(fs.existsSync(path.join(tempDir, CONTINUITY_DIRS.base))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, CONTINUITY_DIRS.ledgers))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, CONTINUITY_DIRS.handoffs))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, CONTINUITY_DIRS.context))).toBe(true);
    });

    it('should not show initialization message on subsequent runs', async () => {
      // First run - initializes
      await sessionLoader(createMockInput());

      // Reset was_cleanly_ended to avoid stale session warning
      const contextFile = path.join(tempDir, CONTINUITY_DIRS.context, 'shared-context.json');
      const content = JSON.parse(fs.readFileSync(contextFile, 'utf8'));
      content.session_heartbeat.was_cleanly_ended = true;
      fs.writeFileSync(contextFile, JSON.stringify(content, null, 2));

      // Second run - should not show initialization message
      const result = await sessionLoader(createMockInput());

      expect(result.systemMessage).not.toContain('Continuity initialized');
    });

    it('should include /save-state reference in initialization message', async () => {
      const result = await sessionLoader(createMockInput());

      expect(result.systemMessage).toContain('/save-state');
    });
  });

  // ===========================================================================
  // Stale Session Detection
  // ===========================================================================

  describe('stale session detection', () => {
    it('should detect stale session when was_cleanly_ended is false', async () => {
      createFullStructure(tempDir);
      createContextFile(tempDir, {
        session_heartbeat: {
          was_cleanly_ended: false,
          last_activity: '2024-01-01T12:00:00Z',
        },
      });

      const result = await sessionLoader(createMockInput());

      expect(result.systemMessage).toContain('Previous session ended without handoff');
    });

    it('should show timestamp in stale session warning', async () => {
      createFullStructure(tempDir);
      createContextFile(tempDir, {
        session_heartbeat: {
          was_cleanly_ended: false,
          last_activity: '2024-01-01T12:00:00Z',
        },
      });

      const result = await sessionLoader(createMockInput());

      expect(result.systemMessage).toContain('2024-01-01');
    });

    it('should not show stale warning when was_cleanly_ended is true', async () => {
      createFullStructure(tempDir);
      createContextFile(tempDir, {
        session_heartbeat: {
          was_cleanly_ended: true,
          last_activity: '2024-01-01T12:00:00Z',
        },
      });

      const result = await sessionLoader(createMockInput());

      expect(result.systemMessage).not.toContain('Previous session ended without handoff');
    });

    it('should include /save-state suggestion in stale warning', async () => {
      createFullStructure(tempDir);
      createContextFile(tempDir, {
        session_heartbeat: {
          was_cleanly_ended: false,
        },
      });

      const result = await sessionLoader(createMockInput());

      expect(result.systemMessage).toContain('/save-state');
    });
  });

  // ===========================================================================
  // Dirty Tracking Reset
  // ===========================================================================

  describe('dirty tracking reset', () => {
    it('should reset files_edited_count to 0', async () => {
      createFullStructure(tempDir);
      createContextFile(tempDir, {
        dirty_tracking: {
          files_edited_count: 10,
          files_edited_this_session: ['a.ts', 'b.ts'],
        },
      });

      await sessionLoader(createMockInput());

      const contextFile = path.join(tempDir, CONTINUITY_DIRS.context, 'shared-context.json');
      const content = JSON.parse(fs.readFileSync(contextFile, 'utf8'));

      expect(content.dirty_tracking.files_edited_count).toBe(0);
    });

    it('should reset files_edited_this_session to empty array', async () => {
      createFullStructure(tempDir);
      createContextFile(tempDir, {
        dirty_tracking: {
          files_edited_count: 3,
          files_edited_this_session: ['x.ts', 'y.ts', 'z.ts'],
        },
      });

      await sessionLoader(createMockInput());

      const contextFile = path.join(tempDir, CONTINUITY_DIRS.context, 'shared-context.json');
      const content = JSON.parse(fs.readFileSync(contextFile, 'utf8'));

      expect(content.dirty_tracking.files_edited_this_session).toEqual([]);
    });

    it('should set was_cleanly_ended to false', async () => {
      createFullStructure(tempDir);
      createContextFile(tempDir, {
        session_heartbeat: {
          was_cleanly_ended: true,
        },
      });

      await sessionLoader(createMockInput());

      const contextFile = path.join(tempDir, CONTINUITY_DIRS.context, 'shared-context.json');
      const content = JSON.parse(fs.readFileSync(contextFile, 'utf8'));

      expect(content.session_heartbeat.was_cleanly_ended).toBe(false);
    });

    it('should set session_start timestamp', async () => {
      createFullStructure(tempDir);
      createContextFile(tempDir);

      const before = new Date();
      await sessionLoader(createMockInput());
      const after = new Date();

      const contextFile = path.join(tempDir, CONTINUITY_DIRS.context, 'shared-context.json');
      const content = JSON.parse(fs.readFileSync(contextFile, 'utf8'));

      const sessionStart = new Date(content.session_heartbeat.session_start);
      expect(sessionStart.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
      expect(sessionStart.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
    });
  });

  // ===========================================================================
  // Ledger Summary Output
  // ===========================================================================

  describe('ledger summary output', () => {
    it('should output compact ledger summary', async () => {
      createFullStructure(tempDir);
      createContextFile(tempDir);
      createLedgerFile(tempDir);

      const result = await sessionLoader(createMockInput());

      // Check for summary fields, not full ledger
      expect(result.systemMessage).toContain('Status:');
      expect(result.systemMessage).toContain('Recent:');
      expect(result.systemMessage).toContain('Next:');
    });

    it('should extract status from Now section', async () => {
      createFullStructure(tempDir);
      createContextFile(tempDir);
      createLedgerFile(
        tempDir,
        `## Current State

### Now
- **Branch**: \`feature-branch\`

### Done (Recent)
1. Did stuff

### Next
- More stuff
`
      );

      const result = await sessionLoader(createMockInput());

      expect(result.systemMessage).toContain('Branch: `feature-branch`');
    });

    it('should extract recent work from Done section', async () => {
      createFullStructure(tempDir);
      createContextFile(tempDir);
      createLedgerFile(
        tempDir,
        `## Current State

### Now
Working

### Done (Recent)
1. First task
2. Second task
3. Most recent completed task

### Next
- Future work
`
      );

      const result = await sessionLoader(createMockInput());

      expect(result.systemMessage).toContain('Recent: Most recent completed task');
    });

    it('should extract next item from Next section', async () => {
      createFullStructure(tempDir);
      createContextFile(tempDir);
      createLedgerFile(
        tempDir,
        `## Current State

### Now
Working

### Done (Recent)
1. Done

### Next
- First next item to do
- Second item
`
      );

      const result = await sessionLoader(createMockInput());

      expect(result.systemMessage).toContain('Next: First next item to do');
    });

    it('should handle missing ledger gracefully', async () => {
      createFullStructure(tempDir);
      createContextFile(tempDir);
      // Don't create ledger file

      const result = await sessionLoader(createMockInput());

      // Should still succeed without crashing
      expect(result.continue).toBe(true);
    });
  });

  // ===========================================================================
  // Git Branch Output
  // ===========================================================================

  describe('git branch output', () => {
    it('should include branch name when in git repo', async () => {
      createFullStructure(tempDir);
      createContextFile(tempDir);
      createGitRepo(tempDir, 'feature/my-feature');

      const result = await sessionLoader(createMockInput());

      expect(result.systemMessage).toContain('Branch: feature/my-feature');
    });

    it('should not include git branch line when not in git repo', async () => {
      createFullStructure(tempDir);
      createContextFile(tempDir);
      // Don't create .git directory - remove any ledger to avoid "Branch:" from ledger summary

      // Remove the auto-created ledger to ensure no "Branch:" in output
      const ledgersDir = path.join(tempDir, CONTINUITY_DIRS.ledgers);
      const files = fs.readdirSync(ledgersDir);
      for (const file of files) {
        if (file.endsWith('.md')) {
          fs.unlinkSync(path.join(ledgersDir, file));
        }
      }

      const result = await sessionLoader(createMockInput());

      // The git branch line format is "Branch: <name>\n" at the start of context
      // Should not have a standalone Branch: line (only from git detection)
      expect(result.systemMessage).not.toMatch(/^Branch: /m);
    });
  });

  // ===========================================================================
  // Lock Handling
  // ===========================================================================

  describe('lock handling', () => {
    it('should release lock after successful operation', async () => {
      createFullStructure(tempDir);
      createContextFile(tempDir);

      await sessionLoader(createMockInput());

      const lockDir = path.join(tempDir, CONTINUITY_DIRS.context, 'shared-context.json.lock');
      expect(fs.existsSync(lockDir)).toBe(false);
    });

    it('should handle missing context file gracefully', async () => {
      createFullStructure(tempDir);
      // Don't create context file

      const result = await sessionLoader(createMockInput());

      // Should still succeed (will be created by ensureContinuityStructure)
      expect(result.continue).toBe(true);
    });
  });

  // ===========================================================================
  // Output Format
  // ===========================================================================

  describe('output format', () => {
    it('should include session context header', async () => {
      createFullStructure(tempDir);
      createContextFile(tempDir);

      const result = await sessionLoader(createMockInput());

      expect(result.systemMessage).toContain('=== SESSION CONTEXT ===');
    });

    it('should include /resume-session footer', async () => {
      createFullStructure(tempDir);
      createContextFile(tempDir);

      const result = await sessionLoader(createMockInput());

      expect(result.systemMessage).toContain('/resume-session');
      expect(result.systemMessage).toContain('full context');
    });

    it('should always return continue=true', async () => {
      const result = await sessionLoader(createMockInput());

      expect(result.continue).toBe(true);
    });

    it('should not have suppressOutput set', async () => {
      const result = await sessionLoader(createMockInput());

      expect(result.suppressOutput).toBeUndefined();
    });
  });

  // ===========================================================================
  // Output Size (Compact Format)
  // ===========================================================================

  describe('output size', () => {
    it('should produce output under 1KB for normal session', async () => {
      createFullStructure(tempDir);
      createContextFile(tempDir);
      createLedgerFile(tempDir);
      createGitRepo(tempDir, 'main');

      const result = await sessionLoader(createMockInput());

      const outputSize = Buffer.byteLength(result.systemMessage || '', 'utf8');
      expect(outputSize).toBeLessThan(1024);
    });

    it('should produce output under 1KB even with stale session', async () => {
      createFullStructure(tempDir);
      createContextFile(tempDir, {
        session_heartbeat: {
          was_cleanly_ended: false,
          last_activity: '2024-01-01T12:00:00Z',
        },
        dirty_tracking: {
          files_edited_count: 10,
        },
      });
      createLedgerFile(tempDir);
      createGitRepo(tempDir, 'feature/branch');

      const result = await sessionLoader(createMockInput());

      const outputSize = Buffer.byteLength(result.systemMessage || '', 'utf8');
      expect(outputSize).toBeLessThan(1024);
    });

    it('should NOT include skills index in output', async () => {
      createFullStructure(tempDir);
      createContextFile(tempDir);

      const result = await sessionLoader(createMockInput());

      // Skills index was removed in v1.0.7
      expect(result.systemMessage).not.toContain('## Skills Index');
      expect(result.systemMessage).not.toContain('postgresql-master');
    });

    it('should NOT include handoff content in output', async () => {
      createFullStructure(tempDir);
      createContextFile(tempDir);

      // Create a handoff file
      const handoffPath = path.join(tempDir, CONTINUITY_DIRS.handoffs, 'handoff-2024.md');
      fs.writeFileSync(handoffPath, '# Session Handoff\n\nThis is handoff content.');

      const result = await sessionLoader(createMockInput());

      // Handoff content was removed in v1.0.7
      expect(result.systemMessage).not.toContain('## Latest Handoff');
      expect(result.systemMessage).not.toContain('This is handoff content');
    });

    it('should NOT include full ledger content', async () => {
      createFullStructure(tempDir);
      createContextFile(tempDir);

      // Create a ledger with lots of content
      const ledgerContent = `# Project Ledger: test

> Last updated: 2024-01-01T00:00:00Z

## Current State

### Now
- **Branch**: \`main\`

### Done (Recent)
1. Task one

### Next
- Future task

## Session Activity Log

### 2024-01-01 - Session
- Did lots of work here
- More work
- Even more work

## Key Decisions

1. Decision one with lots of text and explanation
2. Decision two with more text

## Open Questions

### Blocking
- Question one
- Question two

### Non-blocking
- Question three
`;
      createLedgerFile(tempDir, ledgerContent);

      const result = await sessionLoader(createMockInput());

      // Should not contain full ledger sections
      expect(result.systemMessage).not.toContain('## Session Activity Log');
      expect(result.systemMessage).not.toContain('## Key Decisions');
      expect(result.systemMessage).not.toContain('## Open Questions');
      expect(result.systemMessage).not.toContain('Did lots of work here');
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe('edge cases', () => {
    it('should handle empty ledger file', async () => {
      createFullStructure(tempDir);
      createContextFile(tempDir);
      createLedgerFile(tempDir, '');

      const result = await sessionLoader(createMockInput());

      expect(result.continue).toBe(true);
    });

    it('should handle ledger with unicode content', async () => {
      createFullStructure(tempDir);
      createContextFile(tempDir);
      createLedgerFile(
        tempDir,
        `## Current State

### Now
Status: ✔ ⚠ 🎉

### Done (Recent)
1. Task done ✅

### Next
- Future task
`
      );

      const result = await sessionLoader(createMockInput());

      expect(result.systemMessage).toContain('✔');
    });

    it('should handle project dir with spaces', async () => {
      const spacedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session test with spaces-'));
      process.env['CLAUDE_PROJECT_DIR'] = spacedDir;

      try {
        const result = await sessionLoader(createMockInput());

        expect(result.continue).toBe(true);
        expect(fs.existsSync(path.join(spacedDir, CONTINUITY_DIRS.base))).toBe(true);
      } finally {
        cleanupTempDir(spacedDir);
      }
    });

    it('should handle missing CLAUDE_PROJECT_DIR by using current directory', async () => {
      delete process.env['CLAUDE_PROJECT_DIR'];

      // This will use '.' as project dir, which is fine for testing
      const result = await sessionLoader(createMockInput());

      expect(result.continue).toBe(true);
    });

    it('should handle corrupted context file gracefully', async () => {
      createFullStructure(tempDir);
      const contextFile = path.join(tempDir, CONTINUITY_DIRS.context, 'shared-context.json');
      fs.writeFileSync(contextFile, 'invalid json {{{');

      const result = await sessionLoader(createMockInput());

      // Should still succeed, just won't detect stale session
      expect(result.continue).toBe(true);
    });

    it('should handle unreadable ledger file gracefully', async () => {
      createFullStructure(tempDir);
      createContextFile(tempDir);
      const ledgerPath = createLedgerFile(tempDir);

      // Make ledger unreadable to trigger the catch branch in outputLedgerSummary
      fs.chmodSync(ledgerPath, 0o000);

      try {
        const result = await sessionLoader(createMockInput());

        // Should still succeed — unreadable ledger yields empty summary, not a crash
        expect(result.continue).toBe(true);
      } finally {
        fs.chmodSync(ledgerPath, 0o644);
      }
    });

    it('should handle continuity structure init failure gracefully', async () => {
      // Block directory creation by placing a file where a directory is expected
      const baseDir = path.join(tempDir, CONTINUITY_DIRS.base);
      fs.mkdirSync(path.dirname(baseDir), { recursive: true });
      fs.writeFileSync(baseDir, 'blocker'); // file where dir should be

      const result = await sessionLoader(createMockInput());

      // Should still return a valid HookResult even when ensureContinuityStructure errors
      expect(result.continue).toBe(true);
    });
  });

  // ===========================================================================
  // CLAUDE_ENV_FILE Support
  // ===========================================================================

  describe('CLAUDE_ENV_FILE', () => {
    it('should write env vars to CLAUDE_ENV_FILE when set', async () => {
      createFullStructure(tempDir);
      createContextFile(tempDir);

      const envFile = path.join(tempDir, 'env-file');
      fs.writeFileSync(envFile, ''); // Create empty file
      process.env['CLAUDE_ENV_FILE'] = envFile;

      // Ensure CONTINUITY_LOG_LEVEL is not set so it gets written
      delete process.env['CONTINUITY_LOG_LEVEL'];

      await sessionLoader(createMockInput());

      const content = fs.readFileSync(envFile, 'utf8');
      expect(content).toContain("export CONTINUITY_LOG_LEVEL='warn'");
    });

    it('should skip when CLAUDE_ENV_FILE is not set', async () => {
      createFullStructure(tempDir);
      createContextFile(tempDir);

      delete process.env['CLAUDE_ENV_FILE'];

      // Should not throw
      const result = await sessionLoader(createMockInput());
      expect(result.continue).toBe(true);
    });

    it('should not overwrite existing CONTINUITY_LOG_LEVEL', async () => {
      createFullStructure(tempDir);
      createContextFile(tempDir);

      const envFile = path.join(tempDir, 'env-file');
      fs.writeFileSync(envFile, '');
      process.env['CLAUDE_ENV_FILE'] = envFile;
      process.env['CONTINUITY_LOG_LEVEL'] = 'debug';

      await sessionLoader(createMockInput());

      const content = fs.readFileSync(envFile, 'utf8');
      expect(content).not.toContain('CONTINUITY_LOG_LEVEL');
    });

    it('should not overwrite existing CLAUDE_PROJECT_DIR', async () => {
      createFullStructure(tempDir);
      createContextFile(tempDir);

      const envFile = path.join(tempDir, 'env-file');
      fs.writeFileSync(envFile, '');
      process.env['CLAUDE_ENV_FILE'] = envFile;
      // CLAUDE_PROJECT_DIR is already set in beforeEach

      delete process.env['CONTINUITY_LOG_LEVEL'];
      await sessionLoader(createMockInput());

      const content = fs.readFileSync(envFile, 'utf8');
      expect(content).not.toContain('CLAUDE_PROJECT_DIR');
    });

    it('should append to existing env file content', async () => {
      createFullStructure(tempDir);
      createContextFile(tempDir);

      const envFile = path.join(tempDir, 'env-file');
      fs.writeFileSync(envFile, "export EXISTING_VAR='value'\n");
      process.env['CLAUDE_ENV_FILE'] = envFile;
      delete process.env['CONTINUITY_LOG_LEVEL'];

      await sessionLoader(createMockInput());

      const content = fs.readFileSync(envFile, 'utf8');
      expect(content).toContain("export EXISTING_VAR='value'");
      expect(content).toContain("export CONTINUITY_LOG_LEVEL='warn'");
    });
  });

  // ===========================================================================
  // shellEscape
  // ===========================================================================

  describe('shellEscape', () => {
    it('should wrap value in single quotes', () => {
      expect(shellEscape('warn')).toBe("'warn'");
    });

    it('should escape internal single quotes', () => {
      expect(shellEscape("it's")).toBe("'it'\\''s'");
    });

    it('should handle empty string', () => {
      expect(shellEscape('')).toBe("''");
    });

    it('should handle special characters', () => {
      expect(shellEscape('hello world')).toBe("'hello world'");
      expect(shellEscape('$PATH')).toBe("'$PATH'");
      expect(shellEscape('a"b')).toBe("'a\"b'");
    });

    it('should handle paths with spaces', () => {
      expect(shellEscape('/path/with spaces/dir')).toBe("'/path/with spaces/dir'");
    });
  });

  // ===========================================================================
  // HookResult Structure
  // ===========================================================================

  describe('HookResult structure', () => {
    it('should produce valid JSON when stringified', async () => {
      createFullStructure(tempDir);
      createContextFile(tempDir);

      const result = await sessionLoader(createMockInput());

      expect(() => JSON.stringify(result)).not.toThrow();

      const json = JSON.stringify(result);
      const parsed = JSON.parse(json);

      expect(parsed.continue).toBe(true);
      expect(typeof parsed.systemMessage).toBe('string');
    });

    it('should have systemMessage property', async () => {
      const result = await sessionLoader(createMockInput());

      expect(result).toHaveProperty('systemMessage');
      expect(typeof result.systemMessage).toBe('string');
    });
  });

  // ===========================================================================
  // terminalSequence (CC v2.1.141) — window title, opt-in
  // ===========================================================================

  describe('terminalSequence window title', () => {
    const ORIGINAL_FLAG = process.env['CONTINUITY_TERMINAL_TITLE'];
    const ORIGINAL_PROJECT_DIR = process.env['CLAUDE_PROJECT_DIR'];

    afterEach(() => {
      if (ORIGINAL_FLAG === undefined) {
        delete process.env['CONTINUITY_TERMINAL_TITLE'];
      } else {
        process.env['CONTINUITY_TERMINAL_TITLE'] = ORIGINAL_FLAG;
      }
      if (ORIGINAL_PROJECT_DIR === undefined) {
        delete process.env['CLAUDE_PROJECT_DIR'];
      } else {
        process.env['CLAUDE_PROJECT_DIR'] = ORIGINAL_PROJECT_DIR;
      }
    });

    it('does not emit terminalSequence when env var is unset (default)', async () => {
      const tempDir = createTempDir();
      try {
        delete process.env['CONTINUITY_TERMINAL_TITLE'];
        process.env['CLAUDE_PROJECT_DIR'] = tempDir;
        const result = await sessionLoader(createMockInput());
        expect(result).not.toHaveProperty('terminalSequence');
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('does not emit terminalSequence when env var is a non-"1" value', async () => {
      const tempDir = createTempDir();
      try {
        process.env['CONTINUITY_TERMINAL_TITLE'] = '0';
        process.env['CLAUDE_PROJECT_DIR'] = tempDir;
        const result = await sessionLoader(createMockInput());
        expect(result).not.toHaveProperty('terminalSequence');
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('does not emit terminalSequence for "true" (must be exactly "1")', async () => {
      const tempDir = createTempDir();
      try {
        process.env['CONTINUITY_TERMINAL_TITLE'] = 'true';
        process.env['CLAUDE_PROJECT_DIR'] = tempDir;
        const result = await sessionLoader(createMockInput());
        expect(result).not.toHaveProperty('terminalSequence');
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('emits an OSC 2 window-title sequence when env var is "1" (project basename only when no git repo)', async () => {
      const tempDir = createTempDir();
      try {
        process.env['CONTINUITY_TERMINAL_TITLE'] = '1';
        process.env['CLAUDE_PROJECT_DIR'] = tempDir;
        const result = await sessionLoader(createMockInput());
        expect(result.terminalSequence).toBeDefined();
        const seq = result.terminalSequence as string;
        expect(seq.startsWith('\x1b]2;')).toBe(true);
        expect(seq.endsWith('\x07')).toBe(true);
        const inner = seq.slice(4, -1);
        expect(inner).toBe(path.basename(tempDir));
        expect(inner).not.toContain(' · ');
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('includes branch in title when CLAUDE_PROJECT_DIR is a git repo', async () => {
      const tempDir = createTempDir();
      try {
        fs.mkdirSync(path.join(tempDir, '.git'), { recursive: true });
        fs.writeFileSync(path.join(tempDir, '.git', 'HEAD'), 'ref: refs/heads/feat/x\n');
        process.env['CONTINUITY_TERMINAL_TITLE'] = '1';
        process.env['CLAUDE_PROJECT_DIR'] = tempDir;
        const result = await sessionLoader(createMockInput());
        const seq = result.terminalSequence as string;
        const inner = seq.slice(4, -1);
        expect(inner).toBe(`${path.basename(tempDir)} · feat/x`);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('preserves continue and systemMessage when terminalSequence is added', async () => {
      const tempDir = createTempDir();
      try {
        process.env['CONTINUITY_TERMINAL_TITLE'] = '1';
        process.env['CLAUDE_PROJECT_DIR'] = tempDir;
        const result = await sessionLoader(createMockInput());
        expect(result.continue).toBe(true);
        expect(typeof result.systemMessage).toBe('string');
        expect(result.terminalSequence).toBeDefined();
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  // ===========================================================================
  // HOOK LIVENESS STAMPING (#82)
  // ===========================================================================

  describe('hook liveness stamping', () => {
    it('stamps a marker recording that SessionStart ran', async () => {
      // SessionStart is the decisive stamp: it fires before the user does
      // anything, which is what lets the statusline treat a missing marker as a
      // real failure rather than "too early to tell".
      await sessionLoader(createMockInput());

      expect(fs.existsSync(livenessFile(TEST_SESSION_ID))).toBe(true);
      const record = JSON.parse(fs.readFileSync(livenessFile(TEST_SESSION_ID), 'utf8')) as {
        at: string;
        hook: string;
      };
      expect(record.hook).toBe('session-start');
      expect(Number.isNaN(Date.parse(record.at))).toBe(false);
    });

    it('keys the marker by the PAYLOAD session id, not the environment', async () => {
      // The statusline reads this marker and derives its filename from the payload
      // id it receives. If this writer preferred the environment the two would key
      // different files — the writer/reader split that silently disabled ctk's
      // context warnings until 2.8.0, except here it would produce a false
      // "no security guardrails" alarm instead of mere silence.
      const explicit = 'test-session-loader-explicit';
      process.env['CLAUDE_CODE_SESSION_ID'] = 'env-should-lose';
      try {
        await sessionLoader(createMockInput(explicit));

        expect(fs.existsSync(livenessFile(explicit))).toBe(true);
        expect(fs.existsSync(livenessFile('env-should-lose'))).toBe(false);
      } finally {
        try {
          fs.unlinkSync(livenessFile(explicit));
        } catch {
          // Ignore
        }
      }
    });
  });
});
