---
name: development-pipeline
description: "Guided 6-phase development pipeline: Gate, Design, Hypothesize, Plan, Build (TDD), Verify. Chains brainstorming, quality gates, and testing skills with human checkpoints. Supports greenfield, brownfield, bugfix, and refactor modes. Use when: building a feature end-to-end, implementing a ticket, or following a structured dev process. Triggers on: develop, build feature, implement, create feature, from ticket, structured development, pipeline, end-to-end"
effort: xhigh
context: fork
---

## Overview

A 6-phase development pipeline that orchestrates existing etk skills into a
structured process: **Gate → Design → Hypothesize → Plan → Build → Verify**. Each phase delegates to
specialized skills and includes human checkpoints for approval.

### Pipeline Flow

```
/develop "task description"
    │
Phase 0: GATE ─────── Blocks if >3 critical unknowns
    │
Phase 1: DESIGN ───── Brainstorming skill (simple or deep)
    │                  Human checkpoint: approve design
    │
Phase 2: HYPOTHESIZE ─ State assumptions, risks, success criteria
    │                  Human checkpoint: approve hypotheses
    │
Phase 3: PLAN ──────── Quality gates + task breakdown + test strategy
    │                  Human checkpoint: approve plan
    │
Phase 4: BUILD ─────── TDD implementation per task
    │                  Human checkpoint: review changes
    │
Phase 5: VERIFY ────── Evidence collection + quality checks
    │                  Human checkpoint: approve for merge
    │
  DONE ─── Summary + optional MR
```

## Mode Detection

Detect mode from explicit flag or context. Explicit flag in arguments takes priority.

| Signal | Mode |
|--------|------|
| `greenfield` flag or no existing code referenced | `greenfield` |
| `brownfield` flag or modifying existing files | `brownfield` |
| `bugfix` flag or mentions "bug", "fix", "broken", "error" | `bugfix` |
| `refactor` flag or mentions "refactor", "clean up", "reorganize" | `refactor` |

**Bugfix abbreviated pipeline**: Skip Phase 1 (Design) and Phase 2 (Hypothesize). Go directly Gate → Plan → Build → Verify.

### Parallel Dispatch Flag

When `--parallel` is present in arguments, Phase 4 (Build) dispatches tasks to fresh subagents instead of sequential execution:

1. Extract all tasks from the Phase 3 plan
2. Identify independent tasks (no shared file dependencies)
3. Dispatch each independent task to a fresh subagent using the implementer prompt template
4. Each subagent gets: task description, file ownership, test requirements, and the status protocol (DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED)
5. Controller collects results, runs spec compliance review, then proceeds to Phase 5 (Verify)

**When to use --parallel**:
- 3+ independent tasks identified in the plan
- Tasks operate on different files/modules
- Greenfield or brownfield mode (not bugfix — bugfixes are typically sequential)

**When NOT to use**: Single-file changes, tightly coupled tasks, bugfixes with cascading dependencies.

**Mode routing matrix** (quick reference):

| Phase | greenfield | brownfield | bugfix | refactor |
|-------|-----------|-----------|--------|----------|
| 0: Gate | Full (5 unknowns) | Full (5 unknowns) | Light (3 unknowns) | Medium (4 unknowns) |
| 1: Design | Deep brainstorm | Simple brainstorm | SKIP | Simple brainstorm |
| 2: Hypothesize | Full (assumptions + risks) | Focused (change impact) | SKIP | Focused (preservation) |
| 3: Plan | Full quality gates | Full quality gates | Light plan | Full quality gates |
| 4: Build | Strict TDD | Test-alongside | Regression test | Characterization tests |
| 5: Verify | Full evidence | Full evidence | Regression proof | Behavior preservation |

## Phase 0: Erotetic-Lite Gating

Identify critical unknowns before proceeding. Use mode-specific checklists from
`${CLAUDE_SKILL_DIR}/references/gating-checklists.md`.

