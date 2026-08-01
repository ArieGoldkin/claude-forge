# Issue #98 — the cause of the inert `if` conditions

> Measured 2026-08-01 on **CC v2.1.220**, against the **installed** ctk 2.17.0 bundle
> (`hooks.json` verified byte-identical to `main` @ `f62bfae` before probing).
> Issue #98 established the *consequence* on **one** group (`PreToolUse[0]`, controlled pair,
> 2026-07-31, same CC version — the table in #98's body). This document probes **three more**, for
> **4 of 6 measured**, and identifies the mechanism. The remaining 2 are inferred, never probed —
> see the scorecard below, and do not restate the total as "all 6."

## 0. What #98 asked

1. Is group-level `if` honoured for `PreToolUse` with a `Bash` matcher **at all**?
2. If honoured elsewhere, is the 20-glob condition on `[0]` simply wrong and better deleted?
3. Does `write-combined`'s condition on `PreToolUse[2]` actually gate? *(It should.)*

### Measurement scorecard — 4 of 6 measured, 2 inferred

Stated up front because every document derived from this one initially dropped the qualifier and
claimed all six were measured. **Do not restate this as "all 6 were measured."**

| # | Group | Status |
|---|---|---|
| 1 | `PreToolUse[0]` | **MEASURED** — controlled pair 2026-07-31 during #65, CC v2.1.220 (recorded in #98's body) |
| 2 | `PreToolUse[1]` | **MEASURED** — §3, four cells |
| 3 | `PreToolUse[2]` | **MEASURED** — §4 |
| 4 | `PostToolUse[4]` | **MEASURED** — §5, with a stated limit |
| 5 | `PostToolUse[1]` | **INFERRED** — no constructible discriminator exists (§6) |
| 6 | `PermissionRequest[0]` | **INFERRED** — fires only on a permission dialog (§6) |

Four measurements across two events and both matcher kinds, all agreeing, plus a documented
mechanism (§7c) that applies to all six identically. That is an overwhelming case for deletion —
and it is still not the same as six measurements.

## 1. Scope: the `if` keys are ctk-only

| Plugin | `if` keys in `hooks.json` |
|---|---|
| continuity-toolkit (ctk) | **6** |
| devops-toolkit | 0 |
| ai-toolkit | 0 |
| frontend-toolkit | 0 |
| engineering-toolkit | 0 |

The six live at `PreToolUse[0]`, `[1]`, `[2]`, `PermissionRequest[0]`, `PostToolUse[1]`, `PostToolUse[4]`.

The conditions entered at **`f0d2c5f`, the initial commit**, and were **edited deliberately once
since** — at **`4807c0c`** (2026-07-17, ctk 2.7.3, #26), which expanded `PostToolUse[1]`'s condition
from 8 clauses to 24 and reasoned explicitly about gating: *"the lint-checker `if` condition listed
only Write()/Edit() clauses while its matcher claimed Write|Edit|MultiEdit, so MultiEdit never
satisfied it."* So there **is** prior art: a shipped, version-bumped change made in the belief that
these conditions gate. That belief was wrong, but it was deliberate, and this document originally
denied it existed.

> **⚠ Instrument error, corrected — and it is the same shape as the one this document indicts.**
> The original claim ("exactly one commit; never a deliberate decision; no prior art") came from
> `git log -S'"if":'`. **`-S` counts occurrence *changes*, so a same-count replacement is invisible
> to it** — and `4807c0c` replaced one `if` string with another. `git log -G'"if"\s*:'` returns
> `f0d2c5f`, `4807c0c`, and the removal commit. **Use `-G` for "was this line ever touched"; `-S`
> only answers "did the count change."** Found by an adversarial verifier, not by review.

## 2. Method — why these probes discriminate

Every candidate hook carries an **internal guard** that duplicates its `if` condition, so hook
*silence* is ambiguous: it cannot distinguish "the `if` excluded the call" from "the hook ran and
its own guard no-op'd." (This is what makes `review-logger` useless as a silence-based instrument,
and it is the same shape as the `logInfo`-suppressed-at-WARN trap.)

