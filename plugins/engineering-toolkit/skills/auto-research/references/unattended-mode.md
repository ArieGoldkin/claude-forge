# Unattended / Propose-Only Mode

`/auto-research --unattended <goal>` runs the loop without a human watching each iteration. Because no one is in the loop, the mode trades per-change confirmation for a single safety invariant that makes background autonomy safe:

> **Propose-don't-apply.** In unattended mode auto-research never mutates source, never `git commit`s, never `git push`es. Its *only* write is appending to a findings ledger. The worst case of a misfire is a stale ledger entry — never an unsupervised commit.

This captures the value of ork's `ci-sentinel` (a background watcher that observes and reports) **without** ork's substrate (no daemon, no server, no session registry). The loop self-schedules on CC-native primitives and stops itself.

## When to use it

A good unattended goal is a **watcher**: observe some state on an interval, and report or propose when it changes.

| Good fit | Why |
|---|---|
| "watch `main` for failing tests and tell me" | observe → report; nothing to apply |
| "flag coverage drift below 85% as it happens" | `/verify`/`/cover` in read-only sentinel form |
| "keep an eye on the open-error backlog and draft fixes" | `/fix-bug` degraded to propose-only (diff in the ledger) |
| "watch CI on this branch and summarize failures" | tight-cadence external-state watch |

**Do NOT use it** for goals that only make sense when applied immediately (a build you need green *now*, an interactive design session, anything where a human is already present to confirm). For those, run the normal confirmed 5-phase flow.

## The four hard rails

1. **Propose-don't-apply.** No `Edit`/`Write` to source, no `Bash(git commit*)`, no `Bash(git push*)`. The findings ledger is the only writable artifact. Write-routes (`/cover`, `/experiment`, `/fix-bug`, `/develop`) are *degraded to propose-only*: they generate the change as a diff and write it to the ledger under an `apply with:` line — they do not land it.
2. **Hard token cap — a mid-run cutoff, not just a between-iteration check.** The token axis of the triple ceiling (`--tokens`) becomes a hard stop the moment cumulative output crosses it. This is the cost brake that lets a loop run unattended without a human watching spend. (In confirmed mode the ceiling is checked between iterations; unattended makes it a hard cutoff.)
3. **User-initiated only.** The first invocation must come from a human. The loop self-schedules its *next* wake, but it can never bootstrap itself — there is no path by which auto-research starts a paid background loop on its own. This is the no-paid-background-LLM rule.
4. **Bounded lifetime.** Every unattended run carries an explicit ceiling on total wake-ups — `--max-wakeups N` (default 24) and/or a calendar cap `--deadline <ISO-date>`. The loop schedules its *own* next wake and stops scheduling the moment any terminator fires (see Termination). A loop that cannot describe how it ends does not get to run unattended.

## Self-scheduling (CC-native, no daemon)

Two flavors, chosen by lifetime:

| Flavor | Primitive | Lives | Use when |
|---|---|---|---|
| **Session-bound, adaptive** (default) | `ScheduleWakeup` (the `/loop` dynamic self-pacing primitive) | the CC session | the watcher picks its own next interval from what it finds |
| **Session-bound, fixed cron** | `CronCreate` | the CC session only — `durable` is a **no-op**, and recurring jobs auto-expire after 7 days | a steady cron cadence *while you work* |
| **Persistent routine** | `/schedule` → the claude.ai triggers API (`RemoteTrigger`) | across sessions — a cloud routine with its own claude.ai URL | a watch that must outlive the session |

Default to `ScheduleWakeup` — it self-paces (tighten to ~270s on an active failure, relax to 1200–1800s when idle), needs no cloud agent, and dies cleanly when the session ends. Reach for `CronCreate` when you want a fixed cron cadence *within the session* — it cannot outlive the session (its `durable` flag has no effect) and recurring jobs expire after 7 days. For a watch that must **survive** the session, `/schedule` it as a persistent cloud routine (see [`routine-recipes.md`](routine-recipes.md)). `CronCreate` is fixed-interval by design, so the adaptive cadence below applies to the `ScheduleWakeup` flavor. Either way, **auto-research does not poll continuously**: it sleeps between checks and is re-invoked by the harness.

