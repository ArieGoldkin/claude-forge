# Recipe Presets

Recipes are **named goal + stop-condition templates** for `/auto-research --recipe <name>`. They package the common loops so a user names the intent instead of hand-authoring the target skill, budget, and stop-condition every time. A recipe is a preset, not new machinery — it expands to an existing skill invocation and rides the triple ceiling (iters / minutes / tokens) and the [Stop-Conditions](../SKILL.md) model.

> To run a preset as a **persistent, scheduled routine** (fires unattended on its own cron, survives the session) rather than an in-session `/loop`, see [`routine-recipes.md`](routine-recipes.md) — it also classifies which skills beyond these presets are routine-safe.

## How a recipe expands

`--recipe <name>` resolves to: a **target skill**, its **args**, a **budget** (any of the three ceilings the recipe wants to tighten), and a **stop-condition**. The user can override any field inline — `--recipe coverage-90 --until streak=3 --tokens 400k` keeps the recipe but raises the streak and token budget.

The resolved plan is still shown in the Phase 3 confirm box and still requires approval. Recipes never bypass confirmation or a target skill's guardrails.

## Catalog

| Recipe | Target skill + args | Budget override | Stop-condition | Use when |
|---|---|---|---|---|
| `coverage-90` | `/cover {scope} --target=90% --streak=2` | — | `streak=2` | drive coverage to 90% and confirm it holds across two fresh runs |
| `perf-p95-200ms` | `/experiment` minimizing p95 latency below 200ms | — | `goal` | optimize a latency metric to a hard threshold |
| `error-sweep` | `/fix-bug` over the top open error, investigation-first | `--tokens 300k` | `budget` | chip at the error backlog within a cost cap, propose fixes |
| `docs-drift` | `/verify` + a doc-vs-code consistency scan | — | `goal` | catch docs that disagree with the code they describe |
| `flake-hunt` | `/verify --streak=5` | — | `streak=5` | surface intermittent test failures by demanding 5 consecutive greens |
| `pr-review-watch` | `/review-mr` over the open PRs/MRs, report-only watch via `/loop` | `--unattended --tokens 300k` | `budget` | babysit open PRs/MRs — surface blockers and draft review notes as they appear |

`{scope}` is filled from the goal text or the current selection; if absent, auto-research scans the codebase per its normal Phase 2 step.

## Operational profile

What each preset costs to *run as a loop* — the cadence to schedule it at, the [autonomy rung](autonomy-ladder.md) it's safe to start on, and its rough token weight. (Adapted from `cobusgreyling/loop-engineering`'s per-pattern cadence/readiness/cost metadata, MIT.)

| Recipe | Cadence | Start rung | Token cost |
|---|---|---|---|
| `coverage-90` | 1200–1800s (idle drift) | L3 confirmed | medium |
| `perf-p95-200ms` | on-demand | L3 confirmed | high |
| `error-sweep` | 1200–1800s | L2 propose-only | medium |
| `docs-drift` | 1200–1800s | L1 report | low |
| `flake-hunt` | on-demand / per-CI | L3 confirmed | medium |
| `pr-review-watch` | ~270s active · 1200s idle | L1 report → L2 propose | high |

`error-sweep` already covers loop-engineering's "Issue Triage" / "CI Sweeper" intent (top open error, investigation-first). Its "Changelog Drafter", "Post-Merge Cleanup", and "Dependency Sweeper" patterns are **not** ported: none has a backing skill, so per the "Adding a recipe" rules below they are skill gaps, not recipe gaps.

## Adding a recipe

A recipe must satisfy three rules:

1. **Rides an existing skill.** It expands to `/experiment`, `/cover`, `/verify`, `/fix-bug`, `/develop`, `/review-mr`, or `/brainstorming` — never a new execution path. If a desired loop has no backing skill, that's a skill gap, not a recipe.
2. **Names a stop-condition.** One of `goal`, `streak=N`, `holdout-wins`, `budget`. Default to `goal` unless flakiness (`streak`) or an open-ended sweep (`budget`) is the point.
3. **Respects the integrity law.** Any `streak`/`holdout` stop-condition counts **only fresh runs** — never a cached or skipped prior pass (see SKILL.md → Stop-Conditions).

To add one: append a row to the catalog above with the four fields (target+args, budget override, stop-condition, use-when). Keep expansions in the real flag syntax of the target skill (e.g. cover uses `--target=N%` and `--streak=N`). Validate by running `--recipe <name> --dry-run` and confirming the expanded plan matches intent.

## Relationship to OrchestKit's loop recipe book

This adopts the *capability* of ork's loop recipe book (pre-built `/goal` recipes) in our idiom: we route named presets through the existing engine + `/auto-research` rather than shipping a parallel `/goal` command or a `skills.sh` publication pack. Capability, not substrate.