The discriminator is the **asymmetry** between each `if` glob and its internal guard:

- `if` globs are **prefix-anchored** — `Bash(git commit*)`.
- Internal guards match **anywhere** — `/\bgit\s+commit\b/`.

So a command whose *text* contains the pattern but which does not *start* with it matches the
internal guard and no `if` glob. If the hook still fires, the `if` did not confine it.

Each question gets a **must-not-fire** control (proves the observable is not unconditional) and a
**must-fire** control (proves the hook is alive, so a null result would be interpretable).

## 3. Q1 — `PreToolUse[1]`, Bash matcher

Hook: `preflight-context-injector`. `if` = `Bash(git commit*) || Bash(git push*) ||
Bash(terraform apply*) || Bash(terraform destroy*) || Bash(rm -rf *) || Bash(rm -fr *)`.
Observable: `additionalContext` injected into the caller's own tool result — no log parsing.

| Cell | Command | Matches `if`? | Matches internal guard? | Result |
|---|---|---|---|---|
| N1 must-not-fire | `echo "nothing destructive here"` | no | no | **silent** ✅ |
| D1 discriminator | `echo "checking the git commit policy"` | no (starts `echo`) | yes | **INJECTED** |
| D2 discriminator | `echo "rm -r"` | no — **under any reading** | yes | **INJECTED** |
| P1 must-fire | `git commit --dry-run` | yes | yes | **INJECTED** ✅ |

**D2 closes the substring loophole for this group.** D1 alone leaves it open: if CC matched `if`
globs as *substrings* rather than prefixes, `Bash(git commit*)` could arguably match D1's text, and
the injection would be the `if` working, not failing. D2 shuts that down — the `if` list contains
only `rm -rf *` and `rm -fr *`, and the string `rm -rf` does not occur in `echo "rm -r"`. **No glob
in this group's list matches D2 under prefix *or* substring semantics**, and the hook fired anyway.

> **⚠ D2 was originally called "the load-bearing cell." It is not, and the demotion came from an
> adversarial verifier.** D2 only enumerates `PreToolUse[1]`'s *own* list. It does not exclude an
> **event-wide union** reading — an implementation where any group's `if` matching runs all hooks on
> that event. Under union + substring, `PreToolUse[0]`'s `Bash(rm *)` matches `echo "rm -r"` (the
> literal `rm ` is present), which would explain D2 without any inertness. The same hole applies to
> the incidental `rm -f` sighting below.
>
> **The load-bearing cell is §4's Write probe**, which is immune to all three escapes at once: it is
> a **Write** tool call, so none of the 26 `Bash(...)` clauses across `PreToolUse[0]`/`[1]` can apply
> under any reading; the only Write/Edit clauses on the event are group `[2]`'s own six; and the
> path matches none of them under prefix, substring, basename-only, or case-insensitive matching.

> **Answer: group-level `if` is not honoured for `PreToolUse` with a `Bash` matcher.**
> Established independently of `PreToolUse[0]`, so this is not a quirk of the 20-glob condition.

Incidentally re-confirmed a fifth time by the cleanup command `rm -f <path>` — not in the `if`
list, injected anyway.

## 4. Q3 — `PreToolUse[2]`, Write/Edit matcher (**file-path** condition)

Hook: `write-combined`. `if` = `Write(.env*) || Write(*secret*) || Write(*credential*) ||
Write(*password*) || Edit(.env*) || Edit(*secret*)`.
Observable: the bundled architecture-change advisor's `outputWithNotification`, which fires on an
internal file list (`Dockerfile`, `biome.json`, `*.tf`, …) **disjoint** from every `if` glob.

| Cell | Write target | Matches `if`? | Matches advisor list? | Result |
|---|---|---|---|---|
| N must-not-fire | `scratchpad/probe-plain.txt` | no | no | **silent** ✅ |
| D discriminator | `scratchpad/Dockerfile` | no | yes | **ADVISORY FIRED** |

