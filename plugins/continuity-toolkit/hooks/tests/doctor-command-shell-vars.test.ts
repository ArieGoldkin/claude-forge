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
 * ISSUE #127 — SCOPE IS NOW EVERY COMMAND FILE, not the two that had defects found by hand.
 * doctor.md (#109) and archive-ledger.md (#110) were each pinned only *after* someone read the file
 * and found the bug. `listCommandFiles()` now enumerates all of them, so the next
 * `archive-ledger`-shaped defect fails CI instead of waiting for a reader.
 *
 * Widening needed exactly two parser rules, both general — no per-file allowlist:
 *
 * 1. **`eval` binds what its argument assigns.** post-mr-comments.md does
 *    `eval "$(jq -r '… "BASE_SHA=\(.base_sha)…"')"`. The assignment is inside a quoted string, so
 *    the line-anchored assignment rule cannot see it. Note `HEAD_SHA` was *not* flagged — it is
 *    separately bound by a literal assignment in the GitHub branch. That asymmetry is the tell that
 *    the parser was right and only `eval` was opaque to it.
 * 2. **An expansion carrying its own fallback is not unbound.** dashboard.md reads
 *    `${CLAUDE_SESSION_MONITOR_DIR:-$HOME/…}`. The spec states the value to use when the
 *    environment supplies none, so a reader never has to invent one — which is the whole harm this
 *    detector exists to catch. Chosen over adding the knob to {@link ENV_PROVIDED}: an allowlist
 *    needs an entry per plugin knob forever, this needs none.
 *
 * ⚠ **`$ARGUMENTS` IS NOT A BLOCKER, AND #110'S CLAIM THAT IT IS WAS STALE.** Measured: it appears
 * in **0** fenced bash blocks. It *does* appear in **64 of the 81 files** as prose — so a future
 * reader who greps the raw text will "refute" this note and re-add a needless allowlist entry. The
 * detector reads only fenced `bash`/`sh` blocks, and prose is not an expansion.
 *
 * ⚠ **A SWEEP OVER AN EMPTY LIST PASSES.** If `listCommandFiles()` ever returns nothing — a moved
 * directory, a broken walk — every "expands no unbound variable" assertion is vacuously true and
 * CI stays green while covering zero files. `enumerates every command file in the repo` exists to
 * make that failure loud; do not delete it as redundant.
 *
 * KNOWN LIMITS OF THE PARSER, all measured at **0 occurrences** across the 81 files. They are
 * recorded because a silent skip and a clean file are indistinguishable from the outside:
 *
 * - **`${#ARR[@]}` and `${!VAR}`** match neither branch of {@link expandedNames} — the character
 *   after `${` is not `[A-Za-z_]` — so a length or indirect expansion of an unbound name is
 *   skipped rather than flagged.
 * - **A nested `${…}` inside a fallback** is not parsed; `[^}]*` stops at the first `}`.
 * - **The `eval` rule scans to end of line**, so a line that merely *mentions* eval inside a string
 *   (`echo "eval FOO=1"`) would bind `FOO`. The inverse direction — a non-eval line must not bind —
 *   is pinned by a control; this direction is not, because the construct does not occur.
 * - **A bound name with a wrong suffix** (`$LEDGER.backup` where only `$LEDGER` is bound) is
 *   invisible to any name-level parser; that class keeps its own dedicated test below.
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
  // eval binds whatever its argument text assigns (#127). The assignment lives inside a quoted
  // string — `eval "$(jq -r '… "BASE_SHA=\(.base_sha)…"')"` — so the line-anchored rule above is
  // blind to it. Scoped to the eval command deliberately: a bare `NAME=` inside any other quoted
  // string (`echo "FOO=bar"`) must NOT bind, which is what stops this from binding half the repo.
  //
  // ⚠ THE ESCAPE SEQUENCE IS PART OF THE NAME IF YOU LET IT BE. The payload separates assignments
  // with a literal `\n`, and `\w` happily eats the `n`: a first cut of this rule bound
  // `nHEAD_SHA` / `nSTART_SHA` instead of the real names. It looked like it worked, because
  // `HEAD_SHA` is *separately* bound on the GitHub branch — only `START_SHA`, which has no second
  // binding, exposed it. So: normalise `\n` `\r` `\t` to whitespace first, and require a real
  // separator before the name. Pinned by `binds every name in an escape-separated payload`.
  add(/\beval\b[^\n]*/g, (m) =>
    [...m[0].replace(/\\[nrt]/g, ' ').matchAll(/(?:^|[\s;&|("'`])([A-Za-z_]\w*)=/g)].map(
      (x) => x[1] as string
    )
  );

  return bound;
}

/**
 * A braced expansion suffix that supplies its own fallback: `:-` `-` `:=` `=` (#127).
 *
 * Must NOT match the other `${…}` forms, which supply nothing and stay subject to the check:
 * `${VAR:0:12}` (substring, used by post-mr-comments.md), `${VAR#glob}`, `${VAR%glob}`,
 * `${VAR/a/b}`. `${VAR:?msg}` is also excluded — it *errors* when unset rather than providing a
 * value, so the spec still depends on something the file never sets.
 */
const SUPPLIES_FALLBACK = /^:?[-=]/;

/**
 * Every `$NAME` / `${NAME…}` expansion. Skips `$1`, `$?`, `$@` and other non-identifiers.
 *
 * An expansion whose braces carry a fallback is skipped, but **only that occurrence** — the name is
 * deliberately not added to the bound set. A file may read `${VAR:-default}` in one place and bare
 * `$VAR` in another, and the second is still an unbound read. Binding globally would launder it.
 */
function expandedNames(src: string): string[] {
  const names: string[] = [];
  // Braced alternative first so `${VAR:-x}` is inspected as a unit before the bare `$VAR` branch
  // can claim it. `[^}]*` also means a nested `${…}` inside a fallback is not parsed — accepted,
  // and absent from all 81 files.
  for (const m of src.matchAll(/\$\{([A-Za-z_]\w*)([^}]*)\}|\$([A-Za-z_]\w*)/g)) {
    if (m[1] === undefined) {
      names.push(m[3] as string);
      continue;
    }
    if (!SUPPLIES_FALLBACK.test(m[2] as string)) names.push(m[1]);
    // The fallback text can expand variables of its own — `${FOO:-$BAR}` still reads BAR.
    names.push(...expandedNames(m[2] as string));
  }
  return names;
}

function unboundIn(markdown: string): string[] {
  const src = stripComments(bashBlocks(markdown));
  const bound = boundNames(src);
  return [...new Set(expandedNames(src).filter((n) => !bound.has(n)))].sort();
}

/** Repo root, four levels up from `plugins/<name>/hooks/tests/`. */
const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');

/**
 * Every command `.md` in the repo, deduped by REAL path (#127).
 *
 * Dedupe is load-bearing: ctk's `commands/` holds symlinks into `shared/commands/`, so a walk that
 * follows them counts the same file twice and reports a doubled inventory. `realpathSync` collapses
 * them — the same `find … -samefile` discipline the repo uses elsewhere, applied in Node.
 *
 * `tests/fixtures/` is excluded: those are deliberately-malformed inputs for
 * `validate-versions.sh`, not specs anyone follows.
 */
function listCommandFiles(): string[] {
  const found = new Set<string>();
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable directory is not a command file
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        if (full.includes(`${path.sep}tests${path.sep}fixtures`)) continue;
        walk(full);
      } else if (
        entry.name.endsWith('.md') &&
        path.basename(dir) === 'commands' &&
        !full.includes(`${path.sep}tests${path.sep}fixtures`)
      ) {
        try {
          found.add(fs.realpathSync(full));
        } catch {
          /* dangling symlink is not a command file */
        }
      }
    }
  };
  walk(REPO_ROOT);
  return [...found].sort();
}

