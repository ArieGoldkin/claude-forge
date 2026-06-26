# Changelog

All notable changes to the engineering-toolkit (`etk`) plugin will be documented in this file.

## [2.8.1] - 2026-06-26 — atlassian-integration: MCP authentication note

Adds an MCP-auth note to the `atlassian-integration` skill (CC alignment v2.1.193): authenticate the Atlassian MCP server with `claude mcp login atlassian` (CC v2.1.186), the startup notice when a server needs auth, and automatic reconnect on transient 401/403 (CC v2.1.191/193). Skill-content only; no hook/dist change.


## [2.8.0] - 2026-06-25 — auto-research: real `research` route + orchestration-contract hardening

> Ports the company work-copy's auto-research process audit (P0 + P1) into Claude Forge, **merged on top of** our existing recipe / triple-ceiling / unattended-mode work (2.7.3–2.7.6) rather than overwriting it. Skill-definition only — no runtime hook behavior changed, no `dist/` rebuild.

### Added

- **`research` route (P0)** — promoted the decision tree's dangling "Generic research" leaf to a first-class `research` intent that hands off to `/ctk:web-research` (escalating to the `deep-research` harness for multi-source, adversarially-verified reports). Adds an intent-table row + signal words, when-to-use + quick-start examples, a `routing-rules.md` route section + TOC entry + disambiguation rules 8/9, 4 `intent-benchmark.json` entries, and heartbeat / Result / budget / Related-Skills coverage. Reconciled "8 intent categories" → 10.
- **`--resume` flag** — resume an interrupted run from the last reported state.
- **Model-economics guardrail** — Safety & Budget Enforcement notes auto-research is the highest-fan-out entry point and must not spawn children that undercut the repo's model-economics guidance. Adapted to Claude Forge's advisory "Model economics for subagent dispatch"; the company's *enforceable* governance layer (`enforceAvailableModels` / Fable soft-deny) is not yet in this repo (separate adoption).
- **Interrupt & clean-state contract** — auto-research performs no rollback of its own; relies on the target skill's clean-exit guarantee, warning for routes (`/develop`, `/brainstorming`) that lack one.

### Changed

- **Fan-out cost front-loaded (P1)** — the Phase-2 plan format and Phase-3 confirm box gained a `Fan-out:` line so a multi-agent dispatch (e.g. `design`→~11 agents) is approved deliberately, not blind.
- **Canonical multi-agent dispatch phrasing (P1)** — Phase-4 step 1 now says "dispatch all agents in a single response by emitting multiple Agent tool calls in the same message" for fan-out routes (prevents serialization).
- **Fail-loud blocker surfacing (P1)** — Phase-4 step 4 defines what counts as a blocker and emits a canonical `STATUS:` line alongside the human-readable `Result:` enum (now includes `RESEARCH_COMPLETE`).
- **`--no-confirm` scoped (P1)** — honored only for read-only/single-pass routes (`verify`, `review`, `research`, `--dry-run`, `--replay`); ignored for write routes.

### Preserved (Claude Forge-specific, absent from the company copy)

- Triple ceiling (iterations / minutes / **tokens**), recipe presets, and unattended / propose-only mode were kept intact — the audit deltas were merged on top, not overwritten.

## [2.7.8] - 2026-06-25 — rebrand to Claude Forge

Suite renamed `claude-dev-kit` → **Claude Forge**. Updated repository/homepage URLs, the `continuity-recommendation` hook's install hint (`/plugin install ctk@claude-forge`), and install commands; dist rebuilt. Re-add the marketplace and reinstall as `etk@claude-forge`.


## [2.7.7] - 2026-06-24 — genericize company-specific domain references

Part of a monorepo-wide pass removing company-specific domain references and genericizing example data across every plugin. Skill-prose only (no hook/dist rebuild).

### Changed

- **Genericized engineering skill examples** — removed company member/coach references and company repo paths from `hipaa-compliance-checker` (checklist + templates), `investigate-sentry` (PHI examples), `fix-bug`, `review-mr`, `post-mr-comments`, `develop`, and `auto-research`.

## [2.7.6] - 2026-06-22 — auto-research: unattended / propose-only watcher mode

