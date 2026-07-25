/**
 * Error Warner PostToolUse Hook
 *
 * Analyzes Bash command output for common error patterns and provides
 * helpful tips to the user. Runs asynchronously to avoid blocking.
 *
 * This hook reads error patterns from .claude/rules/error_rules.json
 * and matches them against command output.
 *
 * @module posttool/error-warner
 */

import { loadErrorRules, matchError } from '../lib/error-rules.js';
import { guardBash, guardHasCommand, runGuards } from '../lib/guards.js';
import { getCommand } from '../lib/input.js';
import { logDebug, logInfo } from '../lib/logging.js';
import { outputSilentSuccess, outputWithContext } from '../lib/output.js';
import type { HookInput, HookResult } from '../types.js';

const HOOK_NAME = 'error-warner';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Extended hook input with tool output (PostToolUse context).
 */
interface PostToolUseInput extends HookInput {
  /**
   * PostToolUse payload field. Captured live from CC 2.1.220 for a Bash call:
   * `{ stdout, stderr, interrupted, isImage, noOutputExpected }`.
   * `exit_code` / `output` were NOT observed for Bash — kept optional in case
   * other tools supply them, but do not rely on them.
   *
   * NOTE: this field must also appear in `passThrough` in lib/input.ts, or
   * normalizeInput deletes it before this handler runs (see ctk 2.9.0).
   */
  tool_response?: {
    stdout?: string;
    stderr?: string;
    exit_code?: number;
    output?: string;
  };
}

// =============================================================================
// MAIN HOOK
// =============================================================================

/**
 * Error warner PostToolUse hook.
 *
 * This hook analyzes the output of Bash commands and provides helpful
 * tips when it detects common error patterns. It runs asynchronously
 * (configured in hooks.json) to avoid blocking the user experience.
 *
 * @param input - Hook input from Claude Code (includes tool_response)
 * @returns HookResult with additionalContext if error detected
 */
export async function errorWarner(input: HookInput): Promise<HookResult> {
  const skipped = runGuards(input, guardBash, guardHasCommand);
  if (skipped) return skipped;

  // guardHasCommand ensures command is present; narrow for TypeScript
  const command = getCommand(input) as string;

  // Get tool output from the extended input
  const extendedInput = input as PostToolUseInput;
  const toolOutput = extendedInput.tool_response;

  if (!toolOutput) {
    logDebug(HOOK_NAME, 'No tool output available');
    return outputSilentSuccess();
  }

  // Combine stdout, stderr, and output fields
  const outputText = [toolOutput.stdout, toolOutput.stderr, toolOutput.output]
    .filter(Boolean)
    .join('\n');

  if (!outputText) {
    logDebug(HOOK_NAME, 'Empty output, skipping');
    return outputSilentSuccess();
  }

  // Only analyze if there seems to be an error
  // Check exit code or error-like patterns
  // Note: CC v2.1.105+ aborts stalled API streams after 5 minutes of no data and
  // retries non-streaming. These "stream abort + retry" events may surface as transient
  // API errors in tool output. Error rules should distinguish stream-abort retries
  // (benign, CC handles automatically) from genuine API failures.
  const hasError =
    (toolOutput.exit_code !== undefined && toolOutput.exit_code !== 0) ||
    outputText.includes('Error') ||
    outputText.includes('error') ||
    outputText.includes('FAIL') ||
    outputText.includes('failed') ||
    outputText.includes('Cannot') ||
    outputText.includes('cannot') ||
    outputText.includes('stream abort') ||
    outputText.includes('STREAM_ABORT');

  if (!hasError) {
    logDebug(HOOK_NAME, 'No error indicators found');
    return outputSilentSuccess();
  }

  logDebug(HOOK_NAME, `Analyzing error output for: ${command.slice(0, 50)}...`);

  // Load error rules
  const projectDir = process.env['CLAUDE_PROJECT_DIR'] || '.';
  const config = await loadErrorRules(projectDir);

  if (!config || config.rules.length === 0) {
    logDebug(HOOK_NAME, 'No error rules configured');
    return outputSilentSuccess();
  }

  // Match against error patterns
  const matchResult = matchError(outputText, config.rules);

  if (!matchResult.matched || !matchResult.rule) {
    logDebug(HOOK_NAME, 'No matching error pattern found');
    return outputSilentSuccess();
  }

  logInfo(HOOK_NAME, `Matched error rule: ${matchResult.rule.id}`);

  // Return with additionalContext so Claude can see the tip
  return outputWithContext(`💡 Tip: ${matchResult.rule.message}`);
}

export default errorWarner;
