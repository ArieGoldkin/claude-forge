/**
 * doctor.md shell-variable invariants.
 *
 * ISSUE #109 — no shell variable in `/ctk:doctor` may be expanded without being bound.
 *
 * Three loops in Steps 2, 3 and 7 iterated `$INSTALLED_PLUGINS` while checking paths built from
 * `$PLUGIN_ROOT` and `$PLUGIN_SHORT_NAME`. All three variables were unassigned, present since the
 * initial commit (f0d2c5f).
 *
 * ⚠ CORRECTED 2026-08-01 (ctk 2.17.4). This header first said "the loops iterated an empty list and
 * printed nothing … a loop over an empty list exits 0". THAT DESCRIBED LITERAL EXECUTION, WHICH
 * DOES NOT HAPPEN. A command body reaches the model as `role=user` prompt text; CC never runs the
 * fenced bash. Measured over 26 unwitnessed sessions: every one composed its own command instead of
 * running the block. See docs/reviews/2026-08-01_command-md-execution-mode.md.
 *
 * WHY THIS STILL NEEDS A TEST RATHER THAN A COMMENT: the blocks are a SPEC, and an unbound variable
 * makes the spec ambiguous — a reader must invent the value before acting. That is not harmless,
 * because literal text from a block demonstrably propagates into the commands a model composes
 * (3 of the 26 sessions embedded a block's literal line, one after editing it). A wrong literal
 * ships into real commands. `/doctor` is a diagnostic, so its dangerous failure direction is the
 * false all-clear, and an ambiguous instruction is invisible in exactly the way a correct one is.
 *
 * ⚠ THE MINIMAL-LOOKING REPAIR IS THE WRONG ONE. `$PLUGIN_ROOT` and `$PLUGIN_SHORT_NAME` never
 * varied with the loop variable `$PLUGIN`, which appeared only inside the `echo`. Assigning
 * `INSTALLED_PLUGINS` alone would therefore check ONE path N times and label that single result
 * with N different plugin names — trading a silent wrong answer for a confident one. The name and
 * the install path must travel together; that is what the Step 2 inventory is for. This test
 * cannot catch that specific regression, so it is stated here: **do not reintroduce a per-plugin
 * loop whose body does not reference the loop variable.**
 *
 * SCOPE: doctor.md and archive-ledger.md. Widening to EVERY command file still needs an
 * `eval`-aware parser (post-mr-comments.md assigns via `eval "$(jq …)"`) and an allowlist for CC's
 * `$ARGUMENTS` placeholder; archive-ledger.md was added because it needs **neither** — it contains
 * no `eval` and no `$ARGUMENTS`, so the existing detector covers it unmodified.
 *
 * ISSUE #110 — archive-ledger.md Step 6 expanded `$ARCHIVE_CONTENT` and `$LEAN_LEDGER`, neither
 * bound anywhere. The asymmetry made it worse than doctor.md's: the *destination* `$LEDGER` was
 * correctly bound to the live `CONTINUITY_*.md`, so the ambiguous instruction pointed at real data.
 * Reclassified from destructive to spec-ambiguity by the same execution-mode measurement above —
 * still a defect, because a reader must invent the value before acting.
 *
 * ⚠ THE VARIABLE DETECTOR STRUCTURALLY CANNOT CATCH THE THIRD #110 DEFECT, so it gets its own test.
 * Step 7 read `"$LEDGER.backup"` while no step created it (the only backup instruction lived in a
 * later Safety section under a *dated* name, `.backup.$(date +%Y%m%d)`). `LEDGER` **is** bound, so
 * every unbound-variable check passes and the file still names a file that never exists — which
 * made `OLD_SIZE` empty and `PERCENT=$((REDUCTION * 100 / OLD_SIZE))` a division by zero.
 * A bound variable plus a wrong suffix is invisible to a name-level parser: see
 * `creates the backup file that Step 7 reads`.
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

/** Same override contract as {@link DOCTOR_PATH}, for the #110 file. */
const ARCHIVE_LEDGER_PATH =
  process.env.ARCHIVE_LEDGER_MD_PATH ??
  path.join(__dirname, '..', '..', 'commands', 'archive-ledger.md');

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