The must-fire control was held in reserve — it is only needed to rescue a *null* result, and D
fired, which proves the hook is alive and the `if` was bypassed in the same observation.

> **Answer: `PreToolUse[2]`'s file-path `if` does not gate either.**

**This is the finding that breaks the floor note.** Root `CLAUDE.md` asserts that ctk's *file-path*
`if` conditions "depend on the **v2.1.176** fix to gate correctly — that is the effective minimum
CC version for our security/permission hooks." We are on v2.1.220, well past that floor, and the
file-path condition does not gate at all.

## 5. Q2 — `PostToolUse[4]`, Bash matcher

Hook: `review-logger`. `if` = `Bash(git *) || Bash(gh *) || Bash(glab *)`.
Observable: appends to `review-history.jsonl` — a **durable artifact**, absent at baseline.

| Cell | Command | Result |
|---|---|---|
| baseline | (file state before probe) | **ABSENT** |
| D discriminator | `echo "glab mr note 42"` | **entry written**, stamped with this session's id |

> **Answer: `PostToolUse` group-level `if` does not confine the hook either** — it fired on an
> `echo`, which is not a `git`/`gh`/`glab` command.

**The limit originally stated here has since been CLOSED — by an adversarial verifier's probes.**
This section first said the cell could not exclude a substring reading, because "every command
matching `review-logger`'s internal pattern necessarily contains the literal `glab `." **That was
false.** The internal pattern is `/glab\s+mr\s+(note|approve)\s+(\d+)/`, and `\s` matches a
**newline** — so `echo "glab<LF>mr note N"` satisfies the guard while containing no `glab `
substring at all. A verifier constructed exactly that probe and ran it, along with two others:

| Verifier probe | `glab ` substring? | Result |
|---|---|---|
| `echo "glab<LF>mr note 424242"` | **no** (newline) | **FIRED** |
| `echo "glab mr note 424243"` | yes | **FIRED** (twice) |
| `rtk glab mr note 424244 \|\| true` | yes | **FIRED** |

The first row closes the loophole: no glob in the `if` list matches it under prefix *or* substring
semantics, and the hook ran anyway. `PostToolUse` group-level `if` is inert on the same footing as
`PreToolUse`.

> **⚠ The verifier reported these as NULL results and concluded the opposite — that `PostToolUse`
> `if` *does* gate, and that this section was refuted.** It searched `~/.claude/logs`. Live hooks
> write to **`$CLAUDE_PLUGIN_DATA/logs/`**; `~/.claude/logs/<plugin>/` is the *test-suite* fallback,
> written only when that variable is unset. All four of its probe entries were sitting in the
> plugin-data path, stamped with the live session id. **This is the identical instrument error that
> produced a false "hooks are not logging" verdict on 2026-07-31**, documented in ctk's own
> `CLAUDE.md`, and it inverted an adversarial verdict. Resolve the log directory before treating
> absence as evidence:
> ```
> find ~/.claude -name review-history.jsonl -newermt "-1 hour"
> ```
> Its derived conclusions — a per-event asymmetry, and a recommendation to keep the `PostToolUse`
> conditions pending measurement — fall with the null. Its *other* findings did not, and several are
> incorporated throughout this document.

**Cleanup:** `review-history.jsonl` was **deleted and verified absent** immediately after the probe.
It did not exist before. Leaving a fabricated MR-42 entry in the real plugin-data directory would
have poisoned `/etk:review-stats` — the same class of mistake as the test suite that wrote 20
snapshots into the real `~/.claude` and had the diagnostic read them back as evidence.

## 6. Not measured, and why

