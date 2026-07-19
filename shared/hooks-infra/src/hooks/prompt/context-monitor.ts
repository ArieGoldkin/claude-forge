/**
 * Shared Hooks Infra - Context Monitor Hook
 *
 * UserPromptSubmit hook that reads context window usage from a temp file
 * (written by the StatusLine script) and injects tiered warnings when
 * context usage reaches thresholds.
 *
 * Tiers:
 *   <70%  = none (silent)
 *   70-79 = advisory
 *   80-89 = warning
 *   90+   = critical
 *
 * Rate-limiting: Only emits when the current tier is higher than the
 * last emitted tier. Resets when context drops below 70% (after compaction).
 *
 * Graceful degradation: If the temp file doesn't exist (StatusLine not
 * configured), returns silentSuccess with no impact.
 *
 * @module prompt/context-monitor
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getCachedBranch } from '../lib/git-utils.js';
import { logDebug, logInfo, logWarn } from '../lib/logging.js';
import { outputPromptContext, outputSilentSuccess } from '../lib/output.js';
import type { HookInput, HookResult } from '../types.js';

// =============================================================================
// CONSTANTS
// =============================================================================

const HOOK_NAME = 'context-monitor';
const TEMP_PREFIX = 'claude-context-pct-';
const WARN_PREFIX = 'claude-context-last-warn-';

// =============================================================================
// TIER LOGIC (exported for testing)
// =============================================================================

/** Tier levels: 0=none, 1=advisory, 2=warning, 3=critical */
export type Tier = 0 | 1 | 2 | 3;

/**
 * Determine the warning tier for a given context percentage.
 */
export function getTier(pct: number): Tier {
  if (pct >= 90) return 3;
  if (pct >= 80) return 2;
  if (pct >= 70) return 1;
  return 0;
}

/**
 * Build a suggested handoff filename for the active branch and date.
 *
 * Format: `YYYY-MM-DD_<topic>.yaml` where topic is the branch name with
 * type prefix stripped (feat/, fix/, chore/, etc.) and remaining chars
 * normalized to a slug.
 *
 * Pure for testability — both branch and date can be overridden.
 *
 * @param branch - Branch name (defaults to "session" if empty)
 * @param date - Date to use for the prefix (defaults to now)
 * @returns A suggested handoff filename
 */
export function getSuggestedHandoffName(branch?: string, date?: Date): string {
  const d = date ?? new Date();
  const datePrefix = d.toISOString().slice(0, 10);
  const raw = branch && branch.length > 0 ? branch : 'session';
  const cleaned = raw
    .replace(/^[a-z]+\//, '')
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  const safe = cleaned.length > 0 ? cleaned : 'session';
  return `${datePrefix}_${safe}.yaml`;
}

/**
 * Get the warning message for a given tier and percentage.
 * Returns null for tier 0 (no warning).
 *
 * When `suggestedName` is provided (tier 2+ at the call site), the message
 * appends a "Suggested filename: …" sentence so Claude has a concrete
 * artifact name to use with /create-handoff.
 *
 * The base message structure ("CONTEXT WARNING", "/create-handoff NOW") is
 * preserved before the suggestion suffix so existing substring assertions
 * stay green.
 */
export function getWarningMessage(tier: Tier, pct: number, suggestedName?: string): string | null {
  const suggestion = suggestedName ? ` Suggested filename: ${suggestedName}.` : '';
  switch (tier) {
    case 1:
      return `Context at ${pct}%. Consider running /create-handoff when at a stopping point.`;
    case 2:
      return `CONTEXT WARNING: ${pct}% used. Recommend /create-handoff then /clear soon.${suggestion}`;
    case 3:
      return `CONTEXT CRITICAL: ${pct}%+. Run /create-handoff NOW, then /clear. Auto-compaction imminent.${suggestion}`;
    default:
      return null;
  }
}

/**
 * Determine whether a warning should be emitted based on current and last tier.
 * Only escalate: emit when currentTier > lastTier.
 * Reset when context drops below 70% (tier 0).
 */
export function shouldWarn(currentTier: Tier, lastTier: Tier): boolean {
  if (currentTier === 0) return false;
  return currentTier > lastTier;
}

// =============================================================================
// FILE I/O HELPERS
// =============================================================================

/**
 * Read the context percentage from the temp file.
 * Returns null if file doesn't exist or contains invalid data.
 */
function readPercentage(sessionId: string): number | null {
  const filePath = join(tmpdir(), `${TEMP_PREFIX}${sessionId}.txt`);
  try {
    const content = readFileSync(filePath, 'utf8').trim();
    const pct = Number.parseInt(content, 10);
    if (Number.isNaN(pct) || pct < 0) return null;
    return pct;
  } catch {
    return null;
  }
}

/**
 * Read the last emitted warning tier from the temp file.
 * Returns 0 if file doesn't exist.
 */
function readLastTier(sessionId: string): Tier {
  const filePath = join(tmpdir(), `${WARN_PREFIX}${sessionId}.txt`);
  try {
    const content = readFileSync(filePath, 'utf8').trim();
    const tier = Number.parseInt(content, 10);
    if (tier >= 0 && tier <= 3) return tier as Tier;
    return 0;
  } catch {
    return 0;
  }
}

/**
 * Write the last emitted warning tier to the temp file.
 */
function writeLastTier(sessionId: string, tier: Tier): void {
  const filePath = join(tmpdir(), `${WARN_PREFIX}${sessionId}.txt`);
  try {
    writeFileSync(filePath, String(tier), 'utf8');
  } catch {
    // Non-fatal
  }
}

// =============================================================================
// SESSION ID EXTRACTION
// =============================================================================

/**
 * Session ids are interpolated into the temp-file paths below, so values
 * carrying path separators or traversal segments are rejected rather than
 * joined. MUST stay identical to `isSafeSessionId()` in the statusline script
 * (`plugins/continuity-toolkit/hooks/src/statusline/context-percentage.ts`):
 * that script writes the file this hook reads, so a validator applied to only
 * one side desynchronises the filename — the same class of writer/reader
 * mismatch that silently disabled these warnings before ctk 2.8.0.
 */
function isSafeSessionId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.includes('..')) return false;
  return /^[A-Za-z0-9._-]{1,128}$/.test(value);
}

