# Changelog

All notable changes to the devops-toolkit (`dtk`) plugin will be documented in this file.

## [2.0.14] - 2026-08-01 — hook logs no longer leak into the real ~/.claude (#105)

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

Pinned by 4 new cases in the symlinked `tests/lib/logging.test.ts`, including a guard asserting the
resolved directory is **not** under the real `HOME` when `CLAUDE_CONFIG_DIR` isolates it. Mutation
control: reverting the fallback to `HOME`-only fails the guard (the precedence case still passes,
which is why the guard is the one that pins it).


⚠ **Existing logs are not migrated.** For a user with `CLAUDE_CONFIG_DIR` set, prior logs stay at
`$HOME/.claude/logs/<plugin>/` while new writes go to `$CLAUDE_CONFIG_DIR/logs/<plugin>/` — chasing
history means reading both. The realistic path to hitting this is `bin/` scripts and manual `tsx`
invocations, which run with `CLAUDE_PLUGIN_DATA` unset. `/ctk:doctor` and `/etk:review-stats` were
updated in the same change to search the relocated tree (and to keep excluding the `logs/plugin/`
fixture directory, whose filter was `.claude`-anchored and would have missed a relocated one).
## [2.0.13] - 2026-07-31 — document the real hook-log location

### Fixed

- **`CLAUDE.md` documented the legacy log path.** `logging.ts` prefers `CLAUDE_PLUGIN_DATA`
  (set by CC for live hooks), so real logs go to `$CLAUDE_PLUGIN_DATA/logs/`;
  `~/.claude/logs/devops/` is the fallback used only when that variable is unset — in practice
  the test suite. The legacy directory looks alive and is not, which produced a confident wrong
  conclusion about hooks not logging on 2026-07-31. Full note in ctk's CLAUDE.md.

## [2.0.12] - 2026-07-30 — correct declared counts and remove five phantom skills from the README

### Fixed

- **Command count was `13` everywhere; dtk ships `12`** — corrected in `plugin.json`, the
  marketplace entry, `CLAUDE.md` and `README.md`.
- **`README.md` listed five skills dtk does not ship**: `security-checklist`, `coding-standards`,
  `testing-strategy-builder`, `code-review-playbook` and `ascii-visualizer` all belong to etk/ftk.
  It also omitted `salesforce-integration-patterns` and `setup-pre-commit`, and declared `18` skills
  and `3` agents against a truth of `15` and `2`.
- **The Agents table listed `web-research-analyst`**, which is a **ctk** agent.
- **The Commands table listed `/security-checklist` and `/coding-standards`** (etk commands) while
  omitting `/salesforce-integration-patterns`.
- **`README.md` pinned `**Version**: 2.0.0`**, eleven patch versions stale.

Counts corrected against the filesystem, and pinned by a new CI gate. Until now
`scripts/validate-versions.sh` checked *versions* and nothing else, so a declared
count could drift indefinitely while every check stayed green. Check 7 (declared
counts vs the real directories, plus enumerated lists by name) and check 8 (plugin
README version) now close that hole -- see the root CLAUDE.md release checklist.

## [2.0.11] - 2026-07-27 — one derivation for the log-level variable, and a CI check that docs match code

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

## [2.0.10] - 2026-07-09 — terraform-gitlab-ci OIDC token fix + prune dead session-loader (cross-fork adoption)

Cross-fork adoption from the internal toolkit fork. Docs/skill + dead-code only — no runtime hook behavior changed.

### Fixed

- **terraform-gitlab-ci OIDC**: the CI template declared `id_tokens.GITLAB_OIDC_TOKEN` but the `before_script` read the deprecated `$CI_JOB_JWT_V2` and never used the declared token; the SKILL.md example used the wrong `id_token:` keyword. Both now use `$GITLAB_OIDC_TOKEN` and the `id_tokens:` keyword consistently (template + SKILL.md). `$CI_JOB_JWT_V2` is deprecated/removed on modern GitLab — a genuine functional fix for end users.

### Removed

- Deleted `hooks/src/lifecycle/session-loader.ts` — a real (non-symlink) copy left over from before the shared-hook consolidation. Not wired in `hooks.json`, not registered in `index.ts`, not imported anywhere; no dist artifact. Dead code; no runtime effect (session loading is ctk-owned via the shared hook).

## [2.0.9] - 2026-06-26 — adopt Claude Code OTEL telemetry in observability-monitoring

Documents the new Claude Code OpenTelemetry surface (CC alignment v2.1.193) in the `observability-monitoring` skill: the `model` attribute on metrics (CC v2.1.180) for per-model cost/latency breakdowns, and the `claude_code.assistant_response` log event (CC v2.1.193, redacted unless `OTEL_LOG_ASSISTANT_RESPONSES=1`). Skill-content only; no hook/dist change.


## [2.0.8] - 2026-06-25 — rebrand to Claude Forge

Suite renamed `claude-dev-kit` → **Claude Forge**. Updated repository/homepage URLs, the `continuity-recommendation` hook's install hint (`/plugin install ctk@claude-forge`), schema `$id` URLs, and install commands; dist rebuilt. Re-add the marketplace and reinstall as `dtk@claude-forge`.


## [2.0.7] - 2026-06-24 — genericize company-specific domain references

Part of a monorepo-wide pass removing company-specific domain references and genericizing example data across every plugin.

### Changed

- **`salesforce-integration-patterns`**: genericized the skill/command description and instruction examples (member/subscription framing → neutral domain).
- **`aws-cli-toolkit`**: replaced a hardcoded AWS account ID with the standard `123456789012` placeholder across the examples.
- **Shared skills** (`postgresql`, `coding-standards`, `ascii-visualizer`): genericized example data to a neutral domain.

## [2.0.6] - 2026-06-19 — security: SOQL-injection example fix; drop dangling reference links

Skills-security audit hardening (`docs/reviews/2026-06-19_skills-security-audit.md`).

### Security

- **`salesforce-integration-patterns`**: the User Sync example now validates the interpolated external ID before building the SOQL string (simple_salesforce has no bind-parameter API), with an upsert-by-external-id alternative — the prior f-string SOQL modeled an injectable pattern. Replaced the 5 dangling `references/` links with an inline Security Notes section (SOQL injection, webhook HMAC, least privilege).

## [2.0.5] - 2026-06-14 — first open-source release

DevOps, infrastructure, and backend development: AWS, Terraform, CI/CD, Salesforce, Lambda container patterns, and Husky pre-commit setup. 15 skills, 2 agents, 13 commands, plus the `repo-access-guard` hook.

### Highlights

- **`repo-access-guard`** restricts configured repos to AWS Bedrock users; ships with an empty default policy (`bedrock_only: []`) — add your own patterns via `.claude/repo-access-policy.json`.
- MIT licensed.

_First public release at 2.0.5; earlier version history was internal and has been omitted._
