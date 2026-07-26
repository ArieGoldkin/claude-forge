/**
 * Failure Logger PostToolUseFailure Hook
 *
 * Logs all tool failures with structured data and provides contextual
 * fix hints for known failure patterns. Fires when a tool invocation
 * fails (non-zero exit, timeout, etc.).
 *
 * PostToolUseFailure input includes an `error` field (string) describing
 * the failure, plus standard tool_name/tool_input fields.
 *
 * @module posttool/failure-logger
 */

import { getCommand, getFilePath, getSessionId, getToolName } from '../lib/input.js';
import { logInfo, logWarn } from '../lib/logging.js';
import { outputSilentSuccess, outputWithContext } from '../lib/output.js';
import type { HookInput, HookResult } from '../types.js';

const HOOK_NAME = 'failure-logger';

// =============================================================================
// TYPES
// =============================================================================

// =============================================================================
// KNOWN FAILURE PATTERNS
// =============================================================================

interface FailurePattern {
  /** Regex to match against the error string */
  pattern: RegExp;
  /** Hint to inject as additionalContext for Claude */
  hint: string;
}

/**
 * Known failure patterns with contextual fix hints.
 * When a tool failure matches one of these, the hint is injected
 * as additionalContext so Claude can self-correct.
 */
const KNOWN_PATTERNS: FailurePattern[] = [
  // Specific patterns before generic ones (order matters — first match wins)
  {
    pattern: /ruff:\s*command not found|No such file.*ruff/i,
    hint: 'ruff is not installed. Install with: pip install ruff (or uv pip install ruff). You can also disable the lint-checker hook in .claude/hook-overrides.json.',
  },
  {
    pattern: /command not found|not found in PATH/i,
    hint: 'The command is not installed or not in PATH. Check if it needs to be installed (e.g., pip install, npm install -g, brew install).',
  },
  {
    pattern: /ENOENT|No such file or directory/i,
    hint: 'A file or directory does not exist. Verify the path is correct and the parent directory exists before retrying.',
  },
  {
    pattern: /permission denied|EACCES/i,
    hint: 'Permission denied. Check file permissions or whether the path is read-only.',
  },
  {
    pattern: /ENOSPC|No space left on device/i,
    hint: 'Disk is full. Free up space before retrying.',
  },
  {
    pattern: /timed?\s*out|timeout/i,
    hint: 'The operation timed out. Consider breaking the task into smaller steps or increasing the timeout.',
  },
  {
    pattern: /ECONNREFUSED|ECONNRESET|ETIMEDOUT/i,
    hint: 'Network connection failed. Check if the target service is running and reachable.',
  },
  {
    pattern: /SyntaxError|Unexpected token/i,
    hint: 'There is a syntax error in the code. Review the file for missing brackets, quotes, or semicolons.',
  },
];

// =============================================================================
// MAIN HOOK
// =============================================================================

/**
 * Failure logger PostToolUseFailure hook.
 *
 * Logs structured failure data and injects fix hints for known patterns.
 * Always continues (never blocks) — the tool has already failed.
 *
 * @param input - Hook input from Claude Code (includes error field)
 * @returns HookResult — silent success or context with hint
 */
export async function failureLogger(input: HookInput): Promise<HookResult> {
  // `error` / `is_interrupt` are declared on HookInput since #54 — no local
  // interface, which is the pattern that hid this handler's inertness.
  const error = input.error;

  // No error field means nothing useful to log
  if (!error) {
    return outputSilentSuccess();
  }

  const toolName = getToolName(input);
  const sessionId = getSessionId(input);
  const command = getCommand(input);
  const filePath = getFilePath(input);

  // Build structured log entry
  const target = command ? `cmd=${command.slice(0, 100)}` : filePath ? `file=${filePath}` : '';
  const logMsg = `FAILURE tool=${toolName} session=${sessionId} ${target} error=${error.slice(0, 200)}`;
  logWarn(HOOK_NAME, logMsg);

  // Check known patterns for contextual hints
  for (const { pattern, hint } of KNOWN_PATTERNS) {
    if (pattern.test(error)) {
      logInfo(HOOK_NAME, `Matched pattern: ${pattern.source}`);
      return outputWithContext(hint);
    }
  }

  // Unknown failure — log only, no hint
  return outputSilentSuccess();
}

export default failureLogger;
