# Loop Failure-Mode Checklist

A pre-flight checklist for any **long-horizon or unattended loop** — `/experiment`, `/cover`,
`/auto-research --unattended`, a `/loop`-scheduled watcher, or a multi-agent `Workflow`.
Before you let a loop run unwatched, walk the ten modes below and confirm the cited guardrail
is actually active for *your* loop.

The taxonomy is adapted from `cobusgreyling/loop-engineering` (`docs/failure-modes.md`, MIT).
The **names and symptoms** are theirs; the **mitigations are ours** — this file is an index into
guardrails this repo already enforces, not a second copy of them. Where a row says *enforced*,
the mitigation is a hook or a hard budget cutoff, not advice.

## How to use

1. Pick the modes whose **symptom** could apply to your loop (a read-only watcher can ignore the
   write-scope modes; a write-loop must check all ten).
2. For each, open the cited guardrail and confirm it is wired for this run — the readonly globs
   cover your paths, `--tokens` is set, a checker is in the plan, and so on.
3. If a mode has no active mitigation for your loop, either add one or drop the loop one
   [autonomy rung](../../auto-research/references/autonomy-ladder.md) lower until it does.

## The ten modes

| # | Mode (severity) | Symptom | Our mitigation | Strength |
|---|---|---|---|---|
| 1 | **Infinite Fix Loop** (S2) | Same fix retried 5+ times; never converges | `/experiment` stuck detection — strategy-reset at 5 consecutive discards, hard `STUCK` stop at 6 (`experiment › references/safety-guardrails.md` § Stuck Detection); the triple-ceiling iteration cap; unattended **blocker-stop** ("do not retry-loop on a blocker", `auto-research › references/unattended-mode.md` § Termination) | enforced |
| 2 | **State Rot** (S1→S2) | Loop state cites merged PRs / closed tickets / stale branches | ctk continuity: `/create-handoff` prunes on roll-over, ledger is append-until-handoff, `/resume-session` reloads live state; the **integrity law** — every wake re-checks freshly, never cached (`auto-research › SKILL.md` § Stop-Conditions) | integrity-law |
| 3 | **Verifier Theater** (S2) | Verifier "approves" but CI fails / review finds obvious bugs | `/review-mr` Phase 3 objective **evidence gate** + Phase 5.5 checker that downgrades unverified findings ("do not trust the original agent's reasoning"); `/verify` reports real command exit codes; the `evidence-verification` skill | enforced — our strongest axis |
| 4 | **Notification Fatigue** (S1→S2) | Pings every few minutes; humans mute the loop | Unattended surfaces **only material findings** proactively (`unattended-mode.md` § The findings ledger); cadence guidance — don't poll continuously, 1200–1800s for idle drift, never 300s | convention |
| 5 | **Token Burn** (S1) | Bill spikes; full sub-agent chains run on empty/noisy triage | The **triple-ceiling token axis** — a hard **mid-run cutoff** in `--unattended` (`unattended-mode.md` rail 2), not a daily-budget afterthought; `/experiment` per-iteration cost table; `Workflow` `budget.remaining()` gating | enforced (hard stop) |
| 6 | **Over-Reach / Wrong Scope** (S2→S3) | Loop edits unrelated modules or denylisted paths | `/experiment` readonly **file allowlists** + scope containment (`safety-guardrails.md` § File Allowlists); ctk **security-blocker** hook (in-hook denylist); the **SCOPE-restate** protocol + `/scope-check`; review-mr scope-drift check | enforced (hook + allowlist) |
| 7 | **Comprehension Debt Spiral** (S2) | Velocity up, but nobody can explain recent changes; review rubber-stamps | ctk continuity handoffs capture `key_decisions` + `accomplished` as an audit trail; `/architecture-decision-record` for significant calls; review-mr requires a human reviewer; the `program.md` intent contract | convention |
| 8 | **Cognitive Surrender** (S2) | Team adopts "the loop handles it"; skepticism erodes | **Propose-don't-apply** keeps a human gate (unattended rail 1); **user-initiated-only** — no self-bootstrapping paid loop (rail 3); the confirmed-mode Phase 3 confirm box | design invariant |
| 9 | **Parallel Collision** (S2) | Two sub-agents edit the same files; merge conflicts; corrupt state | **Structurally**, every etk agent excludes `Agent`/`Task`, so a routed skill cannot spawn colliding children at all (root CLAUDE.md) — we buy collision-safety by forbidding fan-out, not by isolating it. For the one place we *do* run agents concurrently — `/etk:start-parallel`'s multi-terminal model — Step 1 puts each terminal in its own **git worktree**, so `.squad/` locks are belt-and-braces rather than the only guard. If we ever ship `Workflow` `agent()` fan-out, `isolation: 'worktree'` is the native lever to reach for; we ship none today. | structural (+ worktree in start-parallel) |
| 10 | **Escalation Failure** (S2) | Loop stuck retrying; the human is never told | Unattended **blocker-stop** writes the blocker to the ledger and **stops**, then surfaces proactively (`SendUserFile status:proactive`); the subagent **status protocol** — `BLOCKED` escalates to the user (root CLAUDE.md) | enforced |

## Before you press go

A 30-second gate for an unattended or write-loop:

- [ ] **Budget** — `--tokens` set (mode 5); iteration / wall-clock ceiling set (mode 1).
- [ ] **Scope** — readonly globs cover tests / CI / locks; the target scope is named (mode 6).
- [ ] **Verification** — a checker runs *real* commands, not self-attestation (mode 3).
- [ ] **Stop** — a stop-condition is named and counts only fresh runs (modes 1, 2).
- [ ] **Escalation** — blockers stop-and-surface; they don't silently retry (modes 1, 10).
- [ ] **Human gate** — write-loops stay propose-only or require review before merge (modes 7, 8).

If you can't tick a box, the loop belongs one [autonomy rung](../../auto-research/references/autonomy-ladder.md)
lower until you can.

> Modes that are structurally impossible in this repo's default configuration (e.g. nested-agent
> fan-out collisions — etk agents don't nest) are listed for completeness but need no per-run
> action here.