| Group | Hook | Why not |
|---|---|---|
| `PostToolUse[1]` | `lint-checker` | **A discriminator IS constructible — this section originally claimed otherwise and was wrong.** Two asymmetries exist: (1) **case fold** — the implementation lowercases via `path.extname(fp).toLowerCase()`, so `probe.TS` enters `JS_EXTENSIONS` while a case-sensitive `Write(*.ts)` glob would not match; (2) **separator crossing** — if `*` does not cross `/`, `Write(*.ts)` matches no absolute path, and absolute paths are all CC supplies. Neither was executed: with `PostToolUse` now measured inert via `PostToolUse[4]`, a null here would be uninterpretable without its own must-fire control, and the question is no longer load-bearing. **Constructible, not measured.** |
| `PermissionRequest[0]` | `permission-request-combined` | Fires only on a permission dialog; not deliberately triggerable without manufacturing a prompt. |

Neither is claimed either way. Both events and both matcher kinds have now been measured inert —
`PreToolUse` on Bash and on Write, `PostToolUse` on Bash (§5, reinforced by four independent
verifier probes) — and §7c supplies a mechanism that applies to all six groups identically. The
parsimonious reading is that these two are inert too. **That remains an inference, not a
measurement, and is labelled as such.**

## 7. Instrument caveat

`echo "validate_exit=${PIPESTATUS[0]}"` returned **empty** under zsh (which uses `$pipestatus`,
1-indexed). The `claude plugin validate` exit code was therefore **not captured**, and no claim is
made about it. Its textual verdict — "Validation passed with warnings", the single warning
unrelated to `if` — is what is relied on. Same family as the `$?`-after-a-pipe trap already on
record in this repo.

## 7a. The latent landmine, enumerated for all six keys

#98 was filed because "if a future Claude Code makes that condition take effect, ctk's security
coverage collapses silently." That risk has never been enumerated past `PreToolUse[0]`. What each
condition would confine its hook to, and what would be **lost**, if `if` started working:

> **§7c revises the trigger.** The mechanism is now known, and the likely cause of activation is
> **a maintainer correcting the nesting**, not a CC release. The consequences below are unchanged
> and are what make that correction dangerous.

| # | Group | Hook (what it bundles) | Lost if `if` started working | Severity |
|---|---|---|---|---|
| 1 | `PreToolUse[0]` | `bash-combined` = auto-approve-safe-bash + profile + git-validator + **security-blocker** | **security-blocker stops seeing every non-destructive command** — `cat <envfile>`, `curl -d @<envfile>`, `cat ~/.ssh/id_rsa` all sail through. **Also** auto-approve-safe-bash stops auto-approving `ls`/`grep`/`cat`, so prompt volume spikes. | **CRITICAL** |
| 2 | `PreToolUse[2]` | `write-combined` = auto-approve-project-writes + profile + **security-blocker** + pre-write secret scan + architecture advisor | Writes to anything not named `.env*`/`*secret*`/`*credential*`/`*password*` lose **secret scanning and the write-side security check**; ordinary project writes stop being auto-approved. | **HIGH** |
| 3 | `PermissionRequest[0]` | `permission-request-combined` | Auto-approval on the permission dialog stops for anything outside the 9-command list. UX regression, not a security hole. | LOW–MED |
| 4 | `PreToolUse[1]` | `preflight-context-injector` | No *useful* work — but a working condition would still lose every **compound or prefixed** form, because the `if` globs are prefix-anchored and the internal guard matches anywhere. `cd /repo && git push` matches `/\bgit\s+push\b/` but not `Bash(git push*)` — and wrong-directory is the exact case this hook exists to catch. | NONE (but see below) |
| 5 | `PostToolUse[1]` | `lint-checker` | Nothing — internal extension set is **identical** to the `if` list. | NONE |
| 6 | `PostToolUse[4]` | `review-logger` | No *useful* work — but a working condition would lose any **prefixed** invocation, e.g. `rtk glab api …/discussions --input f`, which the internal pattern matches and `Bash(glab *)` does not. Not hypothetical: this machine proxies commands through `rtk`. | NONE (but see below) |

Two things fall out of this table that the issue did not anticipate:

