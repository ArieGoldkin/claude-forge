/**
 * Combined PermissionRequest Hook
 *
 * Chains permission hooks for the PermissionRequest event (Claude Code v2.1+).
 * PermissionRequest fires when the user is about to see a permission dialog.
 * This hook auto-approves safe operations before the dialog appears.
 *
 * Unlike PreToolUse, PermissionRequest does NOT need git-validator or
 * security-blocker — those already ran in PreToolUse. This hook only
 * chains the permission (auto-approve) hooks.
 *
 * Logic:
 * 1. For Bash → run autoApproveSafeBash(), short-circuit on allow
 * 2. For Write|Edit|MultiEdit → run autoApproveProjectWrites(), short-circuit on allow
 * 3. For all tools → run profileEvaluator(), short-circuit on allow/deny
 * 4. Else → outputSilentSuccess() (user sees standard permission dialog)
 *
 * @module permission/permission-request-combined
 */

import { getToolName } from '../lib/input.js';
import { logDebug, logInfo } from '../lib/logging.js';
import { isDenyDecision, outputSilentSuccess } from '../lib/output.js';
import type { HookInput, HookResult, HookSpecificOutput } from '../types.js';
import { autoApproveProjectWrites } from './auto-approve-project-writes.js';
import { autoApproveSafeBash } from './auto-approve-safe-bash.js';
import { profileEvaluator } from './profile-evaluator.js';

const HOOK_NAME = 'permission-request-combined';

/**
 * Patch hookEventName from 'PreToolUse' to 'PermissionRequest' on a result.
 * Individual permission hooks return 'PreToolUse' by default. This helper
 * rewrites it to 'PermissionRequest' for the combined hook output.
 */
function patchHookEventName(result: HookResult): HookResult {
  if (result.hookSpecificOutput?.hookEventName === 'PreToolUse') {
    return {
      ...result,
      hookSpecificOutput: {
        ...result.hookSpecificOutput,
        hookEventName: 'PermissionRequest',
      } as HookSpecificOutput,
    };
  }
  return result;
}

/**
 * Check if a hook result is an allow decision.
 */
function isAllowDecision(result: HookResult): boolean {
  return result.continue === true && result.hookSpecificOutput?.permissionDecision === 'allow';
}

// `isDenyDecision` is imported from lib/output.js — single definition of what
// counts as a denial (#65). A private copy here tested only `continue === false`.

/**
 * Combined PermissionRequest hook.
 *
 * Runs permission hooks in sequence within a single Node.js process.
 * Short-circuits on first allow/deny decision.
 *
 * @param input - Hook input from Claude Code
 * @returns HookResult with permission decision or silent success
 */
export async function permissionRequestCombined(input: HookInput): Promise<HookResult> {
  const toolName = getToolName(input);

  logDebug(HOOK_NAME, `Evaluating permission request for ${toolName}`);

  // 1. For Bash → run autoApproveSafeBash
  if (toolName === 'Bash') {
    logDebug(HOOK_NAME, 'Running: auto-approve-safe-bash');
    const safeBashResult = await autoApproveSafeBash(input);

    if (isAllowDecision(safeBashResult)) {
      logInfo(HOOK_NAME, 'Auto-approved by safe-bash check');
      return patchHookEventName(safeBashResult);
    }
  }

  // 2. For Write|Edit|MultiEdit → run autoApproveProjectWrites
  if (toolName === 'Write' || toolName === 'Edit' || toolName === 'MultiEdit') {
    logDebug(HOOK_NAME, 'Running: auto-approve-project-writes');
    const writeResult = await autoApproveProjectWrites(input);

    if (isAllowDecision(writeResult)) {
      logInfo(HOOK_NAME, 'Auto-approved by project-writes check');
      return patchHookEventName(writeResult);
    }
  }

  // 3. For all tools → run profileEvaluator
  logDebug(HOOK_NAME, 'Running: profile-evaluator');
  const profileResult = await profileEvaluator(input);

  if (isAllowDecision(profileResult)) {
    logInfo(HOOK_NAME, 'Allowed by profile');
    return patchHookEventName(profileResult);
  }

  if (isDenyDecision(profileResult)) {
    logInfo(HOOK_NAME, 'Denied by profile');
    return patchHookEventName(profileResult);
  }

  // 4. No decision — defer to standard permission dialog
  logDebug(HOOK_NAME, 'No decision, deferring to permission dialog');
  return outputSilentSuccess();
}

export default permissionRequestCombined;
