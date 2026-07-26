/**
 * Tests for the phi-output-redactor MessageDisplay hook.
 *
 * WHY THESE DRIVE RAW JSON
 *
 * Every test in this file used to build a `HookInput` by hand and set a
 * top-level `message` field. That shape does not exist. A live capture of CC
 * 2.1.220 (2026-07-25, 41 records) shows the MessageDisplay payload is exactly:
 *
 *   session_id, transcript_path, cwd, prompt_id, hook_event_name,
 *   turn_id, message_id, index, final, delta
 *
 * One key set across all 41 records. `message`, `text`, `assistant_message`,
 * `last_assistant_message` and `tool_input` appear in 0 of them. The handler read four of those names,
 * so it was inert on every message it ever saw — and this suite was green the
 * whole time, because a hand-built input can assert any shape you like.
 *
 * So these tests go through `parseHookInput` from the raw JSON string, the same
 * pattern posttool-payload-e2e.test.ts adopted in 2.9.0. A hand-built input
 * proves the function works on data Claude Code does not send.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseHookInput } from '../../src/lib/input.js';
import {
  extractAssistantMessage,
  phiOutputRedactor,
} from '../../src/messagedisplay/phi-output-redactor.js';
import type { HookInput } from '../../src/types.js';

const OPT_IN_ENV_VAR = 'CONTINUITY_PHI_OUTPUT_REDACT';

/**
 * A verbatim MessageDisplay record from the capture, with only `delta` varied.
 * Field names, ordering and the index/final values are exactly as captured.
 */
function capturedPayload(delta: string): string {
  return JSON.stringify({
    session_id: 'efc54e3d-827f-4a8e-aa81-d50e49a5ce5c',
    transcript_path: '/Users/dev/.claude/projects/-Users-dev-proj/efc54e3d.jsonl',
    cwd: '/Users/dev/proj',
    prompt_id: '5bd851fd-a52e-4a42-95ed-87d3e2e6a89c',
    hook_event_name: 'MessageDisplay',
    turn_id: 'ff38951d-2f5a-47bc-9265-577943dd9039',
    message_id: 'bd41ec77-7674-4177-8ea2-12b1f33770a8',
    index: 0,
    final: true,
    delta,
  });
}

/** Parse a captured MessageDisplay payload the way the hook runner does. */
function fromCapture(delta: string): HookInput {
  return parseHookInput(capturedPayload(delta));
}

/**
 * One chunk of a multi-chunk message. CC emits one event per markdown block:
 * at 41 captured records `index` runs 0-9, `final` takes both values, and every
 * non-final chunk ends in a blank line.
 */
function chunk(delta: string, pos: { index: number; final: boolean }): HookInput {
  const base = JSON.parse(capturedPayload(delta)) as Record<string, unknown>;
  base['index'] = pos.index;
  base['final'] = pos.final;
  return parseHookInput(JSON.stringify(base));
}

describe('extractAssistantMessage', () => {
  it('reads `delta` from a real captured MessageDisplay payload', () => {
    expect(extractAssistantMessage(fromCapture('hello world'))).toBe('hello world');
  });

  it('survives normalization end-to-end, not just as a hand-built object', () => {
    // The regression that mattered: before #54 the allowlist stripped unknown
    // top-level fields, so even the right field name would have arrived empty.
    const input = fromCapture('hello world');
    expect(input.delta).toBe('hello world');
    expect(input.tool_name).toBe('MessageDisplay');
  });

  it('returns null when delta is absent', () => {
    const input = parseHookInput(JSON.stringify({ hook_event_name: 'MessageDisplay' }));
    expect(extractAssistantMessage(input)).toBeNull();
  });

  it('returns null on empty delta', () => {
    expect(extractAssistantMessage(fromCapture(''))).toBeNull();
  });

  it('does NOT read the four names that were guessed and never sent', () => {
    // Pins the narrowing. These were candidates 1-4 of a 5-candidate fallback
    // chosen because "docs are sparse on exact field naming"; all four are
    // absent from every captured record. If a future CC really does send one,
    // capture it first — do not restore it on the strength of its plausibility.
    for (const name of ['message', 'text', 'assistant_message', 'last_assistant_message']) {
      const input = parseHookInput(
        JSON.stringify({ hook_event_name: 'MessageDisplay', [name]: 'should not be read' })
      );
      // The field itself now survives normalization (that is #54's fix) …
      expect((input as unknown as Record<string, unknown>)[name]).toBe('should not be read');
      // … the handler simply does not treat it as the message text.
      expect(extractAssistantMessage(input), `'${name}' must not be read`).toBeNull();
    }
  });
});

