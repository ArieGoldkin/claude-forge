/**
 * Behavioural guard for normalizeInput field forwarding.
 *
 * WHAT REPLACED WHAT
 *
 * This file used to be `passthrough-completeness.test.ts`: a text-level parser
 * that read the `passThrough` allowlist out of lib/input.ts, read every
 * `interface X extends HookInput { … }` out of the hook sources, and failed when
 * a handler declared a field the allowlist did not carry.
 *
 * That guard was a net, not a proof, and the review of #53 defeated it with six
 * ordinary syntaxes — a type alias, a second base type, an indirect base, an
 * inline cast, bracket access, destructuring. The last three need no declaration
 * at all and are the natural way to reach a field `HookInput` does not declare,
 * so they were the LIKELY shape of the next instance, not an exotic one.
 *
 * The allowlist is gone (#54). normalizeInput now forwards every top-level field
 * Claude Code sends and scrubs only `__proto__`. A handler can no longer be
 * inert because normalization deleted its field, whatever syntax it uses to read
 * it — so a syntax parser has nothing left to check.
 *
 * These tests therefore assert BEHAVIOUR through the public `parseHookInput`
 * entry point rather than source text:
 *
 *   1. an undeclared field survives            (the class fix itself)
 *   2. every live-captured field survives      (regression pin, was a source grep)
 *   3. the three HookInput fields that the allowlist never carried survive
 *   4. normalization still wins over the raw payload
 *   5. a `__proto__` payload cannot inject fields via the prototype chain
 *
 * MUST-FAIL CONTROLS — each mutation applied and RUN, counts measured not
 * predicted (2026-07-25):
 *   - restore an allowlist loop in normalizeInput   -> 5 fail (every forwarding
 *     test), prototype + normalization suites stay green. This is the control
 *     that isolates forwarding.
 *   - swap the spread for a per-key assignment loop -> exactly 1 fails, the
 *     prototype-chain injection test. Nothing else moves.
 *   - remove ONLY the Reflect.deleteProperty line        -> exactly 1 fails, the
 *     same test. Run separately from the control above so each half of the
 *     prototype defence is isolated: with only one mutation applied at a time,
 *     neither gate can be masked by the other.
 *   - drop the three normalized-field assignments   -> 6 fail: the normalization
 *     test directly, plus all 5 forwarding tests by cascade — without a string
 *     `tool_name`, isUsableInput rejects and parseHookInput returns the default
 *     input, so nothing is forwarded at all. Read control A, not this one, as
 *     evidence that the forwarding assertions bite.
 *
 * @module tests/lib/input-field-forwarding
 */

import { describe, expect, it } from 'vitest';
import { parseHookInput } from '../../src/lib/input.js';

/** Read a field that `HookInput` does not declare, the way a handler would. */
function field(input: unknown, name: string): unknown {
  return (input as Record<string, unknown>)[name];
}

