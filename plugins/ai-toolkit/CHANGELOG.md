# Changelog

All notable changes to the ai-toolkit (`atk`) plugin will be documented in this file.

## [2.0.9] - 2026-07-27 — the documented log-level variable was a third name that nothing read

Docs + test config. No skill, agent, command or hook behaviour changed.

### Fixed

**`AI_TOOLKIT_LOG_LEVEL` → `AI_LOG_LEVEL` in `CLAUDE.md`, and the test identity aligned to production** (closes #63 for atk).

Issue #63 reported two disagreeing names — production (`ai`, via `run-hook-wrapper.sh`) versus tests (`ai-toolkit`, via `vitest.config.ts`). Investigation found a **third**: `CLAUDE.md` documented `AI_TOOLKIT_LOG_LEVEL`, matching neither. Since `logging.ts:122` builds the variable as `${CLAUDE_PLUGIN_NAME.toUpperCase()}_LOG_LEVEL`, production reads `AI_LOG_LEVEL` — so a user following the documentation exported a variable **nothing has ever read**.

Measured, not assumed: `AI_LOG_LEVEL` appeared in **0** files repo-wide, against 17 / 8 / 7 for `CONTINUITY_` / `ENGINEERING_` / `DEVOPS_LOG_LEVEL` — the three plugins whose names never drifted. The absence of the production name and the presence of a documented name that nothing reads are the same defect seen from two sides.

`vitest.config.ts` now sets `ai`, so the suite verifies the identity users actually get. The issue's recommended option covered only that half; correcting the docs was added because aligning the tests alone would have left the documented control dead.

Deriving the env var separately from the log directory was considered and rejected — `ai` is already a valid shell identifier, and the invalid-identifier problem existed only in the hyphenated test-only name now removed.

## [2.0.8] - 2026-07-11 — CSO-compliant command descriptions + doc count reconciliation

### Fixed

- **Command descriptions (all 25)**: 17 command `description` fields were hard-truncated at exactly 150 characters, cut mid-word, dropping their `Triggers on` trigger keywords (e.g. `/atk:function-calling` ended `…tool execution loops, o` and `/atk:langgraph-routing` ended `…retry loops wi`). Rewrote every command description to be complete and CSO-compliant (`Use when … Triggers on …`), restoring command-palette discoverability. Commands with a 1:1 skill are aligned to the skill's curated description; themed entry points into consolidated skills (`langgraph-*` → `atk:langgraph`, `llm-*` → `atk:llm-patterns`) keep distinct per-topic descriptions.
- **Doc count drift**: `.claude-plugin/marketplace.json` and `CLAUDE.md` reported "14 skills, 23 commands"; the actual content is **16 skills, 25 commands** (`coaching-conversation-patterns` and `pgvector-search` were missing from both lists). Reconciled the counts and lists (README was already correct).

No `dist` rebuild — commands and docs only; no hook code changed.

## [2.0.7] - 2026-07-09 — prune dead session-loader.ts (cross-fork adoption)

### Removed

- Deleted `hooks/src/lifecycle/session-loader.ts` — dead, drifted code from before the shared-hook consolidation (not wired in `hooks.json`, not registered in `index.ts`, not imported; no dist artifact). No runtime effect; session loading is ctk-owned via the shared hook.

## [2.0.6] - 2026-06-25 — rebrand to Claude Forge

Suite renamed `claude-dev-kit` → **Claude Forge**. Updated repository/homepage URLs, the `continuity-recommendation` hook's install hint (`/plugin install ctk@claude-forge`), and install commands; dist rebuilt. Re-add the marketplace and reinstall as `atk@claude-forge`.


## [2.0.5] - 2026-06-24 — genericize company-specific domain references

Part of a monorepo-wide pass removing company-specific domain references and genericizing example data across every plugin.

### Changed

- **`coaching-conversation-patterns`** (skill + command): removed health/wellness-company framing from the examples (member → user, etc.).
- **`prompt-caching`**: genericized the worked examples to drop the same company framing.

## [2.0.4] - 2026-06-19 — security: remove eval() example; RAG injection guidance

Skills-security audit hardening (`docs/reviews/2026-06-19_skills-security-audit.md`).

### Security

- **`ai-native-development`**: replaced the `eval(expression)` ReAct tool example (an injection-to-RCE pattern readers copy verbatim) with a sandboxed expression parser, and added a "tool inputs are untrusted" (OWASP LLM01) note to the agentic examples.
- **`rag-retrieval` + `ai-native-development/rag-patterns`**: added "retrieved content is untrusted" guidance — wrap retrieved docs in data delimiters and frame them as data, not instructions, for untrusted corpora (OWASP LLM01 indirect injection).

## [2.0.3] - 2026-06-14 — first open-source release

AI/LLM development patterns: RAG, embeddings, LangGraph, prompt patterns, semantic caching, observability, and conversational AI. 16 skills, 1 agent, 25 commands.

### Highlights

- Domain-agnostic example data throughout (RAG, coaching, pgvector, langfuse, semantic-caching).
- MIT licensed.

_First public release at 2.0.3; earlier version history was internal and has been omitted._
