# Changelog

All notable changes to the ai-toolkit (`atk`) plugin will be documented in this file.

## [2.0.10] - 2026-07-27 — one derivation for the log-level variable, and a CI check that docs match code

Shared library, tests and CI. No skill, agent or command behaviour changed.

### Fixed

**The log-level env var name was derived in two places, and the second had no tests** (closes #74).

`lib/logging.ts:122` and `getHookEnvironment()` in `types.ts:1070` each built `${CLAUDE_PLUGIN_NAME.toUpperCase()}_LOG_LEVEL` independently. The `types.ts` copy is **public API** — re-exported from all five plugins — and had **zero tests and zero callers**, so nothing constrained it. The two copies had already diverged in behaviour: it neither lower-cased nor validated the value, so `<PLUGIN>_LOG_LEVEL=BOGUS` returned `'BOGUS'` typed as a `LogLevel` while the logger itself fell back to `'warn'`. One variable, two answers.

Both readers now call `logLevelEnvVarName()` and `resolveLogLevel()`, exported from `lib/logging.ts`.

**Log-level validation accepted inherited prototype keys.** The check was `envLevel in LOG_LEVEL_VALUES`, which consults the prototype chain. Because the value is lower-cased first, the reachable inputs are only the prototype keys that are already lower-case: `constructor` and `__proto__`. Neither indexes to `undefined` — `in` returning true means the property is reachable, so they index to the Object constructor and to `Object.prototype` respectively. The damage is downstream in `shouldLog()`, where `number >= function` and `number >= object` both coerce to `NaN` and compare false, silencing **every** log line instead of falling back to `warn`. Now an own-property check.

(An earlier draft of this entry cited `<PLUGIN>_LOG_LEVEL=toString` as the trigger and said it indexed to `undefined`. Both halves were wrong — `toString` arrives as `tostring`, which is not a key under either check, so that input was never a bug. Corrected before release after an adversarial review refuted it.)

### Added

**CI enforcement of the log-level identity** — check 6 of `scripts/validate-versions.sh`, already wired to the `versions` job. Per plugin it asserts:

- `CLAUDE_PLUGIN_NAME` is a valid shell identifier
- `vitest.config.ts` runs under the **same** name as `run-hook-wrapper.sh` (this disagreement *is* #63)
- `CLAUDE.md` documents exactly `UPPER(name)_LOG_LEVEL` and no other `*_LOG_LEVEL` name

This is the signal that did not exist when #63 shipped: corrupting the documented name previously left the plugin suite, the shared suite and this script all at exit 0, and nothing under `scripts/`, `.github/` or `tools/` mentioned `LOG_LEVEL` at all. Guarded by three negative fixtures — `tests/fixtures/versions/bad-{logvar,plugin-id,test-identity}/` — so deleting the check cannot pass silently, since check 6 skips any plugin without a wrapper.

**29 tests for `getHookEnvironment()` and the identity helpers** — `tests/lib/hook-environment.test.ts`, linked into all five plugins. This surface previously had none.

### Changed

Plugin names are now **required** to match `[A-Za-z_][A-Za-z0-9_]*`, stated in root `CLAUDE.md`'s "Adding a New Plugin" procedure and enforced in CI. `export AI-TOOLKIT_LOG_LEVEL=debug` is rejected by POSIX `sh` as "not a valid identifier" while Node accepts the key, producing a knob that can be read but never set. The name is deliberately **not** normalised in code — normalising would let a violating name work by accident and re-open the gap between the log directory name and the variable name.

This supersedes the closing note of [2.0.9], which recorded that deriving the env var separately from the log directory "was considered and rejected" because the short name is already a valid shell identifier. That reasoning was reached from `logging.ts` alone — a second derivation existed in `types.ts`, untested, carrying the same hazard. The constraint is now explicit and enforced rather than incidental. Remaining factual corrections to the [2.0.9] entry are tracked in #75.

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
