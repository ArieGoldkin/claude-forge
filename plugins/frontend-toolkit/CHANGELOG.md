# Changelog

All notable changes to the frontend-toolkit (`ftk`) plugin will be documented in this file.

## [2.4.0] - 2026-08-06 — `quickviz`: render it now, inline

### Added

- **New skill `quickviz`** — renders an answer as a diagram **in the chat reply, immediately**:
  no setup questions, no agents, no file written. With no topic given, the topic is the current
  conversation. Adapted from [OrchestKit](https://github.com/yonatangross/orchestkit)'s skill of
  the same name (MIT, with thanks); the behaviour contract, shape→form routing, closed glyph
  vocabulary, and the Blast Radius / Reversibility Timeline patterns come from there.
- **An honesty rule, carried over deliberately**: if a number is unknown, print `?` — never invent
  one. A confident-looking chart built on guesses launders a guess as a measurement.

### Changed

- **`ascii-visualizer`'s ASCII-only rule is now scoped by GLYPH CLASS**, which is what it always
  actually meant. The skill was never "ASCII only" — its own file-tree examples use `├── └── │` and
  it carries ~94 box-drawing characters. The rule now written down in both skills:
  **bordered boxes in a file use ASCII (`+ - |`)**, because every box-drawing border character is
  East-Asian **Ambiguous** and a framed diagram can double in width for a reader you cannot predict;
  **file trees use Unicode**, because a tree has no right border to align, so the risk costs nothing.
  **In chat, bordered boxes may use Unicode** — one client, known locale. Common Mistakes row and
  Creation Checklist item 10 are both scoped accordingly; neither is a ban on `│`.
- **`ascii-visualizer` now declares `effort: low`**, which it previously omitted.
- **`ascii-visualizer`'s description now complies with the repo's CSO rules.** It previously began
  with a capability statement and carried no `Use when` opening and no `Triggers on` tail, so it paid
  permanent per-turn context rent while being hard to actually trigger.

### Fixed

- **The enumerated skill list in `CLAUDE.md` named a skill this plugin does not have and omitted one
  it does** — it listed `coding-standards` (an **etk** skill) and left out `playground`. The declared
  total, the list length, and the directory count **all agreed at 17**, which is exactly why it
  survived. ⚠ CI check 7 does **not** catch this for ftk: the by-name verification covers the
  `- **N skills**: a, b, c` form, and this file uses the directory-attached form, which is
  count-only. Verified by running the gate against the wrong list — it exits 0.

### Divergences from the upstream skill (each measured, not assumed)

- **Glyphs inside diagrams, emoji outside.** The 11 glyph slots (15 characters) are **1 column** each
  in a Western locale; **all 11 emoji shipped here are 2 columns** and shift a row's right edge.
  Upstream ships both vocabularies without stating the placement rule. ⚠ **1 column is not "safe
  everywhere"**: 11 of the 15 glyphs are East-Asian Ambiguous — and so is *every border character*,
  so in an unknown locale the correct advice is to avoid a bordered box entirely rather than swap its
  contents. Upstream's `⏸` is dropped here (the `▷` glyph already means *awaiting input*, and `⏸` is
  the one 1-column emoji, so keeping it would falsify the rule).
- **Unicode is scoped to chat**, per the surface split above, rather than used everywhere.
- **Alignment is prose discipline, not a verifier script.** Adding executable machinery to a shipped
  plugin needs its own justification, which it does not yet have. ⚠ The discipline is not
  theoretical: upstream's own worked example — the one labelled *"Correct"* — measures **55, 57 and
  56** columns across its three border lines, and the same file mixes `┌─┐` with `+-+`, which its own
  `single-set` rule forbids.
- **Declined**: upstream's `tokens.json` / `primitives.json` / `tokens.schema.json` substrate —
  maintainer machinery that an installer never touches, the same call made in 2.3.7 and 2.3.8.

## [2.3.14] - 2026-08-01 — hook logs no longer leak into the real ~/.claude (#105)

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
## [2.3.13] - 2026-07-30 — correct two refuted claims in the 2.3.11 entry (#75)

Documentation only. No skill, agent, command or hook behaviour changed.

### Fixed

Two factual claims in the released **2.3.11** entry below were refuted by the adversarial review of
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

Minor, same area: `hooks/bin/run-hook-wrapper.sh` no longer identifies itself as `# AI Toolkit Plugin` in its header comment (pre-existing copy-paste; comment only, no behaviour).

> **On versioning.** Corrections to released entries ride whatever release is already shipping; when
> the correction is the only change, it takes its own patch bump, because Claude Code re-resolves an
> install only when the version differs — an unbumped correction is one no user ever receives. That
> decision is recorded in etk's CHANGELOG under #75.

## [2.3.12] - 2026-07-27 — one derivation for the log-level variable, and a CI check that docs match code

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

This supersedes the closing note of [2.3.11], which recorded that deriving the env var separately from the log directory "was considered and rejected" because the short name is already a valid shell identifier. That reasoning was reached from `logging.ts` alone — a second derivation existed in `types.ts`, untested, carrying the same hazard. The constraint is now explicit and enforced rather than incidental. Remaining factual corrections to the [2.3.11] entry are tracked in #75.

## [2.3.11] - 2026-07-27 — the documented log-level variable was a third name that nothing read

Docs + test config. No skill, agent, command or hook behaviour changed.

### Fixed

**`FRONTEND_TOOLKIT_LOG_LEVEL` → `FRONTEND_LOG_LEVEL` in `CLAUDE.md`, and the test identity aligned to production** (closes #63 for ftk).

Issue #63 reported two disagreeing names — production (`frontend`, via `run-hook-wrapper.sh`) versus tests (`frontend-toolkit`, via `vitest.config.ts`). Investigation found a **third**: `CLAUDE.md` documented `FRONTEND_TOOLKIT_LOG_LEVEL`, matching neither. Since `logging.ts:122` builds the variable as `${CLAUDE_PLUGIN_NAME.toUpperCase()}_LOG_LEVEL`, production reads `FRONTEND_LOG_LEVEL` — so a user following the documentation exported a variable **nothing has ever read**.

Measured, not assumed: `FRONTEND_LOG_LEVEL` appeared in **0** files repo-wide, against 17 / 8 / 7 for `CONTINUITY_` / `ENGINEERING_` / `DEVOPS_LOG_LEVEL` — the three plugins whose names never drifted.

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

`vitest.config.ts` now sets `frontend`, so the suite verifies the identity users actually get. The issue's recommended option covered only that half; correcting the docs was added because aligning the tests alone would have left the documented control dead.

Deriving the env var separately from the log directory was considered and rejected — `frontend` is already a valid shell identifier, and the invalid-identifier problem existed only in the hyphenated test-only name now removed.

> **Correction (2026-07-30, #75).** "Considered and rejected" was decided against **one of two**
> derivation sites. A second lived at `shared/hooks-infra/src/types.ts` inside `getHookEnvironment()`
> — public API of all five plugins, with zero tests and zero callers, and it had already diverged
> (it neither lower-cased nor validated the value). The conclusion holds *today* only because #74
> later single-sourced the derivation (etk 2.16.1); it did not hold when this entry was written, and
> the reason given here was never sufficient to support it.

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
