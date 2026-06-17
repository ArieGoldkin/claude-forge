# Changelog

All notable changes to the engineering-toolkit (`etk`) plugin will be documented in this file.

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
