/**
 * SessionStart Hook - Continuity Toolkit Recommendation
 *
 * Checks if the continuity plugin (ctk — formerly continuity-toolkit) is
 * installed alongside the current plugin. If not found, outputs a one-time
 * recommendation to install it for full hook coverage (security, permissions,
 * lifecycle, context monitoring).
 *
 * Detection: Looks for ctk (or legacy continuity-toolkit) as a sibling
 * directory relative to CLAUDE_PLUGIN_ROOT. Works for:
 *   - Marketplace installs (~/.claude/plugins/cache/<marketplace>/ctk/)
 *   - Local dev (--plugin-dir ./plugins/continuity-toolkit) — directory name
 *     kept as `continuity-toolkit` in the monorepo for readability
 *   - Legacy marketplace installs still using the old name
 *
 * @module lifecycle/continuity-recommendation
 */

import { existsSync, mkdirSync, readdirSync, rmdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { logDebug } from '../lib/logging.js';
import { outputSilentSuccess, outputSuccess } from '../lib/output.js';
import type { HookInput, HookResult } from '../types.js';

const HOOK_NAME = 'continuity-recommendation';

/**
 * Names under which the continuity plugin may be installed or live on disk.
 * - `ctk`: new marketplace identity (v2.0.0+)
 * - `continuity-toolkit`: source directory name in the monorepo AND the
 *   legacy marketplace identity (pre-v2.0.0 installs)
 */
const CONTINUITY_NAMES = ['ctk', 'continuity-toolkit'];

/**
 * Check if the continuity plugin is installed as a sibling plugin.
 *
 * For marketplace installs, plugins live at:
 *   ~/.claude/plugins/cache/<marketplace>/<plugin-name>/<version>/
 * CLAUDE_PLUGIN_ROOT points to the version directory, so we go up 2 levels
 * to reach the marketplace directory and check for ctk/ (or legacy
 * continuity-toolkit/).
 *
 * For local dev (--plugin-dir ./plugins/continuity-toolkit), we go up 1 level
 * to reach the plugins/ directory and check for the continuity-toolkit/
 * source directory.
 */
function isContinuityInstalled(): boolean {
  const pluginRoot = process.env['CLAUDE_PLUGIN_ROOT'];
  if (!pluginRoot) {
    logDebug(HOOK_NAME, 'CLAUDE_PLUGIN_ROOT not set, skipping check');
    return true; // Can't determine, assume installed
  }

  const currentPluginName = basename(pluginRoot);

  // Pattern 3 (fast path): We ARE the continuity plugin
  if (CONTINUITY_NAMES.includes(currentPluginName)) {
    return true;
  }

  // Pattern 1: Marketplace install — CLAUDE_PLUGIN_ROOT is <cache>/<marketplace>/<plugin>/<version>/
  // Go up 2 levels to reach <cache>/<marketplace>/ then check for ctk/ or continuity-toolkit/
  const marketplaceDir = dirname(dirname(pluginRoot));
  for (const name of CONTINUITY_NAMES) {
    const marketplacePath = join(marketplaceDir, name);
    if (existsSync(marketplacePath)) {
      logDebug(HOOK_NAME, `Found continuity plugin at ${marketplacePath}`);
      return true;
    }
  }

  // Pattern 2: Local dev — CLAUDE_PLUGIN_ROOT is <repo>/plugins/<plugin>/
  // Go up 1 level to reach <repo>/plugins/ then check for ctk/ or continuity-toolkit/
  const parentDir = dirname(pluginRoot);
  for (const name of CONTINUITY_NAMES) {
    const siblingPath = join(parentDir, name);
    if (existsSync(siblingPath)) {
      logDebug(HOOK_NAME, `Found continuity plugin at ${siblingPath}`);
      return true;
    }
  }

  logDebug(HOOK_NAME, `continuity plugin (ctk) not found at ${marketplaceDir} or ${parentDir}`);
  return false;
}

/**
 * Atomically claim the right to show the recommendation message.
 *
 * Uses mkdir as an atomic operation — only the first process to create the
 * marker directory succeeds. The marker includes today's date so it resets
 * daily (in case the user installs ctk later).
 *
 * @returns true if this process claimed the marker (should show message)
 */
function claimRecommendationMarker(): boolean {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const claudeDir = join(homedir(), '.claude');
  const markerDir = join(claudeDir, `.continuity-rec-${today}`);

  try {
    // Ensure ~/.claude/ exists (may not on fresh installs)
    mkdirSync(claudeDir, { recursive: true });

    // Atomic claim — only the first process succeeds
    mkdirSync(markerDir, { recursive: false });
    logDebug(HOOK_NAME, `Claimed recommendation marker: ${markerDir}`);
    return true;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') {
      logDebug(HOOK_NAME, 'Recommendation already shown by another plugin');
    } else {
      logDebug(HOOK_NAME, `Failed to create marker: ${code}`);
    }
    return false;
  }
}

/**
 * Clean up stale marker directories from previous days.
 * Best-effort, non-blocking — called after showing the message.
 */
function cleanStaleMarkers(): void {
  const today = new Date().toISOString().slice(0, 10);
  const claudeDir = join(homedir(), '.claude');

  try {
    const entries = readdirSync(claudeDir);
    for (const entry of entries) {
      if (entry.startsWith('.continuity-rec-') && !entry.endsWith(today)) {
        try {
          rmdirSync(join(claudeDir, entry));
        } catch {
          // Ignore — may not be empty or already removed
        }
      }
    }
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * SessionStart hook — recommends installing ctk (continuity plugin) if not found.
 *
 * Returns silent success if ctk (or legacy continuity-toolkit) is detected.
 * Uses an atomic marker to ensure only one plugin shows the message,
 * even when multiple plugins are installed without ctk.
 */
export async function continuityRecommendation(_input: HookInput): Promise<HookResult> {
  if (isContinuityInstalled()) {
    return outputSilentSuccess();
  }

  // Only the first plugin to claim the marker shows the message
  if (!claimRecommendationMarker()) {
    return outputSilentSuccess();
  }

  cleanStaleMarkers();

  const message =
    '💡 For full hook coverage (security guardrails, auto-permissions, context monitoring, session persistence), install ctk (continuity toolkit) alongside your other plugins: `/plugin install ctk@claude-forge`. For lighter-weight context restoration without ctk, CC v2.1.108+ has built-in /recap.';

  logDebug(HOOK_NAME, 'ctk (continuity plugin) not detected, showing recommendation');

  return outputSuccess(message);
}

export default continuityRecommendation;