1. **`PreToolUse[2]` is a second security-critical landmine**, not just a documentation
   inconsistency. It bundles `security-blocker` and the pre-write secret scan for the *write* path.
   Fixing `[0]` while leaving `[2]` armed would be incoherent — both were measured failing.
2. **The `if` conditions carry no upside on any of the six groups.** Where they would confine
   anything at all, they confine it *wrongly*; where they look harmless, they are redundant with an
   internal guard that already exists — and *still* lossy, per rows 4 and 6. There is no group where
   the `if` is doing useful work.

3. **A prefix-anchored `if` is structurally incompatible with this repo.** The `if` globs match from
   the start of the command; five hooks — `security-blocker`, `bash-combined`, `git-validator`,
   `profile-evaluator`, `auto-approve-safe-bash` — call `stripProxyPrefix` precisely because
   commands here arrive wrapped (`rtk <cmd>`). A condition that anchors at position 0 cannot see
   past a proxy prefix, so on this machine a "working" `if` would silently stop matching the moment
   a command is proxied. That is an argument against ever repairing these, independent of the
   security one.

4. **`PermissionRequest[0]` is the one group where deletion genuinely widens a deny-capable hook.**
   That group has **no `matcher`** (verified: its only key is `hooks`), and `profile-evaluator` runs
   for every tool without a tool-name guard. So its `if` was the sole declared confinement, and
   removing it exposes `permission-request-combined` to tools its list never named. **No effect on
   v2.1.220**, where the condition is inert, and it only reaches users who have a
   `.claude/permissions/` profile — but it is the weakest instance of "the internal guard is the
   real filter," and is recorded rather than smoothed over.

## 7b. Cause of the *documentation* error — established from primary repo evidence

The floor note entered root `CLAUDE.md` in commit **`b3cbedc`**, sourced from
`docs/reviews/2026-06-26_cc-v2.1.193-alignment-gaps.md` **T1.1**, which reads:

> - **CC change:** v2.1.176 "Fixed hook `if` conditions for file paths with patterns."
> - **Our exposure:** `hooks.json` uses **6 `if` conditions with file-path glob patterns** …
> - **Implication:** these conditions only evaluate correctly on **CC ≥ v2.1.176**. …
>   **We benefit automatically on current CC** …
> - **Action:** … **No code change needed.**

That analysis declared *"Source confidence: High"* and *"Hook-specific findings verified against our
actual `hooks.json` files."* **The verification confirmed that the conditions are PRESENT. It never
tested that they GATE.** Presence of syntax was taken for effect of syntax, and a CHANGELOG line
about a fix was read as evidence our usage was correct.

This is the repo's recurring failure mode, not a new one: a confident claim derived by reading
rather than executing, in a spot the author considered obviously fine. It is the same class as
"provably inert is a claim, not a proof" and "partial capture is still inference."

**Consequence for the remedy:** the floor note is wrong in both directions. It is not merely that
v2.1.176 is the wrong floor — there is **no** CC version at which these conditions are known to
gate, and the note's implied reassurance ("our security/permission hooks work correctly at ≥
v2.1.176") is the opposite of the measured truth.

## 7c. Cause — best-supported explanation, from the official docs plus measurement

Quotes verified against <https://code.claude.com/docs/en/hooks>, fetched directly and independently
re-verified by a second agent as exact. The conditions were wrong in **two independent ways**.

> **Scope of this claim, stated precisely.** The *docs* establish where `if` belongs and what values
> it accepts. They do **not** state what CC does when `if` appears at the matcher-group level — that
> case is simply not described. So "the key is never read" is an **inference**: well-corroborated by
> four measurements across two events and both matcher kinds, but not a documented fact. An earlier
> revision of this section was headed "ESTABLISHED from the official documentation," which was the
> same move it criticises in §7b — a real doc statement about an adjacent thing read as proof of a
> specific mechanism. Corrected after review.

**(1) Wrong nesting level.** `if` is a **hook-handler** field, not a matcher-group field:

> "For tool events, you can filter more narrowly by setting the `if` field on **individual hook
> handlers**."