Phase 2 (first PR) of adopting OrchestKit's loop capabilities in our idiom (capability, not substrate — see `docs/plans/2026-06-21_adopt-loop-capabilities-roadmap.md`, roadmap item R4). Skill-prose only (no hook/dist rebuild). Adopts ork's `ci-sentinel` value — a background watcher that observes and reports — without ork's substrate (no daemon, no server, no coordination DB).

### Added

- **Unattended / propose-only mode — `/auto-research --unattended <goal>`.** Runs the loop as a background watcher that self-schedules on CC-native primitives (`ScheduleWakeup` session-bound, default; `Cron` / `/schedule` persistent), re-checks state freshly each wake, and reports to a findings ledger. Governed by one safety invariant — **propose-don't-apply**: it never mutates source, commits, or pushes; its only write is the ledger. Write-routes (`/cover`, `/experiment`, `/fix-bug`, `/develop`) are degraded to propose-only (change lands in the ledger as a diff with an `apply with:` line). New `references/unattended-mode.md` with the four hard rails, cadence guidance, ledger format, and termination conditions.
- **`--ledger <path>`** — findings-ledger path (default `docs/artifacts/unattended/<goal-slug>.md`, gitignored so propose-only output stays local).
- **`--max-wakeups N`** (default 24) and **`--deadline <ISO-date>`** — bounded-lifetime caps for an unattended run; `--deadline` is kept distinct from the stop-condition selector `--until` to avoid overloading one flag with two value grammars. A loop that can't describe how it ends doesn't run unattended.

### Changed

- **Token ceiling hardens in unattended mode.** The `--tokens` axis of the triple ceiling becomes a **hard mid-run cutoff** (not just a between-iteration check) when `--unattended` is set — the cost brake for running unwatched. Realizes the forward-reference left in 2.7.5 (`SKILL.md` Budget Passing) that this was "Phase 2 of the loop-capability roadmap."
- **Confirmation model under `--unattended`** moves from per-change to once-at-setup: the invocation is the confirmation and implies `--no-confirm` for the iterations — but never permission to apply.

## [2.7.5] - 2026-06-21 — auto-research: recipes, token ceiling, composable stop-conditions

Phase 1 of adopting OrchestKit's loop capabilities in our idiom (capability, not substrate — see `docs/plans/2026-06-21_adopt-loop-capabilities-roadmap.md`). Turns `/auto-research` into the hub for the loop-quality features, all skill-prose (no hook/dist rebuild).

### Added

- **Recipe presets — `/auto-research --recipe <name>`.** Named goal+stop-condition templates (`coverage-90`, `perf-p95-200ms`, `error-sweep`, `docs-drift`, `flake-hunt`) that expand to the right target skill + budget + stop-condition, overridable inline. Adopts ork's loop recipe book through our routing instead of a parallel `/goal` command. New `references/recipes.md` catalog.
- **Token/cost ceiling — `--tokens N`.** The budget is now a **triple ceiling** (iterations / minutes / **tokens**); the loop stops as soon as any one is hit. Adopts ork's budget caps; makes long runs cost-safe.
- **Composable stop-conditions — `--until <goal|streak=N|holdout-wins|budget>`.** First-class, selectable, shown in the plan's `Stop:` line. Includes a global **integrity law**: a stop-condition may only count *fresh* runs, never a stale/cached/skipped prior pass (generalizes the 2.7.4 streak fix).

## [2.7.4] - 2026-06-21 — streak gate hardening: fresh runs only

Hardening of the 2.7.3 streak gate, prompted by researching OrchestKit's parallel work — they shipped the same gate, then hit a race (their #2554) where a stale prior "pass" satisfied the streak with **zero fresh runs**. Our `/cover` had a latent version of that bug via Phase 0 fingerprint caching.

### Fixed

- **`/cover --streak=N` now forces fresh runs.** `--streak` bypasses Phase 0 fingerprint gating for streaked tests — a cached or skipped result (a prior `pass`) can no longer count toward a streak, so a fingerprint-cached test is re-run N times rather than vacuously marked green. Closes a false-green hole where `/cover --streak=3` on an unchanged file ran the test **0 times**.
- **`/verify --streak=N` clarified**: the N runs are N *fresh* executions this pass; no prior or cached result counts toward the streak.

