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
 * MUST-FAIL CONTROLS — each mutation applied one at a time and RUN, counts
 * measured not predicted (2026-07-25):
 *   - restore a STRIPPED allowlist (source/model/hook_event_name) -> 5 fail,
 *     every forwarding test; prototype + normalization suites stay green. This
 *     is the control that isolates forwarding.
 *   - restore main's FAITHFUL 21-name allowlist    -> 4 fail, not 5. The
 *     live-capture regression pin passes, because the 8 names it pins were all
 *     on main's allowlist — correctly, since a faithful revert removes nothing.
 *     Recorded because an earlier revision quoted only the 5 and described the
 *     mutation as "restore an allowlist loop", which reads as the faithful
 *     revert and overstates that pin's independent detection power.
 *   - remove the safeJsonParse `__proto__` reviver  -> exactly 1 fails, the
 *     every-depth test. This is now the ONLY prototype gate.
 *   - drop the Array.isArray payload guard          -> exactly 2 fail, both
 *     array cases.
 *   - drop the three normalized-field assignments   -> 6 fail: the normalization
 *     test directly, plus all 5 forwarding tests by cascade — without a string
 *     `tool_name`, isUsableInput rejects and parseHookInput returns the default
 *     input, so nothing is forwarded at all. Read control A, not this one, as
 *     evidence that the forwarding assertions bite.
 *
 * TWO CONTROLS WERE RETIRED, AND WHY THAT MATTERS. An earlier revision claimed
 * "swap the spread for a per-key assignment loop -> exactly 1 fails" and "remove
 * only the Reflect.deleteProperty line -> exactly 1 fails, the same test", and
 * presented "exactly 1" as precision. Adversarial review pointed out it was the
 * opposite: both halves of the defence were gated by ONE assertion, and the
 * suite had one real check wearing three test titles. The other two —
 * global-Object.prototype pollution, and a nested prototype swap — could not
 * fail under ANY mutation, because pollution never occurs and JSON.parse defines
 * rather than assigns. Both are now folded in as extra assertions on tests that
 * do bite. Once the reviver moved the defence to parse time, the spread and the
 * delete became unfalsifiable too; the delete was removed as dead code and the
 * spread is now just how the copy is made.
 *
 * @module tests/lib/input-field-forwarding
 */

import { describe, expect, it } from 'vitest';
import { getField, parseHookInput } from '../../src/lib/input.js';

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
    // Folded in from a separate `leaves the global Object.prototype untouched`
    // test. As its own case it was VACUOUS: global pollution does not occur
    // under the assignment loop either, so no mutation of this file could make
    // it fail. Kept as an assertion — free — but it earns no test title.
    expect(field({}, 'injected')).toBeUndefined();
  });

  it('strips __proto__ at EVERY depth, not just the top level', () => {
    // Adversarial review of #56: the top-level Reflect.deleteProperty left every
    // NESTED object holding an own `__proto__` data property, forwarded by
    // reference from JSON.parse. Not exploitable in-repo today (nothing copies
    // those objects with [[Set]] semantics), but it round-trips through
    // JSON.stringify into any file a hook writes — a loaded object, not a
    // discharged one. The JSON.parse reviver drops the key at all depths.
    const input = parseHookInput(
      '{"tool_name":"Bash",' +
        '"tool_input":{"command":"ls","__proto__":{"injected":"PWNED"}},' +
        '"tool_response":{"stdout":"x","__proto__":{"injected":"PWNED"}},' +
        '"deep":{"a":{"b":{"__proto__":{"injected":"PWNED"}}}}}'
    );

    const owns = (o: unknown) => Object.prototype.hasOwnProperty.call(o, '__proto__');
    const deep = field(input, 'deep') as { a: { b: object } };

    expect(owns(input)).toBe(false);
    expect(owns(input.tool_input)).toBe(false);
    expect(owns(input.tool_response)).toBe(false);
    expect(owns(deep.a.b)).toBe(false);

    // The poisoned key must not survive serialization into a file a hook writes.
    expect(JSON.stringify(input.tool_input)).toBe('{"command":"ls"}');

    // …and the legitimate sibling data is untouched.
    expect(input.tool_input.command).toBe('ls');
    expect(input.tool_response?.stdout).toBe('x');

    // Folded in from a separate `does not swap the prototype of a nested
    // tool_input` test, which was VACUOUS on its own: JSON.parse DEFINES rather
    // than assigns, so a nested prototype was never at risk under any mutation
    // of this file. It asserted the one nested property that could not break
    // and skipped the one that did.
    expect(Object.getPrototypeOf(input.tool_input)).toBe(Object.prototype);
  });
});