The canonical example puts `if` inside the handler object, as a sibling of `type`/`command`:

```json
{ "matcher": "Bash",
  "hooks": [ { "type": "command", "if": "Bash(rm *)", "command": "…" } ] }
```

All 6 of ours sat one level up, as a sibling of `matcher` and `hooks` — **a position the docs never
describe.** Combined with the measurements, the parsimonious reading is that the key is simply not
read there. This fault alone explains every observation.

**(2) Invalid value syntax, even at the correct level.**

> "The `if` field holds **exactly one permission rule**. There is no `&&`, `||`, or list syntax for
> combining rules; to apply multiple conditions, define a separate hook handler for each."

Every one of our values was a `||`-joined list — up to 20 alternatives on `PreToolUse[0]`. That
combinator syntax exists in **no** CC subsystem: permission lists are arrays of single-pattern
strings, and the only documented use of `||` is as a *shell chain operator* CC splits a Bash command
on before matching. The syntax appears to have been invented.

**What fault (2) does and does not imply.** It is *not* a second independent proof of inertness —
CC's handling of a malformed `if` at the correct nesting level is undocumented (see the open
sub-question below), and a fail-*closed* parser would make such a hook never run at all, which is
the opposite of inert. Fault (1) is what explains the measurements. Fault (2)'s significance is
different and still important: **no correctly-nested repair can be written from these values as they
stand** — each would have to be split into one handler per pattern, which is precisely the change
§7a shows to be a security regression.

This fully explains the measurements, and it retires the earlier open question. The relevant scope
note: `if` is "only evaluated on tool events: `PreToolUse`, `PostToolUse`, `PostToolUseFailure`,
`PermissionRequest`, and `PermissionDenied`" — all 6 of ours were on tool events, so event scope was
never the issue.

**A third reason the pin is right, from the clause that sentence continues into:**

> "**On other events, a hook with `if` set never runs.**"

So an `if` added to any *non-tool* event group — `SessionStart`, `PreCompact`, `Stop`, `SessionEnd`,
or the twelve monitor-forward groups — does not narrow that hook, it **silently kills it**. The
regression test walks every event rather than only the tool events, so it already covers this; the
rationale is simply stronger than when it was written.

### The risk was misidentified — and the real one is worse

#98 framed the danger as "a future Claude Code makes that condition take effect." That is now the
*less* likely path: unknown-key tolerance is stable behaviour, and neither relevant changelog fix
(v2.1.176, v2.1.214) mentions group-level key handling. ⚠ **That last point is an inference** —
neither entry states the nesting level it operates on; it is read from the fact that `if` is only
documented as a handler field. Flagged because it is what downgrades "a future CC arms this" from
likely to unlikely, and it is doing real work.

> **Verbatim discrepancy worth recording.** The v2.1.176 entry our own gap analysis quotes as
> *"Fixed hook `if` conditions for file paths with patterns"* is a **paraphrase**. The actual entry,
> confirmed by direct `grep`/`sed` against the raw CHANGELOG, reads: *"Fixed hook `if` conditions for
> Read/Edit/Write tool paths: documented patterns like `Edit(src/**)`, `Read(~/.ssh/**)`, and
> `Read(.env)` now match correctly."* A second agent fetching the same file via a summarising tool
> could not locate the entry at all and raised the possibility it was fabricated. It is real; the
> difference is instrument, not fact. Quote changelog entries from the raw file, never from a
> summary, and never re-quote a paraphrase as if it were verbatim.

**The realistic path to the security regression is a well-meaning maintainer.** Someone reads the
official docs, correctly observes that our nesting is wrong, and "fixes" it — moving `if` into each
handler and splitting the `||` lists into one handler per pattern, which is precisely what the docs
prescribe *in general*. On `PreToolUse[0]` that change would confine `security-blocker` to 20
destructive-verb globs and let every secret-file read through. **The correct-looking fix is the
dangerous one.**

