# Changelog

All notable changes to the ai-toolkit (`atk`) plugin will be documented in this file.

## [2.0.13] - 2026-08-01 — hook logs no longer leak into the real ~/.claude (#105)

### Fixed

- **`getLogDir()`'s fallback now honors `CLAUDE_CONFIG_DIR`** before `$HOME/.claude`. Keying it off
  `HOME` alone meant the per-plugin `CLAUDE_CONFIG_DIR` isolation in every `vitest.config.ts` could
  never cover logging — that isolation (added during #82) made snapshot-writing hermetic and left
  log-writing exactly as leaky as before. Test runs wrote **28 MB across 6 directories** into the
  developer's real home, and a shipped command (#106) read those fixtures back as real data.
- **`shared/hooks-infra/vitest.config.ts` gained `CLAUDE_CONFIG_DIR`** — it was the one config of
  six without it, which is why `~/.claude/logs/plugin/` accumulated 1026 fabricated rows.

`CLAUDE_PLUGIN_DATA` still takes precedence, so **live hook logging is unchanged**: CC sets that
variable for real dispatch, which is why the fallback runs almost exclusively under test and on
pre-`CLAUDE_PLUGIN_DATA` CC versions. Where it does run, respecting `CLAUDE_CONFIG_DIR` is the
correct behaviour — a user who relocates `.claude` expects their logs to move with it.

Pinned by 3 new cases in the symlinked `tests/lib/logging.test.ts`, including a guard asserting the
resolved directory is **not** under the real `HOME` when `CLAUDE_CONFIG_DIR` isolates it. Mutation
control: reverting the fallback to `HOME`-only fails the guard (the precedence case still passes,
which is why the guard is the one that pins it).

## [2.0.12] - 2026-07-30 — correct declared skill/command counts (16 · 1 · 25)

### Fixed

- **`plugin.json` declared `14 skills, 1 agent, 23 commands`; the real numbers are `16 · 1 · 25`.**
  The two missing entries are `coaching-conversation-patterns` and `pgvector-search`, which PR #25
  added to marketplace.json and CLAUDE.md but never to `plugin.json` or the README.
- **`README.md`** carried the same stale `14 Skills` / `23 Commands` lists (both omitting those two
  skills/commands) and pinned `**Version**: 2.0.0`, eleven patch versions stale.

Counts corrected against the filesystem, and pinned by a new CI gate. Until now
`scripts/validate-versions.sh` checked *versions* and nothing else, so a declared
count could drift indefinitely while every check stayed green. Check 7 (declared
counts vs the real directories, plus enumerated lists by name) and check 8 (plugin
README version) now close that hole -- see the root CLAUDE.md release checklist.

## [2.0.11] - 2026-07-30 — correct two refuted claims in the 2.0.9 entry (#75)

Documentation only. No skill, agent, command or hook behaviour changed.

### Fixed

Two factual claims in the released **2.0.9** entry below were refuted by the adversarial review of
#72 and had been left uncorrected. Both are now annotated **in place**:

- **The `17 / 8 / 7` log-level counts were symlink paths, not distinct files.** `grep -R` follows
  this repo's directory symlinks and inflates counts ~2.8×; the distinct-blob figures are
  **6 / 3 / 2**. The asymmetry the argument rested on survives, so the conclusion stands — but the
  stated numbers did not.
- **"Deriving the env var separately was considered and rejected" was decided against one of two
  derivation sites.** A second lived in `getHookEnvironment()` in `types.ts` — public API of all five
  plugins, zero tests, zero callers, already divergent. #74 later single-sourced it (etk 2.16.1),
  which is why the conclusion holds today; it did not hold for the reason originally given.

Also recorded, in the symlinked `logging.test.ts` header where the identity table lives: **the
production log directory is safe iff `run-hook-wrapper.sh` is unchanged** — *not* because
`CLAUDE_PLUGIN_DATA` takes precedence, which was the reasoning #72 gave and the review demolished.
The wrong reason would have given identical false reassurance had #63 been resolved by changing the
wrappers instead, which *would* have relocated real users' logs.

Minor, same area: `CLAUDE.md` regained the column alignment its predecessor had, and now documents `CLAUDE_PLUGIN_NAME` — ftk's did, atk's did not, so the #63 confusion stayed undocumented on this side.

> **On versioning.** Corrections to released entries ride whatever release is already shipping; when
> the correction is the only change, it takes its own patch bump, because Claude Code re-resolves an
> install only when the version differs — an unbumped correction is one no user ever receives. That
> decision is recorded in etk's CHANGELOG under #75.

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

> **Correction (2026-07-30, #75).** The `17 / 8 / 7` figures above are **symlink paths, not distinct
> files** — `grep -R` follows this repo's directory symlinks, inflating counts ~2.8×. The
> distinct-blob figures are **6 / 3 / 2** (`git grep -l`). The asymmetry the argument rests on
> survives intact (0 vs 6/3/2) and the conclusion stands, but a reader would reasonably infer the
> variable is referenced in seventeen places, and it is not.
>
> Also imprecise: **"appears in 0 files" is not "nothing reads it."** `logging.ts` builds the name
> dynamically, so a literal-text census could never find it whether or not it works. The zero is
> evidence of *undocumented*, not of *unread*.
>
> Corrected in place rather than only forward: a reader landing on this entry should not be handed a
> false measurement. History is annotated, not rewritten.

`vitest.config.ts` now sets `ai`, so the suite verifies the identity users actually get. The issue's recommended option covered only that half; correcting the docs was added because aligning the tests alone would have left the documented control dead.

Deriving the env var separately from the log directory was considered and rejected — `ai` is already a valid shell identifier, and the invalid-identifier problem existed only in the hyphenated test-only name now removed.

> **Correction (2026-07-30, #75).** "Considered and rejected" was decided against **one of two**
> derivation sites. A second lived at `shared/hooks-infra/src/types.ts` inside `getHookEnvironment()`
> — public API of all five plugins, with zero tests and zero callers, and it had already diverged
> (it neither lower-cased nor validated the value). The conclusion holds *today* only because #74
> later single-sourced the derivation (etk 2.16.1); it did not hold when this entry was written, and
> the reason given here was never sufficient to support it.

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
