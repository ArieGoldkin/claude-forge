/**
 * Tests for Context Monitor hook
 *
 * Validates tier determination, warning messages, rate limiting,
 * and graceful degradation for the UserPromptSubmit hook.
 *
 * @module tests/prompt/context-monitor
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  contextMonitor,
  getSuggestedHandoffName,
  getTier,
  getWarningMessage,
  shouldWarn,
} from '../../src/prompt/context-monitor.js';
import type { HookInput, ToolInput } from '../../src/types.js';

// =============================================================================
// HELPERS
// =============================================================================

function createInput(sessionId = 'test-session'): HookInput {
  const input: HookInput = {
    tool_name: '' as HookInput['tool_name'],
    tool_input: {} as ToolInput,
    session_id: sessionId,
  };
  (input as unknown as Record<string, unknown>)['prompt'] = 'test prompt';
  return input;
}

function pctFile(sessionId: string): string {
  return join(os.tmpdir(), `claude-context-pct-${sessionId}.txt`);
}

function warnFile(sessionId: string): string {
  return join(os.tmpdir(), `claude-context-last-warn-${sessionId}.txt`);
}

function writePct(sessionId: string, pct: number): void {
  fs.writeFileSync(pctFile(sessionId), String(pct), 'utf8');
}

function livenessFile(sessionId: string): string {
  return join(os.tmpdir(), `claude-ctk-hook-alive-${sessionId}.txt`);
}

function cleanup(sessionId: string): void {
  try {
    fs.unlinkSync(pctFile(sessionId));
  } catch {
    /* ignore */
  }
  try {
    fs.unlinkSync(warnFile(sessionId));
  } catch {
    /* ignore */
  }
  // Liveness markers must be removed too. This suite calls the real
  // `contextMonitor` against the real temp directory, so anything it leaves
  // behind is read by the developer's own live statusline and `/ctk:doctor`. An
  // earlier revision left markers (and a machine-global arming flag) lying
  // around, and `/doctor` consequently reported "FAIL — total or partial hook
  // unload" on a completely healthy install.
  try {
    fs.unlinkSync(livenessFile(sessionId));
  } catch {
    /* ignore */
  }
}

// =============================================================================
// getTier
// =============================================================================

describe('getTier', () => {
  it('should return 0 for percentages below 70', () => {
    expect(getTier(0)).toBe(0);
    expect(getTier(42)).toBe(0);
    expect(getTier(69)).toBe(0);
  });

  it('should return 1 for 70-79', () => {
    expect(getTier(70)).toBe(1);
    expect(getTier(75)).toBe(1);
    expect(getTier(79)).toBe(1);
  });

  it('should return 2 for 80-89', () => {
    expect(getTier(80)).toBe(2);
    expect(getTier(85)).toBe(2);
    expect(getTier(89)).toBe(2);
  });

  it('should return 3 for 90+', () => {
    expect(getTier(90)).toBe(3);
    expect(getTier(95)).toBe(3);
    expect(getTier(100)).toBe(3);
  });

  it('should return 3 for values above 100', () => {
    expect(getTier(105)).toBe(3);
    expect(getTier(200)).toBe(3);
  });

  it('should return 0 for negative values', () => {
    expect(getTier(-1)).toBe(0);
    expect(getTier(-100)).toBe(0);
  });
});

// =============================================================================
// getWarningMessage
// =============================================================================