describe('phiOutputRedactor', () => {
  beforeEach(() => {
    delete process.env[OPT_IN_ENV_VAR];
  });
  afterEach(() => {
    delete process.env[OPT_IN_ENV_VAR];
  });

  describe('opt-in gating', () => {
    it('returns silent success when env var is unset', async () => {
      const result = await phiOutputRedactor(fromCapture('SSN 123-45-6789 here.'));
      expect(result.hookSpecificOutput).toBeUndefined();
      expect(result.continue).toBe(true);
    });

    it('returns silent success when env var is set to "0"', async () => {
      process.env[OPT_IN_ENV_VAR] = '0';
      const result = await phiOutputRedactor(fromCapture('SSN 123-45-6789 here.'));
      expect(result.hookSpecificOutput).toBeUndefined();
    });

    it('activates when env var is exactly "1"', async () => {
      process.env[OPT_IN_ENV_VAR] = '1';
      const result = await phiOutputRedactor(fromCapture('SSN 123-45-6789 here.'));
      expect(result.hookSpecificOutput?.hookEventName).toBe('MessageDisplay');
    });

    it('does NOT activate on truthy-ish values other than "1"', async () => {
      process.env[OPT_IN_ENV_VAR] = 'true';
      const result = await phiOutputRedactor(fromCapture('SSN 123-45-6789 here.'));
      expect(result.hookSpecificOutput).toBeUndefined();
    });
  });

  describe('redaction behavior (env on)', () => {
    beforeEach(() => {
      process.env[OPT_IN_ENV_VAR] = '1';
    });

    it('redacts a single SSN and returns displayContent', async () => {
      const result = await phiOutputRedactor(fromCapture('Patient SSN 123-45-6789 admitted.'));
      expect(result.hookSpecificOutput?.['displayContent']).toBe(
        'Patient SSN [SSN-REDACTED] admitted.'
      );
    });

    it('returns silent success when nothing matches (no transform needed)', async () => {
      const result = await phiOutputRedactor(fromCapture('All clear, no sensitive data.'));
      expect(result.hookSpecificOutput).toBeUndefined();
    });

    it('returns silent success when no message text is present', async () => {
      const input = parseHookInput(JSON.stringify({ hook_event_name: 'MessageDisplay' }));
      const result = await phiOutputRedactor(input);
      expect(result.hookSpecificOutput).toBeUndefined();
    });

    it('redacts mixed PHI patterns', async () => {
      const result = await phiOutputRedactor(
        fromCapture('Patient 123-45-6789 reached at (555) 123-4567 via card 4111-1111-1111-1111.')
      );
      const out = result.hookSpecificOutput?.['displayContent'] as string;
      expect(out).toContain('[SSN-REDACTED]');
      expect(out).toContain('[PHONE-REDACTED]');
      expect(out).toContain('[CC-REDACTED]');
    });

    it('redacts every chunk of a real multi-chunk message independently', async () => {
      // Chunking is routine, not hypothetical: CC emits one event per markdown
      // block, so a multi-paragraph message reaches this hook as N invocations
      // with no state between them. Each chunk must redact on its own.
      const chunks = [
        chunk('Patient SSN 123-45-6789 was admitted.\n\n', { index: 0, final: false }),
        chunk('Reachable at (555) 123-4567.\n\n', { index: 1, final: false }),
        chunk('Card on file 4111-1111-1111-1111.', { index: 2, final: true }),
      ];

      const results = await Promise.all(chunks.map((c) => phiOutputRedactor(c)));
      const transformed = results.map((r) => r.hookSpecificOutput?.['displayContent']);

      expect(transformed[0]).toContain('[SSN-REDACTED]');
      expect(transformed[1]).toContain('[PHONE-REDACTED]');
      expect(transformed[2]).toContain('[CC-REDACTED]');
      // Notably NOT best-effort: CC splits on `\n\n` and no pattern in
      // phi-redactor can contain a blank line, so no PHI token straddles a
      // boundary and every chunk is scanned whole.
      for (const t of transformed) {
        expect(t).not.toMatch(/\d{3}-\d{2}-\d{4}|\d{4}-\d{4}-\d{4}-\d{4}/);
      }
    });
  });
});
