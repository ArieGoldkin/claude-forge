/**
 * Combined Write/Edit/MultiEdit PreToolUse Hook
 *
 * Combines Write/Edit hooks into a single hook to reduce Node.js cold start overhead:
 * 1. auto-approve-project-writes - Auto-approve safe file writes within project
 * 2. profile-evaluator - Evaluate against permission profiles
 * 3. security-blocker - Block writes to sensitive files
 * 4. pre-write-secret-scan - Scan content for secrets before writing
 * 5. architecture-change-advisor - Warn on config file edits
 *
 * Performance: Single Node.js process (~170ms) vs 5 processes (~850ms)
 *
 * @module pretool/write-combined
 */

import { guardWriteEdit, runGuards } from '../lib/guards.js';
import { getContent, getFilePath, getNewString } from '../lib/input.js';
import { logDebug, logInfo, logWarn } from '../lib/logging.js';
import {
  isDenyDecision,
  outputDeny,
  outputSilentSuccess,
  outputWithNotification,
} from '../lib/output.js';
import { autoApproveProjectWrites } from '../permission/auto-approve-project-writes.js';
import { profileEvaluator } from '../permission/profile-evaluator.js';
import { scanForSecrets } from '../posttool/secret-detector.js';
import type { HookInput, HookResult } from '../types.js';
import { securityBlocker } from './security-blocker.js';

const HOOK_NAME = 'write-combined';

/** Config files that warrant an advisory when modified. */
const ARCHITECTURE_FILES: ReadonlyArray<{ pattern: RegExp; category: string }> = [
  { pattern: /tsconfig\.json$/, category: 'TypeScript config' },
  { pattern: /package\.json$/, category: 'package manifest' },
  { pattern: /Dockerfile/, category: 'Docker config' },
  { pattern: /docker-compose/, category: 'Docker Compose' },
  { pattern: /\.gitlab-ci\.yml$/, category: 'CI/CD pipeline' },
  { pattern: /\.github\/workflows\//, category: 'GitHub Actions' },
  { pattern: /terraform\.tfvars$/, category: 'Terraform variables' },
  { pattern: /\.tf$/, category: 'Terraform config' },
  { pattern: /alembic\.ini$/, category: 'Alembic config' },
  { pattern: /biome\.json$/, category: 'Biome config' },
  { pattern: /\.eslintrc/, category: 'ESLint config' },
  { pattern: /vitest\.config/, category: 'Vitest config' },
  { pattern: /jest\.config/, category: 'Jest config' },
];

/**
 * Check if a hook result is an allow decision.
 */
function isAllowDecision(result: HookResult): boolean {
  return result.continue === true && result.hookSpecificOutput?.permissionDecision === 'allow';
}

// `isDenyDecision` is imported from lib/output.js — single definition of what
// counts as a denial (#65). A private copy here tested only `continue === false`.

/**
 * Gather ALL write content to scan for secrets, across every file-write tool
 * variant: Write (`content`), Edit (`new_string`), and MultiEdit
 * (`edits[].new_string`). The previous scan read only content||new_string, so
 * a MultiEdit silently slipped its payload past the secret gate entirely.
 */
function gatherWriteContent(input: HookInput): string {
  const parts: string[] = [];
  const content = getContent(input);
  if (content) parts.push(content);
  const newStr = getNewString(input);
  if (newStr) parts.push(newStr);
  const edits = (input.tool_input as { edits?: Array<{ new_string?: string }> } | undefined)?.edits;
  if (Array.isArray(edits)) {
    for (const e of edits) {
      if (e && typeof e.new_string === 'string') parts.push(e.new_string);
    }
  }
  return parts.join('\n');
}

/**
 * Combined Write/Edit/MultiEdit PreToolUse hook.
 *
 * Runs all Write/Edit validation hooks in sequence within a single Node.js process.
 * Short-circuits on first allow/deny.
 *
 * Order:
 * 1. auto-approve-project-writes - Fast check for safe project files
 * 2. profile-evaluator - Check permission profiles
 * 3. security-blocker - Protected paths, symlinks
 * 4. pre-write-secret-scan - Block writes containing secrets
 * 5. architecture-change-advisor - Warn on config file edits
 *
 * @param input - Hook input from Claude Code
 * @returns HookResult with permission decision or silent success
 */
export async function writeCombined(input: HookInput): Promise<HookResult> {
  const skipped = runGuards(input, guardWriteEdit);
  if (skipped) return skipped;

  logDebug(HOOK_NAME, 'Starting combined Write/Edit validation');

  // 1. Security blocker FIRST — protected paths / symlink escapes. A deny must
  // beat any auto-approve: previously auto-approve-project-writes ran first and
  // short-circuited on `allow`, so the security + secret gates below were dead
  // code for any in-project file (e.g. a write to .claude/settings.json or a
  // hardcoded AWS/GitLab key in src/config.py was auto-approved unscanned).
  logDebug(HOOK_NAME, 'Running: security-blocker');
  const securityResult = await securityBlocker(input);

  if (isDenyDecision(securityResult)) {
    logInfo(HOOK_NAME, 'Blocked by security check');
    return securityResult;
  }

  // 2. Pre-write secret scan — block writes containing secrets BEFORE any
  // auto-approve. Covers Write/Edit AND MultiEdit (edits[]).
  const contentToScan = gatherWriteContent(input);
  if (contentToScan) {
    logDebug(HOOK_NAME, 'Running: pre-write-secret-scan');
    const scan = scanForSecrets(contentToScan);
    if (scan.detected) {
      const types = scan.secretTypes.join(', ');
      logWarn(HOOK_NAME, `BLOCKED: secrets detected in write content: ${types}`);
      return outputDeny(
        `Blocked: content contains potential secrets (${types}). Use environment variables or a secrets manager instead of hardcoding credentials.`
      );
    }
  }

  // 3. Auto-approve safe project writes (fast path) — only AFTER the deny gates.
  logDebug(HOOK_NAME, 'Running: auto-approve-project-writes');
  const projectWriteResult = await autoApproveProjectWrites(input);

  if (isAllowDecision(projectWriteResult)) {
    logInfo(HOOK_NAME, 'Auto-approved by project-writes check');
    return projectWriteResult;
  }

  // 4. Profile evaluator
  logDebug(HOOK_NAME, 'Running: profile-evaluator');
  const profileResult = await profileEvaluator(input);

  if (isAllowDecision(profileResult)) {
    logInfo(HOOK_NAME, 'Allowed by profile');
    return profileResult;
  }

  if (isDenyDecision(profileResult)) {
    logInfo(HOOK_NAME, 'Denied by profile');
    return profileResult;
  }

  // 5. Architecture change advisor — warn on config file edits
  const filePath = getFilePath(input);
  if (filePath) {
    for (const { pattern, category } of ARCHITECTURE_FILES) {
      if (pattern.test(filePath)) {
        logInfo(HOOK_NAME, `Architecture file edit: ${category} (${filePath})`);
        const fileName = filePath.split('/').pop();
        return outputWithNotification(
          `\u26a0 Editing ${category}: ${fileName}`,
          `Architecture file modified: ${filePath} (${category}). Verify that this change is intentional and consider its impact on builds, tests, and deployments.`,
          'PreToolUse'
        );
      }
    }
  }

  // No decision made - defer to standard permission flow
  logDebug(HOOK_NAME, 'No decision, deferring to standard flow');
  return outputSilentSuccess();
}

export default writeCombined;
