/**
 * TeammateIdle Hook - Auto-save continuity state on teammate idle
 *
 * When a teammate agent goes idle, updates shared-context.json heartbeat
 * to prevent state loss if the session ends abruptly.
 *
 * @module lifecycle/teammate-idle-saver
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { CONTINUITY_DIRS, formatTimestamp } from '../lib/continuity.js';
import { acquireLock, releaseLock } from '../lib/lock.js';
import { logDebug, logError, logInfo } from '../lib/logging.js';
import { outputSilentSuccess } from '../lib/output.js';
import type { HookInput, HookResult } from '../types.js';

const HOOK_NAME = 'teammate-idle-saver';
const MAX_LOCK_ATTEMPTS = 20;

/**
 * TeammateIdle hook - updates shared-context.json heartbeat on teammate idle.
 *
 * Updates:
 * - session_heartbeat.last_activity = current timestamp
 * - last_agent_idle = { teammate_name, team_name, timestamp }
 *
 * TeammateIdle input carries `teammate_name` and `team_name` -- NOT
 * `agent_id`/`agent_type`, which this hook read until 2.8.4 and which CC never
 * sends for this event (both landed as "unknown" on every real idle). Verified
 * against the CC v2.1.215 binary and a live probe.
 *
 * Always returns outputSilentSuccess() -- TeammateIdle hooks cannot block.
 *
 * @param input - Hook input from Claude Code
 * @returns HookResult (always silent success)
 */
export async function teammateIdleSaver(input: HookInput): Promise<HookResult> {
  const projectDir = process.env['CLAUDE_PROJECT_DIR'] || '.';
  const teammateName = input.teammate_name || 'unknown';
  const teamName = input.team_name || 'unknown';

  logDebug(HOOK_NAME, `Teammate idle: teammate_name=${teammateName}, team_name=${teamName}`);

  const contextFile = path.join(projectDir, CONTINUITY_DIRS.context, 'shared-context.json');

  if (!fs.existsSync(contextFile)) {
    logDebug(HOOK_NAME, 'No context file found, nothing to update');
    return outputSilentSuccess();
  }

  const lockDir = `${contextFile}.lock`;

  if (!(await acquireLock(lockDir, MAX_LOCK_ATTEMPTS))) {
    logError(HOOK_NAME, 'Failed to acquire lock, skipping context update');
    return outputSilentSuccess();
  }

  try {
    const raw = fs.readFileSync(contextFile, 'utf8');
    let context: Record<string, unknown>;

    try {
      context = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      logError(HOOK_NAME, 'Context file contains invalid JSON, skipping update');
      return outputSilentSuccess();
    }

    const timestamp = formatTimestamp();

    // Update session heartbeat
    const heartbeat = (context['session_heartbeat'] as Record<string, unknown>) || {};
    heartbeat['last_activity'] = timestamp;
    context['session_heartbeat'] = heartbeat;

    // Record last agent idle event
    context['last_agent_idle'] = {
      teammate_name: teammateName,
      team_name: teamName,
      timestamp,
    };

    // Write atomically
    const tempFile = `${contextFile}.tmp`;
    fs.writeFileSync(tempFile, `${JSON.stringify(context, null, 2)}\n`);
    fs.renameSync(tempFile, contextFile);

    logInfo(HOOK_NAME, `Heartbeat updated on teammate idle (teammate: ${teammateName})`);
  } catch (error) {
    logError(HOOK_NAME, `Failed to update context file: ${error}`);
  } finally {
    releaseLock(lockDir);
  }

  return outputSilentSuccess();
}

export default teammateIdleSaver;
