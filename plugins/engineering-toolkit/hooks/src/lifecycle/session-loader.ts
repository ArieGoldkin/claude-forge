/**
 * SessionStart Hook - Loads continuity context at session start
 *
 * This hook is called automatically by Claude Code when a new session begins.
 * It:
 * 1. Ensures continuity directory structure exists in user's project
 * 2. Manages session state in shared-context.json
 * 3. Outputs compact continuity context to stdout (injected into Claude context)
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
import { getProviderInfo } from '../lib/input.js';
import {
  DEFAULT_LOG_LEVEL,
  logDebug,
  logError,
  logInfo,
  logLevelEnvVarName,
  logWarn,
} from '../lib/logging.js';
import { outputSuccess } from '../lib/output.js';
import type { HookInput, HookResult, SharedContext } from '../types.js';

const HOOK_NAME = 'session-start';

// =============================================================================
// LOCKING UTILITIES
// =============================================================================

/**
 * Maximum attempts for acquiring lock (50 * 100ms = 5 seconds total).
 */
const MAX_LOCK_ATTEMPTS = 50;

/**
 * Delay between lock attempts in milliseconds.
 */
const LOCK_RETRY_DELAY_MS = 100;

/**
 * Sleep for a specified number of milliseconds.
 *
 * @param ms - Milliseconds to sleep
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Acquire a file lock using mkdir (atomic on POSIX systems).
 *
 * @param lockDir - Path to the lock directory
 * @returns True if lock was acquired
 */
async function acquireLock(lockDir: string): Promise<boolean> {
  for (let attempt = 0; attempt < MAX_LOCK_ATTEMPTS; attempt++) {
    try {
      fs.mkdirSync(lockDir);
      // Write PID file for debugging
      fs.writeFileSync(path.join(lockDir, 'pid'), String(process.pid));
      return true;
    } catch {
      // Lock exists, retry after delay
      await sleep(LOCK_RETRY_DELAY_MS);
    }
  }
  return false;
}

/**
 * Release a file lock.
 *
 * @param lockDir - Path to the lock directory
 */
function releaseLock(lockDir: string): void {
  try {
    fs.rmSync(lockDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

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

    // Derived, not hardcoded — see the matching note in ctk's session-loader.
    // This copy is not currently bundled (etk does not register this hook), so
    // it was dormant rather than shipped; fixed together so registering it later
    // cannot silently reintroduce the drift. #74.
    const logLevelVar = logLevelEnvVarName();
    if (!process.env[logLevelVar]) {
      lines.push(`export ${logLevelVar}=${shellEscape(DEFAULT_LOG_LEVEL)}`);
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
// AGENTS.MD CHECK
// =============================================================================

/**
 * Marker used to identify etk sections in AGENTS.md.
 */
const ENGINEERING_MARKER_START = '<!-- etk:start -->';

/**
 * Check if AGENTS.md exists with etk markers.
 * Returns compact reminder message if missing or markers not found.
 *
 * @param projectDir - The project directory path
 * @returns Reminder message if AGENTS.md needs setup, empty string otherwise
 */
function checkAgentsMd(projectDir: string): string {
  const agentsMdPath = path.join(projectDir, 'AGENTS.md');

  if (!fs.existsSync(agentsMdPath)) {
    return 'TIP: Run `/generate-agents-md` to index skills for better AI assistance.\n\n';
  }

  try {
    const content = fs.readFileSync(agentsMdPath, 'utf8');
    if (!content.includes(ENGINEERING_MARKER_START)) {
      return 'TIP: Run `/generate-agents-md` to add etk skills index.\n\n';
    }
  } catch {
    // Ignore read errors - file may be unreadable
  }

  return ''; // Already configured, no reminder needed
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
// MAIN HOOK
// =============================================================================

/**
 * SessionStart hook - loads compact continuity context at session start.
 *
 * @param _input - Hook input (not used for this hook)
 * @returns HookResult with compact continuity context message
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

  // 3b. Write plugin env vars to CLAUDE_ENV_FILE (if available)
  writeEnvFile(projectDir);

  // 4. Output git branch (if in git repo)
  const branch = getCurrentBranch(projectDir);
  if (branch) {
    output += `Branch: ${branch}\n`;
  }

  // 5. Output compact ledger summary
  output += outputLedgerSummary(projectDir);

  // 6. Check AGENTS.md status (compact tip)
  output += `\n${checkAgentsMd(projectDir)}`;

  // 7. Check continuity setup status
  output += checkContinuitySetup(projectDir);

  // 8. Footer with help
  output += '---\nRun `/resume-session` for full context.';

  logDebug(HOOK_NAME, 'Context output complete');

  return outputSuccess(output);
}

export default sessionLoader;