describe('getWarningMessage', () => {
  it('should return null for tier 0', () => {
    expect(getWarningMessage(0, 50)).toBeNull();
  });

  it('should return advisory message for tier 1', () => {
    const msg = getWarningMessage(1, 72);
    expect(msg).toContain('72%');
    expect(msg).toContain('/create-handoff');
    expect(msg).not.toContain('CRITICAL');
    expect(msg).not.toContain('WARNING');
  });

  it('should return warning message for tier 2', () => {
    const msg = getWarningMessage(2, 85);
    expect(msg).toContain('85%');
    expect(msg).toContain('CONTEXT WARNING');
    expect(msg).toContain('/create-handoff');
    expect(msg).toContain('/clear');
  });

  it('should return critical message for tier 3', () => {
    const msg = getWarningMessage(3, 93);
    expect(msg).toContain('93%');
    expect(msg).toContain('CONTEXT CRITICAL');
    expect(msg).toContain('/create-handoff NOW');
    expect(msg).toContain('Auto-compaction imminent');
  });

  it('should NOT include suggestion suffix at tier 1 (terse)', () => {
    const msg = getWarningMessage(1, 72, '2026-05-11_feat-x.yaml');
    expect(msg).not.toContain('Suggested filename');
  });

  it('should include suggestion suffix at tier 2 when provided', () => {
    const msg = getWarningMessage(2, 85, '2026-05-11_feat-x.yaml');
    expect(msg).toContain('CONTEXT WARNING');
    expect(msg).toContain('Suggested filename: 2026-05-11_feat-x.yaml');
  });

  it('should include suggestion suffix at tier 3 when provided', () => {
    const msg = getWarningMessage(3, 92, '2026-05-11_feat-x.yaml');
    expect(msg).toContain('CONTEXT CRITICAL');
    expect(msg).toContain('Suggested filename: 2026-05-11_feat-x.yaml');
    // base structure preserved for backward compat
    expect(msg).toContain('/create-handoff NOW');
  });

  it('should omit suggestion suffix when name is undefined (tier 2)', () => {
    const msg = getWarningMessage(2, 85);
    expect(msg).not.toContain('Suggested filename');
  });
});

// =============================================================================
// getSuggestedHandoffName
// =============================================================================

describe('getSuggestedHandoffName', () => {
  const fixedDate = new Date('2026-05-11T12:00:00Z');

  it('strips feat/ prefix from branch', () => {
    expect(getSuggestedHandoffName('feat/login-redesign', fixedDate)).toBe(
      '2026-05-11_login-redesign.yaml'
    );
  });

  it('strips fix/, chore/, refactor/ prefixes', () => {
    expect(getSuggestedHandoffName('fix/oom-crash', fixedDate)).toBe('2026-05-11_oom-crash.yaml');
    expect(getSuggestedHandoffName('chore/deps-bump', fixedDate)).toBe('2026-05-11_deps-bump.yaml');
    expect(getSuggestedHandoffName('refactor/auth', fixedDate)).toBe('2026-05-11_auth.yaml');
  });

  it('handles bare branch names (no prefix)', () => {
    expect(getSuggestedHandoffName('main', fixedDate)).toBe('2026-05-11_main.yaml');
    expect(getSuggestedHandoffName('experiment', fixedDate)).toBe('2026-05-11_experiment.yaml');
  });

  it('handles ticket-style branches (NAPP-1234-description)', () => {
    expect(getSuggestedHandoffName('NAPP-1234-fix-login', fixedDate)).toBe(
      '2026-05-11_napp-1234-fix-login.yaml'
    );
  });

  it('handles developer-prefix branches (arie/feature)', () => {
    expect(getSuggestedHandoffName('arie/feature-x', fixedDate)).toBe('2026-05-11_feature-x.yaml');
  });

  it('normalizes special chars to hyphens', () => {
    expect(getSuggestedHandoffName('feat/api_v2.update', fixedDate)).toBe(
      '2026-05-11_api-v2-update.yaml'
    );
  });

  it('collapses repeated hyphens', () => {
    expect(getSuggestedHandoffName('feat/foo--bar---baz', fixedDate)).toBe(
      '2026-05-11_foo-bar-baz.yaml'
    );
  });

  it('falls back to "session" when branch is empty', () => {
    expect(getSuggestedHandoffName('', fixedDate)).toBe('2026-05-11_session.yaml');
    expect(getSuggestedHandoffName(undefined, fixedDate)).toBe('2026-05-11_session.yaml');
  });

  it('falls back to "session" when cleaning yields empty string', () => {
    expect(getSuggestedHandoffName('feat/', fixedDate)).toBe('2026-05-11_session.yaml');
  });

  it('uses current date by default', () => {
    const result = getSuggestedHandoffName('feat/x');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}_x\.yaml$/);
  });
});

