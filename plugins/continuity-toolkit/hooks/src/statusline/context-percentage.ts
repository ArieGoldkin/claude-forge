#!/usr/bin/env node
/**
 * Continuity Plugin - Context Percentage StatusLine Script
 *
 * Standalone Node.js script invoked by Claude Code's StatusLine mechanism.
 * NOT a hook - runs after each assistant message to capture context window usage.
 *
 * Reads JSON from stdin containing context_window data, extracts used_percentage,
 * writes it to a temp file for the context-monitor hook to read, and outputs
 * a rich two-line status string to stdout with model name, git branch, progress
 * bar with ANSI colors, cost, and duration.
 *
 * @module statusline/context-percentage
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// =============================================================================
// CONSTANTS
// =============================================================================

const TEMP_PREFIX = 'claude-context-pct-';
const FILLED_CHAR = '\u2588'; // █
const EMPTY_CHAR = '\u2591'; // ░
const DEFAULT_BAR_WIDTH = 10;
const GIT_CACHE_STALE_MS = 5000;
const FALLBACK_STATUS =
  '[?] \uD83D\uDCC1 unknown\n\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591 --% | $0.00 | \u23F1\uFE0F 0m';

export const ANSI = {
  RESET: '\x1b[0m',
  CYAN: '\x1b[36m',
  GREEN: '\x1b[32m',
  YELLOW: '\x1b[33m',
  RED: '\x1b[31m',
} as const;

// =============================================================================
// PURE FUNCTIONS (exported for testing)
// =============================================================================

/**
 * Get emoji representing context quality/freshness.
 * 0-24% ✨ Fresh | 25-49% 👍 Good | 50-69% ⚡ Warm | 70%+ 🔥 Hot
 */
export function getContextEmoji(pct: number): string {
  if (pct < 25) return '\u2728'; // ✨
  if (pct < 50) return '\uD83D\uDC4D'; // 👍
  if (pct < 70) return '\u26A1'; // ⚡
  return '\uD83D\uDD25'; // 🔥
}

/**
 * Build a visual progress bar from filled/empty block characters.
 * @param pct - Percentage (0-100+), clamped to [0, 100]
 * @param width - Bar width in characters (default 10)
 */
export function buildProgressBar(pct: number, width = DEFAULT_BAR_WIDTH): string {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round((clamped / 100) * width);
  return FILLED_CHAR.repeat(filled) + EMPTY_CHAR.repeat(width - filled);
}

/**
 * Get ANSI color code for progress bar based on percentage thresholds.
 * Green <70%, Yellow 70-89%, Red 90%+
 */
export function getBarColor(pct: number): string {
  if (pct >= 90) return ANSI.RED;
  if (pct >= 70) return ANSI.YELLOW;
  return ANSI.GREEN;
}

/**
 * Format cost as a dollar string.
 *
 * Below $10 we keep two decimals (cents matter for cheap sessions and the
 * decimal point reads clearly between single digits). At $10+ we drop cents
 * and add thousands separators: at statusline font size the decimal point in
 * e.g. "$356.00" disappears and gets misread as "$35600", so whole dollars
 * are unambiguous ("$356", "$1,234", "$35,600").
 */
export function formatCost(costUsd: number): string {
  if (costUsd >= 10) return `$${Math.round(costUsd).toLocaleString('en-US')}`;
  return `$${costUsd.toFixed(2)}`;
}

/**
 * Format duration in milliseconds as "Xm Ys" string.
 */
