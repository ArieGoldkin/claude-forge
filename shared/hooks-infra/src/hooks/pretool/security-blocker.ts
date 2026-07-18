/**
 * Security Blocker Hook
 *
 * TypeScript port of scripts/pre-tool-use-security.sh
 *
 * This is the SECURITY-CRITICAL hook that prevents dangerous operations.
 * It is the last line of defense against:
 * - Dangerous bash commands (rm -rf /, dd, mkfs, fork bombs)
 * - Modification of sensitive files (.env, .ssh keys, credentials)
 * - Modification of system directories (/etc, /usr, /var)
 * - Path traversal attacks (..)
 * - Symlink bypass attacks (ME-001)
 *
 * SECURITY NOTES:
 * 1. This hook BLOCKS operations - it never auto-approves
 * 2. All protected patterns from bash script are preserved EXACTLY
 * 3. Symlink resolution (ME-001 fix) checks BOTH normalized AND resolved paths
 * 4. Error messages are helpful but don't reveal sensitive information
 *
 * @module pretool/security-blocker
 */

import { FILESYSTEM_PATTERNS, matchDangerousBash } from '../lib/dangerous-bash/index.js';
import type { Match as DangerousBashMatch } from '../lib/dangerous-bash/index.js';
import {
  getAgentId,
  getAgentType,
  getCommand,
  getFilePath,
  getSessionId,
  getToolName,
  stripProxyPrefix,
} from '../lib/input.js';
import { logDebug, logPermission, logWarn } from '../lib/logging.js';
import { outputAsk, outputDeny, outputSilentSuccess, outputWarning } from '../lib/output.js';
import {
  CREDENTIAL_PATTERNS,
  ENV_PATTERNS,
  GIT_PATTERNS,
  SSH_PATTERNS,
  SYSTEM_DIR_PATTERNS,
  normalizePath,
  resolveRealPath,
} from '../lib/path-utils.js';
import type { ProtectionCategory } from '../lib/path-utils.js';
import type { AgentContext, HookInput, HookResult, ToolName } from '../types.js';

// Re-export protected path patterns and types from path-utils (single source of truth)
export { ENV_PATTERNS, GIT_PATTERNS, SSH_PATTERNS, CREDENTIAL_PATTERNS, SYSTEM_DIR_PATTERNS };
export type { ProtectionCategory };

// =============================================================================
// CONSTANTS
// =============================================================================

const HOOK_NAME = 'pre-tool-use-security';

/**
 * File operation tools that require security validation.
 */
const FILE_WRITE_TOOLS: ReadonlySet<ToolName> = new Set(['Write', 'Edit', 'MultiEdit']);

// =============================================================================
// DANGEROUS BASH COMMAND PATTERNS
// =============================================================================

/**
 * Dangerous bash command patterns that could cause system damage.
 * These commands are ALWAYS blocked.
 *
 * Backed by the categorized dangerous-bash registry in
 * `lib/dangerous-bash/`. Exported as a flat `RegExp[]` for backward
 * compatibility with consumers that iterate the legacy array shape.
 *
 * Note: this constant exposes only the `filesystem` category; the runtime
 * check in `validateBashCommand` calls `matchDangerousBash` directly so
 * additional categories (e.g., `http`) participate in matching.
 */
export const DANGEROUS_COMMAND_PATTERNS: readonly RegExp[] = FILESYSTEM_PATTERNS.map(
  (p) => p.regex
);

/**
 * Environment dump command patterns - block commands that dump all env vars.
 * These commands can leak secrets stored in process environment variables.
 *
 * Each pattern uses (?:^|\||\&\&|\;)\s* prefix to handle chained commands.
 */
export const ENV_DUMP_PATTERNS: readonly RegExp[] = [
  // printenv (with or without args, always dumps env info)
  // Compound + sudo aware (CC v2.1.98 alignment)
  /(?:^|[|&;]\s*|sudo\s+)printenv(?:\s|$)/,
  // env alone or piped (but NOT env VAR=val cmd, env -i, /usr/bin/env python)
  /(?:^|[|&;]\s*|sudo\s+)env\s*(?:$|[|&;])/,
  // set alone or piped (but NOT set -e, set -x, set -o)
  /(?:^|[|&;]\s*|sudo\s+)set\s*(?:$|[|&;])/,
  // export -p (list all exports)
  /(?:^|[|&;]\s*|sudo\s+)export\s+-p(?:\s|$)/,
  // declare -x (list all exported vars)
  /(?:^|[|&;]\s*|sudo\s+)declare\s+-x(?:\s|$)/,
  // compgen -v (list all variable names)
  /(?:^|[|&;]\s*|sudo\s+)compgen\s+-v(?:\s|$)/,
] as const;