describe('normalizeInput rejects payloads that are not objects', () => {
  it('treats a JSON array as malformed rather than spreading it into keys', () => {
    // `typeof [] === 'object'`, so an array used to pass the guard and spread
    // into {"0":…,"1":…} — a "valid" HookInput built from junk, with one own
    // property per element. Found by adversarial review of #56.
    const input = parseHookInput('[1,2,3]');

    expect(field(input, '0')).toBeUndefined();
    expect(input.tool_name).toBe('');
    expect(input.tool_input).toEqual({});
  });

  it('does not amplify a large array into that many own properties', () => {
    const big = JSON.stringify(Array.from({ length: 5000 }, (_, i) => i));

    expect(Object.keys(parseHookInput(big))).toEqual(['tool_name', 'session_id', 'tool_input']);
  });

  it('coerces an array tool_input to an empty object', () => {
    const input = parseHookInput('{"tool_name":"Bash","tool_input":["command","ls"]}');

    expect(Array.isArray(input.tool_input)).toBe(false);
    expect(input.tool_input).toEqual({});
  });
});

describe('no hook re-declares HookInput locally', () => {
  // WHY THIS SURVIVED THE OLD GUARD'S DELETION.
  //
  // Adversarial review of #56 showed the deleted structural guard did something
  // this file's other tests do NOT: it cross-checked handler-declared field
  // names against an allowlist curated from live captures, making it a de-facto
  // SPELL-CHECK. The 2.9.0 defect — three handlers reading `tool_output`, a key
  // Claude Code sends on no event — was exactly that class. Forwarding does not
  // fix it: `tool_output` is now forwarded happily and the handler is still
  // inert. "The denylist makes this structurally impossible" was wrong.
  //
  // What changed instead: this release deleted every local
  // `interface X extends HookInput`, so handlers read `input.foo` directly
  // against the shared type, and `HookInput` has no index signature. A typo is
  // now a COMPILE ERROR — verified: reading `input.tool_output` in a handler
  // gives `TS2339: Property 'tool_output' does not exist on type 'HookInput'`.
  // That is stricter than the old guard, which only ever warned.
  //
  // The one path tsc cannot see is a future author re-introducing a local
  // declaration, which is precisely how all seven historical instances were
  // written. So the rule is simply: don't. Add the field to `HookInput` in
  // types.ts — where it sits next to the capture that justifies it — and the
  // compiler does the rest.
  //
  // MUST-FAIL CONTROL: adding `interface Probe extends HookInput { x?: string }`
  // to a hook source fails this test (verified 2026-07-25).
  const DECL = /(?:interface\s+\w+\s+extends\s+[^{]*\bHookInput\b|type\s+\w+\s*=\s*[^;]*\bHookInput\b\s*&)/;

  it('has no local HookInput extension in any hook source', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');

    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const repo = path.resolve(here, '../../../..');
    const roots = [
      path.join(repo, 'shared/hooks-infra/src/hooks'),
      ...['continuity', 'devops', 'ai', 'frontend', 'engineering'].map((p) =>
        path.join(repo, `plugins/${p}-toolkit/hooks/src`)
      ),
    ];

    const walk = (dir: string): string[] => {
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        if (e.name === 'node_modules' || e.name === 'dist') return [];
        const full = path.join(dir, e.name);
        let isDir = e.isDirectory();
        if (e.isSymbolicLink()) {
          try {
            isDir = fs.statSync(full).isDirectory();
          } catch {
            return [];
          }
        }
        return isDir ? walk(full) : e.name.endsWith('.ts') ? [full] : [];
      });
    };

    const seen = new Set<string>();
    const violations: string[] = [];
    for (const root of roots) {
      for (const file of walk(root)) {
        const real = fs.realpathSync(file);
        if (seen.has(real)) continue;
        seen.add(real);
        // Strip comments first. Several files — including this rule's own
        // rationale in lib/input.ts and types.ts — quote the forbidden syntax
        // while explaining why it is forbidden. Matching prose would make the
        // guard fire on its own documentation, which is how the first run of
        // this test failed.
        const src = fs
          .readFileSync(file, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\/\/.*$/gm, '');
        if (DECL.test(src)) {
          violations.push(path.relative(repo, file));
        }
      }
    }

    // Sanity: the harness must actually be reading files, or this passes vacuously.
    expect(seen.size).toBeGreaterThan(20);
    expect(violations).toEqual([]);
  });
});

describe('getField reads own properties only', () => {
  it('does not resolve Object.prototype members as tool_input fields', () => {
    // `if (getField(input, name))` was true for any inherited member even when
    // tool_input was empty. Found by adversarial review of #56.
    const input = parseHookInput('{"tool_name":"Bash","tool_input":{}}');

    for (const name of ['constructor', 'hasOwnProperty', 'toString', 'valueOf']) {
      expect(getField(input, name), `'${name}' must not resolve`).toBeUndefined();
    }
  });

  it('still reads a real field the payload did send', () => {
    const input = parseHookInput('{"tool_name":"Bash","tool_input":{"command":"ls"}}');

    expect(getField(input, 'command')).toBe('ls');
  });
});
