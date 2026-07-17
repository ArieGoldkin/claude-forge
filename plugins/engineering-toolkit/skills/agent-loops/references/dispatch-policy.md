# The Dispatch Ladder (L0 → L3)

*How many minds should work this task?* This file is the single source for **agent-dispatch
decisions** across the routed skills — when to stay solo, when to spawn one specialist, when to fan
out a team, and when a dynamic `Workflow` is warranted. It is the orthogonal axis to the
[autonomy ladder](../../auto-research/references/autonomy-ladder.md): that ladder governs *how
unattended* a loop may run; this one governs *how many agents* a task gets. A routed skill cites its
rung from here — it does not restate the ladder (adding a rung or criterion must stay a one-place
edit).

**The default is the lowest rung that does the job.** Escalation is a brake, not an accelerator:
each rung must be *earned* by a criterion below, never assumed.

## The structural constraint (read first)

Every agent in this repo excludes `Agent`/`Task` from its tools — **agents cannot spawn agents**
(root `CLAUDE.md` → Subagent Scope Restate note; [failure-mode #9,
Parallel Collision](loop-failure-modes.md)). All dispatch happens from the main loop or a forked
skill. Any design that assumes nested delegation is dead on arrival; the main loop *is* the
orchestrator.

## The four rungs

| Rung | Shape | Escalate when… | Never when… |
|---|---|---|---|
| **L0 — Solo** (default) | main loop does the work | — (this is where every task starts) | n/a |
| **L1 — Single specialist** | one sub-agent, one report | **independence matters**: reviewing your own work (a trust boundary — self-report misses what an independent reviewer catches), or **noise isolation**: a broad scan whose raw output would pollute context (`Explore`) | the task is a follow-on edit the main loop already has full context for |
| **L2 — Team fan-out** | 3+ agents, single-message dispatch | the work decomposes into **≥3 independent, file-disjoint units** AND **coverage or diversity is the goal** (review dimensions, design perspectives, per-module builds) | units share files (use worktrees or drop to L0/L1); the "team" would just serialize the same judgment |
| **L3 — Dynamic `Workflow`** | scripted pipeline/fan-out | unknown-size work-lists, loop-until-dry, adversarial-verify chains needing deterministic control flow — **and the user explicitly opted in** (ultracode / "use a workflow") | as a default rung. The `Workflow` opt-in gate is the user's cost control; no route may defeat it |

**L2 mechanics** (cite, don't restate, at the dispatch site): emit all `Agent` calls in a **single
message** (root `CLAUDE.md` → Opus guidance #2 — soft phrasing serializes); every agent gets the
SCOPE-restate + status protocol (root `CLAUDE.md`); writes that could collide get **worktree
isolation** (`/etk:start-parallel` Step 2 is the in-repo exemplar).

## Route → rung map

The exemplars ship their own dispatch tables — this map points at them rather than duplicating:

| Route / skill | Rung | Team / selection rule lives in |
|---|---|---|
| `/review-mr --standard/--deep` | **L2** | its Phase-4/5 domain-conditional table (3–10 agents) — the exemplar |
| `/brainstorming --deep` | **L2** | `deep-mode-phases.md` (~11-perspective panel) — the exemplar |
| `/develop --parallel` (Phase 4) | **L2** | the domain→agent map in `development-pipeline/SKILL.md` § Parallel Dispatch |
| `/develop` Phase 5 | **L1** | `adversarial-verifier` (or `quality-reviewer`) — independent gate on self-authored work (`development-pipeline/SKILL.md` Phase 5) |
| `/fix-bug` pre-MR | **L1** *(target state — not yet wired into the skill)* | same independent gate before opening the MR |
| `/cover` | **L2** | its own per-tier dispatch (unit/integration/E2E agents — `cover/SKILL.md`); a per-module worktree-isolated sweep is *target state, not yet wired* |
| `/ctk:web-research` | **L1** | `web-research-analyst` (already wired) |
| `/verify` · `/experiment` · `/etk:prepare-pr` · `/investigate-sentry` | **L0** | sequential / guardrail-boxed / human-gated — deliberately solo |
| any route facing an unknown-size list | **L3** | `Workflow` — only on explicit user opt-in |

## Model economics at dispatch time

All agents declare `model: inherit` — on an expensive session model, a fan-out multiplies the most
expensive configuration. The advisory tiering (scans → `sonnet`, reduction → `haiku`) and its
**pilot-before-flipping rule** live in root `CLAUDE.md` → *Model economics for subagent dispatch*;
the enforceable backing is `enforceAvailableModels` (root `CLAUDE.md` → *Model & MCP governance*).
Phase-D of the adoption plan: pilot cheap tiers by piggybacking an already-planned review wave —
never flip agent frontmatter on intuition.

## Failure modes this ladder guards against

- **Fan-out theater** — 5 agents produce one agent's insight five times. If diversity isn't the
  goal, L2 wasn't earned.
- **Silent-return orchestration** — a forked/fanned pipeline whose final message loses the work
  (the `/review-mr` 2.14.1 regression). Every dispatch surface needs an explicit return contract.
- **Wrong-specialist dispatch** — a domain map mis-routes (a "CRUD task in an AI repo" →
  `ai-ml-engineer` flounders). Each agent's `description` carries a "Do NOT use for" clause —
  the dispatch site must honor it and give cheap-tier agents explicit stop conditions.
- The unattended variants (Token Burn, Parallel Collision, Escalation Failure) are the
  [loop failure-mode checklist](loop-failure-modes.md)'s domain — walk it before any L2+ loop
  runs unwatched.
