# Routine Recipes — running a routine-safe skill on a schedule

A **routine** is a *persistent, scheduled* run of a skill — the unattended watcher, promoted from
"lives in my session" to "runs whether or not I'm here." This file answers the two questions the
other loop docs don't: **which of our skills can be a routine at all**, and **how to schedule one
safely**. It adds no machinery — routines ride Claude Code's native scheduler and inherit the rungs
and rails already defined elsewhere. It only classifies and assembles.

- Rung definitions (L1/L2/L3) and promotion gates → [`autonomy-ladder.md`](autonomy-ladder.md).
- The four hard rails an unattended loop runs under → [`unattended-mode.md`](unattended-mode.md).
- In-session goal presets (`--recipe <name>`) → [`recipes.md`](recipes.md).
- The pre-flight failure-mode gate → [`loop-failure-modes.md`](../../agent-loops/references/loop-failure-modes.md).

This file **cites** those; it does not restate a single rung, rail, or cadence number.

## Buy, don't build: `/schedule` is the scheduler

We do not ship a scheduler, a daemon, or a routine registry. Claude Code already provides the
substrate, in two flavors that differ only by **lifetime** — pick by whether the routine must
outlive your session:

| Flavor | Primitive | Lives | Fires on |
|---|---|---|---|
| **In-session** (ephemeral) | `ScheduleWakeup` (adaptive `/loop`) · `CronCreate` (fixed cron) | this CC session only — `CronCreate` is session-only (its `durable` flag is a **no-op**) and recurring jobs auto-expire after 7 days | a wall-clock interval while the REPL is idle |
| **Persistent routine** (the real routine) | `/schedule` → the claude.ai triggers API (`RemoteTrigger`) | across sessions — a cloud object with its own claude.ai URL, managed by `/schedule` (`list`/`get`/`create`/`update`/`run`) | a **cron** schedule or an **on-demand `run`** |

An in-session loop is for cadence *while you work* (watch this CI run, drift-check coverage this
afternoon). A **routine** is the persistent one: `/schedule` it once and it fires unattended on its
own cron until you delete it. Both are CC-native — building our own would be substrate, not
capability: `unattended-mode.md` § *Relationship to OrchestKit's ci-sentinel* records why we adopt
the scheduling *capability* and decline the daemon *substrate*.

> **Honest trigger surface.** The verifiable triggers are **cron** and **on-demand `run`**. Treat
> `/schedule` itself as the authority on any richer trigger surface — don't assume triggers this repo
> hasn't exercised.

A routine runs **unattended by definition**, so it inherits the four hard rails
(`unattended-mode.md`) and starts at the rung the ladder assigns — scheduling changes *when* a loop
runs, never *how much it's allowed to do*.

## Is this skill routine-safe?

> **The rule.** A skill is routine-safe only if it **produces a report or a proposal from
> observable state with no human in the loop**, and its only writes are to a findings ledger or a
> single artifact — never to source, never a merge. Everything else is not routine material.

Most of our ~85 skills fail that rule, and that's expected — three buckets are **not** routines:

- **Knowledge libraries** — reference skills a human pulls open mid-session: most of atk
  (`rag-retrieval`, `langgraph`, `embeddings`, `function-calling`, `prompt-caching`, …), most of dtk
  (`terraform-*`, `aws-*`, `postgresql-master`, `database-schema-designer`), most of ftk
  (`design-system-tokens`, `frontend-creative-design`, `interaction-patterns`, `shadcn`, …), and
  etk's `coding-standards`, `security-checklist`, `testing-strategy-builder`, `zoom-out`, `caveman`.
  They have no "observe → report" action; scheduling one does nothing.
- **Interactive orchestrators** — need a human decision each run: `brainstorming`, `develop`,
  `prepare-pr`, `cmux`, `start-parallel` / `sync-parallel` / `allocate-tasks-parallel`.
- **Setup / one-shot / session-lifecycle** — run once or per session, not on a cadence: `setup-*`,
  `generate-agents-md`, `resume-session`, `save-state`, `create-handoff`, `archive-*`.

**Read-only is enforced by the rail, not assumed.** Run every L1 report routine under `--unattended`
— the propose-only rail (`unattended-mode.md`) is what guarantees it writes nothing but the ledger,
whatever the skill's own tools allow. Only one skill needs no such trust: `audit-skill` is read-only
*by construction* (tool-locked — its frontmatter disallows `Edit`/`Write`), so it is safe even with
the rail off. Two skills need *more* than the rail: `hipaa-compliance-checker` isn't tool-locked (it
could write if the rail were down), and `investigate-sentry` needs live credentials (see §Governance).

**Routine-worthy report-only skills & commands (L1)** — the reporters not already covered as
write-route presets in `recipes.md`:

