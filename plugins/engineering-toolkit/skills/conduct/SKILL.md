---
name: conduct
description: "cmux Conductor — routes a work item to the right execution topology. Use when: you have a work item or ticket and want the right amount of cmux (including none), you're choosing between fleet/race/solo execution, you want agents opened under your current workspace, or you want /etk:develop run over cmux panes. Triggers on: conduct, cmux run, run this in cmux, fleet this, race this, orchestrate execution, how many agents, dev fleet, open under this workspace"
effort: high
---

# Conduct — the cmux Conductor

Routes a work item to an **execution topology**, the way `/auto-research` routes a goal to
a **skill**. The two compose: auto-research answers *which process*; conduct answers *what
shape that process runs in* (and whether cmux is involved at all). Human writes intent,
agent picks the topology.

**Core discipline — the lowest rung that does the job.** Escalation is a brake, not an
accelerator (`agent-loops/references/dispatch-policy.md` — cite, don't restate). Most work
items route to the leftmost rungs; a fleet must be *earned* by the classification below,
never assumed. Routing everything to a fleet is the fan-out-theater failure mode.

**cmux is optional infrastructure.** Routes that need it require the cmux app + socket
(`etk:cmux` skill — macOS only). When cmux is absent, conduct still classifies and emits;
patterns 1–2 degrade to their non-cmux equivalents (noted per pattern in the routing map).

## Phase 1 — Classify

Read the work item (`$ARGUMENTS`) and score **four axes**:

| Axis | Values | Inferred from |
|---|---|---|
| **Scope** | single task · divisible job · full ticket | Classify on the **deliverable**, in this order: (1) a **research/estimation** deliverable — spike, "research the work needed", "turn X into tickets", "size it", "investigate options" — → **divisible**, *even when it carries a ticket ID*; (2) "audit/map/sweep across…" → **divisible**; (3) a ticket ID **or** "implement/build/fix X end-to-end" → **ticket** (this keeps ordinary bug and feature tickets on row 3/4); (4) otherwise **single**. A ticket ID still implies ticket scope — it just no longer overrides a research deliverable |
| **Lanes** | 1 · 2–3 · 4+ | independent, file-disjoint work streams (backend/frontend/tests…); "and"-chains of separable deliverables |
| **Visibility** | watch · background | "watch", "show me", "I want to see/steer" → watch; quick checks → background |
| **Diversity** | none · best-of-N · race | "compare/multiple takes/which model" → best-of-N; "fast/hotfix/prod down/first wins" → race |
| *(tickets only)* **Kind** | bug · feature | error/regression/broken → bug; build/add/implement → feature |

**Fifth axis — Container (where it lands).** Scored from live cmux state, not the item
text. Outside cmux (`CMUX_WORKSPACE_ID` unset) → `new-workspace` (nothing to nest under).
Inside cmux, read the container BEFORE routing with **`cmux identify`** and take it from
`caller.workspace_ref`, then resolve that against `cmux workspace list --json` (fields
`custom_title`, `current_directory`, `description`) for the name/project you match on.

**Never route on `cmux current-workspace`** — it reports the *focused* workspace, not the
caller's. Semantics, evidence and the reproduction: `etk:cmux` skill §
"`identify` ≠ `current-workspace`".

**Self-check before routing:** if `cmux current-workspace` differs from
`caller.workspace_ref`, surface the divergence in the Phase-3 box. **Diagnostic only —
routing always uses `caller.workspace_ref`.**

Then match the container to the item:

| Container | When | Placement |
|---|---|---|
| **nest-under-current** *(default on match)* | the current workspace IS for this work — same project/repo/ticket family | one workspace = one workflow: the caller's pane orchestrates, each lane is its own `new-pane` (visible split) UNDER it, never a sibling |
| **join-group** | team-scale fleet on matched work | `workspace-group` anchored on the current workspace |
| **new-workspace** *(fallback)* | container mismatch, or outside cmux | the pattern's own named-workspace recipe |

Workspaces are durable and project-scoped in real use ("Platform", "Bug-fixing" live for
weeks) — routing into the EXISTING workspace is the norm; a ticket-named throwaway
workspace is the exception, not the default.

If scope or lanes are genuinely ambiguous, ask **one** clarifying question, then route.

## Phase 2 — Route

First matching row wins (top-down); every pattern's emission template + worked example
lives in `${CLAUDE_SKILL_DIR}/references/routing-map.md` — read it before emitting.

| # | Shape | Pattern | Rung |
|---|---|---|---|
| 1 | diversity = race | **Race + verify gate** (winner must pass `etk:adversarial-verifier`) | L2 |
| 2 | diversity = best-of-N | **Broadcast fan-out + reconcile** | L2 |
| 3 | ticket · 1 lane, or 2–3 lanes background | **Pipeline solo** — `/fix-bug` (bug) / `/develop` (feature); cmux optional watch-pane | L0/L1 |
| 4 | **scope = full ticket** AND (watch requested OR 4+ lanes) | **develop-fleet** — `/develop` as lead pane, worker panes on demand (**one pane at first** — see below) | L2 |
| 5 | divisible job | **Sweep fan-out / fan-in** | L2 |
| 6 | single task · watch | **Single agent in a pane** | L1 |
| 7 | single task · background | **L0 solo** — no cmux; run it (or the fitting skill) directly | L0 |

Fleet-shape default for row 4 is **lead-only, fan out on demand**: boot one primed lead
pane; workers appear only if the pipeline's Phase 4 actually decomposes. Never pre-lay
role panes on assumption.

**Say the pane count at the gate.** Because lead-only is the default, an operator expecting a
visible fan-out sees a single pane and reads it as failure. The Phase-3 box therefore carries a
**"You'll see"** line: either `N panes now` or `1 lead pane now, workers on demand`. Filling it
in is not optional — an unstated lead-only routing is indistinguishable from a broken dispatch.

The pattern row picks the **shape**; the Container axis picks the **placement** — each
cmux pattern in the routing map carries a placement branch (§ Placement branch). The
invariant: **workers are `new-pane` targets — never `new-workspace`, never a background
tab** — with exactly two named exceptions: (1) the race (row 1), whose per-racer
workspaces are how the completion event's `workspace_id` identifies the winner; (2) the
**sidebar-dashboard tier** — 5+ lanes, or a run the operator wants to *watch* as a board —
where each lane gets its own colored workspace because per-lane state pills and progress
bars are workspace-scoped (`set-status`/`set-progress` take no surface target; a pane
can never carry them). Ladder and teardown rules: agent-fleets.md § Visibility. Both
exceptions still confirm at Phase 3 like any multi-session pattern.

## Phase 3 — Confirm

Present the plan and get explicit approval — a fleet or race is a deliberate cost choice:

```
┌───────────────────────────────────────────────┐
│  Conduct Plan                                 │
│  Item:     {work item / ticket}               │
│  Shape:    {scope · lanes · visibility · div} │
│  Pattern:  {name} (rung {L0-L2})              │
│  Container:{nest-under-current · join-group   │
│             · new-workspace} + target ws name │
│  You'll see:{N panes now · 1 lead pane now,   │
│             workers on demand}                │
│  Sessions: {N} ({cost note})                  │
│  Recipe:   {one-line summary of what runs}    │
│  [Run]  [Adjust]  [Cancel]                    │
└───────────────────────────────────────────────┘
```

Row 7 (L0 solo) may confirm inline — one sentence, no box. Do NOT proceed without
approval on any multi-session pattern.

**The cost note is a real number, not a shrug.** Every pane lane is a *cold-start* agent
session: it pays the full system prompt + SessionStart injection before it reads a single
file. Re-measured 2026-07-29 on a second three-lane fleet with **all three cost footers read
directly** (superseding the same day's earlier ~$0.45 figure, which rested on two readable
footers and one truncated one): **64.8–65.1k input tokens and $0.54–$0.60 per lane, $1.71 for
the three**, to return 148–319 output tokens apiece. Quote `Sessions: N (~$0.57+ per lane
cold-start)` so the operator approves a fan-out knowing its floor — this is the arithmetic
behind "the lowest rung that does the job," and it is why a fleet must be earned. The dominant
term is ctk's SessionStart continuity injection, not the task: a one-question lane and a
five-directory lane cost within 10% of each other.

## Phase 4 — Execute (emit-first)

**Conduct emits; it does not silently drive.** Produce the ready-to-run invocation from
the routing map, parametrized with the actual work item / ticket.

- **Outside a cmux session** (no `CMUX_WORKSPACE_ID`): emit the recipe as the deliverable
  and stop — the user runs it where they want it. To start *inside* cmux instead, the
  cold-start launcher `${CLAUDE_SKILL_DIR}/scripts/cmux-conduct.sh "<item>"` boots a
  workspace already running conduct (see its `--help`); by design it refuses to run from
  inside cmux, where the Container axis already governs placement.
- **Inside cmux**: emit per the Container axis — nested placements target the CURRENT
  workspace as a `new-pane --type terminal` (visible split), dispatched with `send` +
  `send-key enter`, never a sibling. **A driven lane is never `--type agent-session`** —
  those surfaces reject `send`, `send-key` and `read-screen` (`invalid_params: Surface is
  not a terminal`), so the lane opens empty and can never be collected from
  (routing-map.md § Placement branch). Offer to run it now. If accepted, drive it per the
  `etk:cmux` skill — `--focus false` everywhere, **file-based completion** (each lane writes
  `$TEAM/<title>-<assignment>.md` with `STATUS:` as its LAST line; collect with `collect_lane`, never by
  grepping `read-screen` — the cmux skill's `references/read-and-notify.md` §1), scoped
  teardown verified with `cmux tree`, and every fleet rule in the cmux skill's
  `references/agent-fleets.md`. Never steal focus; never close panes or surfaces you
  didn't create. **Teardown is not finished when the panes close** — any pill, progress bar
  or log line the run wrote persists on the workspace and must be cleared too
  (agent-fleets.md § Sidebar teardown; verify with `cmux sidebar-state`).
- **Label at dispatch (mandatory when driving).** The orchestrator names every lane AT
  SPAWN — agents never self-label: `rename-tab --surface <the ref new-pane printed>`
  with an emoji role prefix, plus a `set-status` sidebar pill per role. **Never emit a bare
  `rename-tab`** — its targeting flags are optional, so it retitles the caller's own tab
  (routing-map.md § Placement branch). Re-label on hand-off — stale titles misroute
  humans (a pane titled with yesterday's ticket doing today's work is a live failure
  mode). Labels are `<glyph> <Title>·<assignment>` — a lane is a teammate with a job
  title, never an index. The roster (titles, glyphs, file convention) + in-pane
  fallbacks live in agent-fleets.md § Identity — the single source; don't inline a
  copy here.
- Pattern-specific guardrails (race verify gate, worktree isolation for parallel writes,
  single-line dispatch) come from the cited references — apply them, don't reinvent them.

## Phase 5 — Report

One block: shape → pattern → what ran (or what was emitted) → per-lane `collect_lane`
verdicts (read from each lane's result file, never scraped off a screen)
→ synthesis (for broadcast/sweep: the reconciliation IS the deliverable; for race: winner +
verifier verdict, named by approach). End with `STATUS: DONE | DONE_WITH_CONCERNS | BLOCKED`.

**For broadcast/sweep, report the slice census before the aggregate** — `got/expected`, and
every dropped slice by name and reason. An aggregate over an unstated subset is a false
green: five different lane failures all render as a plausible smaller number that is
indistinguishable from a legitimate one. If any slice is missing, the run is
`DONE_WITH_CONCERNS` at best, and the aggregate is withheld, not caveated
(`etk:cmux` → `references/agent-fleets.md` § Fan-in). **Retrying a dropped slice is bounded**
(same ref, § Give-up bound) — name the cause or do not spend the round.

## Safety rails

- **No recursive conduct** — conduct never invokes itself, and never re-routes a routed
  skill's own sub-dispatch (the pipeline's Phase-4 fan-out is `/develop`'s decision).
- **Confirmation is per-run**; there is no unattended mode. A fleet that should run
  unwatched belongs to `/auto-research --unattended` (propose-only), not conduct.
- Routed skills' own gates apply unchanged (develop's phase gates, prepare-pr's approval,
  review-mr's never-auto-post).