/**
 * Does the spec create `$LEDGER.backup` before Step 7 reads it?
 *
 * Deliberately narrow: it asks only about the one path #110 named, not "every file read is created
 * somewhere", which would need real dataflow. Stated so the next reader does not mistake its pass
 * for general coverage of the read-a-file-nobody-wrote class.
 */
function backupUsage(markdown: string): { reads: boolean; creates: boolean } {
  const src = stripComments(bashBlocks(markdown));
  // read: the bare `.backup` name appears as a redirect source or command operand
  const reads = /<[ \t]*"\$\{?LEDGER\}?\.backup"/.test(src);
  // create: something copies the live ledger onto that exact name
  const creates = /\bcp[ \t]+"\$\{?LEDGER\}?"[ \t]+"\$\{?LEDGER\}?\.backup"/.test(src);
  return { reads, creates };
}

describe('archive-ledger.md shell variables (#110)', () => {
  const read = () => fs.readFileSync(ARCHIVE_LEDGER_PATH, 'utf8');

  it('expands no variable that is never bound', () => {
    expect(unboundIn(read())).toEqual([]);
  });

  it('no longer names the two variables the issue reported', () => {
    // Same resolution doctor.md took for INSTALLED_PLUGINS: removed, not assigned. Multi-KB
    // markdown does not belong in a shell variable, so the spec hands Step 6 draft *files* whose
    // paths are bound. Asserting absence (not boundness) keeps a future re-introduction failing.
    const src = stripComments(bashBlocks(read()));
    expect(src).not.toMatch(/\$\{?ARCHIVE_CONTENT/);
    expect(src).not.toMatch(/\$\{?LEAN_LEDGER/);
    const bound = boundNames(src);
    expect(bound.has('ARCHIVE_DRAFT')).toBe(true);
    expect(bound.has('LEAN_DRAFT')).toBe(true);
  });

  it('creates the backup file that Step 7 reads', () => {
    // The third #110 defect, invisible to every unbound-variable check because LEDGER *is* bound.
    // Reading without creating leaves OLD_SIZE empty, making the PERCENT arithmetic divide by zero.
    const { reads, creates } = backupUsage(read());
    expect(reads).toBe(true);
    expect(creates).toBe(true);
  });

  it('MUST-FAIL CONTROL: the pre-fix Step 6 is reported as broken', () => {
    const preFix = [
      '```bash',
      'LEDGER=$(ls .claude/continuity/ledgers/CONTINUITY_*.md | head -1)',
      '```',
      '```bash',
      'echo "$ARCHIVE_CONTENT" > "$ARCHIVE_FILE"',
      'echo "$LEAN_LEDGER"     > "$LEDGER"',
      '```',
    ].join('\n');
    expect(unboundIn(preFix)).toEqual(['ARCHIVE_CONTENT', 'ARCHIVE_FILE', 'LEAN_LEDGER']);
  });

  it('MUST-FAIL CONTROL: reading a backup nobody creates is caught', () => {
    // Guards the backup check itself. The pre-fix file read `$LEDGER.backup` and created only the
    // differently-named `$LEDGER.backup.$(date +%Y%m%d)`, which must NOT count as creating it.
    const preFix = [
      '```bash',
      'LEDGER=$(ls .claude/continuity/ledgers/CONTINUITY_*.md | head -1)',
      'cp "$LEDGER" "$LEDGER.backup.$(date +%Y%m%d)"',
      'OLD_SIZE=$(wc -l < "$LEDGER.backup")',
      '```',
    ].join('\n');
    expect(backupUsage(preFix)).toEqual({ reads: true, creates: false });
  });
});
