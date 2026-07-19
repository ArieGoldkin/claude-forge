/**
 * Tests for task-created-logger hook
 *
 * Verifies that the TaskCreated hook:
 * - Appends JSONL entry to metrics file with event: 'created'
 * - Creates metrics directory if missing
 * - Handles multiple creations (append, not overwrite)
 * - Records correct fields
 *
 * @module tests/lifecycle/task-created-logger
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { taskCreatedLogger } from '../../src/lifecycle/task-created-logger.js';
import type { HookInput } from '../../src/types.js';

function createMockInput(overrides: Partial<HookInput> = {}): HookInput {
  return {
    tool_name: 'TaskCreated' as HookInput['tool_name'],
    tool_input: {},
    task_id: 'task-789',
    session_id: 'session-abc',
    task_subject: 'Review PR 38',
    task_description: 'Security review of the env-file changes',
    teammate_name: 'sec-reviewer',
    team_name: 'session-fc573d34',
    ...overrides,
  };
}

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'task-created-test-'));
}

describe('task-created-logger', () => {
  const originalEnv = { ...process.env };
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    process.env['CLAUDE_PROJECT_DIR'] = tempDir;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('core functionality', () => {
    it('should create metrics directory and file', async () => {
      await taskCreatedLogger(createMockInput());

      const metricsFile = path.join(tempDir, '.claude/continuity/metrics/tasks.jsonl');
      expect(fs.existsSync(metricsFile)).toBe(true);
    });

    it('should write valid JSONL entry with event: created', async () => {
      await taskCreatedLogger(createMockInput());

      const metricsFile = path.join(tempDir, '.claude/continuity/metrics/tasks.jsonl');
      const content = fs.readFileSync(metricsFile, 'utf8').trim();
      const entry = JSON.parse(content);

      expect(entry.event).toBe('created');
      expect(entry.task_id).toBe('task-789');
      expect(entry.session_id).toBe('session-abc');
      expect(entry.task_subject).toBe('Review PR 38');
      expect(entry.task_description).toBe('Security review of the env-file changes');
      expect(entry.teammate_name).toBe('sec-reviewer');
      expect(entry.team_name).toBe('session-fc573d34');
      expect(entry.timestamp).toBeDefined();
      // Guard against reverting to the fields CC never sends for this event.
      expect(entry).not.toHaveProperty('agent_id');
      expect(entry).not.toHaveProperty('tool_use_id');
    });

    it('should append multiple entries', async () => {
      await taskCreatedLogger(createMockInput({ task_id: 'task-1' }));
      await taskCreatedLogger(createMockInput({ task_id: 'task-2' }));

      const metricsFile = path.join(tempDir, '.claude/continuity/metrics/tasks.jsonl');
      const lines = fs.readFileSync(metricsFile, 'utf8').trim().split('\n');

      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]).task_id).toBe('task-1');
      expect(JSON.parse(lines[1]).task_id).toBe('task-2');
    });

    it('should omit optional task and teammate fields when not present', async () => {
      await taskCreatedLogger(
        createMockInput({
          task_subject: undefined,
          task_description: undefined,
          teammate_name: undefined,
          team_name: undefined,
        })
      );

      const metricsFile = path.join(tempDir, '.claude/continuity/metrics/tasks.jsonl');
      const entry = JSON.parse(fs.readFileSync(metricsFile, 'utf8').trim());

      expect(entry).not.toHaveProperty('task_subject');
      expect(entry).not.toHaveProperty('task_description');
      expect(entry).not.toHaveProperty('teammate_name');
      expect(entry).not.toHaveProperty('team_name');
    });
  });

  describe('return value', () => {
    it('should always return silent success', async () => {
      const result = await taskCreatedLogger(createMockInput());

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle missing task_id', async () => {
      await taskCreatedLogger(createMockInput({ task_id: undefined }));

      const metricsFile = path.join(tempDir, '.claude/continuity/metrics/tasks.jsonl');
      const entry = JSON.parse(fs.readFileSync(metricsFile, 'utf8').trim());

      expect(entry.task_id).toBe('unknown');
    });

    it('should handle missing session_id', async () => {
      delete process.env['CLAUDE_SESSION_ID'];
      await taskCreatedLogger(createMockInput({ session_id: undefined }));

      const metricsFile = path.join(tempDir, '.claude/continuity/metrics/tasks.jsonl');
      const entry = JSON.parse(fs.readFileSync(metricsFile, 'utf8').trim());

      expect(entry.session_id).toBe('unknown');
    });

    it('should handle pre-existing metrics directory', async () => {
      const metricsDir = path.join(tempDir, '.claude/continuity/metrics');
      fs.mkdirSync(metricsDir, { recursive: true });

      const result = await taskCreatedLogger(createMockInput());

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
    });

    it('should produce valid JSON when stringified', async () => {
      const result = await taskCreatedLogger(createMockInput());

      expect(() => JSON.stringify(result)).not.toThrow();
    });
  });
});
