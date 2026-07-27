# Changelog

All notable changes to the frontend-toolkit (`ftk`) plugin will be documented in this file.

## [2.3.12] - 2026-07-27 — one derivation for the log-level variable, and a CI check that docs match code

Shared library, tests and CI. No skill, agent or command behaviour changed.

### Fixed

**The log-level env var name was derived in two places, and the second had no tests** (closes #74).

`lib/logging.ts:122` and `getHookEnvironment()` in `types.ts:1070` each built `${CLAUDE_PLUGIN_NAME.toUpperCase()}_LOG_LEVEL` independently. The `types.ts` copy is **public API** — re-exported from all five plugins — and had **zero tests and zero callers**, so nothing constrained it. The two copies had already diverged in behaviour: it neither lower-cased nor validated the value, so `<PLUGIN>_LOG_LEVEL=BOGUS` returned `'BOGUS'` typed as a `LogLevel` while the logger itself fell back to `'warn'`. One variable, two answers.

Both readers now call `logLevelEnvVarName()` and `resolveLogLevel()`, exported from `lib/logging.ts`.

**Log-level validation accepted inherited prototype keys.** The check was `envLevel in LOG_LEVEL_VALUES`, and `'toString' in LOG_LEVEL_VALUES` is true through the prototype chain — so `<PLUGIN>_LOG_LEVEL=toString` passed validation and then indexed to `undefined`, silencing **every** log line instead of falling back to `warn`. Now an own-property check.

### Added

**CI enforcement of the log-level identity** — check 6 of `scripts/validate-versions.sh`, already wired to the `versions` job. Per plugin it asserts:

- `CLAUDE_PLUGIN_NAME` is a valid shell identifier
- `vitest.config.ts` runs under the **same** name as `run-hook-wrapper.sh` (this disagreement *is* #63)
- `CLAUDE.md` documents exactly `UPPER(name)_LOG_LEVEL` and no other `*_LOG_LEVEL` name

This is the signal that did not exist when #63 shipped: corrupting the documented name previously left the plugin suite, the shared suite and this script all at exit 0, and nothing under `scripts/`, `.github/` or `tools/` mentioned `LOG_LEVEL` at all. Guarded by three negative fixtures — `tests/fixtures/versions/bad-{logvar,plugin-id,test-identity}/` — so deleting the check cannot pass silently, since check 6 skips any plugin without a wrapper.

**29 tests for `getHookEnvironment()` and the identity helpers** — `tests/lib/hook-environment.test.ts`, linked into all five plugins. This surface previously had none.

### Changed

Plugin names are now **required** to match `[A-Za-z_][A-Za-z0-9_]*`, stated in root `CLAUDE.md`'s "Adding a New Plugin" procedure and enforced in CI. `export AI-TOOLKIT_LOG_LEVEL=debug` is rejected by POSIX `sh` as "not a valid identifier" while Node accepts the key, producing a knob that can be read but never set. The name is deliberately **not** normalised in code — normalising would let a violating name work by accident and re-open the gap between the log directory name and the variable name.

This supersedes the closing note of [2.3.11], which recorded that deriving the env var separately from the log directory "was considered and rejected" because the short name is already a valid shell identifier. That reasoning was reached from `logging.ts` alone — a second derivation existed in `types.ts`, untested, carrying the same hazard. The constraint is now explicit and enforced rather than incidental. Remaining factual corrections to the [2.3.11] entry are tracked in #75.

## [2.3.11] - 2026-07-27 — the documented log-level variable was a third name that nothing read

Docs + test config. No skill, agent, command or hook behaviour changed.

### Fixed

**`FRONTEND_TOOLKIT_LOG_LEVEL` → `FRONTEND_LOG_LEVEL` in `CLAUDE.md`, and the test identity aligned to production** (closes #63 for ftk).

Issue #63 reported two disagreeing names — production (`frontend`, via `run-hook-wrapper.sh`) versus tests (`frontend-toolkit`, via `vitest.config.ts`). Investigation found a **third**: `CLAUDE.md` documented `FRONTEND_TOOLKIT_LOG_LEVEL`, matching neither. Since `logging.ts:122` builds the variable as `${CLAUDE_PLUGIN_NAME.toUpperCase()}_LOG_LEVEL`, production reads `FRONTEND_LOG_LEVEL` — so a user following the documentation exported a variable **nothing has ever read**.

Measured, not assumed: `FRONTEND_LOG_LEVEL` appeared in **0** files repo-wide, against 17 / 8 / 7 for `CONTINUITY_` / `ENGINEERING_` / `DEVOPS_LOG_LEVEL` — the three plugins whose names never drifted.

`vitest.config.ts` now sets `frontend`, so the suite verifies the identity users actually get. The issue's recommended option covered only that half; correcting the docs was added because aligning the tests alone would have left the documented control dead.

Deriving the env var separately from the log directory was considered and rejected — `frontend` is already a valid shell identifier, and the invalid-identifier problem existed only in the hyphenated test-only name now removed.

## [2.3.10] - 2026-07-09 — prune dead session-loader.ts (cross-fork adoption)

### Removed

- Deleted `hooks/src/lifecycle/session-loader.ts` — dead, drifted code from before the shared-hook consolidation (not wired in `hooks.json`, not registered in `index.ts`, not imported; no dist artifact). No runtime effect; session loading is ctk-owned via the shared hook.

## [2.3.9] - 2026-07-04 — playground description accuracy

Resolves the one `/etk:audit-skill` finding carried from 2.3.8: the `playground` skill `description` enumerated its templates but omitted the `decision-board` template added in 2.3.8. Added "decision boards (drag-to-prioritize)" to the enumeration so the model-invoked description matches the shipped template set (the "decision board" trigger keyword already covered discovery; this is an accuracy fix). Description-only; no `dist` rebuild.


## [2.3.8] - 2026-07-04 — playground chart-encoding + decision-board archetype (orchestkit adoption, round 2)

Follow-up to 2.3.7 after a deeper read of orchestkit's playground ecosystem (yonatangross/orchestkit, MIT). Adopted the two items a deeper assessment surfaced as genuine gaps; declined the rest (gold-standard HTML is bespoke and less strict than our own standard; decision-router is ork-substrate-locked; visualize-plan's ASCII family is plan-domain-locked). Skills/docs only; no `dist` rebuild.

### Added

- **`skills/playground/references/chart-encoding.md`** — fills a real gap (ftk had zero chart/palette/CVD guidance despite 5 playground templates rendering quantitative marks). Defers the data-mark layer to Claude Code's bundled `/dataviz` skill, enforces the **chrome↔marks boundary** (persona `--pg-` HSL for the frame, `/dataviz` validated palette for the data — never `--pg-accent` on a bar), and probes-don't-requires (`/dataviz` absent → simple/ASCII fallback, so zero-dependency holds).
- **`skills/playground/templates/decision-board.md`** — a new operate-it archetype guide: drag items across an Impact×Effort matrix / ranked list / Now-Next-Later buckets with a live RICE score. Extracts the verified accessible engine (Pointer-Events drag, keyboard reorder + `refocus()`, `aria-live` announcements, RTL-aware axis) into house-style prose + snippets, citing `interaction-patterns`. Not a copied HTML file.

### Changed

- **`skills/playground/references/visual-standard.md`** — added the `aria-pressed`-as-selection-state protocol for non-drag toggle UI (§5); wired chart-encoding into §0 routing and the §8 self-audit; added a `decision-board.md` scaffold pointer. **Fixed three wrong section cross-references** in §0 (reduced-motion is §4 not §5; component specs / drag-and-drop engine are §5 not §6).
- **`skills/playground/SKILL.md`** — added `decision-board.md` to the template list; a "charts defer to `/dataviz`" core requirement; updated the operate-it family (decision board now has a dedicated template; user-story player still standard-built).

### Declined (confirmed by the deeper read)

- `homeos-arieh.html` verbatim (bespoke Hebrew/HomeOS/personal, "study don't edit" — and it violates our own reduced-motion + 4-duration-budget rules); `decision-router.template.html` (hardcodes ork's 37-agent registry, `ORK-ONLY`); `release-notes-player` (a recipe of user-story-player, not a distinct archetype); the entire `visualize-plan` ASCII pattern family (swimlane/DAG/reversibility/pre-mortem — plan/diff-domain-locked, a different skill's job).


## [2.3.7] - 2026-07-04 — playground Visual Standard (orchestkit adoption)

Cross-fork adoption from orchestkit's `playground-visual-standard.md` (yonatangross/orchestkit, MIT) into the `playground` skill — principles, not verbatim assets. Skills/docs only; no `dist` rebuild.

### Added

- **`skills/playground/references/visual-standard.md`** — a falsifiable design contract for single-file HTML playgrounds: §0 signal-count archetype routing, HSL `--pg-` token scales (one value per role), glass do/don'ts, a 4-duration motion budget + verbatim `prefers-reduced-motion` gate, component specs (device frame / transport / flow arrow / copy-prompt / accessible drag-and-drop), RTL logical-properties rules, a 10-point anti-"generic AI" checklist, and a pre-ship self-audit. Defers to sibling ftk skills (`frontend-creative-design`, `interaction-patterns`, `design-system-tokens`) for the general ground they already own rather than duplicating it.

### Changed

- **`skills/playground/SKILL.md`** — Step 1 rewritten as a signal-count archetype routing ("decision, not vibe") pointing at the standard's §0; added a self-audit gate before `open`; added accessibility + reduced-motion to core requirements; reframed "Two genres" → "Three families" (control panel · read-and-decide brief · **operate-it playground** — user-story player / decision board, buildable from the standard). Added `user story player, decision board` triggers.

### Declined (orchestkit substrate, fails the end-user-install lens)

- decision-router board (37-agent ork registry + Workflow strategies), the multi-format front-door (ASCII / NotebookLM infographic), memory-MCP visualization storage, and the plan-context scripts / PR-playground CI gate. Charts-via-`/dataviz` (`chart-encoding-standard`) parked as a separate follow-up.


## [2.3.6] - 2026-06-25 — rebrand to Claude Forge

Suite renamed `claude-dev-kit` → **Claude Forge**. Updated repository/homepage URLs, the `continuity-recommendation` hook's install hint (`/plugin install ctk@claude-forge`), explainer-video references, and install commands; dist rebuilt. Re-add the marketplace and reinstall as `ftk@claude-forge`.


## [2.3.5] - 2026-06-24 — genericize company-specific domain references

Part of a monorepo-wide pass removing company-specific domain references and genericizing example data across every plugin.

### Changed

- **`explainer-video`**: re-themed the worked examples — member-lifecycle FSM → subscription-lifecycle (asset file renamed) and the event-lambda architecture genericized.
- **`agentation` + `ai-ui-generation`**: genericized the examples to drop company framing.

## [2.3.4] - 2026-06-19 — security: trust-boundary notes; MCP dep audit + SDK pin

Skills-security audit hardening (`docs/reviews/2026-06-19_skills-security-audit.md`).

### Security

- **Trust-boundary notes** added to `browser-content-capture` (captured page text is untrusted data; use `--content-boundaries`) and `stitch` (Gemini-generated markup is untrusted content — prompt-injection risk, review before adopting; not XSS).
- **MCP workspace**: pinned `@google/stitch-sdk` to an exact version (it handles the API key). The MCP advisories themselves are unreachable (stdio-only transport); a non-blocking `mcp-audit` CI job for visibility is staged separately.

## [2.3.3] - 2026-06-17 — agent-browser: refresh to upstream Vercel v0.27.3

### Changed

- **`agent-browser` skill docs synced from v0.22.x → v0.27.3** (`SKILL.md`, `references/commands.md`, `references/protocol-alignment.md`). Adds v0.24–v0.27 coverage: React introspection, Web Vitals, the doctor/chat/skills subsystems, and stable `t1`/`t2` tab ids. Corrects the `snapshot -s` documentation bug (it scopes the snapshot to a CSS-selector subtree, not a "structure-only DOM tree"). Upstream `--provider agentcore` (AWS Bedrock cloud browser) coverage is retained — it is an upstream agent-browser feature, not company infrastructure.

## [2.3.2] - 2026-06-14 — first open-source release

Frontend development, UI/UX design, browser automation, and Remotion explainer videos. 16 skills, 4 agents, 11 commands.

### Highlights

- React, Figma, Google Stitch AI, shadcn/ui, design systems, browser automation, and block-based + bespoke explainer-video generation.
- MIT licensed.

_First public release at 2.3.2; earlier version history was internal and has been omitted._
