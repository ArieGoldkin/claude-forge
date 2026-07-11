/**
 * Git Validator PreToolUse Hook
 *
 * Validates git commit commands for:
 * - Commit message format (conventional commits)
 * - Branch naming conventions
 * - Protected branch warnings
 *
 * This hook provides helpful warnings but does not block operations.
 * It helps maintain consistent git practices across the team.
 *
 * @module pretool/git-validator
 */

import { getCachedBranch, isProtectedBranch } from '../lib/git-utils.js';
import {
  extractCommitMessageFromCommand,
  isAmendCommit,
  isGitCommitCommand,
  validateBranchName,
  validateCommitMessage,
} from '../lib/git-validators.js';
import { guardBash, guardHasCommand, runGuards } from '../lib/guards.js';
import { getCommand, stripProxyPrefix } from '../lib/input.js';
import { logDebug, logInfo, logWarn } from '../lib/logging.js';
import { outputSilentSuccess, outputWarning } from '../lib/output.js';
import type { HookInput, HookResult } from '../types.js';

const HOOK_NAME = 'git-validator';

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

/**
 * Validate commit message and return warning if invalid.
 */
function validateMessage(command: string): string | null {
  const message = extractCommitMessageFromCommand(command);
  if (!message) {
    return null;
  }

  const validation = validateCommitMessage(message);
  if (validation.valid) {
    return null;
  }

  logInfo(HOOK_NAME, `Invalid commit message: ${validation.error}`);
  const suggestion = validation.suggestion ? ` (${validation.suggestion})` : '';
  return `Commit message: ${validation.error}${suggestion}`;
}

/**
 * Check branch and return warnings for protected/invalid branch.
 */
function checkBranch(): string[] {
  const warnings: string[] = [];
  const currentBranch = getCachedBranch();

  if (!currentBranch) {
    return warnings;
  }

  if (isProtectedBranch(currentBranch)) {
    logWarn(HOOK_NAME, `Committing to protected branch: ${currentBranch}`);
    warnings.push(
      `Committing directly to protected branch '${currentBranch}'. Consider using a feature branch.`
    );
    return warnings; // Don't also warn about branch name for protected branches
  }

  const validation = validateBranchName(currentBranch);
  if (!validation.valid) {
    logInfo(HOOK_NAME, `Invalid branch name: ${validation.error}`);
    const suggestion = validation.suggestion ? ` (${validation.suggestion})` : '';
    warnings.push(`Branch: ${validation.error}${suggestion}`);
  }

  return warnings;
}

// =============================================================================
// MAIN HOOK
// =============================================================================

/**
 * Git validator PreToolUse hook.
 *
 * This hook validates git commit commands and provides warnings for:
 * 1. Invalid commit message format (not following conventional commits)
 * 2. Committing to protected branches (main, master, develop, etc.)
 * 3. Invalid branch names (not following naming conventions)
 *
 * The hook never blocks operations - it only provides helpful guidance.
 *
 * @param input - Hook input from Claude Code
 * @returns HookResult with warning message or silent success
 */
export async function gitValidator(input: HookInput): Promise<HookResult> {
  const skipped = runGuards(input, guardBash, guardHasCommand);
  if (skipped) return skipped;

  // guardHasCommand ensures command is present; narrow for TypeScript.
  // Unwrap a token-optimizing proxy prefix (`rtk git commit …` → `git commit …`)
  // so commit-message/branch validation still fires when a proxy is active.
  const command = stripProxyPrefix(getCommand(input) as string);
  if (!isGitCommitCommand(command)) {
    return outputSilentSuccess();
  }

  logDebug(HOOK_NAME, `Validating git commit: ${command.slice(0, 80)}...`);

  const warnings: string[] = [];

  // Validate commit message (skip for amend commits)
  if (!isAmendCommit(command)) {
    const messageWarning = validateMessage(command);
    if (messageWarning) {
      warnings.push(messageWarning);
    }
  }

  // Check branch
  warnings.push(...checkBranch());

  // Return result
  if (warnings.length > 0) {
    logInfo(HOOK_NAME, `Git validation warnings: ${warnings.length}`);
    return outputWarning(warnings.join('\n'));
  }

  logDebug(HOOK_NAME, 'Git commit validation passed');
  return outputSilentSuccess();
}

export default gitValidator;
