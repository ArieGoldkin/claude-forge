# Issue #134 — forking strips the interactive channel; `background: false` does not restore it

**Date measured:** 2026-08-05
**CC version:** 2.1.222 (the v2.1.221 alignment audit was one version behind)
**Repo state:** `main` @ `a81bb2c`
**Method:** three-arm skill probe, one frontmatter key varied per arm, positive control run last

---

## 1. What #134 claimed, and what is actually true

#134 reported that `brainstorming`'s advertised primary mode (interactive Socratic
questioning) is unreachable, and attributed it to the **CC v2.1.218 background default**
for `context: fork` skills.

**The symptom is real and reproduced. The mechanism in the issue is wrong.**

The interactive channel is removed by **`context: fork` itself**, in any background mode.
v2.1.218 changed *visibility* — it added the `Running in the background as @<name>`
announcement that made the gap noticeable — not the channel.

## 2. The measurement

Three temporary project skills were written under `.claude/skills/`, identical except for
frontmatter. Each did exactly one thing: call `AskUserQuestion` once and report whether it
had a channel. They were removed after the run (`git status` clean; they are **not**
gitignored — verified with `git add -n`, not `check-ignore`, which lies about negated
patterns).

| Arm | `context: fork` | `background:` | Execution observed | `AskUserQuestion` |
|---|---|---|---|---|
| **A** | absent | — | main loop, inline, no announcement | ✅ **available; question reached the user, answered "Yes"** |
| **B** | present | absent (default) | `Running in the background as @probe-b-fork-default` | ❌ absent from toolset |
| **C** | present | `false` | **completed synchronously, no background announcement** | ❌ absent from toolset |

Arms B and C both reported the tool as **absent**, not failing:

- `ToolSearch` with `select:AskUserQuestion` → `No matching deferred tools found`
- keyword search returned only unrelated tools; no `AskUserQuestion`
- absent from the base non-deferred tool list

Arm C additionally reported its own framing as *"You are an agent for Claude Code"* and saw
siblings (`main`, `etk-brainstorming`, `probe-b-fork-default`) as `SendMessage` peers — so
`background: false` did **not** return it to the parent's inline context. It remained a
separate agent thread.

### Why arm A matters

Without a positive control, "no channel in B and C" is equally explained by
`AskUserQuestion` being unavailable session-wide, which would make the whole conclusion an
artifact. Arm A ran **after** B and C and the question reached the user, who answered
"Yes". The instrument is validated; B and C's silence is a property of forking.

## 3. What this establishes, and what it does not

**Established (measured):**

1. `context: fork` removes `AskUserQuestion` from the skill's toolset.
2. `background: false` **is a real, recognized key** — arm C demonstrably did not
   background. It controls whether the parent waits, not whether the fork can prompt.
3. Therefore `background: false` **cannot** fix an interactivity gap. Options 1 and 2 of
   #134 are both refuted on measurement.
4. A non-forked skill has the channel.

**NOT established — do not write these in the indicative:**

- Whether `context: fork` stripped `AskUserQuestion` on **pre-2.1.218 CC**. Unmeasured and
  unmeasurable from here. `brainstorming` has carried `context: fork` since the initial
  commit (`f0d2c5f`, 2026-06-14, never modified), but "its Socratic mode never worked" is a
  reconstruction, not an observation. This repo has shipped that exact error before
  (`hook-liveness.ts`, "still carried").
- What CC does with a **denial** inside a fork on the current version. The measured runs
  show tool **absence**, which is a different thing. `CLAUDE.md`'s standing open question on
  fork failure paths is **narrowed, not closed**.

## 4. The failure mode that actually matters

In every measured run the model **noticed** the missing tool and declined to fabricate
answers. That was **discretionary**. Nothing in any skill required it.

A channel-less interactive skill that guesses does not crash. It produces:

- a confident, well-structured design built on **invented user intent** (brainstorming), or
- a pipeline reporting **six passed human checkpoints having asked nothing** at any of them
  (development-pipeline), or
- an **expensive fan-out that self-approved** its own cost gate (auto-research).

All three look like success. This is why "document the limitation only" was rejected: it
documents a silent fabrication while leaving it in place.

## 5. Scope — a class defect, not a brainstorming bug

3 of the **11** `context: fork` skills **as measured before the fix** advertise turn-taking in
their own descriptions (the live count is now **10** — `brainstorming` had the key removed):

| Skill | Description promises | Resolution |
|---|---|---|
| `brainstorming` | "Socratic questioning (simple mode)" | **`context: fork` removed** — iterative dialogue cannot be relayed |
| `auto-research` | "confirms the plan, and executes" | fork kept + guard — approve/reject **is** relayable |
| `development-pipeline` | "with human checkpoints" | fork kept + guard — approve/reject **is** relayable |

The distinction chosen: **iterative dialogue needs the channel; an approval gate can be
relayed faithfully by the parent.** Removing the fork from `auto-research` would cost
context isolation on the repo's highest fan-out route (~11 agents on a `design` route),
which its cost governance exists to restrain.

`brainstorming --deep` was **not** exempt: `references/deep-mode-phases.md` Phase 5 is
titled "Interactive Refinement", blocks on `AskUserQuestion`, re-runs Phase 2 agents from
the answer, and its exit criteria require explicit approval. Verified independently. This
refutes #134 option 2's premise that `--deep` is batch-safe.

## 6. Two-level breakage on the reported route

`auto-research` is itself `context: fork`. The `design` route is therefore a forked skill
invoking another skill — the channel was gone at **two** levels, so fixing `brainstorming`
alone would not have restored Socratic mode through the route #134 was filed about. This is
why the guard ships on `auto-research` regardless of `brainstorming`'s fix.

The repo already documented the contradiction in two places while the frontmatter made it
impossible: `auto-research/references/unattended-mode.md:92` ("wants a human in the loop")
and `references/routine-recipes.md:55` ("Interactive orchestrators — need a human decision
each run").

## 7. Provenance note — how the false lead entered

Root `CLAUDE.md:416` read *"Opt out per skill with `background: false`"* as bare
instruction. Its source (`2026-08-04_cc-v2.1.221-alignment-audit.md:50-51`) is a **verbatim
CHANGELOG quote**, never measured. 0 of **1080** `SKILL.md` files across every installed
plugin declare the key, so there was no worked example either.

This is the #98 shape exactly — that audit *"verified the conditions were **present** and
never that they **gate**."* The key here turned out to be real, but to do something other
than what a reader would assume from the sentence, which is the same class of defect with a
friendlier outcome. Both the claim and this measurement now carry markers.

## 8. ⚠ The verification grep matched its own documentation — again, on this commit

The post-fix check that the fork count had dropped 11 → 10 returned **11**. Not a failed
fix: `brainstorming`'s new frontmatter comment *names* `context: fork` twice in order to
warn against re-adding it, and an unanchored `grep -rl` counts prose.

Anchor it: `grep -rl --include=SKILL.md '^context: fork'` returns **10**.

This is the third recorded instance of the family — the vacuous-assertion check that matched
the comment explaining the removal, and the stale-claim check that returned 0 because the
correction quoted the removed sentence across a line break. It fired here **on the very
commit that introduced the prose it matched**, which is the shortest possible interval
between creating the trap and falling into it. The general form: **any fix that documents
what it removed makes a text search for the removed thing return a false positive, and any
fix whose correction quotes the old wording makes it return a false negative.** Decide which
direction your check errs in before trusting its number.