**Scope check first** (when a ticket is in play): delegate to the `scope-check` skill — auto-loaded by description match on the ticket ID — to enumerate the ticket's acceptance criteria into a checklist. The checklist becomes the working contract for the rest of the pipeline. Skip if no ticket is referenced.

**Process:**
1. Load the checklist for the detected mode
2. For each item, assess: **known** (have answer), **unknown** (don't have answer), or **N/A**
3. Count unknowns and assess complexity (1-5 scale)

**Blocking rule:**
- Unknowns > 3 AND complexity >= 3 → **BLOCK**. Ask user to resolve unknowns before proceeding.
- Unknowns > 3 AND complexity <= 2 → **WARN**. Note risks but allow proceeding.
- Unknowns <= 3 → **PASS**. Proceed to next phase.

**Output:** Present unknowns table to user. If blocked, list specific questions that need answers.

**State update:** Record gating result, unknowns count, complexity score, and resolution in state file.

## Phase 1: Design

Delegate to the brainstorming skill for design exploration.

**brainstorming**: Use this skill to explore the design space and refine the approach.

**Mode routing:**
- `greenfield`: Use `--deep` mode (comprehensive multi-agent analysis)
- `brownfield`: Use simple mode (Socratic questioning focused on change impact)
- `bugfix`: **SKIP** this phase entirely (go to Phase 3: Plan)
- `refactor`: Use simple mode (focused on target architecture)

**Tip — unfamiliar code region (brownfield / refactor)?** If Phase 0's classification routed here AND the target region is one you don't understand at a glance, suggest the user invoke [`/etk:zoom-out`](../zoom-out/SKILL.md) before activating brainstorming. A higher-level map (modules, callers, glossary) makes the Socratic questions sharper and reduces "designing without knowing what you're designing against." `zoom-out` is user-invoked — surface the suggestion, don't auto-fire.

**Process:**
1. Announce: "Phase 1: Design — Activating brainstorming skill"
2. Invoke brainstorming with appropriate mode
3. Capture design output (key decisions, architecture choices, constraints)

**Human checkpoint:** Present design summary and ask:
> "Design complete. Options: **yes** (approve and continue) | **adjust** (refine design) |
> **skip** (skip to planning) | **stop** (pause pipeline)"

**State update:** Record design decisions, chosen approach, and approval status.

## Phase 2: Hypothesize

Before investing in planning and implementation, explicitly state assumptions and define validation criteria.

**Mode routing:**
- `greenfield`: Full hypothesis — cover assumptions, risks, and a minimal validation approach
- `brownfield`: Focused — emphasize change-impact assumptions and integration risks
- `bugfix`: **SKIP** this phase entirely (go to Phase 3: Plan)
- `refactor`: Focused — emphasize behavior-preservation assumptions

**Process:**
1. Announce: "Phase 2: Hypothesize — Stating assumptions and defining success criteria"
2. Answer three key questions:
   - **Core assumption**: "What is our core assumption about why this solution will work?"
   - **Validation approach**: "How will we verify it works before investing in full implementation?"
   - **Invalidation risks**: "What are the top 3 things that could invalidate our approach?"
3. Define success criteria: "How will we know this works?"
4. Propose a minimal test or spike: "What is the smallest thing we can build to validate our approach?"

**Human checkpoint:** Present hypotheses summary and ask:
> "Hypotheses defined. Options: **yes** (approve and continue to planning) | **adjust** (refine assumptions) |
> **skip** (skip to planning) | **stop** (pause pipeline)"

**State update:** Record core assumption, success criteria, risks, and approval status.

## Phase 3: Plan

Create implementation plan with quality assessment and test strategy.

**quality-gates**: Use this skill to assess complexity and identify risks.
**testing-strategy-builder**: Use this skill to define the testing approach.

**Process:**
1. Announce: "Phase 3: Plan — Assessing quality gates and building test strategy"
2. Run quality gates assessment on the planned work
3. Break work into numbered tasks (each task = one logical unit of change)
4. Define test strategy per task using testing-strategy-builder
5. Order tasks by dependency (what must be built first)

**Task breakdown format:**
```
Task 1: [description] — Tests: [test type]
Task 2: [description] — Tests: [test type]
...
```

**Human checkpoint:** Present plan and ask:
> "Plan complete with [N] tasks. Options: **yes** (approve and start building) |
> **adjust** (modify plan) | **skip** (skip to building) | **stop** (pause pipeline)"

**State update:** Record task list, quality gate results, test strategy, and approval status.

## Phase 3.5: Business Invariants Gate

Before any code is written, check the plan against the project's documented business invariants (if present).

Follow the shared loader at `skills/code-review-playbook/references/load-business-invariants.md` with `mode: planning`. The loader handles all four cases (file present / missing / sparse / user-skipped) including the create-or-skip prompt.

**If the loader returns `status: loaded`:**

For each task in the plan, ask: "Does this task touch the domain of any invariant? Does the planned approach preserve it, weaken it, or risk violating it?" Present any plan tasks that risk violating a rule as a structured warning before Phase 4 begins:

```markdown
### ⚠ Planning-time invariants check

- **Task [N]** "[task summary]" touches **I.X** ([rule name]).
  Risk: [one-sentence concrete risk]. Suggested adjustment: [one-line fix].
```

Then ask the user: **"Adjust the plan to address these, or proceed anyway?"** If the user proceeds, the warning is surfaced again at review time by Agent #10 — planning-time consultation is *additional*, not a substitute for review-time enforcement.

**If the loader returns `status: skipped` or `status: absent`:** skip this gate and proceed to Phase 4. Note in the state record that invariants were not consulted.

**Skip-marker reminder:** if a project has `.claude/business-invariants-skipped` set, this gate is silent. Delete that file to re-enable prompting.

## Phase 4: Build

Implement each task using test-driven development. Delegate to the **tdd-implementer** agent
when available, or follow TDD protocol directly.

Follow TDD rules from `${CLAUDE_SKILL_DIR}/references/tdd-protocol.md` based on the detected mode.

**Process (per task):**
1. Announce: "Phase 4: Build — Task [N]/[total]: [description]"
2. Follow TDD cycle for the current mode:
   - `greenfield`: Write test → confirm fail → implement → confirm pass → refactor
   - `brownfield`: Write test + implementation → run together → refactor
   - `bugfix`: Write regression test → confirm it reproduces bug → fix → confirm pass
   - `refactor`: Write characterization tests → refactor → confirm still passing
3. After each task, update state with completion status

**coding-standards**: Use this skill to ensure implementation follows project standards.

**Human checkpoint** (after all tasks complete): Present changes summary and ask:
> "Build complete. [N] tasks implemented, [M] tests passing. Options: **yes** (proceed to
> verify) | **adjust** (revise implementation) | **stop** (pause pipeline)"

