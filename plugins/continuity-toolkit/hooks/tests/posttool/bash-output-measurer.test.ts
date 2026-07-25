/**
 * Integration tests for the PostToolUse `bash-output-measurer` hook.
 *
 * The hook is pure measurement — always returns silent success and never
 * alters bash behavior. Tests verify:
 *
 *   - It writes to the per-session JSONL when invoked on a Bash tool call
 *   - It is a no-op for non-Bash tools (silently skipped via guards)
 *   - It is robust to missing fields (no command, no output, no session)
 *
 * Each test runs against an isolated `TOKEN_COMPRESS_CACHE_DIR`.
 *
 * @module tests/posttool/bash-output-measurer
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bashOutputMeasurerHook } from '../../src/posttool/bash-output-measurer.js';
import type { HookInput } from '../../src/types.js';

const SESSION_ID = 'test-bash-measurer';

let tempRoot: string;
let jsonlPath: string;

interface BashHookInput extends HookInput {
  tool_response?: {
    stdout?: string;
    stderr?: string;
    exit_code?: number;
    output?: string;
  };
  duration_ms?: number;
}

function buildBashInput(
  command: string | undefined,
  output: string,
  duration?: number
): BashHookInput {
  const input: BashHookInput = {
    tool_name: 'Bash',
    session_id: SESSION_ID,
    tool_input: command !== undefined ? { command } : {},
    tool_response: { stdout: output, exit_code: 0 },
  };
  if (duration !== undefined) input.duration_ms = duration;
  return input;
}

function readMeasurements(): unknown[] {
  if (!fs.existsSync(jsonlPath)) return [];
  return fs
    .readFileSync(jsonlPath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-measurer-'));
  jsonlPath = path.join(tempRoot, SESSION_ID, 'measurements.jsonl');
  process.env['TOKEN_COMPRESS_CACHE_DIR'] = tempRoot;
  process.env['CLAUDE_SESSION_ID'] = SESSION_ID;
});

afterEach(() => {
  delete process.env['TOKEN_COMPRESS_CACHE_DIR'];
  delete process.env['CLAUDE_SESSION_ID'];
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

describe('bash-output-measurer hook', () => {
  it('records a bash event with command prefix only', async () => {
    const result = await bashOutputMeasurerHook(
      buildBashInput('git status', 'On branch main\nnothing to commit\n')
    );
    expect(result.continue).toBe(true);
    expect(result.suppressOutput).toBe(true);

    const events = readMeasurements();
    expect(events).toHaveLength(1);
    const event = events[0] as Record<string, unknown>;
    expect(event['tool']).toBe('Bash');
    expect(event['commandPrefix']).toBe('git');
    expect(event['redacted']).toBe(false);
  });

  it('records duration_ms when provided', async () => {
    await bashOutputMeasurerHook(buildBashInput('pytest', 'PASSED\n', 1500));
    const events = readMeasurements();
    expect(events).toHaveLength(1);
    expect((events[0] as Record<string, unknown>)['durationMs']).toBe(1500);
  });

  it('redacts when output contains a credential', async () => {
    await bashOutputMeasurerHook(
      buildBashInput('env', 'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY\n')
    );
    const events = readMeasurements();
    expect(events).toHaveLength(1);
    const event = events[0] as Record<string, unknown>;
    expect(event['redacted']).toBe(true);
    expect(event['outputBytes']).toBeNull();
  });

  it('is a no-op for non-Bash tools', async () => {
    const input: HookInput = {
      tool_name: 'Read',
      session_id: SESSION_ID,
      tool_input: { file_path: '/tmp/x.txt' },
    };
    const result = await bashOutputMeasurerHook(input);
    expect(result.continue).toBe(true);
    expect(readMeasurements()).toHaveLength(0);
  });

  it('returns silent success when command is missing', async () => {
    const result = await bashOutputMeasurerHook(buildBashInput(undefined, ''));
    expect(result.continue).toBe(true);
    // No command → nothing recorded
    expect(readMeasurements()).toHaveLength(0);
  });

  it('returns silent success when session is "unknown"', async () => {
    const input: BashHookInput = {
      tool_name: 'Bash',
      session_id: 'unknown',
      tool_input: { command: 'git status' },
      tool_response: { stdout: 'clean\n', exit_code: 0 },
    };
    const result = await bashOutputMeasurerHook(input);
    expect(result.continue).toBe(true);
    // unknown session id → nothing persisted
    expect(readMeasurements()).toHaveLength(0);
  });

  it('handles empty output', async () => {
    const result = await bashOutputMeasurerHook(buildBashInput('true', ''));
    expect(result.continue).toBe(true);
    const events = readMeasurements();
    expect(events).toHaveLength(1);
    expect((events[0] as Record<string, unknown>)['outputBytes']).toBe(0);
  });

  it('concatenates stdout + stderr in size measurement', async () => {
    const input: BashHookInput = {
      tool_name: 'Bash',
      session_id: SESSION_ID,
      tool_input: { command: 'cat /nonexistent' },
      tool_response: { stdout: '', stderr: 'cat: /nonexistent: No such file\n', exit_code: 1 },
    };
    await bashOutputMeasurerHook(input);
    const events = readMeasurements();
    expect(events).toHaveLength(1);
    const event = events[0] as Record<string, unknown>;
    expect(event['outputBytes']).toBeGreaterThan(0);
  });
});
