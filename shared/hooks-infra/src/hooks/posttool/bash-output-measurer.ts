/**
 * PostToolUse Bash Hook — token-savings measurement spike.
 *
 * Pure measurement hook. Records bash command + output sizes to a per-session
 * JSONL so we can decide — empirically, on real session data — whether to
 * build Spike B (bash output compression). Records nothing about the user-
 * visible output and does not block, warn, or alter the bash result in any
 * way.
 *
 * Companion to the Read-tool measurement hooks: between the two we collect
 * the data needed to:
 *
 *   - Validate Spike A's actual savings (Read cache hits → byte deltas)
 *   - Decide whether to ship Spike B (Bash output sizes per command prefix)
 *
 * @module posttool/bash-output-measurer
 */

import { recordBashEvent } from '../lib/bash-compress/index.js';
import { guardTool, runGuards } from '../lib/guards.js';
import { getCommand, getDurationMs, getSessionId } from '../lib/input.js';
import { logDebug } from '../lib/logging.js';
import { outputSilentSuccess } from '../lib/output.js';
import type { HookInput, HookResult } from '../types.js';

const HOOK_NAME = 'bash-output-measurer';

/** Concatenate every output channel we know about. */
function combineOutput(input: HookInput): string {
  const out = input.tool_response;
  if (!out) return '';
  return [out.stdout, out.stderr, out.output].filter(Boolean).join('');
}

/**
 * PostToolUse Bash hook — measures sizes, never alters behavior.
 *
 * Always returns silent success. The user's bash call has already completed
 * by the time this fires; we have nothing to surface. Any failure inside the
 * measurement library is swallowed there.
 */
export async function bashOutputMeasurerHook(input: HookInput): Promise<HookResult> {
  try {
    const skipped = runGuards(input, (i) => guardTool(i, 'Bash'));
    if (skipped) return skipped;

    const sessionId = getSessionId(input);
    const command = getCommand(input);
    if (!sessionId || sessionId === 'unknown' || !command) {
      return outputSilentSuccess();
    }

    const output = combineOutput(input);
    const durationMs = getDurationMs(input);

    recordBashEvent(sessionId, command, output, durationMs);
    logDebug(HOOK_NAME, `recorded bash event (cmd=${command.length}b, out=${output.length}b)`);

    return outputSilentSuccess();
  } catch (e) {
    // Defensive top-level: measurement must never break the user's session.
    logDebug(HOOK_NAME, `unexpected error: ${e}`);
    return outputSilentSuccess();
  }
}

export default bashOutputMeasurerHook;
