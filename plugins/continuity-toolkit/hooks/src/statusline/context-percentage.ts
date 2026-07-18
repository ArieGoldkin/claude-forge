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
  MAGENTA: '\x1b[35m',
  DIM: '\x1b[2m',
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
  fiveHourResetsAt: number | null;
  sevenDayResetsAt: number | null;
} {
  const empty = {
    fiveHourPct: null,
    sevenDayPct: null,
    fiveHourResetsAt: null,
    sevenDayResetsAt: null,
  };
  const rateLimits = data['rate_limits'] as Record<string, unknown> | undefined;
  if (!rateLimits) return empty;

  const readWindow = (key: string): number | null => {
    const win = rateLimits[key] as Record<string, unknown> | undefined;
    if (!win) return null;
    const used = win['used_percentage'];
    if (typeof used !== 'number' || Number.isNaN(used)) return null;
    return Math.round(used);
  };

  // `resets_at` is a Unix timestamp in SECONDS (verified live: 1784425200).
  // Read independently of used_percentage — either may be absent alone.
  const readReset = (key: string): number | null => {
    const win = rateLimits[key] as Record<string, unknown> | undefined;
    if (!win) return null;
    const at = win['resets_at'];
    if (typeof at !== 'number' || Number.isNaN(at) || at <= 0) return null;
    return at;
  };

  return {
    fiveHourPct: readWindow('five_hour'),
    sevenDayPct: readWindow('seven_day'),
    fiveHourResetsAt: readReset('five_hour'),
    sevenDayResetsAt: readReset('seven_day'),
  };
}

/**
 * Extract the reasoning-effort level and the two mode flags that sit
 * alongside it in the payload.
 *
 * `effort` is documented as present only when the active model supports the
 * reasoning-effort parameter, so `level` is null on models that don't. Both
 * flags default to false when their objects are absent.
 * Verified against a live payload: `effort.level = "xhigh"`, `fast_mode =
 * false`, `thinking.enabled = true` (CC 2.1.214).
 */
export function extractEffort(data: Record<string, unknown>): {
  level: string | null;
  fastMode: boolean;
  thinking: boolean;
} {
  const effort = data['effort'] as Record<string, unknown> | undefined;
  const level = effort && typeof effort['level'] === 'string' ? (effort['level'] as string) : null;

  const thinkingObj = data['thinking'] as Record<string, unknown> | undefined;
  const thinking = thinkingObj?.['enabled'] === true;

  return { level, fastMode: data['fast_mode'] === true, thinking };
}

/**
 * Extract token usage from the context window block.
 *
 * `current_usage` describes the most recent request; the `total_*` fields are
 * cumulative for the session. Window size matters because 1M-context sessions
 * are live (`context_window_size = 1000000` observed), which is why counts are
 * abbreviated rather than printed raw.
 */
export function extractTokenUsage(data: Record<string, unknown>): {
  totalInput: number;
  totalOutput: number;
  cacheRead: number;
  windowSize: number;
} | null {
  const cw = data['context_window'] as Record<string, unknown> | undefined;
  if (!cw) return null;

  const num = (v: unknown): number => (typeof v === 'number' && !Number.isNaN(v) ? v : 0);
  const usage = cw['current_usage'] as Record<string, unknown> | undefined;

  return {
    totalInput: num(cw['total_input_tokens']),
    totalOutput: num(cw['total_output_tokens']),
    cacheRead: num(usage?.['cache_read_input_tokens']),
    windowSize: num(cw['context_window_size']),
  };
}

/**
 * Extract open-PR info for the current branch.
 *
 * NOTE: documented in the official statusline schema but NOT observed in a
 * live capture — the payload omits `pr` entirely unless an open PR exists for
 * the checked-out branch. Treated as best-effort: rendered only when both the
 * object and a numeric `number` are present, so an absent or differently
 * shaped field degrades to no segment rather than a broken statusline.
 */
