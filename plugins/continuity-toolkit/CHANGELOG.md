# Changelog

All notable changes to the continuity-toolkit (`ctk`) plugin will be documented in this file.

## [2.6.11] - 2026-06-25 — rebrand to Claude Forge

Suite renamed `claude-dev-kit` → **Claude Forge**. Updated repository/homepage URLs and the `session-loader` window-title example; dist rebuilt. No behavior change beyond the rename. Re-add the marketplace and reinstall as `ctk@claude-forge`.


## [2.6.10] - 2026-06-24 — strip company-specific domain reference from HIPAA hook

Part of a monorepo-wide pass removing company-specific domain references and genericizing example data across every plugin.

### Changed

- **Removed the `health coach` keyword from the HIPAA context-injector hook's health-domain rule** (the rest of the rule is unchanged) and rebuilt the tracked `dist/`. No behavior change beyond the dropped keyword.

## [2.6.9] - 2026-06-19 — web-research: trust boundary + internal MCP sources

Skills-security audit hardening (`docs/reviews/2026-06-19_skills-security-audit.md`).

### Security

- **`web-research-analyst` agent now states an explicit trust boundary** — fetched web/API/search content is untrusted DATA, not instructions (covers the default WebFetch path, not just agent-browser): ignore embedded directives, don't follow page-invented URLs, and pass `--content-boundaries` on agent-browser escalation. Also dropped the unused `Write` tool from the agent to shrink injection blast radius.

### Changed

- **`/ctk:web-research` now blends internal + external sources.** The command queries connected MCP servers (Atlassian/Confluence, Google Drive, …) for internal context and dispatches the `web-research-analyst` agent for public web sources, synthesizing with per-source citations (`internal:<server>` / `web:<url>`). The agent gained a **Sources** section clarifying it covers the web tier and that MCP-relayed content is untrusted too. Internal sources are queried by the (MCP-capable) command, not the restricted subagent — so it stays domain-agnostic (no hardcoded server names).

## [2.6.8] - 2026-06-17 — rebuild: ship compiled JS for the 2.6.7 statusline features

### Fixed

- **Rebuilt the tracked `dist/` so 2.6.7's statusline features actually ship.** 2.6.7 updated the statusline TypeScript (cost-format fix + account-usage bars) but the committed `dist/src/statusline/context-percentage.js` was not regenerated, so installs ran the stale compiled build against the new source. This release ships only the rebuilt artifact — no source changes vs 2.6.7.

## [2.6.7] - 2026-06-17 — statusline: legible cost formatting + account-usage bars

Domain-agnostic statusline improvements ported from the internal toolkit fork.

### Fixed

- **`formatCost` legibility** — costs ≥ $10 now render as whole dollars with thousands separators (`$356`, `$1,234`) instead of an unconditional `toFixed(2)`. At statusline font size the decimal point in `$356.00` was easily misread as `$35600`. Costs < $10 keep two decimals.

### Added

- **Optional third statusline line** showing session (5-hour) and weekly (7-day) account-usage progress bars from CC v2.1.176+ `rate_limits.{five_hour,seven_day}.used_percentage`. Self-degrading: the line is omitted entirely when `rate_limits` is absent (API/Bedrock users, before the first API response), keeping the existing two-line output byte-identical. No network call. Bundled tests cover both-present / each-absent / NaN-guard / threshold-coloring / 2-line-vs-3-line.

## [2.6.6] - 2026-06-14 — first open-source release

Session continuity and context management: multi-session state persistence with ledger tracking, handoff documents, dirty-file tracking, context-window monitoring, and security guardrails. 11 skills, 1 agent, 12 commands.

### Highlights

- **Canonical owner of all shared hooks** (security, permissions, lifecycle, post-tool, HIPAA context injection). Install alongside the other plugins for full hook coverage.
- MIT licensed.

_First public release at 2.6.6; earlier version history was internal and has been omitted._
