/**
 * TaskCompleted Hook - Log task completion metrics
 *
 * Appends task completion data to a JSONL metrics file for tracking
 * agent task throughput and patterns.
 *
 * @module lifecycle/task-completed-logger
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { formatTimestamp } from '../lib/continuity.js';
import { logDebug, logError, logInfo } from '../lib/logging.js';
import { outputSilentSuccess } from '../lib/output.js';
import type { HookInput, HookResult } from '../types.js';

const HOOK_NAME = 'task-completed-logger';
const METRICS_DIR = '.claude/continuity/metrics';
const METRICS_FILE = 'tasks.jsonl';

/**
 * TaskCompleted hook - logs task completion metrics to JSONL file.
 *
 * Appends one JSON line per task completion to `.claude/continuity/metrics/tasks.jsonl`.
 * Creates the metrics directory if it doesn't exist.
 *
 * TaskCompleted input carries `task_id`, `task_subject`, `task_description`,
 * `teammate_name`, and `team_name` -- NOT `agent_id`/`tool_use_id`, which this
 * hook logged until 2.8.4 and which CC never sends for this event (both landed
 * "unknown"/absent on every real task). Verified against the CC v2.1.215 binary.
 * `session_id` is a common field present in all hook inputs and is retained.
 * The `event: 'completed'` discriminator is added so created/completed rows in
 * the shared tasks.jsonl are distinguishable (created rows already carry one).
 *
 * Always returns outputSilentSuccess() -- TaskCompleted hooks cannot block.
 *
 * @param input - Hook input from Claude Code
 * @returns HookResult (always silent success)
 */
export async function taskCompletedLogger(input: HookInput): Promise<HookResult> {
  const projectDir = process.env['CLAUDE_PROJECT_DIR'] || '.';
  const sessionId = input.session_id || process.env['CLAUDE_SESSION_ID'] || 'unknown';
  const taskId = input.task_id || 'unknown';
  const teammateName = input.teammate_name || undefined;

  logDebug(HOOK_NAME, `Task completed: task_id=${taskId}, session_id=${sessionId}`);

  const metricsDir = path.join(projectDir, METRICS_DIR);
  const metricsFile = path.join(metricsDir, METRICS_FILE);

  try {
    // Ensure metrics directory exists
    if (!fs.existsSync(metricsDir)) {
      fs.mkdirSync(metricsDir, { recursive: true });
    }

    const entry = {
      event: 'completed',
      timestamp: formatTimestamp(),
      task_id: taskId,
      session_id: sessionId,
      ...(input.task_subject && { task_subject: input.task_subject }),
      ...(input.task_description && { task_description: input.task_description }),
      ...(teammateName && { teammate_name: teammateName }),
      ...(input.team_name && { team_name: input.team_name }),
    };

    fs.appendFileSync(metricsFile, `${JSON.stringify(entry)}\n`);

    logInfo(HOOK_NAME, `Task completion logged for task ${taskId}`);
  } catch (error) {
    logError(HOOK_NAME, `Failed to log task completion: ${error}`);
  }

  return outputSilentSuccess();
}

export default taskCompletedLogger;
