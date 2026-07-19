/**
 * Tests for teammate-idle-saver hook
 *
 * Verifies that the TeammateIdle hook:
 * - Updates last_activity in shared-context.json
 * - Records last_agent_idle event (teammate_name + team_name -- the fields CC
 *   actually sends; see the 2.8.4 field-name correction)
 * - Handles missing context file gracefully
 * - Handles corrupted JSON gracefully
 * - Releases lock on success and failure
 *
 * @module tests/lifecycle/teammate-idle-saver
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONTINUITY_DIRS } from '../../src/lib/continuity.js';
import { teammateIdleSaver } from '../../src/lifecycle/teammate-idle-saver.js';
import type { HookInput } from '../../src/types.js';

function createMockInput(teammateName = 'sec-reviewer', teamName = 'session-abc123'): HookInput {
  return {
    tool_name: 'TeammateIdle' as HookInput['tool_name'],
    tool_input: {},
    teammate_name: teammateName,
    team_name: teamName,
  };
}

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'teammate-idle-test-'));
}

function createFullStructure(projectDir: string): void {
  for (const dir of Object.values(CONTINUITY_DIRS)) {
    fs.mkdirSync(path.join(projectDir, dir), { recursive: true });
  }
}

function createContextFile(projectDir: string, overrides: Record<string, unknown> = {}): string {
  const contextFile = path.join(projectDir, CONTINUITY_DIRS.context, 'shared-context.json');
  const defaultContext = {
    version: '1.0.0',
    session_heartbeat: {
      last_activity: '2026-01-01T12:00:00Z',
      session_start: '2026-01-01T10:00:00Z',
      was_cleanly_ended: false,
    },
    dirty_tracking: {
      files_edited_count: 3,
      files_edited_this_session: ['a.ts'],
    },
    ...overrides,
  };
  fs.writeFileSync(contextFile, JSON.stringify(defaultContext, null, 2));
  return contextFile;
}

describe('teammate-idle-saver', () => {
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
    it('should update last_activity timestamp', async () => {
      createFullStructure(tempDir);
      const contextFile = createContextFile(tempDir);

      const before = new Date();
      await teammateIdleSaver(createMockInput());
      const after = new Date();

      const content = JSON.parse(fs.readFileSync(contextFile, 'utf8'));
      const lastActivity = new Date(content.session_heartbeat.last_activity);

      expect(lastActivity.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
      expect(lastActivity.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
    });

    it('should record last_agent_idle event', async () => {
      createFullStructure(tempDir);
      const contextFile = createContextFile(tempDir);

      await teammateIdleSaver(createMockInput('release-reviewer', 'session-xyz789'));

      const content = JSON.parse(fs.readFileSync(contextFile, 'utf8'));
      expect(content.last_agent_idle.teammate_name).toBe('release-reviewer');
      expect(content.last_agent_idle.team_name).toBe('session-xyz789');
      expect(content.last_agent_idle.timestamp).toBeDefined();
      // Guard against reverting to the fields CC never sends for this event.
      expect(content.last_agent_idle).not.toHaveProperty('agent_id');
      expect(content.last_agent_idle).not.toHaveProperty('agent_type');
    });

    it('should preserve other context fields', async () => {
      createFullStructure(tempDir);
      const contextFile = createContextFile(tempDir);

      await teammateIdleSaver(createMockInput());

      const content = JSON.parse(fs.readFileSync(contextFile, 'utf8'));
      expect(content.dirty_tracking.files_edited_count).toBe(3);
      expect(content.version).toBe('1.0.0');
    });
  });

  describe('return value', () => {
    it('should always return silent success', async () => {
      createFullStructure(tempDir);
      createContextFile(tempDir);

      const result = await teammateIdleSaver(createMockInput());

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
    });

    it('should return silent success when context file is missing', async () => {
      createFullStructure(tempDir);

      const result = await teammateIdleSaver(createMockInput());

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
    });

    it('should return silent success on corrupted JSON', async () => {
      createFullStructure(tempDir);
      const contextFile = path.join(tempDir, CONTINUITY_DIRS.context, 'shared-context.json');
      fs.writeFileSync(contextFile, 'invalid json {{{');

      const result = await teammateIdleSaver(createMockInput());

      expect(result.continue).toBe(true);
      expect(result.suppressOutput).toBe(true);
    });
  });

  describe('lock handling', () => {
    it('should release lock after successful operation', async () => {
      createFullStructure(tempDir);
      createContextFile(tempDir);

      await teammateIdleSaver(createMockInput());

      const lockDir = path.join(tempDir, CONTINUITY_DIRS.context, 'shared-context.json.lock');
      expect(fs.existsSync(lockDir)).toBe(false);
    });

    it('should release lock after failure', async () => {
      createFullStructure(tempDir);
      const contextFile = path.join(tempDir, CONTINUITY_DIRS.context, 'shared-context.json');
      fs.writeFileSync(contextFile, 'invalid json');

      await teammateIdleSaver(createMockInput());

      const lockDir = path.join(tempDir, CONTINUITY_DIRS.context, 'shared-context.json.lock');
      expect(fs.existsSync(lockDir)).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle missing teammate_name', async () => {
      createFullStructure(tempDir);
      const contextFile = createContextFile(tempDir);

      await teammateIdleSaver({
        tool_name: 'TeammateIdle' as HookInput['tool_name'],
        tool_input: {},
      });

      const content = JSON.parse(fs.readFileSync(contextFile, 'utf8'));
      expect(content.last_agent_idle.teammate_name).toBe('unknown');
      expect(content.last_agent_idle.team_name).toBe('unknown');
    });

    it('should produce valid JSON when stringified', async () => {
      const result = await teammateIdleSaver(createMockInput());

      expect(() => JSON.stringify(result)).not.toThrow();
    });
  });
});