## [2.7.3] - 2026-06-20 — streak gate for verify + cover (flaky-test defense)

Adopted the one genuinely-new pattern from the Forward Future "Loop Library" assessment of OrchestKit (the rest — recipe presets, holdout-promotion, cross-model reviewer — were either redundant with our existing loop engine or deferred; holdout-promotion is being built upstream in ork milestone #161, so we watch-and-adapt).

### Added

- **`/verify --streak=N`** — re-run the test suite N times and report success only if every run passes (typecheck/lint run once, being deterministic). The structured form of "run it again to rule out flakiness"; default `--streak=1` preserves single-pass behavior. See `verify/SKILL.md` Step 2b.
- **`/cover --streak=N`** — a generated test is kept only after it passes N consecutive runs; a test that can't hold the streak is flagged flaky and re-enters the heal loop rather than being counted as green. Composes with `--target` (new tests must hold the streak before their coverage gain counts). See `cover/SKILL.md` Phase 5.

## [2.7.2] - 2026-06-19 — security: review-mr injection defense; trust-boundary notes; sentry scrub

Skills-security audit hardening (`docs/reviews/2026-06-19_skills-security-audit.md`).

### Security

- **`review-mr`**: the MR diff/title/description are now framed as untrusted, attacker-controlled input in the shared agent Scope block (phase 5), with an injection / finding-suppression sanity check in synthesis (phase 6) — a malicious PR can no longer silently steer the review.
- **Trust-boundary notes** added to `atlassian-integration` (MCP-fetched Jira/Confluence content is untrusted) and `cmux` (WKWebView page content is untrusted).
- **`investigate-sentry`**: parameterized the hardcoded company org-slug, 1Password vault path, and example issue ID (work→public sanitization residue) — now uses `<your-org>` / `<your-vault>` placeholders.

### Changed

- **`auto-research` now directs research toward connected MCP sources.** When a goal references internal context (a ticket, an internal doc, a prior decision), the orchestrator consults the session's connected MCP servers (Atlassian, Google Drive, …) as first-class sources alongside web search, discovering tool names via ToolSearch. Pairs with `/ctk:web-research`'s internal-plus-web blend; MCP results are treated as untrusted data.

## [2.7.1] - 2026-06-17 — skill namespacing fix, CSO trigger suffixes, cmux skill

### Fixed

- **`tdd-implementer` agent skill preloads namespaced** with the `etk:` prefix (`coding-standards`, `testing-strategy-builder`, `evidence-verification`), matching the sibling `quality-reviewer` agent and the monorepo namespacing convention. CC silently drops unresolvable bare-name preloads, so the agent was starting without its core domain context.

### Changed

- **CSO `Triggers on …` suffixes added** to 6 skill descriptions (`agent-loops`, `architecture-decision-record`, `evidence-verification`, `quality-gates`, `tool-wrapper-patterns`, `hipaa-compliance-checker`) for better skill discoverability.

### Added

- **`cmux` skill** (24th skill) — drives the third-party `manaflow-ai/cmux` native macOS terminal app via its CLI / Unix socket: workspaces, panes, surfaces, WKWebView browser automation, and the markdown viewer. macOS 14+ only; no-ops safely when the cmux socket is absent, so it is inert for everyone else.

## [2.7.0] - 2026-06-14 — first open-source release

Engineering-practices toolkit: ADR, TDD, code review, quality gates, brainstorming, Sentry investigation, and workflow orchestration. 23 skills, 4 agents, 19 commands.

### Highlights

- **`/etk:review-mr` + `/etk:post-mr-comments` support both GitLab MRs and GitHub PRs.** Reviews fan out to domain-aware agents, then post inline-anchored comments via `glab` (`/discussions`) or `gh` (`pulls/{N}/comments`), with an out-of-hunk top-level fallback and anchor verification. See `code-review-playbook` for the per-VCS recipes.
- MIT licensed.

_First public release at 2.7.0; earlier version history was internal and has been omitted._