export function formatDuration(durationMs: number): string {
  const totalMinutes = Math.floor(durationMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * Extract workspace/folder name from StatusLine data.
 * Tries workspace.current_dir, then falls back to basename(cwd).
 */
export function extractWorkspaceName(data: Record<string, unknown>): string {
  const workspace = data['workspace'] as Record<string, unknown> | undefined;
  if (workspace) {
    const currentDir = workspace['current_dir'];
    if (typeof currentDir === 'string' && currentDir.length > 0) {
      return basename(currentDir);
    }
  }
  return basename(process.cwd());
}

/**
 * Extract git worktree path from StatusLine data (CC 2.1.97+).
 * Returns the worktree path if present, empty string otherwise.
 */
export function extractWorktreePath(data: Record<string, unknown>): string {
  const workspace = data['workspace'] as Record<string, unknown> | undefined;
  if (workspace) {
    const worktree = workspace['git_worktree'];
    if (typeof worktree === 'string' && worktree.length > 0) {
      return worktree;
    }
  }
  return '';
}

/**
 * Extract cost and duration from StatusLine data.
 * Returns { costUsd, durationMs } with defaults of 0.
 */
export function extractCost(data: Record<string, unknown>): {
  costUsd: number;
  durationMs: number;
} {
  const cost = data['cost'] as Record<string, unknown> | undefined;
  if (!cost) return { costUsd: 0, durationMs: 0 };

  const totalCost = cost['total_cost_usd'];
  const totalDuration = cost['total_duration_ms'];

  const costUsd = typeof totalCost === 'number' && !Number.isNaN(totalCost) ? totalCost : 0;
  const durationMs =
    typeof totalDuration === 'number' && !Number.isNaN(totalDuration) ? totalDuration : 0;

  return { costUsd, durationMs };
}

/**
 * Extract 5-hour (session) and 7-day (weekly) rate-limit usage percentages
 * from StatusLine data (CC v2.1.176+, schema confirmed against the official
 * statusline docs). Both windows are optional: `rate_limits` is present only
 * for Claude.ai Pro/Max subscribers after the first API response in a session,
 * and each window may be independently absent. Returns null for any window not
 * present so the caller can omit it gracefully (API/Bedrock users see no line).
 */
export function extractRateLimits(data: Record<string, unknown>): {
  fiveHourPct: number | null;
  sevenDayPct: number | null;
} {
  const rateLimits = data['rate_limits'] as Record<string, unknown> | undefined;
  if (!rateLimits) return { fiveHourPct: null, sevenDayPct: null };

  const readWindow = (key: string): number | null => {
    const win = rateLimits[key] as Record<string, unknown> | undefined;
    if (!win) return null;
    const used = win['used_percentage'];
    if (typeof used !== 'number' || Number.isNaN(used)) return null;
    return Math.round(used);
  };

  return {
    fiveHourPct: readWindow('five_hour'),
    sevenDayPct: readWindow('seven_day'),
  };
}

/**
 * Extract model display name from StatusLine stdin data.
 * Tries model.display_name, then model.id, then falls back to "?".
 */
export function extractModelName(data: Record<string, unknown>): string {
  const model = data['model'] as Record<string, unknown> | undefined;
  if (!model) return '?';

  const displayName = model['display_name'];
  if (typeof displayName === 'string' && displayName.length > 0) return displayName;

  const id = model['id'];
  if (typeof id === 'string' && id.length > 0) return id;

  return '?';
}

/**
 * Format line 1: [Model] 📁 workspace | 🌿 branch [🌳 worktree]
 * Omits branch/worktree segments if empty.
 */
export function formatLine1(
  modelName: string,
  workspaceName: string,
  gitBranch: string,
  worktreePath = ''
): string {
  const model = `${ANSI.CYAN}[${modelName}]${ANSI.RESET}`;
  let line = `${model} \uD83D\uDCC1 ${workspaceName}`;
  if (gitBranch) {
    line += ` | \uD83C\uDF3F ${gitBranch}`;
  }
  if (worktreePath) {
    line += ` | \uD83C\uDF33 wt:${basename(worktreePath)}`;
  }
  return line;
}

/**
 * Format line 2: colored-bar pct% emoji | $cost | ⏱️ duration
 */
export function formatLine2(pct: number, costUsd: number, durationMs: number): string {
  const color = getBarColor(pct);
  const bar = buildProgressBar(pct);
  const emoji = getContextEmoji(pct);
  const cost = formatCost(costUsd);
  const duration = formatDuration(durationMs);
  return `${color}${bar}${ANSI.RESET} ${pct}% ${emoji} | ${ANSI.YELLOW}${cost}${ANSI.RESET} | \u23F1\uFE0F ${duration}`;
}

/**
 * Format line 3 (account usage): session: <bar> N% \u00B7 weekly: <bar> N%
 *
 * Renders only the windows that are present, reusing the same threshold
 * coloring as the context bar (green <70, yellow 70-89, red 90+). Returns ''
 * when both windows are absent so the caller omits the line entirely \u2014 this
 * is the normal case for API/Bedrock users and before the first API response.
 */
export function formatLine3(fiveHourPct: number | null, sevenDayPct: number | null): string {
  const segments: string[] = [];
  if (fiveHourPct !== null) {
    segments.push(
      `session: ${getBarColor(fiveHourPct)}${buildProgressBar(fiveHourPct)}${ANSI.RESET} ${fiveHourPct}%`
    );
  }
  if (sevenDayPct !== null) {
    segments.push(
      `weekly: ${getBarColor(sevenDayPct)}${buildProgressBar(sevenDayPct)}${ANSI.RESET} ${sevenDayPct}%`
    );
  }
  return segments.join(' \u00B7 ');
}

/**
 * Format the complete StatusLine output: two lines always, plus an optional
 * third usage line when rate-limit data is present (CC v2.1.176+).
 * fiveHourPct/sevenDayPct default to null, keeping the two-line output and
 * existing call sites byte-identical.
 */
export function formatStatusLine(
  pct: number,
  modelName: string,
  workspaceName: string,
  gitBranch: string,
  costUsd: number,
  durationMs: number,
  worktreePath = '',
  fiveHourPct: number | null = null,
  sevenDayPct: number | null = null
): string {
  const line1 = formatLine1(modelName, workspaceName, gitBranch, worktreePath);
  const line2 = formatLine2(pct, costUsd, durationMs);
  const line3 = formatLine3(fiveHourPct, sevenDayPct);
  return line3 ? `${line1}\n${line2}\n${line3}` : `${line1}\n${line2}`;
}

// =============================================================================
// GIT BRANCH (with file cache)
// =============================================================================

/**
 * Simple string hash for per-project cache isolation.
 */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    hash = ((hash << 5) - hash + ch) | 0;
  }
  return Math.abs(hash).toString(36);
}