// =============================================================================
// shouldWarn
// =============================================================================

describe('shouldWarn', () => {
  it('should not warn for tier 0', () => {
    expect(shouldWarn(0, 0)).toBe(false);
    expect(shouldWarn(0, 1)).toBe(false);
    expect(shouldWarn(0, 3)).toBe(false);
  });

  it('should warn when current tier > last tier', () => {
    expect(shouldWarn(1, 0)).toBe(true);
    expect(shouldWarn(2, 0)).toBe(true);
    expect(shouldWarn(2, 1)).toBe(true);
    expect(shouldWarn(3, 0)).toBe(true);
    expect(shouldWarn(3, 1)).toBe(true);
    expect(shouldWarn(3, 2)).toBe(true);
  });

  it('should not warn when current tier <= last tier', () => {
    expect(shouldWarn(1, 1)).toBe(false);
    expect(shouldWarn(1, 2)).toBe(false);
    expect(shouldWarn(1, 3)).toBe(false);
    expect(shouldWarn(2, 2)).toBe(false);
    expect(shouldWarn(2, 3)).toBe(false);
    expect(shouldWarn(3, 3)).toBe(false);
  });
});

// =============================================================================
// contextMonitor - integration tests
// =============================================================================

describe('contextMonitor', () => {
  const SESSION = 'test-ctx-monitor';

  beforeEach(() => {
    cleanup(SESSION);
  });

  afterEach(() => {
    cleanup(SESSION);
  });

  // ---------------------------------------------------------------------------
  // No temp file (graceful degradation)
  // ---------------------------------------------------------------------------

  it('should return silentSuccess when no temp file exists', async () => {
    const result = await contextMonitor(createInput(SESSION));
    expect(result.continue).toBe(true);
    expect(result.suppressOutput).toBe(true);
    expect(result.hookSpecificOutput).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Below threshold
  // ---------------------------------------------------------------------------

  it('should return silentSuccess for percentage below 70', async () => {
    writePct(SESSION, 42);
    const result = await contextMonitor(createInput(SESSION));
    expect(result.continue).toBe(true);
    expect(result.suppressOutput).toBe(true);
    expect(result.hookSpecificOutput).toBeUndefined();
  });

  it('should return silentSuccess at exactly 69', async () => {
    writePct(SESSION, 69);
    const result = await contextMonitor(createInput(SESSION));
    expect(result.hookSpecificOutput).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // At thresholds
  // ---------------------------------------------------------------------------

  it('should emit advisory at 70%', async () => {
    writePct(SESSION, 70);
    const result = await contextMonitor(createInput(SESSION));
    expect(result.hookSpecificOutput).toBeDefined();
    expect(result.hookSpecificOutput?.hookEventName).toBe('UserPromptSubmit');
    expect(result.hookSpecificOutput?.additionalContext).toContain('70%');
    expect(result.hookSpecificOutput?.additionalContext).toContain('/create-handoff');
  });

  it('should emit warning at 80%', async () => {
    writePct(SESSION, 80);
    const result = await contextMonitor(createInput(SESSION));
    expect(result.hookSpecificOutput?.additionalContext).toContain('CONTEXT WARNING');
    expect(result.hookSpecificOutput?.additionalContext).toContain('80%');
  });

  it('should include suggested filename at tier 2 (80%)', async () => {
    writePct(SESSION, 80);
    const result = await contextMonitor(createInput(SESSION));
    expect(result.hookSpecificOutput?.additionalContext).toMatch(
      /Suggested filename: \d{4}-\d{2}-\d{2}_.+\.yaml/
    );
  });

  it('should emit critical at 90%', async () => {
    writePct(SESSION, 90);
    const result = await contextMonitor(createInput(SESSION));
    expect(result.hookSpecificOutput?.additionalContext).toContain('CONTEXT CRITICAL');
    expect(result.hookSpecificOutput?.additionalContext).toContain('90%');
  });

  it('should include suggested filename at tier 3 (90%)', async () => {
    writePct(SESSION, 90);
    const result = await contextMonitor(createInput(SESSION));
    expect(result.hookSpecificOutput?.additionalContext).toMatch(
      /Suggested filename: \d{4}-\d{2}-\d{2}_.+\.yaml/
    );
  });

  it('should NOT include suggested filename at tier 1 (70%, terse)', async () => {
    writePct(SESSION, 72);
    const result = await contextMonitor(createInput(SESSION));
    expect(result.hookSpecificOutput?.additionalContext).not.toContain('Suggested filename');
  });

  it('should emit critical at 95%', async () => {
    writePct(SESSION, 95);
    const result = await contextMonitor(createInput(SESSION));
    expect(result.hookSpecificOutput?.additionalContext).toContain('CONTEXT CRITICAL');
    expect(result.hookSpecificOutput?.additionalContext).toContain('95%');
  });

  // ---------------------------------------------------------------------------
  // Rate limiting
  // ---------------------------------------------------------------------------

  it('should not repeat same-tier warning', async () => {
    writePct(SESSION, 75);

    // First call: should warn
    const result1 = await contextMonitor(createInput(SESSION));
    expect(result1.hookSpecificOutput).toBeDefined();

    // Second call at same tier: should be silent
    const result2 = await contextMonitor(createInput(SESSION));
    expect(result2.hookSpecificOutput).toBeUndefined();
  });

  it('should escalate from tier 1 to tier 2', async () => {
    writePct(SESSION, 72);

    // First call: tier 1 advisory
    const result1 = await contextMonitor(createInput(SESSION));
    expect(result1.hookSpecificOutput?.additionalContext).toContain('72%');

    // Escalate to tier 2
    writePct(SESSION, 83);
    const result2 = await contextMonitor(createInput(SESSION));
    expect(result2.hookSpecificOutput?.additionalContext).toContain('CONTEXT WARNING');
    expect(result2.hookSpecificOutput?.additionalContext).toContain('83%');
  });

  it('should escalate from tier 2 to tier 3', async () => {
    writePct(SESSION, 85);
    await contextMonitor(createInput(SESSION));

    writePct(SESSION, 92);
    const result = await contextMonitor(createInput(SESSION));
    expect(result.hookSpecificOutput?.additionalContext).toContain('CONTEXT CRITICAL');
  });

  it('should not warn when tier drops (e.g., 80 -> 75)', async () => {
    writePct(SESSION, 80);
    await contextMonitor(createInput(SESSION)); // tier 2

    writePct(SESSION, 75);
    const result = await contextMonitor(createInput(SESSION));
    expect(result.hookSpecificOutput).toBeUndefined();
  });

  it('should reset rate-limit when context drops below 70', async () => {
    writePct(SESSION, 75);
    await contextMonitor(createInput(SESSION)); // tier 1

    // Context drops (after compaction)
    writePct(SESSION, 40);
    await contextMonitor(createInput(SESSION)); // resets

    // Back up to tier 1 - should warn again
    writePct(SESSION, 72);
    const result = await contextMonitor(createInput(SESSION));
    expect(result.hookSpecificOutput).toBeDefined();
    expect(result.hookSpecificOutput?.additionalContext).toContain('72%');
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  it('should handle empty file gracefully', async () => {
    fs.writeFileSync(pctFile(SESSION), '', 'utf8');
    const result = await contextMonitor(createInput(SESSION));
    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput).toBeUndefined();
  });

  it('should handle NaN in file gracefully', async () => {
    fs.writeFileSync(pctFile(SESSION), 'not-a-number', 'utf8');
    const result = await contextMonitor(createInput(SESSION));
    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput).toBeUndefined();
  });

  it('should handle negative percentage gracefully', async () => {
    writePct(SESSION, -5);
    const result = await contextMonitor(createInput(SESSION));
    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput).toBeUndefined();
  });

  it('should handle percentage above 100', async () => {
    writePct(SESSION, 105);
    const result = await contextMonitor(createInput(SESSION));
    expect(result.hookSpecificOutput?.additionalContext).toContain('CONTEXT CRITICAL');
  });

  // ---------------------------------------------------------------------------
  // Output structure
  // ---------------------------------------------------------------------------

  it('should have hookEventName=UserPromptSubmit when emitting', async () => {
    writePct(SESSION, 75);
    const result = await contextMonitor(createInput(SESSION));
    expect(result.hookSpecificOutput?.hookEventName).toBe('UserPromptSubmit');
  });

  it('should always continue (never block)', async () => {
    writePct(SESSION, 95);
    const result = await contextMonitor(createInput(SESSION));
    expect(result.continue).toBe(true);
  });

  it('should always suppress output (invisible to user)', async () => {
    writePct(SESSION, 75);
    const result = await contextMonitor(createInput(SESSION));
    expect(result.suppressOutput).toBe(true);
  });

  it('should produce valid JSON when stringified', async () => {
    writePct(SESSION, 85);
    const result = await contextMonitor(createInput(SESSION));
    const json = JSON.stringify(result);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  // ---------------------------------------------------------------------------
  // Session ID handling
  // ---------------------------------------------------------------------------

  it('should use session_id from input', async () => {
    const sid = 'unique-session-123';
    writePct(sid, 75);
    const result = await contextMonitor(createInput(sid));
    expect(result.hookSpecificOutput).toBeDefined();
    cleanup(sid);
  });

  it('should fall back to env CLAUDE_SESSION_ID', async () => {
    const sid = 'env-session-456';
    const origEnv = process.env['CLAUDE_SESSION_ID'];
    process.env['CLAUDE_SESSION_ID'] = sid;

    writePct(sid, 80);
    const input: HookInput = {
      tool_name: '' as HookInput['tool_name'],
      tool_input: {} as ToolInput,
    };
    (input as unknown as Record<string, unknown>)['prompt'] = 'test';

    const result = await contextMonitor(input);
    expect(result.hookSpecificOutput?.additionalContext).toContain('80%');

    // Restore
    if (origEnv !== undefined) {
      process.env['CLAUDE_SESSION_ID'] = origEnv;
    } else {
      delete process.env['CLAUDE_SESSION_ID'];
    }
    cleanup(sid);
  });
});

// =============================================================================
// HOOK LIVENESS STAMPING (#82)
// =============================================================================

describe('contextMonitor — hook liveness stamping', () => {
  const sid = 'test-liveness-ctx-monitor';

  beforeEach(() => {
    cleanup(sid);
  });

  afterEach(() => {
    cleanup(sid);
  });

  it('stamps a liveness marker for the session', async () => {
    writePct(sid, 42);
    await contextMonitor(createInput(sid));

    expect(fs.existsSync(livenessFile(sid))).toBe(true);
    const record = JSON.parse(fs.readFileSync(livenessFile(sid), 'utf8')) as {
      at: string;
      hook: string;
    };
    expect(record.hook).toBe('context-monitor');
    expect(Number.isNaN(Date.parse(record.at))).toBe(false);
  });

  it('STAMPS EVEN WITH NO PERCENTAGE FILE — above the fast path', async () => {
    // The load-bearing test for the stamp's placement. `contextMonitor` returns
    // early when no percentage file exists, which is the state of every user who
    // has not configured the statusline. A stamp below that return would never run
    // for them, making the detector inert for exactly the population it is meant
    // to protect. Moving the call after the early return must fail this test.
    expect(fs.existsSync(pctFile(sid))).toBe(false);

    await contextMonitor(createInput(sid));

    expect(fs.existsSync(livenessFile(sid))).toBe(true);
  });

  it('keys the marker by the session id, so two sessions do not share one', async () => {
    const other = 'test-liveness-other-session';
    cleanup(other);
    try {
      writePct(sid, 10);
      await contextMonitor(createInput(sid));

      expect(fs.existsSync(livenessFile(sid))).toBe(true);
      expect(fs.existsSync(livenessFile(other))).toBe(false);
    } finally {
      cleanup(other);
    }
  });
});