> **User-facing equivalents.** `--unattended` is the goal-driven, propose-only counterpart to wrapping auto-research in `/loop` (session-bound, self-pacing) or `/schedule` (persistent cloud routine) — it adds the four hard rails those plain commands don't impose. An installer who already runs `/loop` will recognize the cadence model; the difference is the propose-don't-apply safety contract.

### Cadence

These are wall-clock schedule intervals (not thinking budgets), so concrete numbers apply. Match the interval to how fast the watched state actually changes:

| Watching | Interval | Note |
|---|---|---|
| Active external state (a CI run, a deploy) | ~270s | stays inside the prompt-cache window |
| Idle drift (coverage, docs, error backlog) | 1200–1800s | nothing changes faster; don't burn cache 12×/hr |
| Daily/periodic | `CronCreate` | fixed-interval routine, not an adaptive session wake |

**Don't pick 300s** — it's the worst of both: you pay the cache miss without amortizing it. Drop to ~270s (stay cached) or commit to 1200s+ (one miss buys a long wait).

## The findings ledger

Default path: `docs/artifacts/unattended/<goal-slug>.md` (append-only; gitignored in this repo by design — unattended output is for review, never auto-committed). Override with `--ledger <path>`.

Each wake-up appends one timestamped entry. Per the integrity law (see SKILL.md → Stop-Conditions), **every wake re-checks freshly** — a sentinel never reports cached state:

```markdown
## 2026-06-22T14:05:00Z — wake 3/24
Checked:  npm test (fresh run) on main @ a1b2c3d
Found:    2 failing tests in auth/session.test.ts (NEW since wake 2)
Severity: high
Proposal: token-expiry assertion is off-by-one; see diff below
          apply with: git apply docs/artifacts/unattended/watch-main.patch
Next:     re-scheduled +270s (active failure → tight cadence)
```

For a **write-route** proposal, the diff is emitted as a companion `.patch` file beside the ledger (same slug, e.g. `watch-main.patch`) so the `apply with: git apply …` line lands it verbatim after review — the ledger entry is the human-readable record; the patch is the applyable artifact. Nothing is applied automatically.

When a wake finds something **material**, surface it proactively (e.g. `SendUserFile` with `status: proactive`, or a push notification) so the human knows to open the ledger — don't rely on them noticing a silent file write.

## Termination

The loop stops scheduling — and the watch ends — when any of these fire:

- **Stop-condition met** — the goal/streak/holdout condition is satisfied (fresh runs only).
- **Budget exhausted** — any axis of the triple ceiling (iters / minutes / **tokens**) is hit; the token axis is the hard mid-run cutoff.
- **`--max-wakeups` reached** or **`--deadline` date passed.**
- **Blocker hit** — write the blocker to the ledger and **stop**. Do not retry-loop on a blocker; that just burns tokens unattended with no human to break the cycle.

In every case the final ledger entry states *why* the watch ended.

## Compatibility by route

| Route | Behavior in unattended mode |
|---|---|
| `/verify`, `/review-mr`, `/why-not` | Native fit — already read-only; report to the ledger. |
| `/cover`, `/experiment`, `/fix-bug`, `/develop` | **Degraded to propose-only** — generate the change as a diff in the ledger with an `apply with:` line; never apply. |
| `/brainstorming` | Allowed (writes a design doc, not source), but rarely useful unattended — it wants a human in the loop. |

## Confirmation model

Confirmation moves from *per-change* to *once-at-setup*. The `--unattended` invocation **is** the confirmation — the user opts into the whole watch up front. After that there is nothing to confirm per iteration, because nothing is applied. `--unattended` therefore implies `--no-confirm` for the iterations, but never implies permission to apply.

## Relationship to OrchestKit's ci-sentinel

This adopts the *capability* of ork's unattended watcher — observe state in the background, report/propose, never act blindly — in our idiom: CC-native scheduling instead of a daemon, a file-based findings ledger instead of a coordination DB, propose-don't-apply instead of an autonomous committer. We get ~90% of the sentinel's value; the last 10% (true always-on cross-session *coordination*) is the Tier-C substrate we deliberately decline. Capability, not substrate.
