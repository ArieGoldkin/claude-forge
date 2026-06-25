/**
 * SessionStart Hook - Loads continuity context at session start
 *
 * This hook is called automatically by Claude Code when a new session begins.
 * It:
 * 1. Ensures continuity directory structure exists in user's project
 * 2. Manages session state in shared-context.json
 * 3. Outputs compact continuity context to stdout (injected into Claude context)
 *
 * Compact output (~500-800 bytes). Full context available via /resume-session.
 *
 * @module lifecycle/session-loader
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  CONTINUITY_DIRS,
  ensureContinuityStructure,
  extractLedgerSummary,
  formatTimestamp,
  getCurrentLedgerPath,
} from '../lib/continuity.js';
import { formatHandoffSummary, validateHandoff } from '../lib/handoff-schema.js';
import { getProviderInfo } from '../lib/input.js';
import { acquireLock, releaseLock } from '../lib/lock.js';
import { logDebug, logError, logInfo, logWarn } from '../lib/logging.js';
import { outputSuccess } from '../lib/output.js';
import { ensureSessionDir, evictOldSessions } from '../lib/read-cache/index.js';
import { buildWindowTitleSequence } from '../lib/terminal-sequence.js';
import type { HookInput, HookResult, SharedContext } from '../types.js';

const HOOK_NAME = 'session-start';

// =============================================================================
// SESSION STATE MANAGEMENT
// =============================================================================

/**
 * Information about a stale session.
 */
interface StaleSessionInfo {
  lastActivity: string | null;
  filesEdited: number;
}

/**
 * Check for stale/abandoned previous session.
 *
 * @param contextFile - Path to shared-context.json
 * @returns Stale session info if detected, null otherwise
 */
function checkStaleSession(contextFile: string): StaleSessionInfo | null {
  if (!fs.existsSync(contextFile)) {
    return null;
  }

  try {
    const content = fs.readFileSync(contextFile, 'utf8');
    const context = JSON.parse(content) as Partial<SharedContext>;

    const wasClean = context.session_heartbeat?.was_cleanly_ended ?? true;

    if (wasClean === false) {
      return {
        lastActivity: context.session_heartbeat?.last_activity ?? null,
        filesEdited: context.dirty_tracking?.files_edited_count ?? 0,
      };
    }
  } catch {
    // Ignore parse errors - file may be corrupted
  }

  return null;
}

/**
 * Format compact stale session warning.
 *
 * @param staleInfo - Information about the stale session
 * @returns Formatted warning string (compact format)
 */
function formatStaleWarning(staleInfo: StaleSessionInfo): string {
  let warning = '⚠️ Previous session ended without handoff';

  if (staleInfo.lastActivity) {
    // Extract just the date/time portion for compactness
    const timestamp = staleInfo.lastActivity.replace('Z', '').replace('T', ' ');
    warning += ` (${timestamp})`;
  }

  warning += '\n   Run `/save-state` to capture context.\n\n';

  return warning;
}

/**
 * Initialize a new session in the context file.
 * Resets dirty tracking and marks session as started.
 *
 * @param contextFile - Path to shared-context.json
 * @param lockDir - Path to the lock directory
 */
async function initializeSession(contextFile: string, lockDir: string): Promise<void> {
  if (!fs.existsSync(contextFile)) {
    logDebug(HOOK_NAME, 'Context file not found, skipping state management');
    return;
  }

  // Acquire lock for safe read/write
  if (!(await acquireLock(lockDir))) {
    logWarn(HOOK_NAME, 'Failed to acquire lock, proceeding without context update');
    return;
  }

  try {
    const content = fs.readFileSync(contextFile, 'utf8');
    const context = JSON.parse(content);
    const timestamp = formatTimestamp();

    // Reset dirty tracking for new session and mark session as started
    context.session_heartbeat = context.session_heartbeat || {};
    context.session_heartbeat.session_start = timestamp;
    context.session_heartbeat.was_cleanly_ended = false;
    context.session_heartbeat.last_activity = timestamp;

    context.dirty_tracking = context.dirty_tracking || {};
    context.dirty_tracking.files_edited_count = 0;
    context.dirty_tracking.files_edited_this_session = [];
    context.dirty_tracking.last_edit_timestamp = null;

    // Write atomically using temp file
    const tempFile = `${contextFile}.tmp`;
    fs.writeFileSync(tempFile, `${JSON.stringify(context, null, 2)}\n`);
    fs.renameSync(tempFile, contextFile);

    logDebug(HOOK_NAME, 'Session initialized, dirty_tracking reset');
  } catch (error) {
    logError(HOOK_NAME, `Failed to update context file: ${error}`);
  } finally {
    releaseLock(lockDir);
  }
}

// =============================================================================
// CLAUDE_ENV_FILE SUPPORT
// =============================================================================

/**
 * Shell-escape a value for use in an export statement.
 * Wraps in single quotes and escapes any internal single quotes.
 *
 * @param value - The value to escape
 * @returns Shell-safe quoted value
 */