| Skill / command | Reports | Rung | Cadence (numbers in `autonomy-ladder.md` / `recipes.md`) |
|---|---|---|---|
| `/etk:audit-skill` | sediment / CSO / >150-line drift across `SKILL.md`s | **L1** (tool-locked) | nightly or weekly (idle drift) |
| `/etk:review-mr` | blockers on open PRs/MRs | **L1** | = the `pr-review-watch` row in `recipes.md` |
| `/etk:verify` | test / lint / type status, real exit codes | **L1** | per-CI / on-demand |
| `/etk:review-stats` | review-history stats | **L1** | weekly |
| `/ctk:doctor` | plugin / hook / continuity health | **L1** | weekly or post-update |
| `/ctk:check-maintenance` | continuity integrity | **L1** | weekly |
| `/ctk:continuity-metrics` | session / continuity metrics | **L1** | on-demand |
| `/etk:hipaa-compliance-checker` † | PHI / API-security gaps | **L1** | weekly |
| `/etk:investigate-sentry` † | Sentry issue assessment | **L1** | on-demand |

† needs more than the rail — `hipaa-compliance-checker` isn't tool-locked; `investigate-sentry` needs
credentials (§Governance). The **write-route** routines (`/cover`, `/fix-bug`, `/experiment`) start
at **L2 propose-only** (or L3 confirmed with the `/experiment` guardrail box) — they are already the
`coverage-90` / `error-sweep` / `perf-p95-200ms` presets in `recipes.md`; schedule those, don't
re-list them here.

## Scheduling a routine

A routine recipe = **a routine-safe skill + a cron cadence + its starting rung + the unattended
rails**. Before you `/schedule` it, walk the 30-second pre-flight in
[`loop-failure-modes.md`](../../agent-loops/references/loop-failure-modes.md). For an **L1
report-only** routine most of the ten modes are N/A by construction; the two that still bite are
**Token Burn** (set a `--tokens` cap) and **State Rot** (the integrity law — every wake re-checks
freshly, never cached).

### Flagship — nightly skill-audit (L1)

The lowest-risk useful routine, and the one the Release Checklist already wants run before every
version bump. It reports sediment and never touches a file (`audit-skill` holds no `Edit`/`Write`).

```
# via /schedule — a persistent nightly cloud routine, report-only
/schedule "run /etk:audit-skill over plugins/**/SKILL.md, append flags to
           docs/artifacts/unattended/nightly-audit.md, apply nothing" at 02:17 nightly
```

- **Rung:** L1 — read-only by construction; nothing to promote, nothing to gate.
- **Rails:** report-only; the ledger is the only write. No `--tokens` blowout risk on a bounded
  corpus, but set one anyway (mode 5).
- **Value:** the pruning discipline in root `CLAUDE.md` → *Skill body hygiene* runs on a cadence
  instead of only at release; a human still triages every flag (audit-skill never auto-cuts).

### Two more, by rung

- **`weekly-doctor` (L1)** — `/ctk:doctor` on a weekly cron; surfaces hook-load or duplicate-hook
  regressions before they rot. Report-only.
- **`error-sweep` routine (L2)** — the `recipes.md` `error-sweep` preset (`/fix-bug`, propose-only)
  on its `recipes.md` cadence; drafts fixes as diffs in the ledger with an `apply with:` line. A human
  applies. This is the highest rung a routine should reach without the §Governance floor below.

Off-minute cron is not cosmetic: `/schedule` and `CronCreate` both jitter, and every user who asks
for "2am" lands on `0 2` — pick `02:17`, not `02:00` (`CronCreate` guidance).

## Governance floor (the unattended-runs gate)

A routine fires with **no permission prompt** — nobody is there to approve its Bash. Two things keep
that safe, and both are policy, not code in this file:

1. **Propose-don't-apply is the load-bearing rail.** For anything above L1 it is the only thing
   between a 2am routine and an unsupervised commit (`unattended-mode.md` rail 1). Never schedule a
   confirmed (L3) write-loop against `main`.
2. **The model/permission floor differs by context — and for a cloud routine it is NOT your
   `.claude/settings.json`.** An in-session `--unattended` loop honors the settings floor
   (`enforceAvailableModels` + the `autoMode.hard_deny` baseline). A `/schedule` **cloud routine reads
   only server-managed settings** and is governed by its creation-form scopes (model selector,
   network/connectors, "unrestricted branch pushes" OFF) plus a propose-only prompt — `soft_deny` is
   "prompt before" and near-useless with no human. The full two-context map is
   [`unattended-governance.md`](unattended-governance.md). Until you've confirmed a routine's
   guardrails there, keep it at **L1**, or L2 propose-only with a hard `--tokens` cap.

And the invariant that predates all of it: **routines are user-initiated only** — a human creates
the `/schedule`; no loop bootstraps a paid background routine on its own (`unattended-mode.md` rail 3,
the no-paid-background-LLM rule). `investigate-sentry` and any credentialed routine additionally
inherit whatever secret the skill needs (1Password for Sentry) — a routine must not widen that
secret's blast radius, which is another reason the governance-defaults work gates them.
