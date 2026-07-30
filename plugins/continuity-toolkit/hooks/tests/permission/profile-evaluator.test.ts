/**
 * Tests for profile-evaluator permission hook
 *
 * @module tests/permission/profile-evaluator
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { profileEvaluator } from '../../src/permission/profile-evaluator.js';
import type { HookInput } from '../../src/types.js';

// Mock permission-profiles to provide test profile
vi.mock('../../src/lib/permission-profiles.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/lib/permission-profiles.js')>();
  return {
    ...original,
    loadPermissionProfile: vi.fn(() =>
      Promise.resolve({
        name: 'test',
        auto_approve: {
          tools: ['Read', 'Glob', 'Grep'],
          paths: ['$PROJECT/src/**', '$PROJECT/tests/**'],
          commands: ['ls', 'git status', 'npm list'],
        },
        require_approval: {
          paths: ['$PROJECT/package.json'],
          commands: ['npm install', 'git commit'],
        },
        deny: {
          paths: ['$PROJECT/.env', '$PROJECT/.env.*'],
          commands: ['rm -rf /'],
        },
      })
    ),
  };
});

// Import the mocked module
import * as permissionProfiles from '../../src/lib/permission-profiles.js';

// =============================================================================
// TEST HELPERS
// =============================================================================

function createBashInput(command: string): HookInput {
  return {
    tool_name: 'Bash',
    tool_input: { command },
  };
}

function createReadInput(filePath?: string): HookInput {
  return {
    tool_name: 'Read',
    tool_input: filePath ? { file_path: filePath } : {},
  };
}

// =============================================================================
// TESTS
// =============================================================================

describe('profileEvaluator', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('auto-approve by tool', () => {
    it('should allow Read tool', async () => {
      const input = createReadInput('/some/file.ts');
      const result = await profileEvaluator(input);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
    });

    it('should allow Glob tool', async () => {
      const input: HookInput = {
        tool_name: 'Glob',
        tool_input: { pattern: '**/*.ts' },
      };
      const result = await profileEvaluator(input);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
    });

    it('should allow Grep tool', async () => {
      const input: HookInput = {
        tool_name: 'Grep',
        tool_input: { pattern: 'function' },
      };
      const result = await profileEvaluator(input);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
    });
  });

  describe('auto-approve by command', () => {
    it('should allow ls command', async () => {
      const input = createBashInput('ls -la');
      const result = await profileEvaluator(input);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
    });

    it('should allow git status command', async () => {
      const input = createBashInput('git status');
      const result = await profileEvaluator(input);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
    });

    it('should allow npm list command', async () => {
      const input = createBashInput('npm list');
      const result = await profileEvaluator(input);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
    });
  });

  describe('require_approval', () => {
    it('should defer npm install to standard flow', async () => {
      const input = createBashInput('npm install lodash');
      const result = await profileEvaluator(input);

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
      expect(result.hookSpecificOutput).toBeUndefined();
    });

    it('should defer git commit to standard flow', async () => {
      const input = createBashInput('git commit -m "message"');
      const result = await profileEvaluator(input);

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
      expect(result.hookSpecificOutput).toBeUndefined();
    });
  });

  describe('deny rules', () => {
    it('should deny rm -rf / command', async () => {
      const input = createBashInput('rm -rf /');
      const result = await profileEvaluator(input);

      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
      expect(result.stopReason).toContain('denied');
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });
  });

  describe('no profile', () => {
    it('should defer when no profile found', async () => {
      vi.mocked(permissionProfiles.loadPermissionProfile).mockResolvedValueOnce(null);

      const input = createBashInput('unknown-command');
      const result = await profileEvaluator(input);

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
    });
  });

  describe('no match', () => {
    it('should defer for unmatched operations', async () => {
      const input = createBashInput('custom-tool --arg');
      const result = await profileEvaluator(input);

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
    });
  });

  describe('result structure', () => {
    it('should produce valid JSON for allow', async () => {
      const input = createBashInput('ls');
      const result = await profileEvaluator(input);

      expect(() => JSON.stringify(result)).not.toThrow();
    });

    it('should produce valid JSON for deny', async () => {
      const input = createBashInput('rm -rf /');
      const result = await profileEvaluator(input);

      expect(() => JSON.stringify(result)).not.toThrow();
    });

    it('should produce valid JSON for defer', async () => {
      const input = createBashInput('npm install');
      const result = await profileEvaluator(input);

      expect(() => JSON.stringify(result)).not.toThrow();
    });
  });
});
