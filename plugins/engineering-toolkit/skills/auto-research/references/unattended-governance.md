# Governance for Unattended Runs

An unattended loop has no human to approve its actions, so its safety comes entirely from what is
configured *before* it starts. The catch: "unattended" is **two different execution contexts with
opposite settings behavior**. Configure the wrong one and you ship a guardrail that never loads.

This file names the levers that actually enforce in each context, and — just as important — the ones
the CC docs do **not** confirm, so you don't lean on a guardrail that isn't there. It assigns the
rungs from [`autonomy-ladder.md`](autonomy-ladder.md) their real enforcement per context; it does not
restate the rung definitions, the four rails ([`unattended-mode.md`](unattended-mode.md)), or the
`hard_deny` pattern list (root `CLAUDE.md` § *Recommended `hard_deny` baseline*).

## Two contexts, opposite settings behavior

| | **In-session unattended** | **Cloud routine** |
|---|---|---|
| How it runs | `/loop`, `/auto-research --unattended`, `CronCreate` — inside your local CC session, on your machine | `/schedule` — a persistent cloud agent on Anthropic-managed infrastructure |
| Reads local `.claude/settings.json`? | **Yes** — same as any local session | **No** — cloud VMs don't receive device settings; only **server-managed** settings reach them |
| Permission model | your session's mode (Auto Mode etc.); `autoMode.*` rules apply | "no permission-mode picker, no approval prompts" — a special unattended mode, **not** Auto Mode |
| Governed by | the `.claude/settings.json` floor (below) | server-managed settings + the routine's creation-form scopes |

*(Grounded against Claude Code's routines + model-configuration docs.)*

**The trap:** the `autoMode.hard_deny` / `enforceAvailableModels` block you commit to
`.claude/settings.json` governs an in-session `--unattended` loop — but a `/schedule` **cloud routine
never reads it**. A repo-committed settings floor does **not** protect a cloud routine.

## Context A — in-session unattended (`.claude/settings.json` applies)

The floor that loads here:

- **`enforceAvailableModels`** — pin the model set so a background loop can't pick an expensive model
  (root `CLAUDE.md` § *Model & MCP governance*). Set in `~/.claude/settings.local.json` or managed.
- **`autoMode.hard_deny` baseline** — the unconditional block list (root `CLAUDE.md`). This is the
  load-bearing lever unattended: `hard_deny` blocks with **no human needed**.
- **`--tokens` hard cap** — the cost brake (`unattended-mode.md` rail 2).

The lever that does **not** help unattended: **`soft_deny` is "prompt before."** With no human to
answer, it can't do its job. Treat `soft_deny` as interactive-only; for an unattended loop, promote
anything you'd soft-deny into `hard_deny`, or rely on propose-don't-apply.

## Context B — cloud routine (`.claude/settings.json` does NOT apply)

A `/schedule` routine has no approval prompts and ignores local settings, so it is governed only by
creation-time and server-side config:

| Lever | Controls | Set in |
|---|---|---|
| **Per-routine model selector** | the model baked at creation, reused every run — the **documented** cost pin | `/schedule` creation form |
| **Server-managed `enforceAvailableModels`** | *may* also pin the model set — **inferred**, see *Unverified* (cloud VMs read only managed settings) | admin console |
| **Network access** (environment) | what the routine may reach | creation form |
| **Connectors — include only what's needed** | the routine's external reach / secret blast radius | creation form |
| **"Allow unrestricted branch pushes" OFF** | forces `claude/`-prefixed branches — the routine can't push `main` | creation form |
| **Prompt-level propose-don't-apply** | with no approval prompts, the *prompt* is what holds a run to report/propose-only above L1 | your routine prompt |

There is **no** per-routine tool allowlist, permission mode, or budget cap in the creation form — so a
cloud routine's write-scope is held by branch-push + connectors + the prompt, never a denylist.

## Unverified — test before relying

CC's docs are silent on these. Do **not** assume them; pilot at L1 and confirm before promoting:

- Whether `autoMode.hard_deny` / `soft_deny` / `classifyAllShell` have **any** effect on a cloud
  routine (not documented for routines; likely inert, since routines aren't Auto Mode).
- Exactly how a `soft_deny` match resolves with no human (likely blocks — unconfirmed).
- Whether `enforceAvailableModels` constrains the routine model beyond the creation-form selector
  (reasonable inference via server-managed settings; not explicitly documented).

## Rung → what actually enforces

| Rung ([`autonomy-ladder.md`](autonomy-ladder.md)) | In-session unattended | Cloud routine |
|---|---|---|
| **L1 report-only** | read-only route + ledger-only write; `hard_deny` baseline as backstop | report-only prompt; branch-push OFF; minimal connectors |
| **L2 propose-only** | propose-don't-apply rail (no `Edit`/commit/push) + `--tokens` cap | prompt enforces propose-only (diff to ledger); branch-push OFF; no auto-merge |
| **L3 confirmed write** | `/experiment` guardrail box (allowlists, rollback, stuck-detection) + human merge gate | **not recommended** — a routine has no approval prompts and no tool allowlist; keep write-loops in-session, where the guardrail box loads |

## The invariant that predates every setting

Routines are **user-initiated only** — a human creates the `/schedule`; no loop bootstraps a paid
background routine (`unattended-mode.md` rail 3). And a routine inherits whatever credential its skill
needs (e.g. Sentry via 1Password) — minimize connectors so an unattended run can't widen a secret's
blast radius.
