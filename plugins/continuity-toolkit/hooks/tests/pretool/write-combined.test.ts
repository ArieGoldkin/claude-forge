/**
 * Tests for write-combined PreToolUse hook
 *
 * @module tests/pretool/write-combined
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HookInput, HookResult } from '../../src/types.js';

// Mock all underlying hooks
vi.mock('../../src/permission/auto-approve-project-writes.js');
vi.mock('../../src/permission/profile-evaluator.js');
vi.mock('../../src/pretool/security-blocker.js');
vi.mock('../../src/posttool/secret-detector.js');

// Import mocked modules
import { autoApproveProjectWrites } from '../../src/permission/auto-approve-project-writes.js';
import { profileEvaluator } from '../../src/permission/profile-evaluator.js';
import { scanForSecrets } from '../../src/posttool/secret-detector.js';
import { securityBlocker } from '../../src/pretool/security-blocker.js';

// Import the hook under test (after mocks are set up)
import { writeCombined } from '../../src/pretool/write-combined.js';

// =============================================================================
// TEST HELPERS
// =============================================================================

function createWriteInput(filePath: string): HookInput {
  return {
    tool_name: 'Write',
    tool_input: { file_path: filePath, content: 'test' },
  };
}

function createEditInput(filePath: string): HookInput {
  return {
    tool_name: 'Edit',
    tool_input: { file_path: filePath, old_string: 'a', new_string: 'b' },
  };
}

function createMultiEditInput(filePath: string): HookInput {
  return {
    tool_name: 'MultiEdit',
    tool_input: { file_path: filePath },
  };
}

function createNonWriteInput(toolName: string): HookInput {
  return {
    tool_name: toolName as HookInput['tool_name'],
    tool_input: { command: 'ls' },
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

function resetMocksToSilentSuccess(): void {
  vi.mocked(autoApproveProjectWrites).mockResolvedValue(silentSuccess());
  vi.mocked(profileEvaluator).mockResolvedValue(silentSuccess());
  vi.mocked(securityBlocker).mockResolvedValue(silentSuccess());
  vi.mocked(scanForSecrets).mockReturnValue({ detected: false, secretTypes: [] });
}

// =============================================================================
// TESTS
// =============================================================================

describe('writeCombined', () => {
  beforeEach(() => {
    resetMocksToSilentSuccess();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('non-Write/Edit tools', () => {
    it('should return silent success for Bash tool', async () => {
      const input = createNonWriteInput('Bash');
      const result = await writeCombined(input);

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
      expect(autoApproveProjectWrites).not.toHaveBeenCalled();
      expect(profileEvaluator).not.toHaveBeenCalled();
      expect(securityBlocker).not.toHaveBeenCalled();
    });

    it('should return silent success for Read tool', async () => {
      const input = createNonWriteInput('Read');
      const result = await writeCombined(input);

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
    });
  });

  describe('short-circuit on allow', () => {
    it('should return immediately when project-writes allows', async () => {
      vi.mocked(autoApproveProjectWrites).mockResolvedValue(allowResult());
      const input = createWriteInput('/project/src/app.ts');

      const result = await writeCombined(input);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
      // security-blocker now runs BEFORE auto-approve (deny-before-allow).
      expect(securityBlocker).toHaveBeenCalledTimes(1);
      expect(autoApproveProjectWrites).toHaveBeenCalledTimes(1);
      expect(profileEvaluator).not.toHaveBeenCalled();
    });

    it('should return when profile-evaluator allows', async () => {
      vi.mocked(autoApproveProjectWrites).mockResolvedValue(silentSuccess());
      vi.mocked(profileEvaluator).mockResolvedValue(allowResult());
      const input = createEditInput('/project/src/app.ts');

      const result = await writeCombined(input);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
      expect(securityBlocker).toHaveBeenCalledTimes(1);
      expect(autoApproveProjectWrites).toHaveBeenCalledTimes(1);
      expect(profileEvaluator).toHaveBeenCalledTimes(1);
    });
  });

  describe('short-circuit on deny', () => {
    it('should return immediately when profile-evaluator denies', async () => {
      vi.mocked(profileEvaluator).mockResolvedValue(denyResult('Denied by profile'));
      const input = createWriteInput('/project/.env');

      const result = await writeCombined(input);

      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
      expect(result.stopReason).toBe('Denied by profile');
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
      // security-blocker now runs first, so it has fired before profile denies
      expect(securityBlocker).toHaveBeenCalledTimes(1);
    });

    it('should return when security-blocker denies', async () => {
      vi.mocked(securityBlocker).mockResolvedValue(denyResult('Protected file blocked'));
      const input = createWriteInput('/home/user/.ssh/id_rsa');

      const result = await writeCombined(input);

      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
      expect(result.stopReason).toBe('Protected file blocked');
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
      // security-blocker runs FIRST and short-circuits — auto-approve / profile never run
      expect(securityBlocker).toHaveBeenCalledTimes(1);
      expect(autoApproveProjectWrites).not.toHaveBeenCalled();
      expect(profileEvaluator).not.toHaveBeenCalled();
    });
  });

  describe('no decision - defer to standard flow', () => {
    it('should return silent success when no hooks make a decision', async () => {
      const input = createWriteInput('/outside/project/file.ts');

      const result = await writeCombined(input);

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
      expect(result.hookSpecificOutput).toBeUndefined();
      expect(autoApproveProjectWrites).toHaveBeenCalledTimes(1);
      expect(profileEvaluator).toHaveBeenCalledTimes(1);
      expect(securityBlocker).toHaveBeenCalledTimes(1);
    });
  });

  describe('execution order', () => {
    it('should execute hooks in correct order', async () => {
      const callOrder: string[] = [];

      vi.mocked(autoApproveProjectWrites).mockImplementation(async () => {
        callOrder.push('project-writes');
        return silentSuccess();
      });
      vi.mocked(profileEvaluator).mockImplementation(async () => {
        callOrder.push('profile');
        return silentSuccess();
      });
      vi.mocked(securityBlocker).mockImplementation(async () => {
        callOrder.push('security');
        return silentSuccess();
      });

      const input = createWriteInput('/project/test.ts');
      await writeCombined(input);

      // Deny-before-allow: security runs before the auto-approve fast path.
      expect(callOrder).toEqual(['security', 'project-writes', 'profile']);
    });
  });

  describe('input passthrough', () => {
    it('should pass the same input to all hooks', async () => {
      const input = createWriteInput('/project/src/app.ts');
      await writeCombined(input);

      expect(autoApproveProjectWrites).toHaveBeenCalledWith(input);
      expect(profileEvaluator).toHaveBeenCalledWith(input);
      expect(securityBlocker).toHaveBeenCalledWith(input);
    });
  });

  describe('all Write/Edit tool types', () => {
    it('should handle Write tool', async () => {
      vi.mocked(autoApproveProjectWrites).mockResolvedValue(allowResult());
      const input = createWriteInput('/project/src/new-file.ts');

      const result = await writeCombined(input);

      expect(result.continue).toBe(true);
      expect(autoApproveProjectWrites).toHaveBeenCalled();
    });

    it('should handle Edit tool', async () => {
      vi.mocked(autoApproveProjectWrites).mockResolvedValue(allowResult());
      const input = createEditInput('/project/src/existing.ts');

      const result = await writeCombined(input);

      expect(result.continue).toBe(true);
      expect(autoApproveProjectWrites).toHaveBeenCalled();
    });

    it('should handle MultiEdit tool', async () => {
      vi.mocked(autoApproveProjectWrites).mockResolvedValue(allowResult());
      const input = createMultiEditInput('/project/src/multi.ts');

      const result = await writeCombined(input);

      expect(result.continue).toBe(true);
      expect(autoApproveProjectWrites).toHaveBeenCalled();
    });
  });

  describe('result structure', () => {
    it('should produce valid JSON for allow result', async () => {
      vi.mocked(autoApproveProjectWrites).mockResolvedValue(allowResult());
      const input = createWriteInput('/project/src/app.ts');

      const result = await writeCombined(input);

      expect(() => JSON.stringify(result)).not.toThrow();
    });

    it('should produce valid JSON for deny result', async () => {
      vi.mocked(securityBlocker).mockResolvedValue(denyResult('Blocked'));
      const input = createWriteInput('/etc/passwd');

      const result = await writeCombined(input);

      expect(() => JSON.stringify(result)).not.toThrow();
    });
  });

  describe('pre-write secret scan', () => {
    it('should block Write when content contains secrets', async () => {
      vi.mocked(scanForSecrets).mockReturnValue({
        detected: true,
        secretTypes: ['AWS Access Key ID'],
      });
      const input: HookInput = {
        tool_name: 'Write',
        tool_input: {
          file_path: '/project/config.ts',
          content: 'const key = "AKIAIOSFODNN7EXAMPLE"',
        },
      };

      const result = await writeCombined(input);

      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
      expect(result.stopReason).toContain('secrets');
      expect(result.stopReason).toContain('AWS Access Key ID');
    });

    it('should block Edit when new_string contains secrets', async () => {
      vi.mocked(scanForSecrets).mockReturnValue({
        detected: true,
        secretTypes: ['Private Key'],
      });
      const input: HookInput = {
        tool_name: 'Edit',
        tool_input: {
          file_path: '/project/config.ts',
          old_string: 'placeholder',
          new_string: '-----BEGIN RSA PRIVATE KEY-----',
        },
      };

      const result = await writeCombined(input);

      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
      expect(result.stopReason).toContain('Private Key');
    });

    it('should allow Write when no secrets detected', async () => {
      vi.mocked(scanForSecrets).mockReturnValue({ detected: false, secretTypes: [] });
      const input: HookInput = {
        tool_name: 'Write',
        tool_input: { file_path: '/project/src/app.ts', content: 'const x = 1;' },
      };

      const result = await writeCombined(input);

      expect(result.continue).toBe(true);
    });

    it('should skip scan when no content or new_string', async () => {
      const input: HookInput = {
        tool_name: 'Write',
        tool_input: { file_path: '/project/empty.ts' },
      };

      const result = await writeCombined(input);

      expect(scanForSecrets).not.toHaveBeenCalled();
      expect(result.continue).toBe(true);
    });
  });

  describe('architecture change advisor', () => {
    it('should warn when editing tsconfig.json', async () => {
      const input: HookInput = {
        tool_name: 'Write',
        tool_input: { file_path: '/project/tsconfig.json', content: '{}' },
      };

      const result = await writeCombined(input);

      expect(result.continue).toBe(true);
      expect(result.systemMessage).toContain('TypeScript config');
      expect(result.hookSpecificOutput?.additionalContext).toContain('Architecture file modified');
    });

    it('should warn when editing package.json', async () => {
      const input: HookInput = {
        tool_name: 'Edit',
        tool_input: { file_path: '/project/package.json', old_string: 'a', new_string: 'b' },
      };

      const result = await writeCombined(input);

      expect(result.continue).toBe(true);
      expect(result.systemMessage).toContain('package manifest');
    });

    it('should warn when editing Dockerfile', async () => {
      const input: HookInput = {
        tool_name: 'Write',
        tool_input: { file_path: '/project/Dockerfile', content: 'FROM node:22' },
      };

      const result = await writeCombined(input);

      expect(result.systemMessage).toContain('Docker config');
    });

    it('should warn when editing .gitlab-ci.yml', async () => {
      const input: HookInput = {
        tool_name: 'Write',
        tool_input: { file_path: '/project/.gitlab-ci.yml', content: 'stages:' },
      };

      const result = await writeCombined(input);

      expect(result.systemMessage).toContain('CI/CD pipeline');
    });

    it('should not warn for regular source files', async () => {
      const input: HookInput = {
        tool_name: 'Write',
        tool_input: { file_path: '/project/src/app.ts', content: 'const x = 1;' },
      };

      const result = await writeCombined(input);

      expect(result.systemMessage).toBeUndefined();
      expect(result.suppressOutput).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle empty tool_input', async () => {
      const input: HookInput = {
        tool_name: 'Write',
        tool_input: {},
      };

      const result = await writeCombined(input);

      expect(result.continue).toBe(true);
    });
  });
});