**Why it is specifically the *maintainer* path and not a platform path — the two faults decide it.**
Arming a landmine requires repairing **both**: re-nesting to handler level *and* decomposing every
`||` list into one handler per pattern. A CC upgrade fixes **neither** — it would have to invent
group-level `if` support *and* an OR-combinator the docs explicitly deny. A maintainer following the
documentation fixes **both in the same edit**, because the docs prescribe them together. That
asymmetry is the whole argument for a test rather than a comment: the only actor capable of arming
this is the one reading the correct instructions.

That is why this ships as a **deletion plus a test that fails on reintroduction**, and why the
warning in root `CLAUDE.md` and in `tests/hooks-manifest.test.ts` names the tempting wrong fix
explicitly rather than just saying "don't add an `if` here."

> **Recommendation received and rejected.** The research agent that established the schema also
> proposed the repair shape above (move `if` into the handlers, split the lists). It is correct as
> generic Claude Code advice and wrong for this repo, for the reason in §7a: on two of the six
> groups the confinement it would create is a security regression. Recorded because a future reader
> will find the same docs and reach the same conclusion.

### Instrument note — the experiment that was blocked

Before the documentation settled this, a three-cell probe in `settings.json` hooks was attempted
(one `if` that must match, one that cannot, a marker file). It was **BLOCKED by the auto-mode
classifier**, which refused edits to `.claude/settings.local.json`. The refusal was correct —
mutating live hook/permission config is what a classifier should stop — and it was not worked
around. It is moot now: the docs answered the question the probe was designed to answer.

One sub-question remains genuinely undocumented and is **NOT ESTABLISHED**: what CC does when an
`if` value at the *correct* nesting level is malformed. The only documented fail-open statement is
narrower, and is about the Bash command being unparseable rather than the pattern:

> "The filter also fails open, running your hook regardless of pattern, when the Bash command can't
> be parsed. Because the `if` filter is best-effort, use the permission system rather than a hook to
> enforce a hard allow or deny."

That last clause is itself worth carrying: **CC's own documentation says not to use `if` for a hard
allow or deny** — which is an independent reason our security hooks must not depend on it.

## 7d. Out-of-scope defect found while probing — worth its own issue

Surfaced by an adversarial verifier and confirmed here. **Not fixed in this change; recorded so it
is not lost.**

- `~/.claude/logs/plugin/review-history.jsonl` holds **1026 entries, every one stamped
  `session_id: "test-session-123"`** — the shared test suite writing into the real user data
  directory. It has no `CLAUDE_PLUGIN_NAME`, so `getLogDir()` falls back to `logs/plugin/`. Same
  defect class as the 20 snapshots the test suite once wrote into the real `~/.claude`, which
  `CLAUDE_CONFIG_DIR` isolation fixed for that path but not this one.
- **`/etk:review-stats` reads `$HOME/.claude/logs` only** (`commands/review-stats.md:13`,
  `find "$HOME/.claude/logs" -name review-history.jsonl`). Live hooks write to
  `$CLAUDE_PLUGIN_DATA/logs/`. So the command does not merely *include* fabricated data — on this
  machine it can read **nothing but** fabricated data, and would report ~1026 reviews of MRs that
  never existed.

Both halves are the wrong-directory family that also inverted a verifier's verdict in §5. The
irony is recorded deliberately: §5 congratulates itself on deleting one fabricated entry to avoid
poisoning `/etk:review-stats`, while a thousand fabricated entries sat in the directory that command
actually reads.

## 8. Consequences for the security posture

Unchanged and load-bearing: `security-blocker` must see **every** Bash command. All 20 globs on
`PreToolUse[0]` are destructive verbs, so a working gate would exclude every secret-file read —
`cat <envfile>`, `curl -d @<envfile> https://…`, `cat ~/.ssh/id_rsa` match none of them and are
denied today **only** because the `if` does not confine the hook.

The measurements above make that dependency worse, not better: it is now known to hold across
three groups, and the `if` has never worked in the repo's history.