const rel = (p: string): string => path.relative(REPO_ROOT, p);

describe('every command file expands only bound variables (#127)', () => {
  const files = listCommandFiles();

  it('enumerates every command file in the repo', () => {
    // THE VACUOUS-PASS GUARD. The sweep below asserts "no file is dirty"; over an empty list that
    // is trivially true, so a broken walk would report success while checking nothing. Asserting a
    // floor rather than the exact 81 keeps this from failing every time a command is added, while
    // still catching the collapse-to-zero that actually matters.
    expect(files.length).toBeGreaterThanOrEqual(75);
    // Dedupe works: ctk symlinks 7 of its 12 commands into shared/commands, so a walk that kept
    // the symlink path would count those 7 twice (88, not 81).
    //
    // ⚠ THE OBVIOUS ASSERTION HERE CANNOT FAIL. `expect(new Set(files).size).toBe(files.length)`
    // is true by construction — `listCommandFiles` already returns `[...found]` spread from a Set,
    // so it restates the data structure instead of testing the dedupe. It shipped in the first cut
    // of this PR carrying a comment that claimed it proved dedupe worked; replacing `realpathSync`
    // with the raw path yielded 88 files and all 15 tests still passed.
    //
    // What actually discriminates: `realpathSync` resolves symlinks, so no returned path may be a
    // symlink itself. Drop the resolution and these entries become symlinks, and this fails.
    for (const f of files) expect(fs.lstatSync(f).isSymbolicLink()).toBe(false);
    // The two files that had hand-found defects must be in scope, or the widening missed its point.
    expect(files.some((f) => f.endsWith(`${path.sep}doctor.md`))).toBe(true);
    expect(files.some((f) => f.endsWith(`${path.sep}archive-ledger.md`))).toBe(true);
  });

  it('reports no unbound variable in any command file', () => {
    const offenders = Object.fromEntries(
      files.map((f) => [rel(f), unboundIn(fs.readFileSync(f, 'utf8'))]).filter(([, u]) => u.length)
    );
    // Compared as a map so a failure names the file AND the variables, not just a count.
    expect(offenders).toEqual({});
  });

  it('MUST-FAIL CONTROL: eval binds only inside eval, not from any quoted string', () => {
    // The risk in rule 1 is over-binding: if `NAME=` bound from anywhere, the detector would go
    // quiet across the repo and look healthier than it is. Same text, once under eval and once not.
    const underEval = ['```bash', 'eval "$(printf \'FOO=1\')"', 'echo "$FOO"', '```'].join('\n');
    const notEval = ['```bash', 'echo "FOO=1"', 'echo "$FOO"', '```'].join('\n');
    expect(unboundIn(underEval)).toEqual([]);
    expect(unboundIn(notEval)).toEqual(['FOO']);
  });

  it('binds every name in an escape-separated eval payload', () => {
    // Regression control for the bug this rule shipped with on its first cut: `\n` between
    // assignments was absorbed into the following name (`nB`, `nC`), so only the FIRST name bound.
    // Asserting all three are clean is what makes a half-working extractor fail — checking one
    // would have passed while two names were garbage.
    const payload = [
      '```bash',
      'eval "$(jq -r \'. | "A=\\(.a)\\nB=\\(.b)\\nC=\\(.c)"\' in.json)"',
      'echo "$A $B $C"',
      '```',
    ].join('\n');
    expect(unboundIn(payload)).toEqual([]);
  });

  it('MUST-FAIL CONTROL: a fallback satisfies only its own expansion, not the name', () => {
    // The risk in rule 2 is laundering: `${VAR:-x}` must not make a later bare `$VAR` acceptable.
    const withFallback = ['```bash', 'echo "${VAR:-default}"', '```'].join('\n');
    const alsoBare = ['```bash', 'echo "${VAR:-default}"', 'echo "$VAR"', '```'].join('\n');
    expect(unboundIn(withFallback)).toEqual([]);
    expect(unboundIn(alsoBare)).toEqual(['VAR']);
  });

  it('MUST-FAIL CONTROL: ${VAR:0:12} and ${VAR#glob} supply nothing and still flag', () => {
    // Guards SUPPLIES_FALLBACK against being loosened to "any `${…}` with a suffix", which would
    // silently exempt post-mr-comments.md's real `${BASE_SHA:0:12}` reads.
    expect(unboundIn('```bash\necho "${SHA:0:12}"\n```')).toEqual(['SHA']);
    expect(unboundIn('```bash\necho "${NAME#pre}"\n```')).toEqual(['NAME']);
    // …and a nested read inside a fallback is still a read.
    expect(unboundIn('```bash\necho "${FOO:-$BAR}"\n```')).toEqual(['BAR']);
  });
});

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
