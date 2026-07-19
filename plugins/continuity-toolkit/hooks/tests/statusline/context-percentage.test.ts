/**
 * Tests for Context Percentage StatusLine script
 *
 * Validates pure formatting functions: emoji thresholds, progress bar,
 * status line formatting, model name extraction, bar colors, cost/duration
 * formatting, workspace extraction, and two-line output.
 *
 * @module tests/statusline/context-percentage
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ANSI,
  buildProgressBar,
  extractCost,
  extractEffort,
  extractModelName,
  extractPr,
  extractRateLimits,
  extractSessionId,
  extractTokenUsage,
  extractWorkspaceName,
  extractWorktreePath,
  formatCost,
  formatDuration,
  formatEffortBadge,
  formatLine1,
  formatLine2,
  formatLine3,
  formatLine4,
  formatPrSegment,
  formatResetIn,
  formatStatusLine,
  formatTokenCount,
  getBarColor,
  getContextEmoji,
} from '../../src/statusline/context-percentage.js';

// =============================================================================
// getContextEmoji
// =============================================================================

describe('getContextEmoji', () => {
  it('should return ✨ for 0-24% (fresh context)', () => {
    expect(getContextEmoji(0)).toBe('\u2728');
    expect(getContextEmoji(12)).toBe('\u2728');
    expect(getContextEmoji(24)).toBe('\u2728');
  });

  it('should return 👍 for 25-49% (good context)', () => {
    expect(getContextEmoji(25)).toBe('\uD83D\uDC4D');
    expect(getContextEmoji(37)).toBe('\uD83D\uDC4D');
    expect(getContextEmoji(49)).toBe('\uD83D\uDC4D');
  });

  it('should return ⚡ for 50-69% (getting warm)', () => {
    expect(getContextEmoji(50)).toBe('\u26A1');
    expect(getContextEmoji(60)).toBe('\u26A1');
    expect(getContextEmoji(69)).toBe('\u26A1');
  });

  it('should return 🔥 for 70%+ (running hot)', () => {
    expect(getContextEmoji(70)).toBe('\uD83D\uDD25');
    expect(getContextEmoji(85)).toBe('\uD83D\uDD25');
    expect(getContextEmoji(100)).toBe('\uD83D\uDD25');
  });

  it('should handle negative values as fresh', () => {
    expect(getContextEmoji(-1)).toBe('\u2728');
  });

  it('should handle values above 100 as hot', () => {
    expect(getContextEmoji(150)).toBe('\uD83D\uDD25');
  });
});

// =============================================================================
// buildProgressBar
// =============================================================================

describe('buildProgressBar', () => {
  it('should return all empty for 0%', () => {
    expect(buildProgressBar(0)).toBe('\u2591'.repeat(10));
  });

  it('should return all filled for 100%', () => {
    expect(buildProgressBar(100)).toBe('\u2588'.repeat(10));
  });

  it('should return half filled for 50%', () => {
    const bar = buildProgressBar(50);
    expect(bar).toBe('\u2588'.repeat(5) + '\u2591'.repeat(5));
  });

  it('should round filled blocks', () => {
    // 20% of 10 = 2 filled
    const bar = buildProgressBar(20);
    expect(bar).toBe('\u2588'.repeat(2) + '\u2591'.repeat(8));
  });

  it('should always produce the correct width', () => {
    for (const pct of [0, 10, 25, 33, 50, 67, 75, 90, 100]) {
      expect(buildProgressBar(pct).length).toBe(10);
    }
  });

  it('should support custom widths', () => {
    const bar = buildProgressBar(50, 20);
    expect(bar.length).toBe(20);
    expect(bar).toBe('\u2588'.repeat(10) + '\u2591'.repeat(10));
  });

  it('should clamp values below 0', () => {
    expect(buildProgressBar(-10)).toBe('\u2591'.repeat(10));
  });

  it('should clamp values above 100', () => {
    expect(buildProgressBar(150)).toBe('\u2588'.repeat(10));
  });
});

// =============================================================================
// getBarColor
// =============================================================================

describe('getBarColor', () => {
  it('should return green for low percentages', () => {
    expect(getBarColor(0)).toBe(ANSI.GREEN);
    expect(getBarColor(42)).toBe(ANSI.GREEN);
    expect(getBarColor(69)).toBe(ANSI.GREEN);
  });

  it('should return yellow at exactly 70%', () => {
    expect(getBarColor(70)).toBe(ANSI.YELLOW);
  });

  it('should return yellow for 70-89%', () => {
    expect(getBarColor(75)).toBe(ANSI.YELLOW);
    expect(getBarColor(89)).toBe(ANSI.YELLOW);
  });

  it('should return red at exactly 90%', () => {
    expect(getBarColor(90)).toBe(ANSI.RED);
  });

  it('should return red for 90%+', () => {
    expect(getBarColor(95)).toBe(ANSI.RED);
    expect(getBarColor(100)).toBe(ANSI.RED);
  });
});

// =============================================================================
// formatCost
// =============================================================================

describe('formatCost', () => {
  it('should format zero cost', () => {
    expect(formatCost(0)).toBe('$0.00');
  });

  it('should format small cost', () => {
    expect(formatCost(0.08)).toBe('$0.08');
  });

  it('should format cost over a dollar', () => {
    expect(formatCost(1.5)).toBe('$1.50');
  });

  it('should round to two decimal places', () => {
    expect(formatCost(0.126)).toBe('$0.13');
    expect(formatCost(0.124)).toBe('$0.12');
  });

  it('should keep cents just under the $10 threshold', () => {
    expect(formatCost(9.99)).toBe('$9.99');
  });

  it('should drop cents at $10 and above (decimal point illegible at statusline size)', () => {
    expect(formatCost(10)).toBe('$10');
    expect(formatCost(356)).toBe('$356');
  });

  it('should add thousands separators for large costs', () => {
    expect(formatCost(1234.56)).toBe('$1,235');
    expect(formatCost(35600)).toBe('$35,600');
  });
});

// =============================================================================
// formatDuration
// =============================================================================

describe('formatDuration', () => {
  it('should format zero duration', () => {
    expect(formatDuration(0)).toBe('0m');
  });

  it('should format minutes only', () => {
    expect(formatDuration(45000)).toBe('0m');
    expect(formatDuration(120000)).toBe('2m');
  });

  it('should format minutes under an hour', () => {
    expect(formatDuration(423000)).toBe('7m');
  });

  it('should show hours and minutes for 60m+', () => {
    expect(formatDuration(3600000)).toBe('1h 0m');
    expect(formatDuration(3960000)).toBe('1h 6m');
  });

  it('should handle large durations', () => {
    // 656m 59s = 39419000ms => 10h 56m
    expect(formatDuration(39419000)).toBe('10h 56m');
  });
});

// =============================================================================
// extractWorkspaceName
// =============================================================================

describe('extractWorkspaceName', () => {
  it('should extract folder name from workspace.current_dir', () => {
    const data = { workspace: { current_dir: '/Users/dev/projects/my-app' } };
    expect(extractWorkspaceName(data)).toBe('my-app');
  });

  it('should fall back to cwd basename when workspace is missing', () => {
    const result = extractWorkspaceName({});
    // Falls back to basename(process.cwd()), which is the test runner's cwd
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('should fall back to cwd basename when current_dir is empty', () => {
    const data = { workspace: { current_dir: '' } };
    const result = extractWorkspaceName(data);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// extractCost
// =============================================================================

describe('extractCost', () => {
  it('should extract cost and duration from data', () => {
    const data = { cost: { total_cost_usd: 0.08, total_duration_ms: 423000 } };
    expect(extractCost(data)).toEqual({ costUsd: 0.08, durationMs: 423000 });
  });

  it('should return zeros when cost object is missing', () => {
    expect(extractCost({})).toEqual({ costUsd: 0, durationMs: 0 });
  });

  it('should default NaN values to zero', () => {
    const data = { cost: { total_cost_usd: Number.NaN, total_duration_ms: Number.NaN } };
    expect(extractCost(data)).toEqual({ costUsd: 0, durationMs: 0 });
  });

  it('should default non-number values to zero', () => {
    const data = { cost: { total_cost_usd: 'invalid', total_duration_ms: null } };
    expect(extractCost(data as Record<string, unknown>)).toEqual({ costUsd: 0, durationMs: 0 });
  });
});

// =============================================================================
// extractRateLimits (CC 2.1.176+)
// =============================================================================

describe('extractRateLimits', () => {
  it('should extract and round both windows', () => {
    const data = {
      rate_limits: {
        five_hour: { used_percentage: 23.5, resets_at: 1738425600 },
        seven_day: { used_percentage: 41.2, resets_at: 1738857600 },
      },
    };
    expect(extractRateLimits(data)).toEqual({
      fiveHourPct: 24,
      sevenDayPct: 41,
      fiveHourResetsAt: 1738425600,
      sevenDayResetsAt: 1738857600,
    });
  });

  it('should return nulls when rate_limits is absent (API/Bedrock users)', () => {
    expect(extractRateLimits({})).toEqual({
      fiveHourPct: null,
      sevenDayPct: null,
      fiveHourResetsAt: null,
      sevenDayResetsAt: null,
    });
  });

  it('should handle each window being independently absent', () => {
    const onlyFive = { rate_limits: { five_hour: { used_percentage: 50 } } };
    expect(extractRateLimits(onlyFive)).toEqual({
      fiveHourPct: 50,
      sevenDayPct: null,
      fiveHourResetsAt: null,
      sevenDayResetsAt: null,
    });

    const onlySeven = { rate_limits: { seven_day: { used_percentage: 80 } } };
    expect(extractRateLimits(onlySeven)).toEqual({
      fiveHourPct: null,
      sevenDayPct: 80,
      fiveHourResetsAt: null,
      sevenDayResetsAt: null,
    });
  });

  it('should default non-number / NaN used_percentage to null', () => {
    const data = {
      rate_limits: {
        five_hour: { used_percentage: Number.NaN },
        seven_day: { used_percentage: 'oops' },
      },
    };
    expect(extractRateLimits(data as Record<string, unknown>)).toEqual({
      fiveHourPct: null,
      sevenDayPct: null,
      fiveHourResetsAt: null,
      sevenDayResetsAt: null,
    });
  });

  it('should read resets_at independently of used_percentage', () => {
    // A window may carry a reset timestamp with no usage figure; the reset is
    // still valid data and must survive the missing percentage.
    const data = { rate_limits: { five_hour: { resets_at: 1738425600 } } };
    expect(extractRateLimits(data)).toEqual({
      fiveHourPct: null,
      sevenDayPct: null,
      fiveHourResetsAt: 1738425600,
      sevenDayResetsAt: null,
    });
  });

  it('should reject non-positive / non-numeric resets_at', () => {
    const data = {
      rate_limits: {
        five_hour: { used_percentage: 10, resets_at: 0 },
        seven_day: { used_percentage: 20, resets_at: 'soon' },
      },
    };
    expect(extractRateLimits(data as Record<string, unknown>)).toEqual({
      fiveHourPct: 10,
      sevenDayPct: 20,
      fiveHourResetsAt: null,
      sevenDayResetsAt: null,
    });
  });
});

// =============================================================================
// formatLine3 (usage bars)
// =============================================================================

describe('formatLine3', () => {
  it('should render both bars with session: and weekly: prefixes', () => {
    const line = formatLine3(23, 41);
    expect(line).toContain('session:');
    expect(line).toContain('weekly:');
    expect(line).toContain('23%');
    expect(line).toContain('41%');
    expect(line).toContain(' · '); // separator between the two segments
  });

  it('should render only session when weekly is absent', () => {
    const line = formatLine3(23, null);
    expect(line).toContain('session:');
    expect(line).not.toContain('weekly:');
    expect(line).not.toContain(' · ');
  });

  it('should render only weekly when session is absent', () => {
    const line = formatLine3(null, 41);
    expect(line).toContain('weekly:');
    expect(line).not.toContain('session:');
  });

  it('should return empty string when both windows are absent', () => {
    expect(formatLine3(null, null)).toBe('');
  });

  it('should color-code bars by threshold like the context bar', () => {
    expect(formatLine3(23, null)).toContain(ANSI.GREEN); // <70
    expect(formatLine3(75, null)).toContain(ANSI.YELLOW); // 70-89
    expect(formatLine3(95, null)).toContain(ANSI.RED); // 90+
  });
});

// =============================================================================
// formatLine1
// =============================================================================

describe('formatLine1', () => {
  it('should format model, workspace, and branch', () => {
    const result = formatLine1('Opus', 'my-app', 'feature/auth');
    expect(result).toContain('[Opus]');
    expect(result).toContain(ANSI.CYAN);
    expect(result).toContain(ANSI.RESET);
    expect(result).toContain('\uD83D\uDCC1 my-app');
    expect(result).toContain('| \uD83C\uDF3F feature/auth');
  });

  it('should omit branch segment when gitBranch is empty', () => {
    const result = formatLine1('Opus', 'my-app', '');
    expect(result).toContain('\uD83D\uDCC1 my-app');
    expect(result).not.toContain('\uD83C\uDF3F');
    expect(result).not.toContain('|');
  });
});

// =============================================================================
// formatLine2
// =============================================================================

describe('formatLine2', () => {
  it('should include colored progress bar', () => {
    const result = formatLine2(42, 0.08, 423000);
    expect(result).toContain(ANSI.GREEN); // <70% = green
    expect(result).toContain(ANSI.RESET);
  });

  it('should use yellow bar color at 75%', () => {
    const result = formatLine2(75, 0.08, 423000);
    expect(result).toContain(ANSI.YELLOW);
    // Bar portion starts with yellow
    expect(result.indexOf(ANSI.YELLOW)).toBeLessThan(result.indexOf(ANSI.RESET));
  });

  it('should use red bar color at 95%', () => {
    const result = formatLine2(95, 0.08, 423000);
    expect(result).toContain(ANSI.RED);
  });

  it('should include percentage and emoji', () => {
    const result = formatLine2(42, 0.08, 423000);
    expect(result).toContain('42%');
    expect(result).toContain('\uD83D\uDC4D'); // 👍
  });

  it('should include cost in yellow', () => {
    const result = formatLine2(42, 0.08, 423000);
    expect(result).toContain(`${ANSI.YELLOW}$0.08${ANSI.RESET}`);
  });

  it('should include duration with stopwatch emoji', () => {
    const result = formatLine2(42, 0.08, 423000);
    expect(result).toContain('\u23F1\uFE0F 7m');
  });
});

// =============================================================================
// formatStatusLine (two-line output)
// =============================================================================

describe('formatStatusLine', () => {
  it('should produce two lines', () => {
    const result = formatStatusLine(42, 'Opus', 'my-app', 'feature/auth', 0.08, 423000);
    const lines = result.split('\n');
    expect(lines.length).toBe(2);
  });

  it('should have model info on line 1', () => {
    const result = formatStatusLine(42, 'Opus', 'my-app', 'main', 0.08, 423000);
    const line1 = result.split('\n')[0];
    expect(line1).toContain('[Opus]');
    expect(line1).toContain('my-app');
    expect(line1).toContain('main');
  });

  it('should have progress bar on line 2', () => {
    const result = formatStatusLine(42, 'Opus', 'my-app', 'main', 0.08, 423000);
    const line2 = result.split('\n')[1];
    expect(line2).toContain('42%');
    expect(line2).toContain('$0.08');
    expect(line2).toContain('7m');
  });

  it('should omit branch when empty', () => {
    const result = formatStatusLine(42, 'Opus', 'my-app', '', 0.08, 423000);
    const line1 = result.split('\n')[0];
    expect(line1).not.toContain('\uD83C\uDF3F');
  });

  it('should stay two lines when no rate limits are passed (default)', () => {
    const result = formatStatusLine(42, 'Opus', 'my-app', 'main', 0.08, 423000);
    expect(result.split('\n').length).toBe(2);
  });

  it('should add a third usage line when rate limits are present', () => {
    const result = formatStatusLine(42, 'Opus', 'my-app', 'main', 0.08, 423000, '', 23, 41);
    const lines = result.split('\n');
    expect(lines.length).toBe(3);
    expect(lines[2]).toContain('session:');
    expect(lines[2]).toContain('weekly:');
  });

  it('should stay two lines when both rate-limit windows are null', () => {
    const result = formatStatusLine(42, 'Opus', 'my-app', 'main', 0.08, 423000, '', null, null);
    expect(result.split('\n').length).toBe(2);
  });
});

// =============================================================================
// extractModelName
// =============================================================================

describe('extractModelName', () => {
  it('should extract display_name when available', () => {
    const data = { model: { display_name: 'Opus', id: 'claude-opus-4-6' } };
    expect(extractModelName(data)).toBe('Opus');
  });

  it('should fall back to id when display_name is missing', () => {
    const data = { model: { id: 'claude-sonnet-4-5' } };
    expect(extractModelName(data)).toBe('claude-sonnet-4-5');
  });

  it('should fall back to id when display_name is empty', () => {
    const data = { model: { display_name: '', id: 'claude-haiku-4-5' } };
    expect(extractModelName(data)).toBe('claude-haiku-4-5');
  });

  it('should return "?" when model object is missing', () => {
    expect(extractModelName({})).toBe('?');
  });

  it('should return "?" when model has no name fields', () => {
    const data = { model: {} };
    expect(extractModelName(data)).toBe('?');
  });

  it('should return "?" when model is null', () => {
    const data = { model: null };
    expect(extractModelName(data as Record<string, unknown>)).toBe('?');
  });

  it('should handle non-string display_name gracefully', () => {
    const data = { model: { display_name: 42, id: 'fallback-id' } };
    expect(extractModelName(data as Record<string, unknown>)).toBe('fallback-id');
  });
});

// =============================================================================
// extractWorktreePath (CC 2.1.97+)
// =============================================================================

describe('extractWorktreePath', () => {
  it('should return worktree path when present', () => {
    const data = { workspace: { git_worktree: '/tmp/worktree-abc' } };
    expect(extractWorktreePath(data)).toBe('/tmp/worktree-abc');
  });

  it('should return empty string when no workspace', () => {
    expect(extractWorktreePath({})).toBe('');
  });

  it('should return empty string when no git_worktree', () => {
    const data = { workspace: { current_dir: '/some/dir' } };
    expect(extractWorktreePath(data)).toBe('');
  });

  it('should return empty string for empty git_worktree', () => {
    const data = { workspace: { git_worktree: '' } };
    expect(extractWorktreePath(data)).toBe('');
  });
});

// =============================================================================
// formatLine1 with worktree (CC 2.1.97+)
// =============================================================================

describe('formatLine1 with worktree', () => {
  it('should include worktree indicator when provided', () => {
    const line = formatLine1('Opus', 'my-project', 'main', '/tmp/wt-feat');
    expect(line).toContain('wt:wt-feat');
  });

  it('should omit worktree indicator when empty', () => {
    const line = formatLine1('Opus', 'my-project', 'main', '');
    expect(line).not.toContain('wt:');
  });

  it('should omit worktree indicator when not provided', () => {
    const line = formatLine1('Opus', 'my-project', 'main');
    expect(line).not.toContain('wt:');
  });
});

// =============================================================================
// Effort / mode badge, resets, tokens, PR (CC 2.1.176+ payload fields)
//
// Field presence below is grounded in a real captured statusline payload
// (CC 2.1.214): effort.level="xhigh", fast_mode=false, thinking.enabled=true,
// rate_limits.*.resets_at in Unix SECONDS, context_window.current_usage.*,
// context_window_size=1000000. `pr` was absent from that capture (no open PR
// for the branch) — it is documented but unobserved, hence the defensive tests.
// =============================================================================

describe('extractEffort', () => {
  it('should extract level and flags from a real-shaped payload', () => {
    const data = { effort: { level: 'xhigh' }, fast_mode: false, thinking: { enabled: true } };
    expect(extractEffort(data)).toEqual({ level: 'xhigh', fastMode: false, thinking: true });
  });

  it('should return nulls/false when the fields are absent (unsupported model)', () => {
    expect(extractEffort({})).toEqual({ level: null, fastMode: false, thinking: false });
  });

  it('should not treat a truthy non-boolean fast_mode as enabled', () => {
    expect(extractEffort({ fast_mode: 'yes' }).fastMode).toBe(false);
  });
});

describe('formatEffortBadge', () => {
  it('should show fast mode in preference to effort level', () => {
    expect(formatEffortBadge('xhigh', true, true)).toBe('⚡ fast');
  });

  it('should show effort with a thinking marker', () => {
    expect(formatEffortBadge('xhigh', false, true)).toBe('◐ xhigh');
  });

  it('should show bare effort when thinking is off', () => {
    expect(formatEffortBadge('high', false, false)).toBe('high');
  });

  it('should return empty when there is no level and no fast mode', () => {
    expect(formatEffortBadge(null, false, true)).toBe('');
  });
});

describe('formatResetIn', () => {
  const now = 1_784_400_000_000; // fixed clock (ms)

  it('should format hours and minutes', () => {
    expect(formatResetIn(1_784_425_200, now)).toBe('resets in 7h 0m');
  });

  it('should format days and hours past 24h', () => {
    expect(formatResetIn(1_784_757_600, now)).toBe('resets in 4d 3h');
  });

  it('should format minutes only under an hour', () => {
    expect(formatResetIn(now / 1000 + 1500, now)).toBe('resets in 25m');
  });

  it('should return empty for an absent timestamp', () => {
    expect(formatResetIn(null, now)).toBe('');
  });

  it('should return empty for a reset already in the past', () => {
    expect(formatResetIn(now / 1000 - 60, now)).toBe('');
  });
});

describe('formatTokenCount', () => {
  it.each([
    [826, '826'],
    [215_762, '215.8k'],
    [1_000_000, '1.0M'],
    [1_500_000, '1.5M'],
    [0, '0'],
  ])('should abbreviate %i as %s', (input, expected) => {
    expect(formatTokenCount(input)).toBe(expected);
  });
});

describe('extractTokenUsage', () => {
  it('should pull totals and cache reads from a real-shaped payload', () => {
    const data = {
      context_window: {
        total_input_tokens: 217_362,
        total_output_tokens: 826,
        context_window_size: 1_000_000,
        current_usage: { cache_read_input_tokens: 215_762 },
      },
    };
    expect(extractTokenUsage(data)).toEqual({
      totalInput: 217_362,
      totalOutput: 826,
      cacheRead: 215_762,
      windowSize: 1_000_000,
    });
  });

  it('should return null when the context window block is absent', () => {
    expect(extractTokenUsage({})).toBeNull();
  });

  it('should default missing numeric fields to 0 rather than NaN', () => {
    expect(extractTokenUsage({ context_window: {} })).toEqual({
      totalInput: 0,
      totalOutput: 0,
      cacheRead: 0,
      windowSize: 0,
    });
  });
});

describe('formatLine4', () => {
  it('should render in/out/cached', () => {
    const line = formatLine4({ totalInput: 217_362, totalOutput: 826, cacheRead: 215_762 });
    expect(line).toContain('215.8k cached');
    expect(line).toContain('217.4k in');
    expect(line).toContain('826 out');
  });

  it('should omit the cached segment when there are no cache reads', () => {
    const line = formatLine4({ totalInput: 100, totalOutput: 20, cacheRead: 0 });
    expect(line).not.toContain('cached');
  });

  it('should return empty for absent usage', () => {
    expect(formatLine4(null)).toBe('');
  });
});

describe('extractPr / formatPrSegment (documented, unobserved live)', () => {
  it('should extract number and review state', () => {
    const data = { pr: { number: 35, url: 'https://x/pull/35', review_state: 'pending' } };
    expect(extractPr(data)).toEqual({ number: 35, reviewState: 'pending' });
    expect(formatPrSegment(extractPr(data))).toBe('PR #35 pending');
  });

  it('should tolerate a missing review_state', () => {
    expect(formatPrSegment(extractPr({ pr: { number: 7 } }))).toBe('PR #7');
  });

  it('should return null when pr is absent (the normal case)', () => {
    expect(extractPr({})).toBeNull();
    expect(formatPrSegment(null)).toBe('');
  });

  it('should reject a pr object with no numeric number rather than rendering NaN', () => {
    expect(extractPr({ pr: { url: 'https://x' } })).toBeNull();
    expect(extractPr({ pr: { number: 'twelve' } } as Record<string, unknown>)).toBeNull();
  });
});

describe('formatStatusLine with extras', () => {
  const now = 1_784_400_000_000;

  it('should stay byte-identical to the 2.7.4 output when no extras are passed', () => {
    // Pinned against bytes captured from the PREVIOUS release's built script
    // (git show main:.../dist/.../context-percentage.js) for the equivalent
    // payload. Comparing the new function against itself with `{}` would be
    // circular — `{}` is the parameter's own default, so such a test passes
    // regardless of whether the output drifted.
    const expected = [
      '\x1b[36m[Opus]\x1b[0m 📁 proj | 🌿 main',
      '\x1b[32m██░░░░░░░░\x1b[0m 22% ✨ | \x1b[33m$1.50\x1b[0m | ⏱️ 1m',
      'session: \x1b[32m█░░░░░░░░░\x1b[0m 11% · weekly: \x1b[32m█████░░░░░\x1b[0m 51%',
    ].join('\n');

    expect(formatStatusLine(22, 'Opus', 'proj', 'main', 1.5, 60_000, '', 11, 51)).toBe(expected);
  });

  it('should render four lines with all extras present', () => {
    const out = formatStatusLine(22, 'Opus 4.8', 'proj', 'main', 51.48, 61_472_869, '', 11, 51, {
      effortBadge: '◐ xhigh',
      prSegment: 'PR #35 pending',
      fiveHourResetsAt: 1_784_425_200,
      sevenDayResetsAt: 1_784_757_600,
      tokens: { totalInput: 217_362, totalOutput: 826, cacheRead: 215_762 },
      nowMs: now,
    });
    const lines = out.split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain('[Opus 4.8 ◐ xhigh]');
    expect(lines[0]).toContain('PR #35 pending');
    expect(lines[2]).toContain('resets in 7h 0m');
    expect(lines[3]).toContain('215.8k cached');
  });

  it('should collapse to two lines in compact mode', () => {
    const out = formatStatusLine(22, 'Opus', 'proj', 'main', 1.5, 60_000, '', 11, 51, {
      effortBadge: '◐ xhigh',
      tokens: { totalInput: 100, totalOutput: 20, cacheRead: 5 },
      compact: true,
      nowMs: now,
    });
    expect(out.split('\n')).toHaveLength(2);
    expect(out).toContain('◐ xhigh');
  });

  it('should omit the usage line but keep tokens for an API user with no rate limits', () => {
    const out = formatStatusLine(22, 'Opus', 'proj', 'main', 1.5, 60_000, '', null, null, {
      tokens: { totalInput: 100, totalOutput: 20, cacheRead: 0 },
      nowMs: now,
    });
    const lines = out.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[2]).toContain('tokens:');
  });
});

// =============================================================================
// getGitBranch portability
//
// `git branch --show-current` requires git >= 2.22; on older git it exits
// non-zero and the branch segment silently vanished from line 1 (reproduced on
// git 2.15.0). The implementation uses `rev-parse --abbrev-ref HEAD` instead.
// =============================================================================

describe('getGitBranch portability', () => {
  it('should not depend on the git >= 2.22 --show-current flag', () => {
    const src = readFileSync(
      new URL('../../src/statusline/context-percentage.ts', import.meta.url),
      'utf8'
    );
    // Assert on the invocation, not any mention — the flag is named in a
    // comment explaining why it was replaced.
    expect(src).not.toContain("execSync('git branch --show-current'");
    expect(src).toContain("execSync('git rev-parse --abbrev-ref HEAD'");
  });

  it('should also pin the compiled bundle, which is what actually ships', () => {
    // The source grep alone cannot catch a stale dist still carrying the old
    // flag; dist/ is tracked and is what users execute.
    const dist = readFileSync(
      new URL('../../dist/src/statusline/context-percentage.js', import.meta.url),
      'utf8'
    );
    expect(dist).toContain('git rev-parse --abbrev-ref HEAD');
    expect(dist).not.toContain("execSync('git branch --show-current'");
  });
});

describe('getGitBranch behaviour', () => {
  // The previous test here asserted `typeof getGitBranch() === 'string'`, which
  // the declared return type already guarantees — it passed against the very
  // git-2.22 bug this block exists to prevent, because the broken version
  // returned '' silently. These drive the three real branches instead.

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.doUnmock('node:child_process');
    vi.doUnmock('node:fs');
  });

  async function loadWithGit(execImpl: (cmd: string) => string) {
    // Force a cache miss so every case exercises the git path, not a leftover
    // cache file from a previous run.
    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
      return { ...actual, existsSync: () => false, writeFileSync: () => {}, renameSync: () => {} };
    });
    vi.doMock('node:child_process', () => ({
      execSync: (cmd: string) => execImpl(cmd),
    }));
    return await import('../../src/statusline/context-percentage.js');
  }

  it('should return the branch name on success', async () => {
    const mod = await loadWithGit(() => 'feature/my-branch\n');
    expect(mod.getGitBranch()).toBe('feature/my-branch');
  });

  it('should normalise a detached HEAD to empty rather than printing "HEAD"', async () => {
    const mod = await loadWithGit(() => 'HEAD\n');
    expect(mod.getGitBranch()).toBe('');
  });

  it('should return empty when git throws (not a repo, git absent)', async () => {
    const mod = await loadWithGit(() => {
      throw new Error('fatal: not a git repository');
    });
    expect(mod.getGitBranch()).toBe('');
  });

  it('should invoke the portable command, not the git >= 2.22 flag', async () => {
    const seen: string[] = [];
    const mod = await loadWithGit((cmd) => {
      seen.push(cmd);
      return 'main\n';
    });
    mod.getGitBranch();
    expect(seen).toEqual(['git rev-parse --abbrev-ref HEAD']);
  });
});

// =============================================================================
// Session-id keying — writer/reader pair
//
// The statusline WRITES the context-percentage file and the context-monitor
// hook READS it. Their session-id precedence must match exactly or the file is
// written under one name and looked for under another, silently disabling the
// 70/80/90% warnings. That is precisely what shipped: the writer read only
// CLAUDE_SESSION_ID, which CC does not export into the statusline child, so it
// wrote "-default.txt" while the hook looked for "-<uuid>.txt".
// =============================================================================

describe('extractSessionId', () => {
  const ENV_KEY = 'CLAUDE_SESSION_ID';
  const original = process.env[ENV_KEY];

  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
  });

  it('should prefer the payload session_id — the field CC actually supplies', () => {
    process.env[ENV_KEY] = 'from-env';
    expect(extractSessionId({ session_id: '99753a0e-6a54-4673-b873-3448edd238c5' })).toBe(
      '99753a0e-6a54-4673-b873-3448edd238c5'
    );
  });

  it('should fall back to the env var when the payload omits it', () => {
    process.env[ENV_KEY] = 'from-env';
    expect(extractSessionId({})).toBe('from-env');
  });

  it('should fall back to "default" when neither is present', () => {
    delete process.env[ENV_KEY];
    expect(extractSessionId({})).toBe('default');
  });

  it('should ignore a non-string or empty payload session_id', () => {
    delete process.env[ENV_KEY];
    expect(extractSessionId({ session_id: '' })).toBe('default');
    expect(extractSessionId({ session_id: 12345 } as Record<string, unknown>)).toBe('default');
  });

  it('should match the context-monitor hook precedence exactly', () => {
    // Mirrors getSessionId() in shared/hooks-infra/src/hooks/prompt/context-monitor.ts:
    // input.session_id -> CLAUDE_SESSION_ID -> 'default'.
    const hookGetSessionId = (input: { session_id?: unknown }): string => {
      if (typeof input.session_id === 'string' && input.session_id) return input.session_id;
      return process.env[ENV_KEY] || 'default';
    };

    for (const payload of [{ session_id: 'abc-123' }, { session_id: '' }, {}] as Record<
      string,
      unknown
    >[]) {
      process.env[ENV_KEY] = 'env-session';
      expect(extractSessionId(payload)).toBe(hookGetSessionId(payload));
      delete process.env[ENV_KEY];
      expect(extractSessionId(payload)).toBe(hookGetSessionId(payload));
    }
  });
});

// =============================================================================
// Hardening found by diffing built output against the previous release
// =============================================================================

describe('formatLine4 zero-data suppression', () => {
  it('should omit the line entirely when every count is zero', () => {
    // A context_window block with no token fields yields all zeros; rendering
    // "tokens: 0 in · 0 out" was a pure noise line in the previous build.
    expect(formatLine4({ totalInput: 0, totalOutput: 0, cacheRead: 0 })).toBe('');
  });

  it('should still render when only cache reads are non-zero', () => {
    expect(formatLine4({ totalInput: 0, totalOutput: 0, cacheRead: 5 })).toContain('5 cached');
  });
});

describe('formatResetIn implausible-value guard', () => {
  const now = 1_784_400_000_000;

  it('should omit a countdown beyond the longest real window', () => {
    // A resets_at mistakenly supplied in milliseconds previously rendered
    // "resets in 1136754d 12h".
    expect(formatResetIn(99_999_999_999, now)).toBe('');
  });

  it('should still render a genuine seven-day window', () => {
    expect(formatResetIn(now / 1000 + 7 * 86_400 - 60, now)).toContain('resets in 6d');
  });
});

// =============================================================================
// Silent mode — composition with another statusline
//
// CC runs one statusLine program, but ctk's script is what writes the file the
// context-monitor hook reads. Silent mode keeps the side effect while ceding
// the display, so a user can run claude-hud (or anything else) AND keep the
// 70/80/90% warnings. Exercised against the BUILT script, since the flag is
// read in main(), which only runs when the file is executed directly.
// =============================================================================

describe('CONTINUITY_STATUSLINE_SILENT', () => {
  const dist = fileURLToPath(
    new URL('../../dist/src/statusline/context-percentage.js', import.meta.url)
  );
  const SILENT_FLAG = 'CONTINUITY_STATUSLINE_SILENT';

  const payload = (sid: string): string =>
    JSON.stringify({
      session_id: sid,
      context_window: { used_percentage: 42, total_input_tokens: 100, total_output_tokens: 10 },
      model: { display_name: 'Opus' },
    });

  const runScript = (input: string, silent: boolean): string => {
    const childEnv = { ...globalThis.process.env } as Record<string, string>;
    if (silent) childEnv[SILENT_FLAG] = '1';
    else delete childEnv[SILENT_FLAG];
    return execFileSync('node', [dist], { input, encoding: 'utf8', env: childEnv });
  };

  const pctFile = (sid: string): string => join(tmpdir(), `claude-context-pct-${sid}.txt`);

  afterEach(() => {
    for (const sid of ['silent-probe', 'loud-probe']) {
      try {
        unlinkSync(pctFile(sid));
      } catch {
        /* already gone */
      }
    }
  });

  it('should print nothing at all when silent', () => {
    expect(runScript(payload('silent-probe'), true)).toBe('');
  });

  it('should STILL write the percentage file when silent — the whole point', () => {
    runScript(payload('silent-probe'), true);
    expect(readFileSync(pctFile('silent-probe'), 'utf8').trim()).toBe('42');
  });

  it('should print normally when the flag is unset', () => {
    expect(runScript(payload('loud-probe'), false)).toContain('42%');
  });

  it('should suppress the fallback string too, so it cannot corrupt the other program', () => {
    // Malformed input takes the FALLBACK_STATUS path; in silent mode that must
    // print nothing, or it would inject "[?] unknown" into the other program's
    // output. This is the leak the `emit` wrapper exists to prevent.
    expect(runScript('{ not json', true)).toBe('');
  });
});