**State update:** Record per-task completion, test results, files modified.

## Phase 5: Verify

Collect evidence and run quality checks on the completed work.

**verify**: Use the standalone `/verify` skill (etk:verify) to run all checks.
**evidence-verification**: Use this skill to collect and verify evidence of completion.
**coding-standards**: Use this skill to validate code meets project standards.

**Process:**
1. Announce: "Phase 5: Verify — Collecting evidence and running quality checks"
2. Run the `/verify` skill pipeline: detect stack → run checks → collect evidence → assess quality
3. Verify coding standards compliance
4. Compile evidence summary

**Evidence checklist:**
- [ ] All tests pass (exit code 0)
- [ ] No linting errors
- [ ] Type checking passes
- [ ] Coverage meets thresholds
- [ ] No security issues introduced
- [ ] Code follows project standards

**Human checkpoint:** Present evidence summary and ask:
> "Verification complete. [pass/fail counts]. Options: **yes** (done — optionally create MR) |
> **adjust** (fix issues) | **stop** (pause pipeline)"

**State update:** Record evidence results, pass/fail status.

**On approval:** Mark pipeline as done. Offer to open the MR with **`/etk:prepare-pr`** — it authors the standardized description (Background / High-Level Design + sequence / Pitfalls) from the diff plus this pipeline's design/plan/verify context, then hands off to `/review-mr`. The Phase-5 verify result satisfies prepare-pr's Step-1 verify gate (it reuses it — no re-prompt). (`/review-mr` reviews an existing MR; it does not create one — prepare-pr is the surface that opens it.)