export function extractPr(data: Record<string, unknown>): {
  number: number;
  reviewState: string | null;
} | null {
  const pr = data['pr'] as Record<string, unknown> | undefined;
  if (!pr) return null;

  const num = pr['number'];
  if (typeof num !== 'number' || Number.isNaN(num)) return null;

  const state = pr['review_state'];
  return { number: num, reviewState: typeof state === 'string' && state ? state : null };
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
 * Format the effort/mode badge that rides inside the model bracket.
 *
 * Fast mode wins the slot when active — it changes latency behaviour and is
 * the more surprising state to be in unknowingly. Otherwise the effort level
 * shows, with a thinking marker appended. Returns '' when there is nothing
 * worth showing, so the bracket collapses to plain `[Model]` unchanged.
 */
export function formatEffortBadge(
  level: string | null,
  fastMode: boolean,
  thinking: boolean
): string {
  if (fastMode) return '⚡ fast'; // ⚡
  if (!level) return '';
  return thinking ? `◐ ${level}` : level; // ◐
}

/**
 * Format a rate-limit reset as a compact countdown, e.g. "resets in 4h 31m".
 *
 * Days are used past 24h so the weekly window stays readable. Returns '' for
 * an absent timestamp or one already in the past — a stale reset time is
 * noise, not information.
 */
export function formatResetIn(resetsAtSec: number | null, nowMs: number = Date.now()): string {
  if (resetsAtSec === null) return '';
  const remainingMs = resetsAtSec * 1000 - nowMs;
  if (remainingMs <= 0) return '';

  const totalMinutes = Math.floor(remainingMs / 60000);
  const days = Math.floor(totalMinutes / 1440);
  if (days > 0) {
    const hours = Math.floor((totalMinutes % 1440) / 60);
    return `resets in ${days}d ${hours}h`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `resets in ${hours}h ${minutes}m`;
  return `resets in ${minutes}m`;
}

/**
 * Abbreviate a token count: 826 → "826", 215762 → "215.8k", 1500000 → "1.5M".
 * Raw counts are unreadable at statusline size once 1M-context sessions are in
 * play (`context_window_size = 1000000` is live).
 */
export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

/**
 * Format the PR segment: "PR #35" plus review state when known.
 * Returns '' when no open PR was reported for the branch.
 */
export function formatPrSegment(pr: { number: number; reviewState: string | null } | null): string {
  if (!pr) return '';
  const base = `PR #${pr.number}`;
  return pr.reviewState ? `${base} ${pr.reviewState}` : base;
}

/**
 * Format line 1: [Model] 📁 workspace | 🌿 branch [🌳 worktree]
 * Omits branch/worktree segments if empty.
 */
export function formatLine1(
  modelName: string,
  workspaceName: string,
  gitBranch: string,
  worktreePath = '',
  effortBadge = '',
  prSegment = ''
): string {
  const label = effortBadge ? `${modelName} ${effortBadge}` : modelName;
  const model = `${ANSI.CYAN}[${label}]${ANSI.RESET}`;
  let line = `${model} \uD83D\uDCC1 ${workspaceName}`;
  if (gitBranch) {
    line += ` | \uD83C\uDF3F ${gitBranch}`;
  }
  if (prSegment) {
    line += ` | ${ANSI.MAGENTA}${prSegment}${ANSI.RESET}`;
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
export function formatLine3(
  fiveHourPct: number | null,
  sevenDayPct: number | null,
  fiveHourResetsAt: number | null = null,
  sevenDayResetsAt: number | null = null,
  nowMs: number = Date.now()
): string {
  const segments: string[] = [];
  const withReset = (label: string, pct: number, resetsAt: number | null): string => {
    const bar = `${getBarColor(pct)}${buildProgressBar(pct)}${ANSI.RESET}`;
    const reset = formatResetIn(resetsAt, nowMs);
    const suffix = reset ? ` ${ANSI.DIM}(${reset})${ANSI.RESET}` : '';
    return `${label}: ${bar} ${pct}%${suffix}`;
  };

  if (fiveHourPct !== null) {
    segments.push(withReset('session', fiveHourPct, fiveHourResetsAt));
  }
  if (sevenDayPct !== null) {
    segments.push(withReset('weekly', sevenDayPct, sevenDayResetsAt));
  }
  return segments.join(' \u00B7 ');
}

/**
 * Format line 4 (token accounting): tokens: 217.4k in \u00B7 826 out \u00B7 215.8k cached
 *
 * Cache reads are shown because on a long session they dominate input volume
 * and explain why cost stays flat while token counts climb. Returns '' when
 * the context window block is absent so the line is omitted entirely.
 */
export function formatLine4(
  usage: { totalInput: number; totalOutput: number; cacheRead: number } | null
): string {
  if (!usage) return '';
  const parts = [
    `${formatTokenCount(usage.totalInput)} in`,
    `${formatTokenCount(usage.totalOutput)} out`,
  ];
  if (usage.cacheRead > 0) {
    parts.push(`${formatTokenCount(usage.cacheRead)} cached`);
  }
  return `${ANSI.DIM}tokens: ${parts.join(' \u00B7 ')}${ANSI.RESET}`;
}

/**
 * Format the complete StatusLine output: two lines always, plus an optional
 * third usage line when rate-limit data is present (CC v2.1.176+).
 * fiveHourPct/sevenDayPct default to null, keeping the two-line output and
 * existing call sites byte-identical.
 */
export interface StatusLineExtras {
  /** Effort/mode badge rendered inside the model bracket. */
  effortBadge?: string;
  /** Open-PR segment for the current branch. */
  prSegment?: string;
  /** Unix-seconds reset timestamps for the two rate-limit windows. */
  fiveHourResetsAt?: number | null;
  sevenDayResetsAt?: number | null;
  /** Session token accounting; omitted line when absent. */
  tokens?: { totalInput: number; totalOutput: number; cacheRead: number } | null;
  /** Collapse to the classic two-line output (CONTINUITY_STATUSLINE_COMPACT=1). */
  compact?: boolean;
  /** Injected clock, for deterministic tests. */
  nowMs?: number;
}

export function formatStatusLine(
  pct: number,
  modelName: string,
  workspaceName: string,
  gitBranch: string,
  costUsd: number,
  durationMs: number,
  worktreePath = '',
  fiveHourPct: number | null = null,
  sevenDayPct: number | null = null,
  extras: StatusLineExtras = {}
): string {
  const line1 = formatLine1(
    modelName,
    workspaceName,
    gitBranch,
    worktreePath,
    extras.effortBadge ?? '',
    extras.prSegment ?? ''
  );
  const line2 = formatLine2(pct, costUsd, durationMs);

  // Compact mode keeps the always-on identity + context lines and drops the
  // optional accounting lines, for users who want the statusline to stay short.
  if (extras.compact) return `${line1}\n${line2}`;

  const line3 = formatLine3(
    fiveHourPct,
    sevenDayPct,
    extras.fiveHourResetsAt ?? null,
    extras.sevenDayResetsAt ?? null,
    extras.nowMs ?? Date.now()
  );
  const line4 = formatLine4(extras.tokens ?? null);

  return [line1, line2, line3, line4].filter(Boolean).join('\n');
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

  // Run git command.
  //
  // `git branch --show-current` needs git >= 2.22. On older git it exits
  // non-zero with "unknown option", which the catch below turned into a silent
  // empty branch — the segment simply never rendered (reproduced on git 2.15).
  // `rev-parse --abbrev-ref HEAD` has been available for far longer and returns
  // the same name, so it is the portable primary; it yields "HEAD" on a detached
  // checkout, which we normalise back to empty.
  let branch = '';
  try {
    branch = execSync('git rev-parse --abbrev-ref HEAD', {
      timeout: 2000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
  if (branch === 'HEAD') return '';

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
  const { fiveHourPct, sevenDayPct, fiveHourResetsAt, sevenDayResetsAt } = extractRateLimits(data);
  const gitBranch = getGitBranch();
  const worktreePath = extractWorktreePath(data);
  const { level, fastMode, thinking } = extractEffort(data);
  const extras: StatusLineExtras = {
    effortBadge: formatEffortBadge(level, fastMode, thinking),
    prSegment: formatPrSegment(extractPr(data)),
    fiveHourResetsAt,
    sevenDayResetsAt,
    tokens: extractTokenUsage(data),
    compact: process.env['CONTINUITY_STATUSLINE_COMPACT'] === '1',
  };

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
    `${formatStatusLine(pct, modelName, workspaceName, gitBranch, costUsd, durationMs, worktreePath, fiveHourPct, sevenDayPct, extras)}\n`
  );
}

// Only run when executed directly (not when imported for testing)
if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  main();
}
