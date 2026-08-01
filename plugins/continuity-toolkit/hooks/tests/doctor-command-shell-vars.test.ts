/**
 * doctor.md shell-variable invariants.
 *
 * ISSUE #109 — no shell variable in `/ctk:doctor` may be expanded without being bound.
 *
 * Three loops in Steps 2, 3 and 7 iterated `$INSTALLED_PLUGINS` while checking paths built from
 * `$PLUGIN_ROOT` and `$PLUGIN_SHORT_NAME`. All three variables were unassigned, present since the
 * initial commit (f0d2c5f). The loops iterated an empty list and printed nothing.
 *
 * WHY THIS NEEDED A TEST RATHER THAN A COMMENT: a loop over an empty list exits 0 and emits no
 * output, which is indistinguishable from "checked, nothing to report". `/doctor` is a diagnostic,
 * so its dangerous failure direction is the false all-clear — the defect is invisible in exactly
 * the way a passing run is.
 *
 * ⚠ THE MINIMAL-LOOKING REPAIR IS THE WRONG ONE. `$PLUGIN_ROOT` and `$PLUGIN_SHORT_NAME` never
 * varied with the loop variable `$PLUGIN`, which appeared only inside the `echo`. Assigning
 * `INSTALLED_PLUGINS` alone would therefore check ONE path N times and label that single result
 * with N different plugin names — trading a silent wrong answer for a confident one. The name and
 * the install path must travel together; that is what the Step 2 inventory is for. This test
 * cannot catch that specific regression, so it is stated here: **do not reintroduce a per-plugin
 * loop whose body does not reference the loop variable.**
 *
 * SCOPE: doctor.md only. Widening to every command file needs an `eval`-aware parser (post-mr-
 * comments.md assigns via `eval "$(jq …)"`) and an allowlist for CC's `$ARGUMENTS` placeholder.
 * A separate dead-variable defect in archive-ledger.md was found by the same probe and filed
 * separately rather than folded in here.
 *
 * @module tests/doctor-command-shell-vars
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Overridable so the detector can be pointed at an arbitrary revision of the file — used to run
 * the must-fail control against the real pre-fix content extracted with `git cat-file blob`,
 * rather than only against a paraphrase of it.
 */
const DOCTOR_PATH =
  process.env.DOCTOR_MD_PATH ?? path.join(__dirname, '..', '..', 'commands', 'doctor.md');

/**
 * Variables supplied by the environment rather than by the file. `CLAUDE_*` are set by Claude Code
 * for plugin execution; the rest are POSIX shell standards.
 */
const ENV_PROVIDED = new Set([
  'HOME',
  'PATH',
  'PWD',
  'SHELL',
  'TMPDIR',
  'USER',
  'CLAUDE_CONFIG_DIR',
  'CLAUDE_PLUGIN_DATA',
  'CLAUDE_PLUGIN_NAME',
  'CLAUDE_PLUGIN_ROOT',
  'CLAUDE_PROJECT_DIR',
  'CLAUDE_SESSION_ID',
]);

/** Concatenate every ```bash / ```sh fenced block. Prose mentioning `$FOO` is not an expansion. */
function bashBlocks(markdown: string): string {
  return [...markdown.matchAll(/```(?:bash|sh)\n([\s\S]*?)```/g)].map((m) => m[1]).join('\n');
}

/**
 * Strip `#` comments. A variable named in a comment is documentation, not an expansion — the fixed
 * doctor.md explains `$PLUGIN_SHORT_NAME` in a comment precisely because it was removed from code.
 * Only strips `#` at line start or after whitespace, so `${FOO:-#x}` style values survive.
 */
function stripComments(src: string): string {
  return src.replace(/(^|\s)#.*$/gm, '$1');
}

/** Names bound anywhere in the script: assignment, `for` binding, or `read` (which binds many). */
function boundNames(src: string): Set<string> {
  const bound = new Set<string>(ENV_PROVIDED);
  const add = (re: RegExp, pick: (m: RegExpMatchArray) => string[]) => {
    for (const m of src.matchAll(re)) for (const n of pick(m)) if (n) bound.add(n);
  };

  // NAME=…, export NAME=…, NAME+=…, NAME[i]=…
  add(/^[ \t]*(?:export[ \t]+|local[ \t]+)?([A-Za-z_]\w*)(?:\[[^\]]*\])?\+?=/gm, (m) => [m[1]]);
  // for NAME in …
  add(/\bfor[ \t]+([A-Za-z_]\w*)[ \t]+in\b/g, (m) => [m[1]]);
  // read [-r] [-a] A B C … — binds EVERY name, which a single-capture regex misses.
  add(/\bread[ \t]+((?:-\w+[ \t]+)*)([A-Za-z_]\w*(?:[ \t]+[A-Za-z_]\w*)*)/g, (m) =>
    m[2].split(/[ \t]+/)
  );

  return bound;
}

/** Every `$NAME` / `${NAME…}` expansion. Skips `$1`, `$?`, `$@` and other non-identifiers. */
function expandedNames(src: string): string[] {
  return [...src.matchAll(/\$\{?([A-Za-z_]\w*)/g)].map((m) => m[1]);
}

function unboundIn(markdown: string): string[] {
  const src = stripComments(bashBlocks(markdown));
  const bound = boundNames(src);
  return [...new Set(expandedNames(src).filter((n) => !bound.has(n)))].sort();
}

describe('doctor.md shell variables (#109)', () => {
  it('expands no variable that is never bound', () => {
    expect(unboundIn(fs.readFileSync(DOCTOR_PATH, 'utf8'))).toEqual([]);
  });

  it('still binds the three variables the issue named', () => {
    const src = stripComments(bashBlocks(fs.readFileSync(DOCTOR_PATH, 'utf8')));
    const bound = boundNames(src);
    // PLUGIN_ROOT and MARKET are bound by the multi-name `read`; INSTALLED_PLUGINS is gone
    // entirely, replaced by the inventory file.
    expect(bound.has('PLUGIN_ROOT')).toBe(true);
    expect(bound.has('MARKET')).toBe(true);
    expect(src).not.toMatch(/\$\{?INSTALLED_PLUGINS/);
    expect(src).not.toMatch(/\$\{?PLUGIN_SHORT_NAME/);
  });

  it('MUST-FAIL CONTROL: the pre-fix file is reported as broken', () => {
    // Guards the detector itself. If this ever passes, the check has stopped checking — which is
    // the same class of silent no-op that #109 was.
    const preFix = [
      '```bash',
      'for PLUGIN in $INSTALLED_PLUGINS; do',
      '  DIST="$PLUGIN_ROOT/hooks/dist/bin/run-hook.js"',
      '  LOG="$HOME/.claude/logs/$PLUGIN_SHORT_NAME/hooks.log"',
      '  echo "$PLUGIN $DIST $LOG"',
      'done',
      '```',
    ].join('\n');
    expect(unboundIn(preFix)).toEqual(['INSTALLED_PLUGINS', 'PLUGIN_ROOT', 'PLUGIN_SHORT_NAME']);
  });

  it('MUST-FAIL CONTROL: a comment-only mention is not treated as an expansion', () => {
    // The inverse control. Without comment stripping the fixed file fails on its own docs.
    const commentOnly = [
      '```bash',
      '# this is what $PLUGIN_SHORT_NAME reached for',
      'echo ok',
      '```',
    ].join('\n');
    expect(unboundIn(commentOnly)).toEqual([]);
  });
});