## State Management

Pipeline state is stored in `.develop/pipeline-state.md` (gitignored). Use the template from
`${CLAUDE_SKILL_DIR}/templates/pipeline-state.md`.

**On pipeline start:**
1. Create `.develop/` directory if it doesn't exist
2. Copy template to `.develop/pipeline-state.md`
3. Fill in metadata (task description, mode, timestamp)

**On phase transitions:**
1. Update current phase status to `completed` with summary
2. Update next phase status to `in-progress`
3. Record checkpoint decision (yes/adjust/skip/stop)

**On pipeline completion:**
1. Update all phases to `completed`
2. Set current phase to `done`
3. Record final summary

## Resume Protocol

When invoked with `--resume`:

1. Read `.develop/pipeline-state.md`
2. If file doesn't exist → error: "No active pipeline found. Start a new one with `/develop [task]`"
3. Find the current phase (status = `in-progress` or first `pending` after a `completed`)
4. Announce: "Resuming pipeline: [task] — Phase [N]: [phase name]"
5. Continue from that phase, preserving all previous phase results

## Phase Transitions

At every human checkpoint, parse user response:

| Response | Action |
|----------|--------|
| **yes** / **approve** / **continue** / **y** | Proceed to next phase |
| **adjust** / **change** / **modify** | Stay in current phase, incorporate feedback |
| **skip** | Mark phase as `skipped`, proceed to next |
| **stop** / **pause** | Save state, exit pipeline (resume later with `--resume`) |

If user response doesn't match any pattern, ask for clarification.

## Skills Delegated To

- **brainstorming** → Phase 1 (Design)
- **quality-gates** → Phase 3 (Plan)
- **testing-strategy-builder** → Phase 3 (Plan)
- **coding-standards** → Phase 4 (Build), Phase 5 (Verify)
- **evidence-verification** → Phase 5 (Verify)

## Reference Files

- `${CLAUDE_SKILL_DIR}/references/gating-checklists.md` — Mode-specific critical unknowns checklists for Phase 0
- `${CLAUDE_SKILL_DIR}/references/tdd-protocol.md` — TDD enforcement rules by mode for Phase 4
- `${CLAUDE_SKILL_DIR}/templates/pipeline-state.md` — State file template copied to `.develop/pipeline-state.md`

## Compliance

### Iron Laws

Violating the letter of these rules is violating the spirit of the rules.

**IRON LAW: NEVER SKIP A PHASE WITHOUT EXPLICIT USER APPROVAL**

**IRON LAW: NEVER CLAIM A PHASE IS COMPLETE WITHOUT PRESENTING EVIDENCE**

### Red Flags

| If You're Thinking... | Required Action |
|---|---|
| "This is a small change, I can skip gating" | STOP. Small changes with hidden dependencies cause the biggest incidents. Run the gate. |
| "The design is obvious, no need to brainstorm" | STOP. 'Obvious' designs miss edge cases. At minimum, run a quick system design check. |
| "I'll verify at the end instead of per-phase" | STOP. Late verification finds problems when they're expensive to fix. Verify each phase. |
| "The user seems impatient, I should move faster" | STOP. Speed without process creates rework. Present the phase checkpoint and let the user decide. |

### Common Rationalizations

| Rationalization | Why It's Wrong |
|---|---|
| "This bugfix doesn't need a plan" | Bugfixes have the highest regression rate. A light plan prevents introducing new bugs while fixing old ones. |
| "The hypothesis phase is overhead" | Stating assumptions explicitly catches wrong ones early. Skipping it means discovering wrong assumptions during implementation. |
| "I'll combine build and verify to save time" | Building without intermediate verification means debugging a larger change surface when something fails. |
