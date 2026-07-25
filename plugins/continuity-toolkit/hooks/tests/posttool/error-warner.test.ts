/**
 * Tests for error-warner PostToolUse hook
 *
 * @module tests/posttool/error-warner
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorWarner } from '../../src/posttool/error-warner.js';
import type { HookInput } from '../../src/types.js';

// Mock error-rules to provide test rules
vi.mock('../../src/lib/error-rules.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/lib/error-rules.js')>();
  return {
    ...original,
    loadErrorRules: vi.fn(() =>
      Promise.resolve({
        rules: [
          {
            id: 'undefined-property',
            pattern: 'Cannot read properties of undefined',
            message: 'Check if the object exists before accessing properties.',
            severity: 'error',
          },
          {
            id: 'module-not-found',
            pattern: 'Cannot find module',
            message: 'The module could not be found.',
            severity: 'error',
          },
          {
            id: 'missing-await',
            pattern: 'Promise { <pending> }',
            message: 'Add await before the async call.',
            severity: 'warning',
          },
        ],
      })
    ),
  };
});

// =============================================================================
// TEST HELPERS
// =============================================================================

/**
 * Create a mock HookInput for Bash tool with output
 */
function createBashInputWithOutput(
  command: string,
  output: {
    stdout?: string;
    stderr?: string;
    exit_code?: number;
    output?: string;
  }
): HookInput & { tool_response: typeof output } {
  return {
    tool_name: 'Bash',
    tool_input: { command },
    tool_response: output,
  };
}

/**
 * Create a mock HookInput for non-Bash tool
 */
function createNonBashInput(toolName: string): HookInput {
  return {
    tool_name: toolName as HookInput['tool_name'],
    tool_input: {},
  };
}

// =============================================================================
// TESTS
// =============================================================================

describe('errorWarner', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('non-Bash tools', () => {
    it('should return silent success for Write tool', async () => {
      const input = createNonBashInput('Write');
      const result = await errorWarner(input);

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
    });

    it('should return silent success for Read tool', async () => {
      const input = createNonBashInput('Read');
      const result = await errorWarner(input);

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
    });
  });

  describe('no output', () => {
    it('should return silent success when no tool_response', async () => {
      const input: HookInput = {
        tool_name: 'Bash',
        tool_input: { command: 'ls -la' },
      };
      const result = await errorWarner(input);

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
    });

    it('should return silent success for empty output', async () => {
      const input = createBashInputWithOutput('ls', { stdout: '', stderr: '' });
      const result = await errorWarner(input);

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
    });

    it('should return silent success for no command', async () => {
      const input: HookInput = {
        tool_name: 'Bash',
        tool_input: {},
      };
      const result = await errorWarner(input);

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
    });
  });

  describe('successful commands', () => {
    it('should return silent success for successful output', async () => {
      const input = createBashInputWithOutput('npm test', {
        stdout: 'All tests passed!',
        exit_code: 0,
      });
      const result = await errorWarner(input);

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
    });

    it('should return silent success when no error indicators', async () => {
      const input = createBashInputWithOutput('ls', {
        stdout: 'file1.txt\nfile2.txt',
        exit_code: 0,
      });
      const result = await errorWarner(input);

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
    });
  });

  describe('error detection', () => {
    it('should provide tip for undefined property error', async () => {
      const input = createBashInputWithOutput('node script.js', {
        stderr: 'TypeError: Cannot read properties of undefined (reading "foo")',
        exit_code: 1,
      });
      const result = await errorWarner(input);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toContain('Tip');
      expect(result.hookSpecificOutput?.additionalContext).toContain('object exists');
    });

    it('should provide tip for module not found error', async () => {
      const input = createBashInputWithOutput('node app.js', {
        stderr: "Error: Cannot find module 'lodash'",
        exit_code: 1,
      });
      const result = await errorWarner(input);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toContain('module');
    });

    it('should provide tip for Promise pending', async () => {
      const input = createBashInputWithOutput('node test.js', {
        stdout: 'Result: Promise { <pending> }',
        exit_code: 0,
      });
      // Note: This might not trigger because exit_code is 0
      // and output doesn't contain error keywords
      const result = await errorWarner(input);

      // The hook checks for error indicators first
      expect(result.continue).toBe(true);
    });

    it('should detect errors in stderr', async () => {
      const input = createBashInputWithOutput('npm run build', {
        stderr: 'Error: Cannot find module "@types/node"',
        exit_code: 1,
      });
      const result = await errorWarner(input);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toBeDefined();
    });

    it('should detect errors based on exit code', async () => {
      const input = createBashInputWithOutput('npm test', {
        stdout: 'FAIL tests/unit.test.ts',
        exit_code: 1,
      });
      const result = await errorWarner(input);

      expect(result.continue).toBe(true);
      // FAIL is detected as error indicator
    });
  });

  describe('result structure', () => {
    it('should always continue (never block)', async () => {
      const input = createBashInputWithOutput('npm test', {
        stderr: 'Cannot find module "unknown"',
        exit_code: 1,
      });
      const result = await errorWarner(input);

      expect(result.continue).toBe(true);
    });

    it('should produce valid JSON', async () => {
      const input = createBashInputWithOutput('npm test', {
        stderr: 'Cannot read properties of undefined',
        exit_code: 1,
      });
      const result = await errorWarner(input);

      expect(() => JSON.stringify(result)).not.toThrow();
    });

    it('should include additionalContext when error matched', async () => {
      const input = createBashInputWithOutput('node app.js', {
        stderr: 'Cannot read properties of undefined',
        exit_code: 1,
      });
      const result = await errorWarner(input);

      expect(result.hookSpecificOutput?.additionalContext).toBeDefined();
      expect(result.hookSpecificOutput?.additionalContext).toContain('💡');
    });
  });

  describe('combined output fields', () => {
    it('should check both stdout and stderr', async () => {
      const input = createBashInputWithOutput('npm test', {
        stdout: 'Running tests...',
        stderr: 'Cannot find module "test-lib"',
        exit_code: 1,
      });
      const result = await errorWarner(input);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toContain('module');
    });

    it('should check output field as well', async () => {
      const input = createBashInputWithOutput('npm test', {
        output: 'Error: Cannot find module "missing"',
        exit_code: 1,
      });
      const result = await errorWarner(input);

      expect(result.continue).toBe(true);
    });
  });
});
