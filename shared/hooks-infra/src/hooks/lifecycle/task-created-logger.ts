/**
 * TaskCreated Hook - Log task creation events
 *
 * Appends task creation data to a JSONL metrics file for tracking
 * task creation patterns and agent task planning behavior.
 *
 * @module lifecycle/task-created-logger
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { formatTimestamp } from '../lib/continuity.js';
import { logDebug, logError, logInfo } from '../lib/logging.js';
import { outputSilentSuccess } from '../lib/output.js';
import type { HookInput, HookResult } from '../types.js';

const HOOK_NAME = 'task-created-logger';
const METRICS_DIR = '.claude/continuity/metrics';
const METRICS_FILE = 'tasks.jsonl';

/**
 * TaskCreated hook - logs task creation events to JSONL file.
 *
 * Appends one JSON line per task creation to `.claude/continuity/metrics/tasks.jsonl`.
 * Creates the metrics directory if it doesn't exist.
 *
 * TaskCreated input carries `task_id`, `task_subject`, `task_description`,
 * `teammate_name`, and `team_name` -- NOT `agent_id`/`tool_use_id`, which this
 * hook logged until 2.8.4 and which CC never sends for this event (both landed
 * "unknown"/absent on every real task). Verified against the CC v2.1.215 binary.
 * `session_id` is a common field present in all hook inputs and is retained.
 *
 * Always returns outputSilentSuccess() -- TaskCreated hooks cannot block.
 *
 * @param input - Hook input from Claude Code
 * @returns HookResult (always silent success)
 */
export async function taskCreatedLogger(input: HookInput): Promise<HookResult> {
  const projectDir = process.env['CLAUDE_PROJECT_DIR'] || '.';
  const sessionId = input.session_id || process.env['CLAUDE_SESSION_ID'] || 'unknown';
  const taskId = input.task_id || 'unknown';
  logDebug(HOOK_NAME, `Task created: task_id=${taskId}, session_id=${sessionId}`);

  const metricsDir = path.join(projectDir, METRICS_DIR);
  const metricsFile = path.join(metricsDir, METRICS_FILE);

  try {
    if (!fs.existsSync(metricsDir)) {
      fs.mkdirSync(metricsDir, { recursive: true });
    }

    const entry = {
      event: 'created',
      timestamp: formatTimestamp(),
      task_id: taskId,
      session_id: sessionId,
      ...(input.task_subject && { task_subject: input.task_subject }),
      ...(input.task_description && { task_description: input.task_description }),
      ...(input.teammate_name && { teammate_name: input.teammate_name }),
      ...(input.team_name && { team_name: input.team_name }),
    };

    fs.appendFileSync(metricsFile, `${JSON.stringify(entry)}\n`);

    logInfo(HOOK_NAME, `Task creation logged for task ${taskId}`);
  } catch (error) {
    logError(HOOK_NAME, `Failed to log task creation: ${error}`);
  }

  return outputSilentSuccess();
}

export default taskCreatedLogger;
