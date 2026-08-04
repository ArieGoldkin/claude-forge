/**
 * Tests for output helper functions
 *
 * These tests verify that all output functions produce the exact JSON structure
 * expected by Claude Code's hook system.
 *
 * @module tests/lib/output
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  outputAllow,
  outputAllowWithContext,
  outputAnswerQuestion,
  outputAsk,
  outputContextBudgeted,
  outputDefer,
  outputDeny,
  outputMessageDisplay,
  outputPromptContext,
  outputRetry,
  outputSessionTitle,
  outputSilentSuccess,
  outputStderrWarning,
  outputStopContext,
  outputSuccess,
  outputWarning,
  outputWarningBudgeted,
  outputWithContext,
  outputWithNotification,
  truncateForLLM,
} from '../../src/lib/output.js';
import type { HookResult } from '../../src/types.js';

// =============================================================================
// outputSilentSuccess TESTS
// =============================================================================

describe('outputSilentSuccess', () => {
  it('should return exact expected structure', () => {
    const result = outputSilentSuccess();

    expect(result).toEqual({
      continue: true,
      suppressOutput: true,
    });
  });

  it('should have continue set to true', () => {
    const result = outputSilentSuccess();
    expect(result.continue).toBe(true);
  });

  it('should have suppressOutput set to true', () => {
    const result = outputSilentSuccess();
    expect(result.suppressOutput).toBe(true);
  });

  it('should not have stopReason', () => {
    const result = outputSilentSuccess();
    expect(result.stopReason).toBeUndefined();
  });

  it('should not have systemMessage', () => {
    const result = outputSilentSuccess();
    expect(result.systemMessage).toBeUndefined();
  });

  it('should not have hookSpecificOutput', () => {
    const result = outputSilentSuccess();
    expect(result.hookSpecificOutput).toBeUndefined();
  });

  it('should produce valid JSON when stringified', () => {
    const result = outputSilentSuccess();
    const json = JSON.stringify(result);

    expect(() => JSON.parse(json)).not.toThrow();
    expect(JSON.parse(json)).toEqual({
      continue: true,
      suppressOutput: true,
    });
  });

  it('should satisfy HookResult interface', () => {
    const result: HookResult = outputSilentSuccess();
    expect(result).toBeDefined();
  });
});

// =============================================================================
// outputSuccess TESTS
// =============================================================================

describe('outputSuccess', () => {
  it('should return exact expected structure with message', () => {
    const result = outputSuccess('Operation completed');

    expect(result).toEqual({
      continue: true,
      systemMessage: 'Operation completed',
    });
  });

  it('should have continue set to true', () => {
    const result = outputSuccess('test');
    expect(result.continue).toBe(true);
  });

  it('should include message as systemMessage', () => {
    const message = 'File validated successfully';
    const result = outputSuccess(message);
    expect(result.systemMessage).toBe(message);
  });

  it('should not have suppressOutput', () => {
    const result = outputSuccess('test');
    expect(result.suppressOutput).toBeUndefined();
  });

  it('should not have stopReason', () => {
    const result = outputSuccess('test');
    expect(result.stopReason).toBeUndefined();
  });

  it('should not have hookSpecificOutput', () => {
    const result = outputSuccess('test');
    expect(result.hookSpecificOutput).toBeUndefined();
  });

  describe('message handling', () => {
    it('should handle empty string message', () => {
      const result = outputSuccess('');
      expect(result.systemMessage).toBe('');
    });

    it('should preserve special characters', () => {
      const message = 'Test with special chars: <>&"\'';
      const result = outputSuccess(message);
      expect(result.systemMessage).toBe(message);
    });

    it('should preserve unicode characters', () => {
      const message = 'Success! \u2714 Check mark';
      const result = outputSuccess(message);
      expect(result.systemMessage).toBe(message);
    });

    it('should preserve emoji characters', () => {
      const message = 'Success! \u{1F389} Party time!';
      const result = outputSuccess(message);
      expect(result.systemMessage).toBe(message);
    });

    it('should preserve newlines', () => {
      const message = 'Line 1\nLine 2\nLine 3';
      const result = outputSuccess(message);
      expect(result.systemMessage).toBe(message);
    });

    it('should preserve tabs', () => {
      const message = 'Column1\tColumn2\tColumn3';
      const result = outputSuccess(message);
      expect(result.systemMessage).toBe(message);
    });

    it('should handle long messages', () => {
      const message = 'A'.repeat(10000);
      const result = outputSuccess(message);
      expect(result.systemMessage).toBe(message);
      expect(result.systemMessage?.length).toBe(10000);
    });

    it('should handle message with backslashes', () => {
      const message = 'Path: C:\\Users\\test\\file.ts';
      const result = outputSuccess(message);
      expect(result.systemMessage).toBe(message);
    });

    it('should handle message with quotes', () => {
      const message = 'He said "Hello" and \'Goodbye\'';
      const result = outputSuccess(message);
      expect(result.systemMessage).toBe(message);
    });
  });

  it('should produce valid JSON when stringified', () => {
    const result = outputSuccess('Test message');
    const json = JSON.stringify(result);

    expect(() => JSON.parse(json)).not.toThrow();
    expect(JSON.parse(json)).toEqual({
      continue: true,
      systemMessage: 'Test message',
    });
  });
});

// =============================================================================
// outputWarning TESTS
// =============================================================================

describe('outputWarning', () => {
  it('should return exact expected structure with warning prefix', () => {
    const result = outputWarning('File is very large');

    expect(result).toEqual({
      continue: true,
      systemMessage: '\u26a0 File is very large',
    });
  });

  it('should have continue set to true', () => {
    const result = outputWarning('test');
    expect(result.continue).toBe(true);
  });

  it('should prepend warning symbol (U+26A0) to message', () => {
    const result = outputWarning('Caution');
    expect(result.systemMessage).toBe('\u26a0 Caution');
  });

  it('should have warning symbol followed by space', () => {
    const result = outputWarning('Test');
    expect(result.systemMessage?.startsWith('\u26a0 ')).toBe(true);
  });

  it('should not have suppressOutput', () => {
    const result = outputWarning('test');
    expect(result.suppressOutput).toBeUndefined();
  });

  it('should not have stopReason', () => {
    const result = outputWarning('test');
    expect(result.stopReason).toBeUndefined();
  });

  it('should not have hookSpecificOutput', () => {
    const result = outputWarning('test');
    expect(result.hookSpecificOutput).toBeUndefined();
  });

  describe('message handling', () => {
    it('should handle empty string message', () => {
      const result = outputWarning('');
      expect(result.systemMessage).toBe('\u26a0 ');
    });

    it('should preserve original message after warning symbol', () => {
      const message = 'Be careful with this operation';
      const result = outputWarning(message);
      expect(result.systemMessage).toBe(`\u26a0 ${message}`);
    });

    it('should preserve special characters in message', () => {
      const message = 'Warning: <danger>';
      const result = outputWarning(message);
      expect(result.systemMessage).toBe('\u26a0 Warning: <danger>');
    });

    it('should preserve unicode in message', () => {
      const message = 'Check \u2714 this';
      const result = outputWarning(message);
      expect(result.systemMessage).toBe('\u26a0 Check \u2714 this');
    });

    it('should handle message already containing warning symbol', () => {
      const message = '\u26a0 Already has warning';
      const result = outputWarning(message);
      // Should add another warning symbol
      expect(result.systemMessage).toBe('\u26a0 \u26a0 Already has warning');
    });

    it('should handle newlines in message', () => {
      const message = 'Line 1\nLine 2';
      const result = outputWarning(message);
      expect(result.systemMessage).toBe('\u26a0 Line 1\nLine 2');
    });
  });

  it('should produce valid JSON when stringified', () => {
    const result = outputWarning('Test warning');
    const json = JSON.stringify(result);

    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json);
    expect(parsed.continue).toBe(true);
    expect(parsed.systemMessage).toBe('\u26a0 Test warning');
  });

  it('should use correct unicode escape for warning symbol', () => {
    const result = outputWarning('test');
    // U+26A0 is the warning sign
    expect(result.systemMessage?.charCodeAt(0)).toBe(0x26a0);
  });
});

// =============================================================================
// outputDeny TESTS
// =============================================================================

describe('outputDeny', () => {
  it('should return exact expected structure', () => {
    const result = outputDeny('Access denied');

    expect(result).toEqual({
      continue: true,
      stopReason: 'Access denied',
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'Access denied',
      },
    });
  });

  it('should NOT set continue:false — a deny blocks the tool, not the turn (#65)', () => {
    // The denial is carried by permissionDecision alone. Per CC's hook docs,
    // `continue: false` "takes precedence over any event-specific decision
    // fields" and stops the agent entirely — which is what killed dispatched
    // subagents mid-task (measured: 7 of 12 historically lost reports; a
    // two-cell experiment where the continue:false cell died between two
    // writes it was told were mandatory and the continue:true cell survived).
    //
    // The tool call is still blocked: `isDenyDecision` (lib/output.ts) treats
    // permissionDecision:'deny' as blocking regardless of `continue`.
    const result = outputDeny('reason');
    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
  });

  it('should include reason as stopReason', () => {
    const reason = 'Access to .env files is not allowed';
    const result = outputDeny(reason);
    expect(result.stopReason).toBe(reason);
  });

  it('should have hookSpecificOutput with permissionDecision deny', () => {
    const result = outputDeny('reason');
    expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
  });

  it('should include reason in permissionDecisionReason', () => {
    const reason = 'Dangerous command blocked';
    const result = outputDeny(reason);
    expect(result.hookSpecificOutput?.permissionDecisionReason).toBe(reason);
  });

  it('should not have suppressOutput', () => {
    const result = outputDeny('reason');
    expect(result.suppressOutput).toBeUndefined();
  });

  it('should not have systemMessage', () => {
    const result = outputDeny('reason');
    expect(result.systemMessage).toBeUndefined();
  });

  describe('reason handling', () => {
    it('should handle empty string reason', () => {
      const result = outputDeny('');
      expect(result.stopReason).toBe('');
      expect(result.hookSpecificOutput?.permissionDecisionReason).toBe('');
    });

    it('should preserve special characters in reason', () => {
      const reason = 'Path /etc/passwd is protected';
      const result = outputDeny(reason);
      expect(result.stopReason).toBe(reason);
      expect(result.hookSpecificOutput?.permissionDecisionReason).toBe(reason);
    });

    it('should preserve unicode in reason', () => {
      const reason = 'Blocked \u274c';
      const result = outputDeny(reason);
      expect(result.stopReason).toBe(reason);
    });

    it('should handle long reason', () => {
      const reason = 'B'.repeat(5000);
      const result = outputDeny(reason);
      expect(result.stopReason).toBe(reason);
      expect(result.hookSpecificOutput?.permissionDecisionReason).toBe(reason);
    });

    it('should handle reason with newlines', () => {
      const reason = 'Error:\n- File is protected\n- Access denied';
      const result = outputDeny(reason);
      expect(result.stopReason).toBe(reason);
    });

    it('should handle reason with quotes', () => {
      const reason = 'Cannot access "sensitive" file';
      const result = outputDeny(reason);
      expect(result.stopReason).toBe(reason);
    });
  });

  it('should produce valid JSON when stringified', () => {
    const result = outputDeny('Test denial');
    const json = JSON.stringify(result);

    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json);
    expect(parsed.continue).toBe(true);
    expect(parsed.stopReason).toBe('Test denial');
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toBe('Test denial');
  });

  it('should have same reason in stopReason and permissionDecisionReason', () => {
    const reason = 'Consistent reason';
    const result = outputDeny(reason);
    expect(result.stopReason).toBe(result.hookSpecificOutput?.permissionDecisionReason);
  });
});

// =============================================================================
// outputAllow TESTS
// =============================================================================

describe('outputAllow', () => {
  it('should return exact expected structure', () => {
    const result = outputAllow();

    expect(result).toEqual({
      continue: true,
      suppressOutput: true,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
      },
    });
  });

  it('should have continue set to true', () => {
    const result = outputAllow();
    expect(result.continue).toBe(true);
  });

  it('should have suppressOutput set to true', () => {
    const result = outputAllow();
    expect(result.suppressOutput).toBe(true);
  });

  it('should have hookSpecificOutput with permissionDecision allow', () => {
    const result = outputAllow();
    expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
  });

  it('should not have stopReason', () => {
    const result = outputAllow();
    expect(result.stopReason).toBeUndefined();
  });

  it('should not have systemMessage', () => {
    const result = outputAllow();
    expect(result.systemMessage).toBeUndefined();
  });

  it('should not have permissionDecisionReason', () => {
    const result = outputAllow();
    expect(result.hookSpecificOutput?.permissionDecisionReason).toBeUndefined();
  });

  it('should not have additionalContext', () => {
    const result = outputAllow();
    expect(result.hookSpecificOutput?.additionalContext).toBeUndefined();
  });

  it('should produce valid JSON when stringified', () => {
    const result = outputAllow();
    const json = JSON.stringify(result);

    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json);
    expect(parsed.continue).toBe(true);
    expect(parsed.suppressOutput).toBe(true);
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('allow');
  });

  it('should satisfy HookResult interface', () => {
    const result: HookResult = outputAllow();
    expect(result).toBeDefined();
  });
});

// =============================================================================
// outputAllowWithContext TESTS
// =============================================================================

describe('outputAllowWithContext', () => {
  it('should return exact expected structure with context', () => {
    const result = outputAllowWithContext('File is in safe directory');

    expect(result).toEqual({
      continue: true,
      suppressOutput: true,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        additionalContext: 'File is in safe directory',
      },
    });
  });

  it('should have continue set to true', () => {
    const result = outputAllowWithContext('context');
    expect(result.continue).toBe(true);
  });

  it('should have suppressOutput set to true', () => {
    const result = outputAllowWithContext('context');
    expect(result.suppressOutput).toBe(true);
  });

  it('should have hookSpecificOutput with permissionDecision allow', () => {
    const result = outputAllowWithContext('context');
    expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
  });

  it('should include context as additionalContext', () => {
    const context = 'Operation auto-approved: safe path';
    const result = outputAllowWithContext(context);
    expect(result.hookSpecificOutput?.additionalContext).toBe(context);
  });

  it('should not have stopReason', () => {
    const result = outputAllowWithContext('context');
    expect(result.stopReason).toBeUndefined();
  });

  it('should not have systemMessage', () => {
    const result = outputAllowWithContext('context');
    expect(result.systemMessage).toBeUndefined();
  });

  it('should not have permissionDecisionReason', () => {
    const result = outputAllowWithContext('context');
    expect(result.hookSpecificOutput?.permissionDecisionReason).toBeUndefined();
  });

  describe('context handling', () => {
    it('should handle empty string context', () => {
      const result = outputAllowWithContext('');
      expect(result.hookSpecificOutput?.additionalContext).toBe('');
    });

    it('should preserve special characters in context', () => {
      const context = 'Path: /path/to/<file>.ts';
      const result = outputAllowWithContext(context);
      expect(result.hookSpecificOutput?.additionalContext).toBe(context);
    });

    it('should preserve unicode in context', () => {
      const context = 'Approved \u2714';
      const result = outputAllowWithContext(context);
      expect(result.hookSpecificOutput?.additionalContext).toBe(context);
    });

    it('should handle long context', () => {
      const context = 'C'.repeat(5000);
      const result = outputAllowWithContext(context);
      expect(result.hookSpecificOutput?.additionalContext).toBe(context);
    });

    it('should handle context with newlines', () => {
      const context = 'Reason 1\nReason 2\nReason 3';
      const result = outputAllowWithContext(context);
      expect(result.hookSpecificOutput?.additionalContext).toBe(context);
    });

    it('should handle context with quotes', () => {
      const context = 'File "test.ts" approved';
      const result = outputAllowWithContext(context);
      expect(result.hookSpecificOutput?.additionalContext).toBe(context);
    });

    it('should handle context with backslashes', () => {
      const context = 'Windows path: C:\\Users\\test';
      const result = outputAllowWithContext(context);
      expect(result.hookSpecificOutput?.additionalContext).toBe(context);
    });
  });

  it('should produce valid JSON when stringified', () => {
    const result = outputAllowWithContext('Test context');
    const json = JSON.stringify(result);

    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json);
    expect(parsed.continue).toBe(true);
    expect(parsed.suppressOutput).toBe(true);
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('allow');
    expect(parsed.hookSpecificOutput.additionalContext).toBe('Test context');
  });

  it('should satisfy HookResult interface', () => {
    const result: HookResult = outputAllowWithContext('context');
    expect(result).toBeDefined();
  });
});

// =============================================================================
// outputPromptContext TESTS
// =============================================================================

describe('outputPromptContext', () => {
  it('should return exact expected structure with context', () => {
    const result = outputPromptContext('Remember: PII must be encrypted at rest');

    expect(result).toEqual({
      continue: true,
      suppressOutput: true,
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: 'Remember: PII must be encrypted at rest',
      },
    });
  });

  it('should have continue set to true', () => {
    const result = outputPromptContext('context');
    expect(result.continue).toBe(true);
  });

  it('should have suppressOutput set to true', () => {
    const result = outputPromptContext('context');
    expect(result.suppressOutput).toBe(true);
  });

  it('should have hookEventName set to UserPromptSubmit', () => {
    const result = outputPromptContext('context');
    expect(result.hookSpecificOutput?.hookEventName).toBe('UserPromptSubmit');
  });

  it('should include context as additionalContext', () => {
    const context = 'Security: Use parameterized queries';
    const result = outputPromptContext(context);
    expect(result.hookSpecificOutput?.additionalContext).toBe(context);
  });

  it('should NOT have permissionDecision', () => {
    const result = outputPromptContext('context');
    expect(result.hookSpecificOutput?.permissionDecision).toBeUndefined();
  });

  it('should not have stopReason', () => {
    const result = outputPromptContext('context');
    expect(result.stopReason).toBeUndefined();
  });

  it('should not have systemMessage', () => {
    const result = outputPromptContext('context');
    expect(result.systemMessage).toBeUndefined();
  });

  describe('context handling', () => {
    it('should handle empty string context', () => {
      const result = outputPromptContext('');
      expect(result.hookSpecificOutput?.additionalContext).toBe('');
    });

    it('should preserve special characters in context', () => {
      const context = 'PII fields: <name>, "DOB", \'SSN\'';
      const result = outputPromptContext(context);
      expect(result.hookSpecificOutput?.additionalContext).toBe(context);
    });

    it('should preserve unicode in context', () => {
      const context = 'Security \u2714 compliant';
      const result = outputPromptContext(context);
      expect(result.hookSpecificOutput?.additionalContext).toBe(context);
    });

    it('should handle long context', () => {
      const context = 'C'.repeat(5000);
      const result = outputPromptContext(context);
      expect(result.hookSpecificOutput?.additionalContext).toBe(context);
    });

    it('should handle multi-line context', () => {
      const context = 'Rule 1: Encrypt PII\nRule 2: Audit access\nRule 3: Minimum necessary';
      const result = outputPromptContext(context);
      expect(result.hookSpecificOutput?.additionalContext).toBe(context);
    });

    it('should handle context with backslashes', () => {
      const context = 'Windows path: C:\\Users\\test';
      const result = outputPromptContext(context);
      expect(result.hookSpecificOutput?.additionalContext).toBe(context);
    });
  });

  it('should produce valid JSON when stringified', () => {
    const result = outputPromptContext('Test context');
    const json = JSON.stringify(result);

    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json);
    expect(parsed.continue).toBe(true);
    expect(parsed.suppressOutput).toBe(true);
    expect(parsed.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
    expect(parsed.hookSpecificOutput.additionalContext).toBe('Test context');
  });

  it('JSON round-trip should preserve structure', () => {
    const result = outputPromptContext('Security compliance reminder');
    const json = JSON.stringify(result);
    const parsed = JSON.parse(json);
    expect(parsed).toEqual(result);
  });

  it('should satisfy HookResult interface', () => {
    const result: HookResult = outputPromptContext('context');
    expect(result).toBeDefined();
  });
});

// =============================================================================
// outputStopContext TESTS (CC v2.1.163+, review !209 finding #3)
// =============================================================================

describe('outputStopContext', () => {
  it('should return exact expected structure with Stop default', () => {
    const result = outputStopContext('One task remains unfinished');

    expect(result).toEqual({
      continue: true,
      suppressOutput: true,
      hookSpecificOutput: {
        hookEventName: 'Stop',
        additionalContext: 'One task remains unfinished',
      },
    });
  });

  it('should support SubagentStop as explicit event name', () => {
    const result = outputStopContext('Subagent feedback', 'SubagentStop');
    expect(result.hookSpecificOutput?.hookEventName).toBe('SubagentStop');
    expect(result.hookSpecificOutput?.additionalContext).toBe('Subagent feedback');
  });

  it('should NOT have permissionDecision, stopReason, or systemMessage', () => {
    const result = outputStopContext('context');
    expect(result.hookSpecificOutput?.permissionDecision).toBeUndefined();
    expect(result.stopReason).toBeUndefined();
    expect(result.systemMessage).toBeUndefined();
  });

  it('should produce valid JSON when stringified', () => {
    const json = JSON.stringify(outputStopContext('Test context'));
    const parsed = JSON.parse(json);
    expect(parsed.continue).toBe(true);
    expect(parsed.suppressOutput).toBe(true);
    expect(parsed.hookSpecificOutput.hookEventName).toBe('Stop');
    expect(parsed.hookSpecificOutput.additionalContext).toBe('Test context');
  });

  it('should satisfy HookResult interface', () => {
    const result: HookResult = outputStopContext('context');
    expect(result).toBeDefined();
  });
});

// =============================================================================
// CROSS-FUNCTION COMPARISON TESTS
// =============================================================================

describe('output function comparisons', () => {
  describe('continue field behavior', () => {
    it('outputSilentSuccess should have continue=true', () => {
      expect(outputSilentSuccess().continue).toBe(true);
    });

    it('outputSuccess should have continue=true', () => {
      expect(outputSuccess('msg').continue).toBe(true);
    });

    it('outputWarning should have continue=true', () => {
      expect(outputWarning('msg').continue).toBe(true);
    });

    it('outputDeny should have continue=true (deny blocks the tool, not the turn)', () => {
      expect(outputDeny('reason').continue).toBe(true);
      expect(outputDeny('reason').hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    it('outputAllow should have continue=true', () => {
      expect(outputAllow().continue).toBe(true);
    });

    it('outputAllowWithContext should have continue=true', () => {
      expect(outputAllowWithContext('ctx').continue).toBe(true);
    });

    it('outputPromptContext should have continue=true', () => {
      expect(outputPromptContext('ctx').continue).toBe(true);
    });
  });

  describe('suppressOutput field behavior', () => {
    it('outputSilentSuccess should suppress output', () => {
      expect(outputSilentSuccess().suppressOutput).toBe(true);
    });

    it('outputSuccess should not suppress output', () => {
      expect(outputSuccess('msg').suppressOutput).toBeUndefined();
    });

    it('outputWarning should not suppress output', () => {
      expect(outputWarning('msg').suppressOutput).toBeUndefined();
    });

    it('outputDeny should not suppress output', () => {
      expect(outputDeny('reason').suppressOutput).toBeUndefined();
    });

    it('outputAllow should suppress output', () => {
      expect(outputAllow().suppressOutput).toBe(true);
    });

    it('outputAllowWithContext should suppress output', () => {
      expect(outputAllowWithContext('ctx').suppressOutput).toBe(true);
    });

    it('outputPromptContext should suppress output', () => {
      expect(outputPromptContext('ctx').suppressOutput).toBe(true);
    });
  });

  describe('permissionDecision field behavior', () => {
    it('outputSilentSuccess should not have permissionDecision', () => {
      expect(outputSilentSuccess().hookSpecificOutput).toBeUndefined();
    });

    it('outputSuccess should not have permissionDecision', () => {
      expect(outputSuccess('msg').hookSpecificOutput).toBeUndefined();
    });

    it('outputWarning should not have permissionDecision', () => {
      expect(outputWarning('msg').hookSpecificOutput).toBeUndefined();
    });

    it('outputDeny should have permissionDecision=deny', () => {
      expect(outputDeny('reason').hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    it('outputAllow should have permissionDecision=allow', () => {
      expect(outputAllow().hookSpecificOutput?.permissionDecision).toBe('allow');
    });

    it('outputAllowWithContext should have permissionDecision=allow', () => {
      expect(outputAllowWithContext('ctx').hookSpecificOutput?.permissionDecision).toBe('allow');
    });

    it('outputPromptContext should NOT have permissionDecision', () => {
      expect(outputPromptContext('ctx').hookSpecificOutput?.permissionDecision).toBeUndefined();
    });
  });
});

// =============================================================================
// JSON SERIALIZATION TESTS
// =============================================================================

describe('JSON serialization', () => {
  it('all output functions should produce valid JSON', () => {
    const outputs = [
      outputSilentSuccess(),
      outputSuccess('test'),
      outputWarning('test'),
      outputDeny('test'),
      outputAllow(),
      outputAllowWithContext('test'),
      outputPromptContext('test'),
    ];

    for (const output of outputs) {
      expect(() => JSON.stringify(output)).not.toThrow();
    }
  });

  it('JSON round-trip should preserve structure', () => {
    const outputs = [
      outputSilentSuccess(),
      outputSuccess('test message'),
      outputWarning('warning message'),
      outputDeny('denial reason'),
      outputAllow(),
      outputAllowWithContext('context info'),
      outputPromptContext('compliance context'),
    ];

    for (const output of outputs) {
      const json = JSON.stringify(output);
      const parsed = JSON.parse(json);
      expect(parsed).toEqual(output);
    }
  });

  it('should handle JSON-unsafe characters in messages', () => {
    const problematicStrings = [
      'Quote: "test"',
      "Apostrophe: 'test'",
      'Backslash: \\test\\',
      'Newline:\ntest',
      'Tab:\ttest',
      'Unicode: \u0000\u001f', // Control characters
      'Null byte: \x00',
    ];

    for (const str of problematicStrings) {
      // These should not throw
      expect(() => JSON.stringify(outputSuccess(str))).not.toThrow();
      expect(() => JSON.stringify(outputWarning(str))).not.toThrow();
      expect(() => JSON.stringify(outputDeny(str))).not.toThrow();
      expect(() => JSON.stringify(outputAllowWithContext(str))).not.toThrow();
    }
  });
});

// =============================================================================
// outputWithContext TESTS
// =============================================================================

describe('outputWithContext', () => {
  it('should return exact expected structure', () => {
    const result = outputWithContext('Tip: use --no-cache');

    expect(result).toEqual({
      continue: true,
      suppressOutput: true,
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: 'Tip: use --no-cache',
      },
    });
  });

  it('should have continue set to true', () => {
    const result = outputWithContext('ctx');
    expect(result.continue).toBe(true);
  });

  it('should have suppressOutput set to true', () => {
    const result = outputWithContext('ctx');
    expect(result.suppressOutput).toBe(true);
  });

  it('should include context as additionalContext', () => {
    const ctx = 'Error matched rule: npm-install-failure';
    const result = outputWithContext(ctx);
    expect(result.hookSpecificOutput?.additionalContext).toBe(ctx);
  });

  it('should have hookEventName PostToolUse', () => {
    const result = outputWithContext('ctx');
    expect(result.hookSpecificOutput?.hookEventName).toBe('PostToolUse');
  });

  it('should NOT have permissionDecision', () => {
    const result = outputWithContext('ctx');
    expect(result.hookSpecificOutput?.permissionDecision).toBeUndefined();
  });

  it('should not have systemMessage', () => {
    const result = outputWithContext('ctx');
    expect(result.systemMessage).toBeUndefined();
  });

  it('should handle empty string context', () => {
    const result = outputWithContext('');
    expect(result.hookSpecificOutput?.additionalContext).toBe('');
  });

  it('should preserve multi-line context', () => {
    const ctx = 'Line 1\nLine 2';
    const result = outputWithContext(ctx);
    expect(result.hookSpecificOutput?.additionalContext).toBe(ctx);
  });

  it('should produce valid JSON when stringified', () => {
    const result = outputWithContext('Test context');
    const json = JSON.stringify(result);
    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json);
    expect(parsed.hookSpecificOutput.additionalContext).toBe('Test context');
  });

  it('should satisfy HookResult interface', () => {
    const result: HookResult = outputWithContext('ctx');
    expect(result).toBeDefined();
  });
});

// =============================================================================
// outputWithNotification TESTS
// =============================================================================

describe('outputWithNotification', () => {
  it('should return exact expected structure', () => {
    const result = outputWithNotification('Lint errors found', 'Fix E401, E501');

    expect(result).toEqual({
      continue: true,
      systemMessage: 'Lint errors found',
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: 'Fix E401, E501',
      },
    });
  });

  it('should have continue set to true', () => {
    const result = outputWithNotification('msg', 'ctx');
    expect(result.continue).toBe(true);
  });

  it('should include userMsg as systemMessage', () => {
    const result = outputWithNotification('User sees this', 'Claude sees this');
    expect(result.systemMessage).toBe('User sees this');
  });

  it('should include claudeCtx as additionalContext', () => {
    const result = outputWithNotification('User sees this', 'Claude sees this');
    expect(result.hookSpecificOutput?.additionalContext).toBe('Claude sees this');
  });

  it('should NOT have suppressOutput', () => {
    const result = outputWithNotification('msg', 'ctx');
    expect(result.suppressOutput).toBeUndefined();
  });

  it('should NOT have permissionDecision', () => {
    const result = outputWithNotification('msg', 'ctx');
    expect(result.hookSpecificOutput?.permissionDecision).toBeUndefined();
  });

  it('should handle empty strings', () => {
    const result = outputWithNotification('', '');
    expect(result.systemMessage).toBe('');
    expect(result.hookSpecificOutput?.additionalContext).toBe('');
  });

  it('should preserve special characters in both channels', () => {
    const result = outputWithNotification('Warning: <danger>', 'Fix "this" & \'that\'');
    expect(result.systemMessage).toBe('Warning: <danger>');
    expect(result.hookSpecificOutput?.additionalContext).toBe('Fix "this" & \'that\'');
  });

  it('should produce valid JSON when stringified', () => {
    const result = outputWithNotification('user msg', 'claude ctx');
    const json = JSON.stringify(result);
    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json);
    expect(parsed.systemMessage).toBe('user msg');
    expect(parsed.hookSpecificOutput.additionalContext).toBe('claude ctx');
  });

  it('should satisfy HookResult interface', () => {
    const result: HookResult = outputWithNotification('msg', 'ctx');
    expect(result).toBeDefined();
  });
});

// =============================================================================
// outputAsk TESTS
// =============================================================================

describe('outputAsk', () => {
  it('should return ask decision with default PreToolUse hookEventName', () => {
    const result = outputAsk();

    expect(result).toEqual({
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
      },
    });
  });

  it('should include updatedInput when provided', () => {
    const result = outputAsk({ command: 'npm test --no-cache' });

    expect(result.hookSpecificOutput?.updatedInput).toEqual({ command: 'npm test --no-cache' });
  });

  it('should not include updatedInput when not provided', () => {
    const result = outputAsk();

    expect(result.hookSpecificOutput?.updatedInput).toBeUndefined();
  });

  it('should accept PermissionRequest hookEventName', () => {
    const result = outputAsk(undefined, 'PermissionRequest');

    expect(result.hookSpecificOutput?.hookEventName).toBe('PermissionRequest');
  });

  it('should combine updatedInput and PermissionRequest hookEventName', () => {
    const result = outputAsk({ command: 'test' }, 'PermissionRequest');

    expect(result.hookSpecificOutput?.hookEventName).toBe('PermissionRequest');
    expect(result.hookSpecificOutput?.updatedInput).toEqual({ command: 'test' });
  });

  it('should have continue=true', () => {
    const result = outputAsk();
    expect(result.continue).toBe(true);
  });

  it('should not have suppressOutput', () => {
    const result = outputAsk();
    expect(result.suppressOutput).toBeUndefined();
  });

  it('should produce valid JSON when stringified', () => {
    const result = outputAsk({ command: 'test' });
    const json = JSON.stringify(result);
    expect(() => JSON.parse(json)).not.toThrow();
  });
});

// =============================================================================
// hookEventName PARAMETER TESTS
// =============================================================================

describe('hookEventName parameter', () => {
  describe('outputAllow', () => {
    it('should default to PreToolUse', () => {
      const result = outputAllow();
      expect(result.hookSpecificOutput?.hookEventName).toBe('PreToolUse');
    });

    it('should accept PermissionRequest', () => {
      const result = outputAllow('PermissionRequest');
      expect(result.hookSpecificOutput?.hookEventName).toBe('PermissionRequest');
    });

    it('should accept explicit PreToolUse', () => {
      const result = outputAllow('PreToolUse');
      expect(result.hookSpecificOutput?.hookEventName).toBe('PreToolUse');
    });
  });

  describe('outputDeny', () => {
    it('should default to PreToolUse', () => {
      const result = outputDeny('reason');
      expect(result.hookSpecificOutput?.hookEventName).toBe('PreToolUse');
    });

    it('should accept PermissionRequest', () => {
      const result = outputDeny('reason', 'PermissionRequest');
      expect(result.hookSpecificOutput?.hookEventName).toBe('PermissionRequest');
    });

    it('should preserve reason with PermissionRequest', () => {
      const result = outputDeny('blocked', 'PermissionRequest');
      expect(result.stopReason).toBe('blocked');
      expect(result.hookSpecificOutput?.permissionDecisionReason).toBe('blocked');
    });
  });

  describe('outputAllowWithContext', () => {
    it('should default to PreToolUse', () => {
      const result = outputAllowWithContext('ctx');
      expect(result.hookSpecificOutput?.hookEventName).toBe('PreToolUse');
    });

    it('should accept PermissionRequest', () => {
      const result = outputAllowWithContext('ctx', 'PermissionRequest');
      expect(result.hookSpecificOutput?.hookEventName).toBe('PermissionRequest');
    });

    it('should preserve context with PermissionRequest', () => {
      const result = outputAllowWithContext('my context', 'PermissionRequest');
      expect(result.hookSpecificOutput?.additionalContext).toBe('my context');
    });
  });

  describe('outputAsk', () => {
    it('should default to PreToolUse', () => {
      const result = outputAsk();
      expect(result.hookSpecificOutput?.hookEventName).toBe('PreToolUse');
    });

    it('should accept PermissionRequest', () => {
      const result = outputAsk(undefined, 'PermissionRequest');
      expect(result.hookSpecificOutput?.hookEventName).toBe('PermissionRequest');
    });
  });

  describe('outputRetry', () => {
    it('should return exact expected structure', () => {
      const result = outputRetry();
      expect(result).toEqual({
        continue: true,
        suppressOutput: true,
        hookSpecificOutput: {
          hookEventName: 'PermissionRequest',
          retry: true,
        },
      });
    });

    it('should have continue set to true', () => {
      expect(outputRetry().continue).toBe(true);
    });

    it('should have suppressOutput set to true', () => {
      expect(outputRetry().suppressOutput).toBe(true);
    });

    it('should have retry set to true', () => {
      expect(outputRetry().hookSpecificOutput?.retry).toBe(true);
    });

    it('should not have permissionDecision', () => {
      expect(outputRetry().hookSpecificOutput?.permissionDecision).toBeUndefined();
    });
  });

  describe('outputDefer', () => {
    it('should return exact expected structure', () => {
      const result = outputDefer();
      expect(result).toEqual({
        continue: true,
        suppressOutput: true,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'defer',
        },
      });
    });

    it('should have continue set to true', () => {
      expect(outputDefer().continue).toBe(true);
    });

    it('should have suppressOutput set to true', () => {
      expect(outputDefer().suppressOutput).toBe(true);
    });

    it('should have permissionDecision set to defer', () => {
      expect(outputDefer().hookSpecificOutput?.permissionDecision).toBe('defer');
    });

    it('should not have retry', () => {
      expect(outputDefer().hookSpecificOutput?.retry).toBeUndefined();
    });
  });
});

// =============================================================================
// truncateForLLM TESTS
// =============================================================================

describe('truncateForLLM', () => {
  describe('text within budget', () => {
    it('should return short text unchanged', () => {
      const text = 'Hello world';
      expect(truncateForLLM(text)).toBe(text);
    });

    it('should return text unchanged when exactly at maxChars', () => {
      const text = 'A'.repeat(500);
      expect(truncateForLLM(text, { maxChars: 500 })).toBe(text);
    });

    it('should return text unchanged when exactly at maxLines', () => {
      const text = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n');
      expect(truncateForLLM(text, { maxLines: 20 })).toBe(text);
    });

    it('should return empty string unchanged', () => {
      expect(truncateForLLM('')).toBe('');
    });
  });

  describe('head truncation', () => {
    it('should keep first N lines and append truncation notice', () => {
      const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
      const text = lines.join('\n');
      const result = truncateForLLM(text, { strategy: 'head', maxLines: 5, maxChars: 10000 });

      expect(result).toContain('line 1');
      expect(result).toContain('line 5');
      expect(result).not.toContain('line 6');
      expect(result).toContain('... (truncated, 25 more lines)');
    });

    it('should truncate by chars and append notice', () => {
      const text = 'A'.repeat(100);
      const result = truncateForLLM(text, { strategy: 'head', maxChars: 50, maxLines: 1000 });

      expect(result.startsWith('A'.repeat(50))).toBe(true);
      expect(result).toContain('... (truncated, 50 more chars)');
    });
  });

  describe('tail truncation (default)', () => {
    it('should keep last N lines and prepend truncation notice', () => {
      const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
      const text = lines.join('\n');
      const result = truncateForLLM(text, { maxLines: 5, maxChars: 10000 });

      expect(result).not.toContain('line 25\n');
      expect(result).toContain('line 26');
      expect(result).toContain('line 30');
      expect(result).toContain('(truncated, 25 lines omitted) ...');
    });

    it('should truncate by chars and prepend notice', () => {
      const text = 'A'.repeat(100);
      const result = truncateForLLM(text, { strategy: 'tail', maxChars: 50, maxLines: 1000 });

      expect(result.endsWith('A'.repeat(50))).toBe(true);
      expect(result).toContain('(truncated, 50 chars omitted) ...');
    });

    it('should use tail strategy by default', () => {
      const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
      const text = lines.join('\n');
      const result = truncateForLLM(text, { maxLines: 5, maxChars: 10000 });

      // Should have tail behavior (last lines kept)
      expect(result).toContain('line 30');
      expect(result).toContain('(truncated,');
    });
  });

  describe('middle truncation', () => {
    it('should keep first 3 and last N-3 lines with omission notice', () => {
      const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
      const text = lines.join('\n');
      const result = truncateForLLM(text, { strategy: 'middle', maxLines: 10, maxChars: 10000 });

      expect(result).toContain('line 1');
      expect(result).toContain('line 2');
      expect(result).toContain('line 3');
      expect(result).toContain('... (20 lines omitted)');
      expect(result).toContain('line 24');
      expect(result).toContain('line 30');
      expect(result).not.toContain('line 4\n');
    });

    it('should truncate by chars with middle strategy', () => {
      const text = 'A'.repeat(50) + 'B'.repeat(50) + 'C'.repeat(50);
      const result = truncateForLLM(text, { strategy: 'middle', maxChars: 60, maxLines: 1000 });

      expect(result.startsWith('A'.repeat(30))).toBe(true);
      expect(result.endsWith('C'.repeat(30))).toBe(true);
      expect(result).toContain('chars omitted');
    });
  });

  describe('maxLines applied before maxChars', () => {
    it('should apply maxLines first, then maxChars on the result', () => {
      // 100 lines of 20 chars each
      const lines = Array.from(
        { length: 100 },
        (_, i) => `line-${String(i).padStart(3, '0')}-padding`
      );
      const text = lines.join('\n');

      // maxLines=5 reduces to ~5 lines + truncation notice, then maxChars=50 further trims
      const result = truncateForLLM(text, { strategy: 'head', maxLines: 5, maxChars: 50 });

      // After line truncation, char truncation kicks in
      expect(result.length).toBeGreaterThan(50); // includes the truncation notice
      expect(result).toContain('more chars');
    });
  });

  describe('edge cases', () => {
    it('should handle single-line text exceeding maxChars', () => {
      const text = 'X'.repeat(1000);
      const result = truncateForLLM(text, { maxChars: 100 });
      expect(result).toContain('X'.repeat(100));
      expect(result).toContain('chars omitted');
    });

    it('should handle text with only newlines', () => {
      const text = '\n'.repeat(50);
      const result = truncateForLLM(text, { maxLines: 5 });
      expect(result).toBeDefined();
    });

    it('should preserve unicode characters during truncation', () => {
      const text = '\u2714 '.repeat(300);
      const result = truncateForLLM(text, { maxChars: 100 });
      expect(result).toContain('\u2714');
    });
  });
});

// =============================================================================
// outputWarningBudgeted TESTS
// =============================================================================

describe('outputWarningBudgeted', () => {
  it('should return warning with short message unchanged', () => {
    const result = outputWarningBudgeted('Short warning');

    expect(result).toEqual({
      continue: true,
      systemMessage: '\u26a0 Short warning',
    });
  });

  it('should truncate long messages', () => {
    const longMessage = 'E'.repeat(1000);
    const result = outputWarningBudgeted(longMessage, 200);

    expect(result.continue).toBe(true);
    expect(result.systemMessage).toBeDefined();
    // The warning prefix is added after truncation
    expect(result.systemMessage?.startsWith('\u26a0 ')).toBe(true);
    // The truncated content should be shorter than original
    // systemMessage = "⚠ " + truncated(1000 -> 200)
    expect(result.systemMessage?.length).toBeLessThan(1000);
  });

  it('should use default maxChars of 500', () => {
    const longMessage = 'W'.repeat(800);
    const result = outputWarningBudgeted(longMessage);

    expect(result.systemMessage).toBeDefined();
    // Should be truncated since 800 > 500
    expect(result.systemMessage).toContain('chars omitted');
  });

  it('should have continue=true', () => {
    const result = outputWarningBudgeted('test');
    expect(result.continue).toBe(true);
  });

  it('should not have hookSpecificOutput', () => {
    const result = outputWarningBudgeted('test');
    expect(result.hookSpecificOutput).toBeUndefined();
  });

  it('should satisfy HookResult interface', () => {
    const result: HookResult = outputWarningBudgeted('test');
    expect(result).toBeDefined();
  });
});

// =============================================================================
// outputContextBudgeted TESTS
// =============================================================================

describe('outputContextBudgeted', () => {
  it('should return context with short text unchanged', () => {
    const result = outputContextBudgeted('Short context');

    expect(result).toEqual({
      continue: true,
      suppressOutput: true,
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: 'Short context',
      },
    });
  });

  it('should truncate long context', () => {
    const longContext = 'C'.repeat(2000);
    const result = outputContextBudgeted(longContext, 500);

    expect(result.continue).toBe(true);
    expect(result.suppressOutput).toBe(true);
    expect(result.hookSpecificOutput?.additionalContext).toBeDefined();
    expect(result.hookSpecificOutput?.additionalContext?.length).toBeLessThan(2000);
    expect(result.hookSpecificOutput?.additionalContext).toContain('chars omitted');
  });

  it('should use default maxChars of 1000', () => {
    const longContext = 'D'.repeat(1500);
    const result = outputContextBudgeted(longContext);

    expect(result.hookSpecificOutput?.additionalContext).toContain('chars omitted');
  });

  it('should have hookEventName UserPromptSubmit', () => {
    const result = outputContextBudgeted('test');
    expect(result.hookSpecificOutput?.hookEventName).toBe('UserPromptSubmit');
  });

  it('should have suppressOutput=true', () => {
    const result = outputContextBudgeted('test');
    expect(result.suppressOutput).toBe(true);
  });

  it('should not have permissionDecision', () => {
    const result = outputContextBudgeted('test');
    expect(result.hookSpecificOutput?.permissionDecision).toBeUndefined();
  });

  it('should satisfy HookResult interface', () => {
    const result: HookResult = outputContextBudgeted('test');
    expect(result).toBeDefined();
  });

  it('should produce valid JSON when stringified', () => {
    const result = outputContextBudgeted('Test context');
    const json = JSON.stringify(result);
    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json);
    expect(parsed.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
  });
});

// =============================================================================
// outputSessionTitle TESTS (CC 2.1.94+)
// =============================================================================

describe('outputSessionTitle', () => {
  it('should return continue=true with suppressOutput=true', () => {
    const result = outputSessionTitle('feat/user-auth');
    expect(result.continue).toBe(true);
    expect(result.suppressOutput).toBe(true);
  });

  it('should set hookEventName to UserPromptSubmit', () => {
    const result = outputSessionTitle('main');
    expect(result.hookSpecificOutput?.hookEventName).toBe('UserPromptSubmit');
  });

  it('should set sessionTitle to the provided title', () => {
    const result = outputSessionTitle('feat/cc-v2.1.97-alignment');
    expect(result.hookSpecificOutput?.sessionTitle).toBe('feat/cc-v2.1.97-alignment');
  });

  it('should handle branch names with slashes', () => {
    const result = outputSessionTitle('fix/login/oauth-bug');
    expect(result.hookSpecificOutput?.sessionTitle).toBe('fix/login/oauth-bug');
  });

  it('should satisfy HookResult interface', () => {
    const result: HookResult = outputSessionTitle('main');
    expect(result).toBeDefined();
  });

  it('should produce valid JSON when stringified', () => {
    const result = outputSessionTitle('develop');
    const json = JSON.stringify(result);
    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json);
    expect(parsed.hookSpecificOutput.sessionTitle).toBe('develop');
  });
});

// =============================================================================
// outputAnswerQuestion TESTS (CC 2.1.85+)
// =============================================================================

describe('outputAnswerQuestion', () => {
  it('should return continue=true with suppressOutput=true', () => {
    const result = outputAnswerQuestion({ answer: 'yes' });
    expect(result.continue).toBe(true);
    expect(result.suppressOutput).toBe(true);
  });

  it('should set hookEventName to PreToolUse', () => {
    const result = outputAnswerQuestion({ answer: 'proceed' });
    expect(result.hookSpecificOutput?.hookEventName).toBe('PreToolUse');
  });

  it('should set permissionDecision to allow', () => {
    const result = outputAnswerQuestion({ answer: 'yes' });
    expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
  });

  it('should pass updatedInput through', () => {
    const input = { answer: 'yes, proceed with migration' };
    const result = outputAnswerQuestion(input);
    expect(result.hookSpecificOutput?.updatedInput).toEqual(input);
  });

  it('should handle complex updatedInput objects', () => {
    const input = { answer: 'option-2', metadata: { confidence: 0.95 } };
    const result = outputAnswerQuestion(input);
    expect(result.hookSpecificOutput?.updatedInput).toEqual(input);
  });

  it('should satisfy HookResult interface', () => {
    const result: HookResult = outputAnswerQuestion({ answer: 'test' });
    expect(result).toBeDefined();
  });

  it('should produce valid JSON when stringified', () => {
    const json = JSON.stringify(outputAnswerQuestion({ answer: 'confirmed' }));
    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json);
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('allow');
    expect(parsed.hookSpecificOutput.updatedInput.answer).toBe('confirmed');
  });
});

// =============================================================================
// outputMessageDisplay TESTS (CC v2.1.152+ MessageDisplay event)
//
// SCOPE LIMIT — read before trusting these tests.
//
// Everything below pins what we EMIT. Nothing here can verify what Claude Code
// CONSUMES. `transformedMessage` was wrong for a year precisely because no
// emitted-shape test could contradict it; the key was settled by reading the CC
// binary (see the reproduction in output.ts). Payload capture remains the only
// ground truth for consumption. These tests exist so the key cannot drift
// SILENTLY, not so it can be declared correct.
//
// Before #64 the key was pinned only through the phi-output-redactor hook — two
// ctk test files (phi-output-redactor.test.ts, and the wrapper e2e in
// tests/bin/run-hook-wrapper.test.ts). Both run through that one hook, so
// re-pointing or deleting it took the pin with it. The pin is intentional and
// lives in shared/ now.
// =============================================================================

describe('outputMessageDisplay', () => {
  it('should emit the exact MessageDisplay payload', () => {
    // Literal expectation on purpose. Deriving it from the implementation
    // would assert the code against itself and pass no matter what it emits.
    expect(outputMessageDisplay('SSN: [REDACTED]')).toEqual({
      continue: true,
      suppressOutput: true,
      hookSpecificOutput: {
        hookEventName: 'MessageDisplay',
        displayContent: 'SSN: [REDACTED]',
      },
    });
  });

  it('should name the replacement key displayContent, not transformedMessage', () => {
    const emitted = outputMessageDisplay('redacted') as {
      hookSpecificOutput: Record<string, unknown>;
    };
    expect(Object.keys(emitted.hookSpecificOutput).sort()).toEqual([
      'displayContent',
      'hookEventName',
    ]);
    expect('transformedMessage' in emitted.hookSpecificOutput).toBe(false);
  });

  it('should pass the text through unmodified', () => {
    const text = 'line one\nline two\ttabbed  — em-dash "quoted" \\backslash\\';
    expect(outputMessageDisplay(text).hookSpecificOutput?.displayContent).toBe(text);
  });

  it('should preserve an empty string rather than dropping the key', () => {
    const emitted = outputMessageDisplay('') as {
      hookSpecificOutput: Record<string, unknown>;
    };
    expect(emitted.hookSpecificOutput.displayContent).toBe('');
    expect('displayContent' in emitted.hookSpecificOutput).toBe(true);
  });

  // MIGRATED FROM outputMessageDisplayHide, which was removed as a pure rename
  // (issue #67). The suppression contract now belongs to this function, so its
  // regression test does too — deleting the wrapper must not delete the only
  // assertion that CC has no `hide` field.
  //
  // That absence is the regression that matters most: the removed helper's
  // ORIGINAL implementation returned `{ hide: true }`, a field occurring nowhere
  // in the CC binary, so a caller believing it had suppressed a message would
  // have displayed that message in full. Nothing called it, so nothing caught it.
  //
  // Asserted with `in` rather than a truthiness check on purpose: a resurrected
  // `hide: false` satisfies `toBeFalsy()` while re-introducing the key.
  it('should suppress via empty displayContent and emit NO hide field', () => {
    const emitted = outputMessageDisplay('') as {
      hookSpecificOutput: Record<string, unknown>;
    };
    expect('hide' in emitted.hookSpecificOutput).toBe(false);
    expect('hide' in emitted).toBe(false);
    expect(Object.keys(emitted.hookSpecificOutput).sort()).toEqual([
      'displayContent',
      'hookEventName',
    ]);
  });

  it('should preserve unicode and emoji without mangling', () => {
    const text = 'patient 🏥 données médicales 日本語 🔒';
    expect(outputMessageDisplay(text).hookSpecificOutput?.displayContent).toBe(text);
  });

  it('should not truncate long content', () => {
    const text = 'x'.repeat(50_000);
    const out = outputMessageDisplay(text).hookSpecificOutput?.displayContent as string;
    expect(out).toHaveLength(50_000);
    expect(out).toBe(text);
  });

  it('should satisfy HookResult interface', () => {
    const result: HookResult = outputMessageDisplay('test');
    expect(result).toBeDefined();
  });

  it('should produce valid JSON when stringified', () => {
    const json = JSON.stringify(outputMessageDisplay('SSN: [REDACTED]'));
    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json);
    expect(parsed.hookSpecificOutput.hookEventName).toBe('MessageDisplay');
    expect(parsed.hookSpecificOutput.displayContent).toBe('SSN: [REDACTED]');
  });
});

// =============================================================================
// outputStderrWarning TESTS
//
// Unlike every other helper in this file, this one returns `never`: it writes to
// stderr and calls process.exit(2).
//
// It is RE-EXPORTED from all five plugins' index.ts, and called from none of
// them — `grep -n 'outputStderrWarning('` over tracked .ts outside dist/ returns
// only this file and the definition itself. It is tested for exactly that reason:
// nothing exercises it, so nothing would catch a change to it. (An earlier
// version of this comment claimed it was "called from all five plugins" —
// false, corrected after adversarial review of #66.)
//
// #67 settled the zero-caller question as a rule rather than case by case: KEEP a
// helper wrapping a real CC mechanism nothing else wraps, DELETE a pure rename.
// This one is kept — it is the only wrapper over exit 2, and the only one of the
// eight zero-caller helpers that is genuinely plugin-public API. The sibling
// `outputMessageDisplayHide` was `return outputMessageDisplay('')` and was
// removed; its load-bearing assertion (no `hide` field) moved to the
// `outputMessageDisplay` block above rather than being deleted with it.
//
// ⚠ A UNIT TEST PINS THE BEHAVIOUR YOU WROTE DOWN — INCLUDING WHEN IT IS WRONG.
// These tests were green while the doc comment described exit 2 as purely
// user-facing. It is a *blocking* error (CC 2.1.221 carries the literals
// `hook blocking error from command:` and `hook returned blocking error`), and on
// PreToolUse/PostToolUse/Stop the message reaches Claude. The docstring is now
// corrected; no assertion here could have caught it, which is the point.
//
// The stub for process.exit deliberately THROWS. A no-op stub was measured
// during Phase 2 of #64 and lets execution continue past a call typed `never` —
// the function then RETURNS, and assertions written after it pass while
// modelling a state that cannot occur at runtime. Throwing keeps the control
// flow faithful: nothing after the exit call is reachable.
// =============================================================================

class ProcessExitCalled extends Error {
  constructor(readonly code: number | string | null | undefined) {
    super(`process.exit(${String(code)})`);
    this.name = 'ProcessExitCalled';
  }
}

/** Stub process.exit/stderr.write. Both spies are restored in afterEach. */
function stubExitAndStderr() {
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new ProcessExitCalled(code);
  }) as never);
  const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  return { exitSpy, writeSpy };
}