export function shellEscape(value: string): string {
  // Replace single quotes with '\'' (end quote, escaped quote, start quote)
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Write plugin environment variables to CLAUDE_ENV_FILE.
 * Uses appendFileSync since other hooks may also write to this file.
 *
 * Only writes variables that are not already set in the environment.
 *
 * @param projectDir - The project directory path
 */
function writeEnvFile(projectDir: string): void {
  const envFile = process.env['CLAUDE_ENV_FILE'];
  if (!envFile) {
    logDebug(HOOK_NAME, 'CLAUDE_ENV_FILE not set, skipping env file write');
    return;
  }

  try {
    const lines: string[] = [];

    if (!process.env['CONTINUITY_LOG_LEVEL']) {
      lines.push(`export CONTINUITY_LOG_LEVEL=${shellEscape('warn')}`);
    }

    if (!process.env['CLAUDE_PROJECT_DIR'] && projectDir !== '.') {
      lines.push(`export CLAUDE_PROJECT_DIR=${shellEscape(projectDir)}`);
    }

    if (lines.length > 0) {
      fs.appendFileSync(envFile, `${lines.join('\n')}\n`);
      logDebug(HOOK_NAME, `Wrote ${lines.length} env var(s) to CLAUDE_ENV_FILE`);
    }
  } catch (error) {
    logDebug(HOOK_NAME, `Failed to write env file: ${error}`);
  }
}

// =============================================================================
// CONTINUITY SETUP CHECK
// =============================================================================

/**
 * Check if continuity system is set up.
 * Returns tip message if ledger doesn't exist.
 *
 * @param projectDir - The project directory path
 * @returns Tip message if continuity not set up, empty string otherwise
 */
function checkContinuitySetup(projectDir: string): string {
  const ledgerDir = path.join(projectDir, '.claude', 'continuity', 'ledgers');

  // Check if ledger directory exists
  if (!fs.existsSync(ledgerDir)) {
    return 'TIP: Run `/setup-continuity` to enable session state tracking.\n\n';
  }

  try {
    const files = fs.readdirSync(ledgerDir);
    const ledgerFiles = files.filter((f) => f.startsWith('CONTINUITY_') && f.endsWith('.md'));
    if (ledgerFiles.length === 0) {
      return 'TIP: Run `/setup-continuity` to enable session state tracking.\n\n';
    }
  } catch {
    // Ignore read errors
  }

  return ''; // Continuity already configured
}

// =============================================================================
// LEDGER SUMMARY OUTPUT
// =============================================================================

/**
 * Get current git branch name.
 *
 * @param projectDir - The project directory path
 * @returns Branch name or null if not a git repo
 */
function getCurrentBranch(projectDir: string): string | null {
  const headPath = path.join(projectDir, '.git', 'HEAD');

  if (!fs.existsSync(headPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(headPath, 'utf8').trim();
    // HEAD format: "ref: refs/heads/branch-name"
    const match = content.match(/^ref: refs\/heads\/(.+)$/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Output compact ledger summary.
 *
 * @param projectDir - The project directory path
 * @returns Compact ledger summary string
 */
function outputLedgerSummary(projectDir: string): string {
  const ledgerPath = getCurrentLedgerPath(projectDir);

  if (!ledgerPath || !fs.existsSync(ledgerPath)) {
    logDebug(HOOK_NAME, `No ledger found in ${projectDir}/.claude/continuity/ledgers/`);
    return '';
  }

  try {
    const content = fs.readFileSync(ledgerPath, 'utf8');
    const summary = extractLedgerSummary(content);

    if (!summary) {
      return '';
    }

    let output = '';

    // Only include non-empty fields
    if (summary.status) {
      output += `Status: ${summary.status}\n`;
    }
    if (summary.recent) {
      output += `Recent: ${summary.recent}\n`;
    }
    if (summary.next) {
      output += `Next: ${summary.next}\n`;
    }

    return output;
  } catch {
    return '';
  }
}

// =============================================================================
// HANDOFF JSON SUMMARY
// =============================================================================

/**
 * Read the latest handoff.json (written by pre-compact-saver) and format
 * a compact summary for inclusion in the SessionStart additionalContext.
 *
 * Returns empty string when the file is missing, malformed, or fails
 * validation — auto-resume is enrichment, never load-bearing.
 */
function outputHandoffSummary(projectDir: string): string {
  const handoffPath = path.join(
    projectDir,
    '.claude',
    'continuity',
    'handoffs',
    'handoff-latest.json'
  );

  if (!fs.existsSync(handoffPath)) {
    return '';
  }

  try {
    const raw = fs.readFileSync(handoffPath, 'utf8');
    const parsed = JSON.parse(raw);
    const handoff = validateHandoff(parsed);
    if (!handoff) {
      logWarn(HOOK_NAME, 'handoff-latest.json failed schema validation; skipping');
      return '';
    }
    return `\n${formatHandoffSummary(handoff)}\n\n`;
  } catch (error) {
    logDebug(HOOK_NAME, `Failed to read handoff.json: ${error}`);
    return '';
  }
}

// =============================================================================
// WINDOW TITLE (CC v2.1.141 terminalSequence)
// =============================================================================

/**
 * Build a window-title escape sequence for the current session, gated on the
 * `CONTINUITY_TERMINAL_TITLE` env var (opt-in, must equal `"1"` exactly).
 *
 * Title shape: `<project basename> · <branch>` — e.g., `claude-forge · main`.
 * Branch is omitted when not in a git repo. Returns empty string when the
 * feature is disabled OR no renderable segments survive sanitization.
 *
 * @param projectDir - The project directory path
 * @param branch - Current branch name, or null if not in a git repo
 * @returns Escape sequence to emit via `terminalSequence`, or `""` to skip
 */
function buildSessionWindowTitle(projectDir: string, branch: string | null): string {
  if (process.env['CONTINUITY_TERMINAL_TITLE'] !== '1') {
    return '';
  }
  const projectName = path.basename(path.resolve(projectDir));
  return buildWindowTitleSequence(branch ? [projectName, branch] : [projectName]);
}

// =============================================================================
// MAIN HOOK
// =============================================================================

/**
 * SessionStart hook - loads compact continuity context at session start.
 *
 * This hook:
 * 1. Ensures continuity directory structure exists
 * 2. Checks for stale/abandoned sessions (compact warning)
 * 3. Initializes new session state
 * 4. Outputs compact ledger summary (~500-800 bytes)
 *
 * Full context is available via /resume-session command.
 *
 * @param _input - Hook input (not used for this hook)
 * @returns HookResult with compact continuity context message
 *
 * @example
 * ```typescript
 * const result = await sessionLoader({});
 * // Returns ~500-800 bytes of compact context
 * ```
 */
export async function sessionLoader(_input: HookInput): Promise<HookResult> {
  const projectDir = process.env['CLAUDE_PROJECT_DIR'] || '.';
  const { provider } = getProviderInfo();

  logDebug(HOOK_NAME, `Provider: ${provider}, project: ${projectDir}`);

  // Build output message (compact format)
  let output = '=== SESSION CONTEXT ===\n\n';

  // 1. Ensure continuity structure
  const initResult = ensureContinuityStructure(projectDir);

  if (initResult === 'created') {
    logInfo(HOOK_NAME, `Initialized continuity structure in ${projectDir}/.claude/`);
    output += 'Continuity initialized in `.claude/`. Use `/save-state` to track work.\n\n';
  } else if (initResult === 'error') {
    logError(HOOK_NAME, 'Failed to initialize continuity structure');
  }

  // 2. Check for stale session
  const contextFile = path.join(projectDir, CONTINUITY_DIRS.context, 'shared-context.json');
  const lockDir = `${contextFile}.lock`;

  const staleInfo = checkStaleSession(contextFile);
  if (staleInfo) {
    logWarn(HOOK_NAME, 'Stale session detected - previous session ended uncleanly');
    output += formatStaleWarning(staleInfo);
  }

  // 3. Initialize new session
  await initializeSession(contextFile, lockDir);

  // 3a. Read-cache lifecycle: evict stale per-session caches and prepare the
  // current session's cache directory. Best-effort — any failure (cache root
  // missing, permission denied, race with another evictor) absorbs silently
  // because the cache is opportunistic and never load-bearing.
  try {
    const sessionId = process.env['CLAUDE_SESSION_ID'];
    if (sessionId) {
      ensureSessionDir(sessionId);
    }
    // Fire-and-forget — don't block session start on filesystem walk.
    void evictOldSessions().catch((err: unknown) => {
      logDebug(HOOK_NAME, `read-cache eviction failed: ${err}`);
    });
  } catch (err) {
    logDebug(HOOK_NAME, `read-cache lifecycle setup failed: ${err}`);
  }

  // 3b. Write plugin env vars to CLAUDE_ENV_FILE (if available)
  writeEnvFile(projectDir);

  // 4. Output git branch (if in git repo)
  const branch = getCurrentBranch(projectDir);
  if (branch) {
    output += `Branch: ${branch}\n`;
  }

  // 5. Output compact ledger summary
  output += outputLedgerSummary(projectDir);

  // 5a. Output latest handoff.json summary if present (auto-resume contract).
  // pre-compact-saver writes handoff-latest.json; we surface a compact summary
  // here so Claude has structural state (dirty files, open MRs, next steps)
  // without the user needing to run /resume-session.
  output += outputHandoffSummary(projectDir);

  // 6. Check continuity setup status
  output += checkContinuitySetup(projectDir);

  // 7. Footer with help
  output += '---\nRun `/resume-session` for full context.';

  logDebug(HOOK_NAME, 'Context output complete');

  // 8. Optional window title (opt-in via CONTINUITY_TERMINAL_TITLE=1)
  const titleSequence = buildSessionWindowTitle(projectDir, branch);
  const result = outputSuccess(output);
  if (titleSequence) {
    return { ...result, terminalSequence: titleSequence };
  }
  return result;
}

export default sessionLoader;