/**
 * Check if a command matches any environment dump pattern.
 *
 * @param command - The bash command to check
 * @returns Object with matched flag and matching pattern source (if any)
 */
export function matchesEnvDumpCommand(command: string): { matched: boolean; pattern?: string } {
  for (const pattern of ENV_DUMP_PATTERNS) {
    if (pattern.test(command)) {
      return { matched: true, pattern: pattern.source };
    }
  }
  return { matched: false };
}

/**
 * Regex matching `git push` invocations.
 *
 * Used to force an explicit user approval prompt for any push, regardless
 * of other auto-approve rules. The friction class from /insights is users
 * interrupting Claude mid-push to enforce "ask first" — gating all pushes
 * makes that intervention unnecessary.
 */
export const GIT_PUSH_REGEX = /\bgit\s+push\b/;

/**
 * Test whether a command is a `git push` invocation that warrants the
 * approval-first gate. `git push --help` is exempt (docs only).
 */
export function matchesGitPush(command: string): boolean {
  if (!GIT_PUSH_REGEX.test(command)) return false;
  if (/--help\b/.test(command)) return false;
  return true;
}

/**
 * Sensitive path patterns to block in bash commands.
 * Commands referencing these paths should require approval.
 */
export const BASH_SENSITIVE_PATTERNS: readonly RegExp[] = [
  /\.env\b/,
  /\.envrc/,
  /\/etc\//,
  /\/usr\//,
  /\/var\//,
  /\/sys\//,
  /\/proc\//,
  /\/boot\//,
  /\.ssh\/id_/,
  /\.ssh\/.*\.pem/,
  /\/root\//,
  // macOS-specific — CC v2.1.113 expanded dangerous-removal targets.
  // Carve-out: CC's harness-managed scratchpad lives at /private/tmp/claude-<uid>/…
  // and every session/subagent is instructed to use it — blocking it kills forked
  // skills mid-run (a PreToolUse deny terminates a fork with no final message).
  // Deeper scratchpad paths are allowed; the bare claude-<uid> root (no trailing
  // slash, e.g. `rm -rf /private/tmp/claude-501`) and all other /private/tmp
  // references stay blocked.
  /\/private\/tmp\/(?!claude-\d+\/)/,
  /\/private\/home\//,
] as const;

// =============================================================================
// PATTERN CATEGORY TYPES
// =============================================================================

/**
 * Result of checking if a path matches protected patterns.
 */
export interface ProtectedPathMatch {
  matched: boolean;
  category?: ProtectionCategory;
  pattern?: string;
}

/**
 * Pattern check configuration for categorized pattern matching.
 */
interface PatternCheckConfig {
  patterns: readonly RegExp[];
  category: ProtectionCategory;
  friendlyName: string;
}

/**
 * All pattern checks in order of precedence.
 */
const PATTERN_CHECKS: readonly PatternCheckConfig[] = [
  {
    patterns: ENV_PATTERNS,
    category: 'env',
    friendlyName: 'Environment file',
  },
  {
    patterns: GIT_PATTERNS,
    category: 'git',
    friendlyName: 'Git configuration',
  },
  {
    patterns: SSH_PATTERNS,
    category: 'ssh',
    friendlyName: 'SSH key/certificate',
  },
  {
    patterns: CREDENTIAL_PATTERNS,
    category: 'credential',
    friendlyName: 'Credentials file',
  },
  {
    patterns: SYSTEM_DIR_PATTERNS,
    category: 'system',
    friendlyName: 'System directory',
  },
] as const;

// =============================================================================
// BASH COMMAND NORMALIZATION
// =============================================================================

/**
 * Normalize backslash-escaped characters in a bash command for security matching.
 *
 * Bash allows backslash-escaping of flags and characters (e.g., \-rf, r\m),
 * which can bypass regex patterns that match literal flag syntax.
 * CC v2.1.98 fixed a similar bypass where backslash-escaped flags were
 * auto-allowed as read-only.
 *
 * This strips single-character backslash escapes so patterns match the
 * canonical form. Does NOT alter quoted strings or heredocs.
 *
 * @param command - Raw bash command
 * @returns Command with backslash escapes normalized
 */