/**
 * Extract session ID from hook input or environment.
 */
function getSessionId(input: HookInput): string {
  if (isSafeSessionId(input.session_id)) {
    return input.session_id;
  }
  const fromEnv = process.env['CLAUDE_SESSION_ID'];
  if (isSafeSessionId(fromEnv)) {
    return fromEnv;
  }
  return 'default';
}

// =============================================================================
// HOOK ENTRY POINT
// =============================================================================

/**
 * Context Monitor - UserPromptSubmit hook.
 *
 * Reads context window usage from temp file and injects tiered warnings.
 * Fast path: No temp file -> silentSuccess in <1ms.
 */
export async function contextMonitor(input: HookInput): Promise<HookResult> {
  const sessionId = getSessionId(input);

  // Read current context percentage
  const pct = readPercentage(sessionId);

  if (pct === null) {
    logDebug(HOOK_NAME, 'No context percentage file found (StatusLine not configured?)');
    return outputSilentSuccess();
  }

  logDebug(HOOK_NAME, `Context at ${pct}%`);

  const currentTier = getTier(pct);
  const lastTier = readLastTier(sessionId);

  // Reset rate-limit state when context drops below 70% (e.g., after compaction)
  if (currentTier === 0 && lastTier > 0) {
    logDebug(HOOK_NAME, 'Context dropped below 70%, resetting rate-limit state');
    writeLastTier(sessionId, 0);
    return outputSilentSuccess();
  }

  // Check if we should emit a warning
  if (!shouldWarn(currentTier, lastTier)) {
    logDebug(HOOK_NAME, `Tier ${currentTier} <= last tier ${lastTier}, skipping`);
    return outputSilentSuccess();
  }

  // At tier 2+ (>=80%), include a suggested handoff filename so Claude has
  // a concrete artifact name ready to use with /create-handoff. Below tier 2
  // we keep the message terse — the user has time to pick a name themselves.
  const suggestedName =
    currentTier >= 2 ? getSuggestedHandoffName(getCachedBranch() || undefined) : undefined;
  const message = getWarningMessage(currentTier, pct, suggestedName);
  if (!message) {
    return outputSilentSuccess();
  }

  // Record this tier as last emitted
  writeLastTier(sessionId, currentTier);

  if (currentTier >= 3) {
    logWarn(HOOK_NAME, `CRITICAL: Context at ${pct}%`);
  } else {
    logInfo(HOOK_NAME, `Context warning tier ${currentTier}: ${pct}%`);
  }

  return outputPromptContext(message);
}