/**
 * Get current git branch with file-based caching (5s staleness).
 * Returns empty string on any failure.
 */
export function getGitBranch(): string {
  const cwd = process.cwd();
  const cacheFile = join(tmpdir(), `statusline-git-cache-${hashString(cwd)}.json`);

  // Check cache
  try {
    if (existsSync(cacheFile)) {
      const stat = statSync(cacheFile);
      const ageMs = Date.now() - stat.mtimeMs;
      if (ageMs < GIT_CACHE_STALE_MS) {
        const cached = JSON.parse(readFileSync(cacheFile, 'utf8')) as { branch: string };
        if (typeof cached.branch === 'string') return cached.branch;
      }
    }
  } catch {
    // Cache miss - continue to git command
  }

  // Run git command
  let branch = '';
  try {
    branch = execSync('git branch --show-current', {
      timeout: 2000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }

  // Write cache atomically
  try {
    const tmpFile = `${cacheFile}.tmp`;
    writeFileSync(tmpFile, JSON.stringify({ branch }), 'utf8');
    renameSync(tmpFile, cacheFile);
  } catch {
    // Non-fatal
  }

  return branch;
}

// =============================================================================
// STDIN READING (Synchronous - matching hooks/src/lib/input.ts pattern)
// =============================================================================

/**
 * Read all data from stdin synchronously.
 * Replicates the readStdinSync() pattern from hooks/src/lib/input.ts.
 */
function readStdinSync(): string {
  try {
    const chunks: Buffer[] = [];
    const BUFSIZE = 256;
    const buf = Buffer.allocUnsafe(BUFSIZE);
    const fd = 0; // stdin file descriptor

    while (true) {
      try {
        const bytesRead = readSync(fd, buf, 0, BUFSIZE, null);
        if (bytesRead === 0) break;
        chunks.push(Buffer.from(buf.subarray(0, bytesRead)));
      } catch {
        break;
      }
    }

    return Buffer.concat(chunks).toString('utf8').trim();
  } catch {
    return '';
  }
}

// =============================================================================
// MAIN
// =============================================================================

function main(): void {
  const raw = readStdinSync();
  if (!raw) {
    process.stdout.write(`${FALLBACK_STATUS}\n`);
    return;
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    process.stdout.write(`${FALLBACK_STATUS}\n`);
    return;
  }

  // Extract used_percentage (pre-calculated by Claude Code)
  const contextWindow = data['context_window'] as Record<string, unknown> | undefined;
  if (!contextWindow) {
    process.stdout.write(`${FALLBACK_STATUS}\n`);
    return;
  }

  const usedPercentage = contextWindow['used_percentage'];
  if (typeof usedPercentage !== 'number' || Number.isNaN(usedPercentage)) {
    process.stdout.write(`${FALLBACK_STATUS}\n`);
    return;
  }

  const pct = Math.round(usedPercentage);
  const modelName = extractModelName(data);
  const workspaceName = extractWorkspaceName(data);
  const { costUsd, durationMs } = extractCost(data);
  const { fiveHourPct, sevenDayPct } = extractRateLimits(data);
  const gitBranch = getGitBranch();
  const worktreePath = extractWorktreePath(data);

  // Get session ID for temp file naming
  const sessionId = process.env['CLAUDE_SESSION_ID'] || 'default';

  // Atomic write: write to .tmp then rename
  const tmpDir = tmpdir();
  const targetFile = join(tmpDir, `${TEMP_PREFIX}${sessionId}.txt`);
  const tmpFile = `${targetFile}.tmp`;

  try {
    writeFileSync(tmpFile, String(pct), 'utf8');
    renameSync(tmpFile, targetFile);
  } catch {
    // Non-fatal - the hook will gracefully degrade without the file
  }

  // Output rich status string to stdout (third usage line appears only when
  // rate_limits is present in the payload — Pro/Max, post-first-response).
  process.stdout.write(
    `${formatStatusLine(pct, modelName, workspaceName, gitBranch, costUsd, durationMs, worktreePath, fiveHourPct, sevenDayPct)}\n`
  );
}

// Only run when executed directly (not when imported for testing)
if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  main();
}