export function normalizeBashEscapes(command: string): string {
  // Remove backslash before non-special characters (flags, command names)
  // Preserves \n, \t, \\ (already meaningful escapes)
  // Pattern: backslash followed by a letter, digit, or hyphen
  return command.replace(/\\([-a-zA-Z0-9_./])/g, '$1');
}

/**
 * Normalize $HOME / ${HOME} references to `~` so home-targeting dangerous
 * patterns match regardless of spelling (CC v2.1.162 alignment — deny rules
 * on home paths must also block the $HOME form).
 *
 * The lookahead restricts matches to path/word boundaries so unrelated
 * variables like $HOMEBREW_PREFIX are not mangled. Shell separators
 * (; & | ) ` < >) count as boundaries too — the separator-glued form
 * (e.g. a target glued to ;ls) must normalize the same as the
 * whitespace form (review !209 finding #1).
 *
 * @param command - Raw bash command
 * @returns Command with home references normalized to ~
 */
export function normalizeHomeRefs(command: string): string {
  return (
    command
      // Double-quoted forms expand in bash exactly like unquoted ones, but a
      // quote glued to the tilde would defeat the ~-anchored deny patterns —
      // unwrap "$HOME" / "${HOME}" / "$HOME/path" to ~ / ~/path first.
      // (Single-quoted '$HOME' is a literal in bash — deliberately untouched.)
      .replace(/"\$\{?HOME\}?"/g, '~')
      .replace(/"\$\{?HOME\}?\/([^"]*)"/g, '~/$1')
      .replace(/\$\{?HOME\}?(?=[/\s"';&|)<>`]|$)/g, '~')
  );
}

/**
 * Unwrap exec wrappers so pattern matching sees the inner command.
 *
 * CC v2.1.113 aligned its deny rules to unwrap exec wrappers before pattern
 * matching. Without this, users can bypass our security-blocker by wrapping
 * dangerous commands in `sh -c '...'`, `bash -c "..."`, or prefixing with
 * `env VAR=value`.
 *
 * Strategy: run repeatedly to handle nested wrappers (e.g.
 * `sh -c 'bash -c "rm -rf /"'`). Returns the original command unchanged if
 * no wrapper is detected.
 *
 * Patterns unwrapped:
 *   - /path/to/sh -c '<inner>' | "<inner>"
 *   - /path/to/bash -c '<inner>' | "<inner>"
 *   - sh -c <inner> | bash -c <inner>  (unquoted)
 *   - env [-i] [VAR=value ...] <cmd> <args>
 *
 * @param command - Raw (already-escape-normalized) bash command
 * @returns Inner command if wrapped, else the original
 */
export function unwrapExecWrappers(command: string): string {
  let current = command.trim();
  // Bound iterations to prevent any pathological input from looping forever
  for (let i = 0; i < 4; i++) {
    // Match: optional path prefix, then sh/bash, then -c, then a quoted or
    // unquoted argument. Also strip a leading sudo if present.
    const shBashMatch = current.match(
      /^(?:sudo\s+)?(?:\/[^\s]*\/)?(?:sh|bash|zsh|dash)\s+-c\s+(?:'([^']*)'|"([^"]*)"|(\S.*))$/
    );
    if (shBashMatch) {
      current = (shBashMatch[1] ?? shBashMatch[2] ?? shBashMatch[3] ?? '').trim();
      continue;
    }
    // Match: env [-i] [VAR=value ...] <rest>
    // Only strips VAR=value assignments; preserves the actual command afterwards.
    const envMatch = current.match(
      /^(?:sudo\s+)?env(?:\s+-i)?((?:\s+[A-Za-z_][A-Za-z0-9_]*=\S*)*)\s+(.+)$/
    );
    if (envMatch?.[2]) {
      current = envMatch[2].trim();
      continue;
    }
    break;
  }
  return current;
}

// =============================================================================
// BASH COMMAND VALIDATION
// =============================================================================

/**
 * Check if a command matches any dangerous command patterns.
 *
 * Walks the categorized dangerous-bash registry (filesystem + http). The
 * returned `pattern` field is the matched regex source for backward
 * compatibility with the pre-registry signature.
 *
 * @param command - The bash command to check
 * @returns Object with matched flag and matching pattern source (if any)
 */
export function matchesDangerousCommand(command: string): { matched: boolean; pattern?: string } {
  const match = matchDangerousBash(command);
  if (match) {
    return { matched: true, pattern: match.pattern.regex.source };
  }
  return { matched: false };
}

/**
 * Check if a command references sensitive paths.
 *
 * @param command - The bash command to check
 * @returns Object with matched flag and matching pattern source (if any)
 */
export function matchesBashSensitivePattern(command: string): {
  matched: boolean;
  pattern?: string;
} {
  for (const pattern of BASH_SENSITIVE_PATTERNS) {
    if (pattern.test(command)) {
      return { matched: true, pattern: pattern.source };
    }
  }
  return { matched: false };
}

/**
 * Validate a bash command for dangerous operations.
 *
 * @param command - The bash command to validate
 * @param sessionId - Session ID for logging
 * @returns HookResult - deny if dangerous, silent success otherwise
 */
function validateBashCommand(
  command: string,
  sessionId: string,
  agentContext?: AgentContext
): HookResult {
  // Normalize backslash escapes to prevent bypass (CC v2.1.98 alignment)
  // e.g., rm \-rf / → rm -rf /, r\m -rf / → rm -rf /
  // Then normalize $HOME/${HOME} → ~ so home-targeting deny patterns match
  // both spellings (CC v2.1.162 alignment).
  const normalized = normalizeHomeRefs(normalizeBashEscapes(command));

  // Unwrap exec wrappers so nested dangerous commands are caught
  // (CC v2.1.113 alignment — sh -c '...', bash -c '...', env VAR=x cmd).
  // Check BOTH raw and unwrapped forms: raw catches wrappers that are
  // themselves dangerous (e.g. literal "env" dump), unwrapped catches
  // the payload they might be hiding.
  const unwrapped = unwrapExecWrappers(normalized);
  const candidates = unwrapped === normalized ? [normalized] : [normalized, unwrapped];

  // Check for dangerous command patterns first (categorized registry walk).
  // Surfaces the human-readable description so users see WHY their command
  // was blocked, not just the cryptic regex source.
  for (const candidate of candidates) {
    const match: DangerousBashMatch | null = matchDangerousBash(candidate);
    if (match) {
      const reason = `Dangerous command detected (${match.pattern.category}): ${match.pattern.description}`;
      logWarn(HOOK_NAME, `Blocked: ${reason}`);
      logPermission('deny', reason, 'Bash', sessionId, agentContext);
      return outputDeny(
        `BLOCKED: Dangerous command detected.\n\nCategory: ${match.pattern.category}\nReason: ${match.pattern.description}\nPattern matched: ${match.pattern.regex.source}`
      );
    }
  }

  // Check for environment dump commands
  for (const candidate of candidates) {
    const envDumpMatch = matchesEnvDumpCommand(candidate);
    if (envDumpMatch.matched) {
      const reason = `Environment dump command detected. Pattern: ${envDumpMatch.pattern}`;
      logWarn(HOOK_NAME, `Blocked: ${reason}`);
      logPermission('deny', reason, 'Bash', sessionId, agentContext);
      return outputDeny(
        'BLOCKED: Environment dump command detected.\n\nThis command could expose secrets stored in environment variables.\nIf you need a specific variable, use: echo $VARIABLE_NAME'
      );
    }
  }

  // Check for sensitive file patterns in command
  for (const candidate of candidates) {
    const sensitiveMatch = matchesBashSensitivePattern(candidate);
    if (sensitiveMatch.matched) {
      const reason = `Command references sensitive file or directory. Pattern: ${sensitiveMatch.pattern}`;
      logWarn(HOOK_NAME, `Blocked: ${reason}`);
      logPermission('deny', reason, 'Bash', sessionId, agentContext);
      return outputDeny(
        `BLOCKED: Command references protected resource.\n\nProtected resources include environment files, system directories, and SSH keys.\nPattern matched: ${sensitiveMatch.pattern}`
      );
    }
  }

  // Approval-first gate for `git push` — forces a user permission prompt.
  const pushGateResult = checkGitPushGate(candidates, sessionId, agentContext);
  if (pushGateResult) return pushGateResult;

  // Command is safe
  return outputSilentSuccess();
}

/**
 * Approval-first gate for `git push`.
 *
 * For any `git push` invocation (other than `--help`), forces a user
 * permission prompt regardless of auto-approve rules. Escape hatch:
 * set `CLAUDE_AUTO_APPROVE_PUSH=1` for solo / automation flows.
 *
 * Returns null when no gate applies (caller proceeds with normal flow).
 * Returns an ask-decision HookResult when the gate fires.
 */
function checkGitPushGate(
  candidates: readonly string[],
  sessionId: string,
  agentContext?: AgentContext
): HookResult | null {
  for (const candidate of candidates) {
    if (!matchesGitPush(candidate)) continue;
    if (process.env['CLAUDE_AUTO_APPROVE_PUSH'] === '1') {
      logDebug(HOOK_NAME, 'git push auto-approved via CLAUDE_AUTO_APPROVE_PUSH=1');
      return null;
    }
    logDebug(
      HOOK_NAME,
      `git push routed to user approval [session=${sessionId}, agent=${agentContext?.agentType ?? 'none'}]`
    );
    return outputAsk();
  }
  return null;
}

// =============================================================================
// FILE PATH VALIDATION
// =============================================================================

/**
 * Check if a path matches any protected pattern.
 * Returns the category and pattern if matched.
 *
 * @param pathToCheck - The path to check against protected patterns
 * @returns ProtectedPathMatch with category and pattern if matched
 */
export function matchesProtectedPath(pathToCheck: string): ProtectedPathMatch {
  for (const config of PATTERN_CHECKS) {
    for (const pattern of config.patterns) {
      if (pattern.test(pathToCheck)) {
        return {
          matched: true,
          category: config.category,
          pattern: pattern.source,
        };
      }
    }
  }
  return { matched: false };
}

/**
 * Get the friendly name for a protection category.
 *
 * @param category - The protection category
 * @returns Human-readable name for the category
 */
function getCategoryFriendlyName(category: ProtectionCategory): string {
  const config = PATTERN_CHECKS.find((c) => c.category === category);
  return config?.friendlyName ?? category;
}

/**
 * Validate a file operation for protected paths.
 *
 * SECURITY: Checks BOTH normalized AND resolved paths to prevent bypasses.
 * The resolved path catches symlink attacks (ME-001) where a symlink inside
 * the project points to a protected file outside.
 *
 * @param filePath - The file path from the tool input
 * @param toolName - The tool being used (for logging)
 * @param sessionId - Session ID for logging
 * @returns HookResult - deny if protected, silent success otherwise
 */
function validateFileOperation(
  filePath: string,
  toolName: ToolName,
  sessionId: string,
  agentContext?: AgentContext
): HookResult {
  // Normalize path for pattern matching
  const normalizedPath = normalizePath(filePath);

  logDebug(HOOK_NAME, `Normalized path: ${normalizedPath}`);

  // Check for path traversal attempts
  // After normalization, if '..' remains, it's escaping the current directory
  if (normalizedPath.includes('..')) {
    const reason = `Path traversal detected in: ${filePath}`;
    logWarn(HOOK_NAME, `Blocked: ${reason}`);
    logPermission('deny', reason, toolName, sessionId, agentContext);
    return outputDeny(
      `BLOCKED: Path traversal detected.\n\nThe path contains '..' which could be a security bypass attempt.\nPath: ${filePath}`
    );
  }

  // SECURITY: Resolve symlinks (ME-001 fix)
  // A symlink inside the project could point to /etc/passwd or other protected files
  // CC<2.1.88 compat: filePath is now always absolute; symlink resolution still critical
  const realPath = resolveRealPath(filePath);
  logDebug(HOOK_NAME, `Resolved path: ${realPath}`);

  // Check BOTH paths against all protected patterns
  // This catches both direct access and symlink bypasses
  const pathsToCheck = [normalizedPath, realPath];

  for (const checkPath of pathsToCheck) {
    const match = matchesProtectedPath(checkPath);
    if (match.matched && match.category) {
      const friendlyName = getCategoryFriendlyName(match.category);
      const reason = `${friendlyName} modification blocked. File: ${filePath} (resolved: ${realPath})`;
      logWarn(HOOK_NAME, `Blocked: ${reason}`);
      logPermission('deny', reason, toolName, sessionId, agentContext);
      return outputDeny(
        `BLOCKED: ${friendlyName} modification blocked.\n\n` +
          `File: ${filePath}\n` +
          `Category: ${friendlyName}\n` +
          `Pattern matched: ${match.pattern}`
      );
    }
  }

  // File operation is safe
  return outputSilentSuccess();
}

// =============================================================================
// AGENT CONTEXT HELPERS
// =============================================================================

/**
 * Extract agent context from hook input for audit logging.
 */
function extractAgentContext(input: HookInput): AgentContext | undefined {
  const agentId = getAgentId(input);
  const agentType = getAgentType(input);
  return agentId || agentType ? { agentId, agentType } : undefined;
}

/**
 * Format agent context for debug logging.
 */
function formatAgentDebug(toolName: ToolName, ctx: AgentContext | undefined): string {
  let msg = `Tool=${toolName}`;
  if (ctx?.agentType) msg += ` agent_type=${ctx.agentType}`;
  if (ctx?.agentId) msg += ` agent_id=${ctx.agentId}`;
  return msg;
}

// =============================================================================
// MAIN HOOK FUNCTION
// =============================================================================

/**
 * Security blocker hook - prevents dangerous operations.
 *
 * This hook is the last line of defense against:
 * - Dangerous bash commands (rm -rf /, dd, mkfs, fork bombs)
 * - Modification of sensitive files (.env, .ssh keys, credentials)
 * - Modification of system directories (/etc, /usr, /var)
 * - Path traversal attacks (..)
 * - Symlink bypass attacks (ME-001)
 *
 * For Bash tool:
 * 1. Checks dangerous command patterns (rm -rf /, dd, mkfs, fork bombs)
 * 2. Checks sensitive file patterns in commands (.env, /etc/, .ssh/)
 * 3. Blocks with deny if match found
 * 4. Allows (silent success) if no match
 *
 * For Write/Edit/MultiEdit tools:
 * 1. Normalizes path (remove ./, collapse //)
 * 2. Checks for path traversal (..)
 * 3. Resolves symlinks (ME-001 CRITICAL)
 * 4. Checks BOTH normalized AND resolved paths against protected patterns
 * 5. Blocks with deny if match found
 * 6. Allows (silent success) if no match
 *
 * For other tools:
 * - Returns silent success (allows by default)
 *
 * @param input - Hook input from Claude Code
 * @returns HookResult with deny decision if blocked, silent success otherwise
 */
export async function securityBlocker(input: HookInput): Promise<HookResult> {
  const toolName = getToolName(input);
  const sessionId = getSessionId(input);
  const agentCtx = extractAgentContext(input);

  logDebug(HOOK_NAME, formatAgentDebug(toolName, agentCtx));

  // Handle Bash commands
  if (toolName === 'Bash') {
    // Warn when sandbox is explicitly disabled (v2.0.24)
    if (input.tool_input.dangerouslyDisableSandbox === true) {
      logWarn(
        HOOK_NAME,
        `Sandbox disabled via dangerouslyDisableSandbox flag [session=${sessionId}]`
      );
    }

    const rawCommand = getCommand(input);
    const command = rawCommand ? stripProxyPrefix(rawCommand) : undefined;
    if (command) {
      const result = validateBashCommand(command, sessionId, agentCtx);
      // If the command itself is safe but sandbox is disabled, append a warning
      if (result.continue && input.tool_input.dangerouslyDisableSandbox === true) {
        return outputWarning(
          'Bash sandbox is disabled (dangerouslyDisableSandbox=true). Command will run without sandbox restrictions.'
        );
      }
      return result;
    }
    // Empty command - allow (will be handled by Claude Code)
    return outputSilentSuccess();
  }

  // Handle file write operations
  if (FILE_WRITE_TOOLS.has(toolName)) {
    const filePath = getFilePath(input);
    if (filePath) {
      return validateFileOperation(filePath, toolName, sessionId, agentCtx);
    }
    // Empty path - allow (will be handled by Claude Code)
    return outputSilentSuccess();
  }

  // For other tools (Read, Glob, Grep, etc.), allow by default
  logDebug(HOOK_NAME, `Tool ${toolName} allowed by default`);
  return outputSilentSuccess();
}

// =============================================================================
// EXPORTS
// =============================================================================

export { HOOK_NAME };
export default securityBlocker;
