# Changelog

All notable changes to the engineering-toolkit (`etk`) plugin will be documented in this file.

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
