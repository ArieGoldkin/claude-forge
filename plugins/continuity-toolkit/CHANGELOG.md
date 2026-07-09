# Changelog

All notable changes to the continuity-toolkit (`ctk`) plugin will be documented in this file.

## [2.7.1] - 2026-07-09 — archive-handoffs .yaml glob fix + shared-hook-count doc reconciliation

Follow-up cleanup after the 2.7.0 cross-fork adoption. Docs/command-definition only — no runtime hook behavior changed, no `dist` rebuild.

### Fixed

- **`archive-handoffs` false-healthy / miss-all bug**: the command scanned, counted, and archived handoffs with a `*.md`-only glob, but handoffs are `*.yaml` since the v3.0 format — so **no `.yaml` handoff would ever be archived** (same class as the `check-maintenance` bug fixed in 2.7.0). All handoff globs now match `*.yaml` + legacy `*.md` (active scan, archive listing, active count, restore example, expected-format list).

### Changed

- **Shared-hook-count doc reconciliation**: the count was stated inconsistently across docs (27 / 28 / 30). Reconciled to the verifiable basis — `registerHook()` calls in `hooks/src/index.ts` = **35 registered (32 shared, symlinked from `shared/hooks-infra/src/hooks/`, + 3 ctk-specific: `hipaa-context-injector`, `phi-output-redactor`, `session-loader`)**. Updated `plugin.json`/`marketplace.json`/`README`/root `CLAUDE.md`/ctk `CLAUDE.md`, and added a **canonical-basis note** to ctk `CLAUDE.md` so the number can be re-derived and stops drifting.

## [2.7.0] - 2026-07-09 — read-cache Read/Edit deadlock fix + secret-skip (cross-fork adoption) + continuity-maintenance doc fixes

Cross-fork adoption from the internal toolkit fork. Adds the delta-cache invalidator (27th shared hook) + advance-on-serve, and fixes several continuity-maintenance doc bugs the fork's skill-audit sweep surfaced. Hook source changed → tracked `dist/` rebuilt.

### Added

- **`posttool/read-cache-invalidator` shared hook** (27th) — refreshes the per-session delta-cache base after every `Write|Edit|MultiEdit` so a subsequent `Read` of the just-edited file hash-matches and is not intercepted with a stale diff. Wired into ctk's `PostToolUse(Write|Edit|MultiEdit)` group.
- Shared **`snapshotFileToCache()`** helper — one choke point for "snapshot file → cache", reused by the read writer, the new edit invalidator, and pretool advance-on-serve. Unit tests + a full deadlock reproduction/self-heal suite (`read-cache-deadlock.test.ts`).

### Fixed

- **Read/Edit deadlock**: the cache writer fired on `Read` only, so `Write/Edit/MultiEdit` never refreshed the cached bytes; a re-Read of a just-edited file saw `cached != disk`, was intercepted with a diff, and **denied** — and a denied Read can't satisfy the harness read-before-edit gate. Two fixes: the new PostToolUse invalidator refreshes the base post-edit, and the pretool hook now **advances the base whenever it serves a diff** so out-of-band changes (e.g. a git branch switch) self-heal on the second Read.
- **`check-maintenance` false-healthy bug**: the handoff-count check globbed `*.md`, but handoffs are `*.yaml` since the v3.0 format — the 20/40 warning could never fire. Now counts both `*.yaml` and legacy `*.md`.
- **`check-maintenance` dead route**: recommended `/archive-shared-context` (no such command) in 3 places → replaced with the real remediation (manual shared-context.json prune).
- **Dirty-tracking threshold drift**: docs said auto-suggest fires at 20 edits; the `dirty-state-tracker` hook's real thresholds are **15 (warn) / 25 (auto-suggest)**. Doc references corrected and the hook named as canonical. Also single-sourced the numeric health thresholds into the `/check-maintenance` command (other files point at it) and fixed one stale `handoff-<date>.md` naming reference.

### Security

- **Delta-cache never persists secret-bearing file content** (`snapshotFileToCache`): skips files matching the security layer's env/ssh/credential patterns (`.env*`, `.ssh/id_*`, `secrets.y(a)ml`, `credentials.json`, `.npmrc`, `.netrc`, …) before writing to `~/.claude/cache`. Filters in the one shared choke point, covering the read writer, the edit invalidator, and pretool advance-on-serve.

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