describe('normalizeInput forwards unknown top-level fields', () => {
  it('carries a field no type declares and no allowlist names', () => {
    // The class fix. Before #54 this returned undefined, and a handler reading
    // it degraded to a plausible default rather than erroring.
    const input = parseHookInput(
      JSON.stringify({
        hook_event_name: 'SomeFutureEvent',
        a_field_invented_for_this_test: 'survived',
      })
    );

    expect(field(input, 'a_field_invented_for_this_test')).toBe('survived');
  });

  it('carries fields of every JSON type, not just strings', () => {
    const input = parseHookInput(
      JSON.stringify({
        hook_event_name: 'Stop',
        a_number: 42,
        a_bool: false,
        a_null: null,
        an_array: [1, 2],
        an_object: { nested: true },
      })
    );

    expect(field(input, 'a_number')).toBe(42);
    // `false` and `null` specifically: a truthiness-gated forward would drop
    // both, which is how the old code preserved hook_event_name.
    expect(field(input, 'a_bool')).toBe(false);
    expect(field(input, 'a_null')).toBeNull();
    expect(field(input, 'an_array')).toEqual([1, 2]);
    expect(field(input, 'an_object')).toEqual({ nested: true });
  });

  it('carries every field confirmed against a live CC 2.1.220 payload', () => {
    // Regression pin, previously asserted by grepping the allowlist source.
    // Now end-to-end: these are the names that cost 2.8.4 / 2.8.5 / 2.9.0.
    const raw = {
      hook_event_name: 'PostToolUse',
      // TeammateIdle / Task* (captured 2026-07-25, ctk 2.8.5)
      teammate_name: 'sec-reviewer',
      team_name: 'session-fc573d34',
      task_id: 'task-1',
      task_subject: 'subject',
      task_description: 'description',
      // PostToolUse / PostToolUseFailure (captured 2026-07-25, ctk 2.9.0)
      tool_response: { stdout: 'out', stderr: '', interrupted: false },
      error: 'boom',
      is_interrupt: false,
    };
    const input = parseHookInput(JSON.stringify(raw));

    for (const [key, value] of Object.entries(raw)) {
      expect(field(input, key), `'${key}' must survive normalization`).toEqual(value);
    }
  });

  it('carries the HookInput fields the allowlist never named', () => {
    // Item 3 of #54: types.ts declared these and passThrough omitted all three,
    // so a handler following types.ts's own guidance ("Stop hooks observing a
    // non-empty array should NOT deregister session state") got an empty read.
    const input = parseHookInput(
      JSON.stringify({
        hook_event_name: 'Stop',
        effort: { level: 'xhigh' },
        background_tasks: [{ id: 'shell_1', status: 'running' }],
        session_crons: [{ id: 'cron_1', schedule: '0 * * * *' }],
      })
    );

    expect(input.effort).toEqual({ level: 'xhigh' });
    expect(input.background_tasks).toHaveLength(1);
    expect(input.session_crons).toHaveLength(1);
  });

  it('carries the MessageDisplay candidates phi-output-redactor reads', () => {
    // phi-output-redactor reads `message` / `text` / `assistant_message` by
    // bracket access. All three were stripped, reducing a deliberate 5-candidate
    // fallback to 2 on a PHI redaction path. This asserts normalization no longer
    // blocks them; it does NOT assert Claude Code sends any of these names.
    const input = parseHookInput(
      JSON.stringify({ hook_event_name: 'MessageDisplay', message: 'hello' })
    );

    expect(field(input, 'message')).toBe('hello');
  });
});

describe('normalizeInput still normalizes', () => {
  it('keeps tool_name, session_id and tool_input authoritative over the payload', () => {
    // Forwarding must not clobber the normalization the rest of the lib assumes.
    const input = parseHookInput(
      JSON.stringify({ hook_event_name: 'SessionStart', tool_input: 'not-an-object' })
    );

    expect(input.tool_name).toBe('SessionStart');
    expect(input.tool_input).toEqual({});
    expect(typeof input.session_id).toBe('string');
  });

  it('forwards hook_event_name even when tool_name takes priority', () => {
    const input = parseHookInput(
      JSON.stringify({ tool_name: 'Bash', hook_event_name: 'PostToolUse', tool_input: {} })
    );

    expect(input.tool_name).toBe('Bash');
    expect(field(input, 'hook_event_name')).toBe('PostToolUse');
  });
});

describe('normalizeInput prototype safety', () => {
  it('does not let a __proto__ payload inject fields through the prototype chain', () => {
    // Forwarding introduces this vector; the old allowlist was safe only by
    // accident (it never named __proto__). A per-key assignment loop here would
    // invoke Object.prototype's setter and make `input.injected` read 'PWNED'.
    const input = parseHookInput(
      '{"hook_event_name":"Stop","__proto__":{"injected":"PWNED","agent_id":"spoofed"}}'
    );

    expect(field(input, 'injected')).toBeUndefined();
    expect(input.agent_id).toBeUndefined();
    expect(Object.getPrototypeOf(input)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(input, '__proto__')).toBe(false);
  });

  it('leaves the global Object.prototype untouched', () => {
    parseHookInput('{"hook_event_name":"Stop","__proto__":{"globally_injected":"PWNED"}}');

    expect(field({}, 'globally_injected')).toBeUndefined();
  });

  it('does not swap the prototype of a nested tool_input carrying __proto__', () => {
    const input = parseHookInput(
      '{"tool_name":"Bash","tool_input":{"command":"ls","__proto__":{"injected":"PWNED"}}}'
    );

    expect(field(input.tool_input, 'injected')).toBeUndefined();
    expect(Object.getPrototypeOf(input.tool_input)).toBe(Object.prototype);
  });
});