describe('outputStderrWarning', () => {
  // Protects any describe added BELOW this one. Cross-FILE leakage is already
  // impossible: no vitest.config.ts here sets `pool` or `isolate`, so vitest 2.x
  // defaults apply (pool=forks, isolate=true) and each file gets a fresh
  // environment. This hook is currently the last line of defence only for
  // in-file ordering — it is not what keeps the other ~220 tests safe, which an
  // earlier version of this comment incorrectly claimed.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should exit with code 2', () => {
    const { exitSpy } = stubExitAndStderr();
    let thrown: unknown;
    try {
      outputStderrWarning('disk almost full');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ProcessExitCalled);
    expect((thrown as ProcessExitCalled).code).toBe(2);
    expect(exitSpy).toHaveBeenCalledTimes(1);
  });

  it('should write the message to stderr with a trailing newline', () => {
    const { writeSpy } = stubExitAndStderr();
    try {
      outputStderrWarning('disk almost full');
    } catch {
      /* expected: the exit stub throws */
    }
    expect(writeSpy).toHaveBeenCalledWith('disk almost full\n');
  });

  it('should write to stderr BEFORE exiting', () => {
    // Ordering is the contract: exiting first would discard the message.
    const order: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation(() => {
      order.push('write');
      return true;
    });
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      order.push('exit');
      throw new ProcessExitCalled(code);
    }) as never);

    try {
      outputStderrWarning('ordered');
    } catch {
      /* expected */
    }
    expect(order).toEqual(['write', 'exit']);
  });

  it('should not swallow an empty message', () => {
    const { writeSpy } = stubExitAndStderr();
    try {
      outputStderrWarning('');
    } catch {
      /* expected */
    }
    expect(writeSpy).toHaveBeenCalledWith('\n');
  });

  it('should write multi-line and unicode messages verbatim', () => {
    const { writeSpy } = stubExitAndStderr();
    const message = 'line one\nline two 🔒 日本語';
    try {
      outputStderrWarning(message);
    } catch {
      /* expected */
    }
    expect(writeSpy).toHaveBeenCalledWith(`${message}\n`);
  });

  it('should not return — execution stops at the exit call', () => {
    stubExitAndStderr();
    const reached: string[] = [];
    let thrown: unknown;
    try {
      outputStderrWarning('halt here');
      reached.push('after-call');
    } catch (error) {
      thrown = error;
    }
    expect(reached).toEqual([]);
    // Both halves matter. Without the second assertion this passes when the
    // helper throws for ANY reason, so it would report "did not fall through"
    // for a function that never reached process.exit at all.
    expect(thrown).toBeInstanceOf(ProcessExitCalled);
  });
});
