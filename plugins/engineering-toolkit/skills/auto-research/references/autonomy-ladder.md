# The Autonomy Ladder (L1 → L2 → L3)

How much should a loop be allowed to do on its own *yet*? This file names the three rungs and the
gates between them. The rungs are not new machinery — every one already ships; this assembles the
scattered pieces into one promotion path so an installer can reason about how much autonomy to
grant, and so a loop graduates on **evidence**, not optimism.

Adapted from `cobusgreyling/loop-engineering`'s L1→L2→L3 ladder (MIT); the rung definitions are
mapped onto capability this repo already enforces.

## The three rungs

### L1 — Report-only
The loop **observes and reports**; it proposes no changes. Lowest blast radius — the worst misfire
is a wrong sentence in a report.
- **Routes:** `/verify`, `/review-mr`, `/why-not`, and any `--unattended` watcher over a read-only
  route (`unattended-mode.md` § Compatibility by route).
- **Writes:** none beyond an append-only findings ledger.

### L2 — Propose-don't-apply
The loop **generates the change as a diff** in the findings ledger with an `apply with:` line, but
never lands it. A human applies after review.
- **Routes:** `--unattended` degrades the write-routes (`/cover`, `/experiment`, `/fix-bug`,
  `/develop`) to propose-only (`unattended-mode.md` rail 1).
- **Writes:** a ledger entry plus a companion `.patch`; nothing in the working tree.

### L3 — Confirmed write-loop
The loop **applies changes inside a guardrail box** — a git-rollback anchor per iteration, readonly
allowlists, correctness gates, a hard budget, and stuck detection — gated by a named stop-condition.
- **Routes:** confirmed-mode `/experiment`, `/cover`, `/fix-bug`, `/develop`.
- **Writes:** commits on a feature branch (never auto-merged to main).

## Route → starting rung

| Route / recipe | Safe starting rung | Why |
|---|---|---|
| `/verify`, `/review-mr`, `/why-not` | **L1** | read-only by construction |
| `docs-drift` | **L1** | reports drift, applies nothing |
| `error-sweep`, any `--unattended` write-route | **L2** | proposes a diff; a human applies |
| `pr-review-watch` | **L1 → L2** | starts as a report, graduates to drafting review comments |
| `coverage-90`, `perf-p95-200ms`, `flake-hunt` | **L3** | confirmed write-loop with a streak/goal gate + experiment guardrails |

This table maps the auto-research *routes*. For **which of our ~85 skills** can run as a scheduled routine at all — a report/propose classifier over the whole catalog — see [`routine-recipes.md`](routine-recipes.md).

## Promotion gates

Promote only when the evidence clears the gate — never on a calendar.

| Gate | Promote when… | Backed by |
|---|---|---|
| **L1 → L2** | the report has been **accurate across a streak of fresh runs** — you trust *what the loop sees* | `--streak=N` + the integrity law (`auto-research › SKILL.md` § Stop-Conditions) |
| **L2 → L3** | the **proposals have been correct on review** *and* the L3 box is wired: a checker, readonly allowlist + scope containment, max-attempts / stuck detection, a hard `--tokens` budget, and a human merge gate — you trust *what the loop does* inside the box | `/experiment` `safety-guardrails.md` (rollback, allowlists, correctness gates, stuck detection); the `holdout-wins` regression gate + "human review gate: always — never auto-merge to main" (`self-improvement.md` § Iteration Guardrails) |

A loop that can't describe its stop-condition or its escalation path does not get promoted. See the
[failure-mode checklist](../../agent-loops/references/loop-failure-modes.md) for the per-rung
pre-flight.

## Worked example — `pr-review-watch`

1. **L1.** `/auto-research --unattended --recipe pr-review-watch` — each wake runs a fresh
   `/review-mr` over the open PRs and appends a summary to the ledger. Nothing is posted. Watch it
   for a streak of clean, accurate reports (~270s when a PR is active, 1200s idle).
2. **L1 → L2.** Once the summaries are reliably right, let it **draft** inline comments via
   `/post-mr-comments` into the ledger with an `apply with:` line — you post after a glance.
3. **L2 → L3** *(optional, rarely needed for review)* — only if you want it to post automatically,
   and only behind a denylist + budget + a human merge gate. Most teams stop at L2 here: review is a
   place to *keep* a human.

> Most loops should live at the **lowest rung that still does the job**. L3 is for metric-driven
> write-loops (`/experiment`, `/cover`) where the guardrail box is tight and the stop-condition is
> objective; L1/L2 are the right home for anything touching review, design, or shared state.
