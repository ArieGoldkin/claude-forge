/**
 * Tests for bash-combined PreToolUse hook
 *
 * @module tests/pretool/bash-combined
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HookInput, HookResult } from '../../src/types.js';

// Mock all underlying hooks
vi.mock('../../src/permission/auto-approve-safe-bash.js');
vi.mock('../../src/permission/profile-evaluator.js');
vi.mock('../../src/pretool/git-validator.js');
vi.mock('../../src/pretool/security-blocker.js');

// Import mocked modules
import { autoApproveSafeBash } from '../../src/permission/auto-approve-safe-bash.js';
import { profileEvaluator } from '../../src/permission/profile-evaluator.js';
import { gitValidator } from '../../src/pretool/git-validator.js';
import { securityBlocker } from '../../src/pretool/security-blocker.js';

// Import the hook under test (after mocks are set up)
import { bashCombined } from '../../src/pretool/bash-combined.js';

// =============================================================================
// TEST HELPERS
// =============================================================================

function createBashInput(command: string): HookInput {
  return {
    tool_name: 'Bash',
    tool_input: { command },
  };
}

function createNonBashInput(toolName: string): HookInput {
  return {
    tool_name: toolName as HookInput['tool_name'],
    tool_input: { file_path: '/test/file.ts' },
  };
}

function silentSuccess(): HookResult {
  return {
    continue: true,
    suppressOutput: true,
  };
}

function allowResult(): HookResult {
  return {
    continue: true,
    suppressOutput: true,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
    },
  };
}

function denyResult(reason: string): HookResult {
  return {
    continue: false,
    stopReason: reason,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
}

function warningResult(message: string): HookResult {
  return {
    continue: true,
    systemMessage: `⚠ ${message}`,
  };
}

function resetMocksToSilentSuccess(): void {
  vi.mocked(autoApproveSafeBash).mockResolvedValue(silentSuccess());
  vi.mocked(profileEvaluator).mockResolvedValue(silentSuccess());
  vi.mocked(gitValidator).mockResolvedValue(silentSuccess());
  vi.mocked(securityBlocker).mockResolvedValue(silentSuccess());
}

// =============================================================================
// TESTS
// =============================================================================

describe('bashCombined', () => {
  beforeEach(() => {
    resetMocksToSilentSuccess();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('non-Bash tools', () => {
    it('should return silent success for Write tool', async () => {
      const input = createNonBashInput('Write');
      const result = await bashCombined(input);

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
      expect(autoApproveSafeBash).not.toHaveBeenCalled();
      expect(profileEvaluator).not.toHaveBeenCalled();
      expect(gitValidator).not.toHaveBeenCalled();
      expect(securityBlocker).not.toHaveBeenCalled();
    });

    it('should return silent success for Edit tool', async () => {
      const input = createNonBashInput('Edit');
      const result = await bashCombined(input);

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
    });

    it('should return silent success for Read tool', async () => {
      const input = createNonBashInput('Read');
      const result = await bashCombined(input);

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
    });
  });

  describe('sandbox bypass protection', () => {
    it('should deny when dangerouslyDisableSandbox is true', async () => {
      const input: HookInput = {
        tool_name: 'Bash',
        tool_input: { command: 'ls', dangerouslyDisableSandbox: true },
      };

      const result = await bashCombined(input);

      expect(result.continue).toBe(false);
      expect(result.stopReason).toContain('Sandbox bypass');
      expect(autoApproveSafeBash).not.toHaveBeenCalled();
      expect(securityBlocker).not.toHaveBeenCalled();
    });

    it('should allow when dangerouslyDisableSandbox is false', async () => {
      vi.mocked(autoApproveSafeBash).mockResolvedValue(allowResult());
      const input: HookInput = {
        tool_name: 'Bash',
        tool_input: { command: 'ls', dangerouslyDisableSandbox: false },
      };

      const result = await bashCombined(input);

      expect(result.continue).toBe(true);
      expect(autoApproveSafeBash).toHaveBeenCalledTimes(1);
    });

    it('should allow when dangerouslyDisableSandbox is absent', async () => {
      vi.mocked(autoApproveSafeBash).mockResolvedValue(allowResult());
      const input = createBashInput('ls');

      const result = await bashCombined(input);

      expect(result.continue).toBe(true);
    });
  });

  describe('short-circuit on allow', () => {
    it('should return immediately when safe-bash allows', async () => {
      vi.mocked(autoApproveSafeBash).mockResolvedValue(allowResult());
      const input = createBashInput('git status');

      const result = await bashCombined(input);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
      // Security + git-validator now run BEFORE the auto-approve fast path
      // (deny-before-allow reorder). Profile runs after auto-approve, so it
      // is not reached when safe-bash allows.
      expect(securityBlocker).toHaveBeenCalledTimes(1);
      expect(gitValidator).toHaveBeenCalledTimes(1);
      expect(autoApproveSafeBash).toHaveBeenCalledTimes(1);
      expect(profileEvaluator).not.toHaveBeenCalled();
    });

    it('should return when profile-evaluator allows', async () => {
      vi.mocked(autoApproveSafeBash).mockResolvedValue(silentSuccess());
      vi.mocked(profileEvaluator).mockResolvedValue(allowResult());
      const input = createBashInput('npm test');

      const result = await bashCombined(input);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
      expect(securityBlocker).toHaveBeenCalledTimes(1);
      expect(gitValidator).toHaveBeenCalledTimes(1);
      expect(autoApproveSafeBash).toHaveBeenCalledTimes(1);
      expect(profileEvaluator).toHaveBeenCalledTimes(1);
    });
  });

  describe('short-circuit on deny', () => {
    it('should return immediately when profile-evaluator denies', async () => {
      vi.mocked(autoApproveSafeBash).mockResolvedValue(silentSuccess());
      vi.mocked(profileEvaluator).mockResolvedValue(denyResult('Denied by profile'));
      const input = createBashInput('dangerous-command');

      const result = await bashCombined(input);

      expect(result.continue).toBe(false);
      expect(result.stopReason).toBe('Denied by profile');
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
      // security + git run before profile in the new order; both have fired
      expect(securityBlocker).toHaveBeenCalledTimes(1);
      expect(gitValidator).toHaveBeenCalledTimes(1);
    });

    it('should return on a security-blocker ASK gate without running auto-approve', async () => {
      // Review !207 finding #3: the new isBlockingDecision 'ask' branch (e.g. the
      // git-push gate) must short-circuit BEFORE the auto-approve fast path.
      vi.mocked(securityBlocker).mockResolvedValue({
        continue: true,
        hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask' },
      });
      const input = createBashInput('git push --force origin main');

      const result = await bashCombined(input);

      expect(result.hookSpecificOutput?.permissionDecision).toBe('ask');
      expect(securityBlocker).toHaveBeenCalledTimes(1);
      expect(autoApproveSafeBash).not.toHaveBeenCalled();
      expect(profileEvaluator).not.toHaveBeenCalled();
    });

    it('should short-circuit a deny carried by permissionDecision alone (continue:true)', async () => {
      // #65 prerequisite. isDenyDecision keyed ONLY on `continue === false`, so a
      // denial expressed the documented way — permissionDecision 'deny' with
      // continue:true — was not recognised as blocking. Execution then fell
      // through to the auto-approve fast path, turning a security denial into a
      // SILENT AUTO-ALLOW. That is the exact outcome the isBlockingDecision
      // comment says the short-circuit exists to prevent.
      //
      // This shape is not hypothetical: read-cache.ts:157-167 already returns it,
      // and CC's docs state continue:false "takes precedence over any
      // event-specific decision fields" — so dropping continue:false is required
      // to stop a denial from killing a subagent (measured: control cell died
      // between two writes, treatment cell survived).
      vi.mocked(securityBlocker).mockResolvedValue({
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: 'Command references protected resource',
        },
      });
      const input = createBashInput('some-command --flag');

      const result = await bashCombined(input);

      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
      expect(securityBlocker).toHaveBeenCalledTimes(1);
      expect(autoApproveSafeBash).not.toHaveBeenCalled();
      expect(profileEvaluator).not.toHaveBeenCalled();
    });

    it('should return when security-blocker denies', async () => {
      vi.mocked(securityBlocker).mockResolvedValue(denyResult('Dangerous command blocked'));
      const input = createBashInput('rm -rf /');

      const result = await bashCombined(input);

      expect(result.continue).toBe(false);
      expect(result.stopReason).toBe('Dangerous command blocked');
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
      // security-blocker now runs FIRST and short-circuits the deny —
      // the auto-approve / profile fast paths never run.
      expect(securityBlocker).toHaveBeenCalledTimes(1);
      expect(gitValidator).not.toHaveBeenCalled();
      expect(autoApproveSafeBash).not.toHaveBeenCalled();
      expect(profileEvaluator).not.toHaveBeenCalled();
    });
  });

  describe('warning aggregation', () => {
    it('should include git-validator warnings when deferring', async () => {
      vi.mocked(gitValidator).mockResolvedValue(warningResult('Committing to protected branch'));
      const input = createBashInput('git commit -m "feat: test"');

      const result = await bashCombined(input);

      expect(result.continue).toBe(true);
      expect(result.systemMessage).toContain('⚠');
      expect(result.systemMessage).toContain('1 git warning');
      expect(result.hookSpecificOutput?.additionalContext).toContain(
        'Committing to protected branch'
      );
    });

    it('should not duplicate warning symbol', async () => {
      vi.mocked(gitValidator).mockResolvedValue(warningResult('Test warning'));
      const input = createBashInput('git commit -m "test"');

      const result = await bashCombined(input);

      expect(result.systemMessage).toMatch(/^⚠ /);
      expect(result.hookSpecificOutput?.additionalContext).toContain('Test warning');
    });
  });

  describe('no decision - defer to standard flow', () => {
    it('should return silent success when no hooks make a decision', async () => {
      const input = createBashInput('some-unknown-command');

      const result = await bashCombined(input);

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
      expect(result.hookSpecificOutput).toBeUndefined();
      expect(autoApproveSafeBash).toHaveBeenCalledTimes(1);
      expect(profileEvaluator).toHaveBeenCalledTimes(1);
      expect(gitValidator).toHaveBeenCalledTimes(1);
      expect(securityBlocker).toHaveBeenCalledTimes(1);
    });
  });

  describe('execution order', () => {
    it('should execute hooks in correct order', async () => {
      const callOrder: string[] = [];

      vi.mocked(autoApproveSafeBash).mockImplementation(async () => {
        callOrder.push('safe-bash');
        return silentSuccess();
      });
      vi.mocked(profileEvaluator).mockImplementation(async () => {
        callOrder.push('profile');
        return silentSuccess();
      });
      vi.mocked(gitValidator).mockImplementation(async () => {
        callOrder.push('git');
        return silentSuccess();
      });
      vi.mocked(securityBlocker).mockImplementation(async () => {
        callOrder.push('security');
        return silentSuccess();
      });

      const input = createBashInput('test command');
      await bashCombined(input);

      // Deny-before-allow: security + git run before the auto-approve fast path.
      expect(callOrder).toEqual(['security', 'git', 'safe-bash', 'profile']);
    });
  });

  describe('input passthrough', () => {
    it('should pass the same input to all hooks', async () => {
      const input = createBashInput('git status');
      await bashCombined(input);

      expect(autoApproveSafeBash).toHaveBeenCalledWith(input);
      expect(profileEvaluator).toHaveBeenCalledWith(input);
      expect(gitValidator).toHaveBeenCalledWith(input);
      expect(securityBlocker).toHaveBeenCalledWith(input);
    });
  });

  describe('result structure', () => {
    it('should produce valid JSON for allow result', async () => {
      vi.mocked(autoApproveSafeBash).mockResolvedValue(allowResult());
      const input = createBashInput('ls');

      const result = await bashCombined(input);

      expect(() => JSON.stringify(result)).not.toThrow();
    });

    it('should produce valid JSON for deny result', async () => {
      vi.mocked(securityBlocker).mockResolvedValue(denyResult('Blocked'));
      const input = createBashInput('rm -rf /');

      const result = await bashCombined(input);

      expect(() => JSON.stringify(result)).not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('should handle empty command', async () => {
      const input: HookInput = {
        tool_name: 'Bash',
        tool_input: {},
      };

      const result = await bashCombined(input);

      expect(result.continue).toBe(true);
    });

    it('should handle warning with empty message', async () => {
      vi.mocked(gitValidator).mockResolvedValue({
        continue: true,
        systemMessage: '⚠ ',
      });
      const input = createBashInput('git commit');

      const result = await bashCombined(input);

      expect(result.continue).toBe(true);
    });
  });
});
