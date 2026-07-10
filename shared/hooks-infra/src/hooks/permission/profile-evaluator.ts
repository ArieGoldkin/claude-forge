/**
 * Permission Profile Evaluator Hook
 *
 * Evaluates tool operations against declarative permission profiles.
 * Profiles are loaded from .claude/permissions/default.json.
 *
 * This hook provides a flexible way to define permission rules without
 * modifying code. Rules can auto-approve, require approval, or deny
 * based on tool name, file path, or command.
 *
 * @module permission/profile-evaluator
 */

import {
  getCommand,
  getFilePath,
  getSessionId,
  getToolName,
  stripProxyPrefix,
} from '../lib/input.js';
import { logDebug, logInfo, logPermission } from '../lib/logging.js';
import { outputAllow, outputDeny, outputSilentSuccess } from '../lib/output.js';
import { evaluatePermission, loadPermissionProfile } from '../lib/permission-profiles.js';
import type { HookInput, HookResult } from '../types.js';

const HOOK_NAME = 'profile-evaluator';

// =============================================================================
// MAIN HOOK
// =============================================================================

/**
 * Permission profile evaluator hook.
 *
 * This hook evaluates operations against a declarative permission profile.
 * It's designed to work alongside other permission hooks in the chain.
 *
 * The hook:
 * 1. Loads the permission profile (with caching)
 * 2. Evaluates deny rules first (blocks if matched)
 * 3. Evaluates require_approval rules (defers to standard flow if matched)
 * 4. Evaluates auto_approve rules (allows if matched)
 * 5. Returns silent success if no rules match (defers to other hooks)
 *
 * @param input - Hook input from Claude Code
 * @returns HookResult with permission decision
 */
export async function profileEvaluator(input: HookInput): Promise<HookResult> {
  const toolName = getToolName(input);
  const filePath = getFilePath(input);
  // Unwrap a token-optimizing proxy prefix (`rtk git status` → `git status`) so
  // profile rules keyed on the command still match when a proxy is active.
  const rawCommand = getCommand(input);
  const command = rawCommand ? stripProxyPrefix(rawCommand) : rawCommand;
  const sessionId = getSessionId(input);
  const projectDir = process.env['CLAUDE_PROJECT_DIR'] || '.';

  logDebug(HOOK_NAME, `Evaluating ${toolName} with profile`);

  // Load permission profile
  const profile = await loadPermissionProfile(projectDir);

  if (!profile) {
    logDebug(HOOK_NAME, 'No permission profile found, deferring');
    return outputSilentSuccess();
  }

  // Evaluate permission
  const decision = evaluatePermission(profile, toolName, filePath, command, projectDir);

  switch (decision) {
    case 'deny': {
      const target = filePath || command || toolName;
      logPermission('deny', `Profile denied: ${target}`, toolName, sessionId);
      logInfo(HOOK_NAME, `Denied by profile: ${target}`);
      return outputDeny(`Operation denied by permission profile: ${target}`);
    }

    case 'require_approval': {
      // Defer to standard permission flow (don't auto-approve)
      logDebug(HOOK_NAME, 'Requires approval per profile, deferring to standard flow');
      return outputSilentSuccess();
    }

    case 'allow': {
      const target = filePath || command || toolName;
      logPermission('allow', `Profile approved: ${target}`, toolName, sessionId);
      logInfo(HOOK_NAME, `Allowed by profile: ${target}`);
      return outputAllow();
    }

    default:
      // No rule matched - defer to other hooks
      logDebug(HOOK_NAME, 'No profile rule matched, deferring');
      return outputSilentSuccess();
  }
}

export default profileEvaluator;
