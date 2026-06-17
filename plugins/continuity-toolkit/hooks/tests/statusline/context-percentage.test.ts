/**
 * Tests for Context Percentage StatusLine script
 *
 * Validates pure formatting functions: emoji thresholds, progress bar,
 * status line formatting, model name extraction, bar colors, cost/duration
 * formatting, workspace extraction, and two-line output.
 *
 * @module tests/statusline/context-percentage
 */

import { describe, expect, it } from 'vitest';
import {
  ANSI,
  buildProgressBar,
  extractCost,
  extractModelName,
  extractRateLimits,
  extractWorkspaceName,
  extractWorktreePath,
  formatCost,
  formatDuration,
  formatLine1,
  formatLine2,
  formatLine3,
  formatStatusLine,
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
    expect(extractRateLimits(data)).toEqual({ fiveHourPct: 24, sevenDayPct: 41 });
  });

  it('should return nulls when rate_limits is absent (API/Bedrock users)', () => {
    expect(extractRateLimits({})).toEqual({ fiveHourPct: null, sevenDayPct: null });
  });

  it('should handle each window being independently absent', () => {
    const onlyFive = { rate_limits: { five_hour: { used_percentage: 50 } } };
    expect(extractRateLimits(onlyFive)).toEqual({ fiveHourPct: 50, sevenDayPct: null });

    const onlySeven = { rate_limits: { seven_day: { used_percentage: 80 } } };
    expect(extractRateLimits(onlySeven)).toEqual({ fiveHourPct: null, sevenDayPct: 80 });
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
    });
  });

  it('should return null for a window object with no used_percentage', () => {
    const data = { rate_limits: { five_hour: { resets_at: 1738425600 } } };
    expect(extractRateLimits(data)).toEqual({ fiveHourPct: null, sevenDayPct: null });
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
