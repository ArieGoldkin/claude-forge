/**
 * End-to-end payload tests for the PostToolUse / PostToolUseFailure handlers.
 *
 * WHY A SEPARATE FILE
 *
 * Every other test for these handlers constructs a `HookInput` object by hand
 * with the payload field already attached. That shape NEVER occurs at runtime:
 * real input arrives as raw JSON on stdin and passes through `parseHookInput`,
 * whose `normalizeInput` step rebuilds the object from an allowlist and drops
 * anything not on it.
 *
 * That gap is why four handlers shipped inert while 2,075 tests stayed green:
 *   - secret-detector, error-warner, bash-output-measurer read `tool_output`,
 *     a key Claude Code sends on no event at all
 *   - failure-logger read `error` / `is_interrupt`, which are real fields that
 *     the allowlist deleted
 *
 * These tests drive the RAW payload through the real parse path, so a handler
 * that reads a stripped or misnamed field fails here instead of silently
 * degrading to a default.
 *
 * Payloads below are captured verbatim from Claude Code 2.1.220 (2026-07-25).
 *
 * @module tests/posttool/posttool-payload-e2e
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseHookInput } from '../../src/lib/input.js';
import { errorWarner } from '../../src/posttool/error-warner.js';
import { failureLogger } from '../../src/posttool/failure-logger.js';
import { secretDetector } from '../../src/posttool/secret-detector.js';

/** Real PostToolUse payload shape (Bash), captured live. */
function postToolUsePayload(stdout: string, command = 'echo hi', stderr = ''): string {
  return JSON.stringify({
    session_id: 'e2e-session',
    transcript_path: '/tmp/t.jsonl',
    cwd: '/repo',
    permission_mode: 'auto',
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_input: { command },
    tool_response: {
      stdout,
      stderr,
      interrupted: false,
      isImage: false,
      noOutputExpected: false,
    },
    tool_use_id: 'tu_e2e',
    duration_ms: 12,
  });
}

/** Real PostToolUseFailure payload shape, captured live. */
function postToolUseFailurePayload(error: string, command = 'nope'): string {
  return JSON.stringify({
    session_id: 'e2e-session',
    transcript_path: '/tmp/t.jsonl',
    cwd: '/repo',
    permission_mode: 'auto',
    hook_event_name: 'PostToolUseFailure',
    tool_name: 'Bash',
    tool_input: { command },
    error,
    is_interrupt: false,
    tool_use_id: 'tu_e2e',
    duration_ms: 9,
  });
}

describe('PostToolUse payload survives parseHookInput (2.9.0 regression)', () => {
  it('preserves tool_response through normalization', () => {
    const input = parseHookInput(postToolUsePayload('hello')) as Record<string, unknown>;

    expect(input['tool_response']).toBeDefined();
    expect((input['tool_response'] as { stdout: string }).stdout).toBe('hello');
  });

  it('secret-detector warns on a leaked key reaching it through the real parse path', async () => {
    // NOT the canonical AWS doc key (AKIA…EXAMPLE) — that one is deliberately
    // allowlisted so documentation snippets don't trip the detector.
    const leaked = `AKIA${'IOSFODNN7QWERTY0'}`;
    const result = await secretDetector(parseHookInput(postToolUsePayload(leaked)));

    // Before 2.9.0 the handler read `tool_output`, which no event sends, so it
    // returned a bare silent success for every input including this one.
    expect(JSON.stringify(result)).toContain('AWS Access Key ID');
  });

  it('secret-detector output differs between clean and leaked stdout', async () => {
    // The discriminating assertion: an inert handler returns an identical
    // result for both, because it sees neither.
    const clean = await secretDetector(parseHookInput(postToolUsePayload('nothing here')));
    const leaked = await secretDetector(
      parseHookInput(postToolUsePayload(`AKIA${'IOSFODNN7QWERTY0'}`))
    );

    expect(JSON.stringify(leaked)).not.toBe(JSON.stringify(clean));
  });

  it('error-warner consumes tool_response without throwing (see caveat)', async () => {
    // DELIBERATELY NOT asserting that a tip is produced.
    //
    // error-warner has a SECOND, INDEPENDENT defect that this release does not
    // fix: it loads its patterns via loadErrorRules() from
    //   $CLAUDE_PROJECT_DIR/.claude/rules/error_rules.json  (or the plugin dir)
    // and NO such file exists anywhere in this repo or the shipped plugin. With
    // no rules it returns silent success for every input, so it cannot emit a
    // tip regardless of whether the payload reaches it.
    //
    // The existing error-warner.test.ts passes only because it `vi.mock`s
    // error-rules.js — which is why the gap was invisible. Asserting a tip here
    // would require the same mock and would prove nothing end-to-end.
    //
    // What this release DOES fix for this handler is the field name: it now
    // reads `tool_response` (real) instead of `tool_output` (never sent). The
    // rules-file gap is tracked separately.
    const result = await errorWarner(
      parseHookInput(postToolUsePayload('', 'node app.js', "Error: Cannot find module 'lodash'"))
    );

    expect(result.continue).toBe(true);
  });
});

describe('PostToolUseFailure payload survives parseHookInput (2.9.0 regression)', () => {
  const originalEnv = { ...process.env };
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posttool-e2e-'));
    process.env['CLAUDE_PROJECT_DIR'] = tempDir;
    process.env['HOME'] = tempDir;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('preserves error and is_interrupt through normalization', () => {
    const input = parseHookInput(postToolUseFailurePayload('foo: command not found')) as Record<
      string,
      unknown
    >;

    expect(input['error']).toBe('foo: command not found');
    expect(input['is_interrupt']).toBe(false);
  });

  it('failure-logger produces a fix hint instead of returning empty-handed', async () => {
    const result = await failureLogger(
      parseHookInput(postToolUseFailurePayload('bash: foo: command not found'))
    );

    // Before 2.9.0 the allowlist stripped `error`, the handler returned early,
    // and no hint was ever emitted. This is the exact assertion that fails on
    // the pre-fix code.
    const hint = (result as { hookSpecificOutput?: { additionalContext?: string } })
      .hookSpecificOutput?.additionalContext;

    expect(hint).toBeDefined();
    expect(String(hint).length).toBeGreaterThan(0);
  });

  it('still returns cleanly when the payload genuinely carries no error', async () => {
    const noError = JSON.stringify({
      session_id: 'e2e-session',
      hook_event_name: 'PostToolUseFailure',
      tool_name: 'Bash',
      tool_input: { command: 'ok' },
    });

    const result = await failureLogger(parseHookInput(noError));

    expect(result.continue).toBe(true);
  });
});
