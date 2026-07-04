# Claude Forge

> **Maintainer**: Arie Goldkin
> **Plugins**: ctk (formerly continuity-toolkit), dtk (formerly devops-toolkit), atk (formerly ai-toolkit), ftk (formerly frontend-toolkit), etk (formerly engineering-toolkit)
> **Versioning**: Independent per plugin
> **CC Alignment**: v2.1.193 (audited 2026-06-26). The v2.1.174→193 gap analysis (model-governance enforcement via `enforceAvailableModels`, the hook `if`-condition file-path fix, auto-mode native git-blocking + `classifyAllShell`, nested-subagent 5-deep, `/plugin` Skills tab) is in `docs/reviews/2026-06-26_cc-v2.1.193-alignment-gaps.md`. **Floor note:** ctk's `hooks.json` file-path `if` conditions (`Write(*.ts)`, `Write(.env*)`, …) depend on the **v2.1.176** fix to gate correctly — that is the effective minimum CC version for our security/permission hooks. Per-version "considered but not adopted" notes are not tracked here — see `git log -p CLAUDE.md` or the CC CHANGELOG for prior reasoning. Prior reviews: v2.1.159→173 in `docs/reviews/2026-06-11_cc-v2.1.173-alignment-audit.md`; v2.1.153→158 in `docs/reviews/2026-05-31_cc-v2.1.158-plugin-system-alignment-audit.md`.

## Communication Style

**IMPORTANT**: Never tell me what I want to hear. Look at things objectively, contradict me when needed. If you think otherwise, go with your strong opinion. Be direct and honest - I value accuracy over agreement.

## Architecture

Monorepo for 5 domain-agnostic Claude Code plugins, sharing hook infrastructure via **directory-level symlinks**.

```
claude-forge/
├── shared/hooks-infra/
│   ├── package.json            # "type": "module" (required for tsx resolution)
│   ├── src/lib/                # 12 shared library files
│   │   ├── output.ts           # Hook output helpers (outputDeny, outputAllow, etc.)
│   │   ├── input.ts            # Input parsing (getToolName, getFilePath, etc.)
│   │   ├── logging.ts          # Structured logging (parameterized via CLAUDE_PLUGIN_NAME)
│   │   ├── path-utils.ts       # Symlink-safe path resolution
│   │   ├── guards.ts           # Composable guard system
│   │   ├── continuity.ts       # Continuity directory management
│   │   ├── git-utils.ts        # Git helper functions
│   │   ├── git-validators.ts   # Branch/commit validation
│   │   ├── error-rules.ts      # Error pattern matching rules
│   │   ├── permission-profiles.ts # Permission rule evaluation
│   │   ├── lock.ts             # Atomic file locking (mkdir-based)
│   │   └── index.ts            # Barrel exports
│   ├── src/types.ts            # Shared type definitions (HookInput, HookResult, etc.)
│   ├── src/hooks/              # Shared hook implementations (symlinked into plugins)
│   │   ├── pretool/            # security-blocker, etc.
│   │   ├── posttool/           # lint-checker, dirty-state-tracker, error-warner, etc.
│   │   ├── lifecycle/          # pre-compact-saver, session-end
│   │   ├── permission/         # auto-approve-safe-bash, auto-approve-project-writes, etc.
│   │   └── prompt/             # context-monitor, hipaa-context-injector
│   └── tests/lib/              # 11 shared library test files
├── plugins/
│   ├── continuity-toolkit/     # Session continuity management (v2.6.11, installed as ctk)
│   ├── devops-toolkit/         # DevOps and infrastructure toolkit (v2.0.9, installed as dtk)
│   ├── ai-toolkit/             # AI/LLM development patterns (v2.0.6, installed as atk)
│   ├── frontend-toolkit/       # Frontend, UI/UX, Stitch AI, json-render, design systems, Remotion explainer videos (block-based + bespoke) (v2.3.9, installed as ftk)
│   └── engineering-toolkit/    # Engineering practices, quality, architecture (v2.8.3, installed as etk)
└── .github/workflows/ci.yml    # GitHub Actions CI (per-plugin matrix + shared tests)
```

### Plugin Summary

| Plugin | Skills | Agents | Commands | Hooks | Focus |
|--------|--------|--------|----------|-------|-------|
| ctk (formerly continuity-toolkit) | 11 | 1 | 12 | 27 (**all shared hooks** + hipaa-context-injector) | Session persistence, context monitoring, web research, shared hook owner |
| dtk (formerly devops-toolkit) | 15 | 2 | 12 | 2 (repo-access-guard, continuity-recommendation) | Infrastructure, AWS, Terraform, CI/CD, Salesforce, Husky pre-commit |
| atk (formerly ai-toolkit) | 16 | 1 | 25 | 1 (continuity-recommendation) | RAG, embeddings, LangGraph, LLM patterns, conversational AI, NotebookLM |
| ftk (formerly frontend-toolkit) | 16 | 4 | 11 | 1 (continuity-recommendation) | React, Figma, Stitch AI, shadcn/ui, design systems, browser automation |
| etk (formerly engineering-toolkit) | 25 | 4 | 20 | 2 (review-logger, continuity-recommendation) | ADR, TDD, code review, quality gates, HIPAA compliance, brainstorming, Sentry investigation, MR-comment posting, codebase zoom-out, caveman terse-mode |

> **Important**: ctk (formerly continuity-toolkit) is the **canonical owner of all shared hooks** (security, permissions, lifecycle, post-tool, HIPAA context injection). Install it alongside other plugins for full hook coverage. Other plugins have been stripped of shared hooks to prevent duplication when multiple plugins are installed simultaneously.
>
> **Note**: All 5 plugins are **domain-agnostic** and reusable on any project.

### Symlink Setup

Each plugin's `hooks/src/lib/`, `hooks/src/types.ts`, and shared hook implementations are symlinks:

```
# Shared library + types (directory-level symlinks)
plugins/{name}/hooks/src/lib      → ../../../../shared/hooks-infra/src/lib
plugins/{name}/hooks/src/types.ts → ../../../../shared/hooks-infra/src/types.ts

# Shared hook implementations (per-file symlinks)
plugins/{name}/hooks/src/pretool/security-blocker.ts  → ../../../../../shared/hooks-infra/src/hooks/pretool/security-blocker.ts
plugins/{name}/hooks/src/lifecycle/pre-compact-saver.ts → ../../../../../shared/hooks-infra/src/hooks/lifecycle/pre-compact-saver.ts
# ... (all shared hooks follow this pattern)
```

**4 levels up** from `plugins/{name}/hooks/src/` to reach the monorepo root.

### Import Resolution: The Directory Nesting Mismatch

**CRITICAL**: Shared hook files have imports that look wrong from the shared directory but are correct from the plugin directory. This is by design.

In the **shared directory**, hooks are nested one level deeper under `src/hooks/`:
```
shared/hooks-infra/src/
├── lib/guards.ts          ← real file
├── types.ts               ← real file
└── hooks/                 ← extra nesting level
    └── permission/
        └── auto-approve-project-writes.ts  (imports ../lib/guards.js)
```
From `src/hooks/permission/`, `../lib/` resolves to `src/hooks/lib/` — **DOES NOT EXIST**.

In the **plugin directory**, symlinks flatten the structure:
```
plugins/{name}/hooks/src/
├── lib/              → symlink to shared/hooks-infra/src/lib
├── types.ts          → symlink to shared/hooks-infra/src/types.ts
└── permission/
    └── auto-approve-project-writes.ts  → symlink to shared file
```
From `src/permission/`, `../lib/` resolves to `src/lib/` — **EXISTS** (the symlinked lib).

With `preserveSymlinks: true`, TypeScript resolves imports relative to the **symlink location** (plugin), not the real file location (shared). This is why it works.

**Consequences**:
- `shared/hooks-infra/tsconfig.json` **MUST** exclude `src/hooks` — those imports don't resolve from the shared directory
- Hook files are only ever compiled via plugin tsconfigs (where preserveSymlinks fixes resolution)
- IDEs may show false import errors when editing shared hook files directly
- The shared tsconfig only type-checks `src/lib/` and `src/types.ts`

### What Is Shared vs Per-Plugin

| Component | Shared? | Location |
|-----------|---------|----------|
| `src/lib/` (12 files) | **Symlink** | `shared/hooks-infra/src/lib/` |
| `src/types.ts` | **Symlink** | `shared/hooks-infra/src/types.ts` |
| `src/{pretool,posttool,...}/*.ts` (shared hooks) | **Symlink** | `shared/hooks-infra/src/hooks/{type}/` |
| `src/index.ts` (hook registry) | Per-plugin | Each plugin registers its own hooks |
| `src/{pretool,posttool,...}/*.ts` (plugin hooks) | Per-plugin | Plugin-specific hook implementations |
| `bin/run-hook.ts` | Per-plugin | Imports plugin-specific `index.ts` |
| `bin/run-hook-wrapper.sh` | Per-plugin | Sets `CLAUDE_PLUGIN_NAME` env var |
| `hooks.json` | Per-plugin | Different hooks wired per plugin |
| Build configs (tsup, tsconfig, etc.) | Per-plugin | Rarely change, copy when needed |
| `skills/`, `agents/`, `commands/` | Per-plugin | Plugin-specific content |

### Hook Ownership

**ctk** (formerly continuity-toolkit) is the sole owner of all shared hooks. Other plugins only register their plugin-specific hooks:

| Plugin | Hooks | Notes |
|--------|-------|-------|
| ctk | All shared hooks (26 total) + hipaa-context-injector | Canonical shared hooks owner |
| etk | review-logger, continuity-recommendation | Domain-specific only |
| dtk | repo-access-guard, continuity-recommendation | Domain-specific only |
| atk | continuity-recommendation | Recommends ctk installation |
| ftk | continuity-recommendation | Recommends ctk installation |

Users must install ctk (continuity-toolkit) for shared hook coverage (security, permissions, lifecycle, etc.).

## Critical Build Requirements

### 1. `preserveSymlinks` in tsup.config.ts and tsconfig.json

Every plugin's `tsup.config.ts` **must** include:
```typescript
esbuildOptions(options) {
  options.preserveSymlinks = true;
},
```
Every plugin's `tsconfig.json` **must** include `"preserveSymlinks": true` in compilerOptions.

Without this, esbuild/TypeScript resolve symlinks to real paths, breaking import resolution for shared hooks (see "Import Resolution" above).

### 1a. `shared/hooks-infra/tsconfig.json` must exclude `src/hooks`

The shared tsconfig must have `"src/hooks"` in its exclude array. Shared hook files use import paths written for the plugin's flat directory structure — they don't resolve from the shared directory's nested `src/hooks/` structure.

### 2. `shared/hooks-infra/package.json` must have `"type": "module"`

tsx resolves symlinks to real paths for module type detection. Without this file, shared `.ts` files are loaded as CommonJS, breaking named exports.

### 3. `CLAUDE_PLUGIN_NAME` environment variable

- Set by each plugin's `run-hook-wrapper.sh` (e.g., `export CLAUDE_PLUGIN_NAME="continuity"`)
- Used by `logging.ts` for log directory name and log level env var prefix
- Set in `vitest.config.ts` via `test.env` for continuity and devops plugins
- Defaults to `'plugin'` if unset

## Development Workflow

### Edit shared code
```bash
# Edit once — all plugins pick it up instantly via symlinks
vim shared/hooks-infra/src/lib/output.ts

# Test in any plugin
cd plugins/continuity-toolkit/hooks && npm test

# Commit — CI validates all 5 plugins
git add -A && git commit -m "fix: shared output helper edge case"
```

### Edit plugin-specific code
```bash
cd plugins/continuity-toolkit/hooks
vim src/pretool/security-blocker.ts
npm test
# CI validates only this plugin (unless shared/ also changed)
```

### Build & test commands
```bash
cd plugins/{name}/hooks
npm install          # Install dependencies
npm run build        # Build with tsup (esbuild)
npm run typecheck    # TypeScript check
npm run test:run     # Run tests once (continuity)
npm test -- --run    # Run tests once (devops/ai/frontend/engineering — different script name)
npm run lint         # Biome lint
```

### Hot-reload during development
```bash
# After editing plugin files (hooks, manifests, agents, commands, skills),
# reload everything without restarting Claude Code
/reload-plugins

# After editing only skill files (skills/**/*.md), re-scan just the skill
# directories — faster than /reload-plugins (CC v2.1.152+)
/reload-skills
```

> **When to use which**: `/reload-skills` (v2.1.152+) only re-scans skill directories — use it during skill authoring for the tightest iteration loop. `/reload-plugins` reloads the entire plugin (hooks, agents, commands, manifests, MCP servers) — use it after any non-skill change.

> **Note**: CC v2.1.116+ auto-installs any missing plugin dependencies on `/reload-plugins` and during background auto-update. Our non-continuity plugins declare `dependencies: ["ctk"]`, so reloading a plugin in a project without ctk will now pull it automatically instead of running the plugin without shared hooks.
>
> **CC v2.1.117+ extends this** to two more paths:
> - `plugin install <name>` on an already-installed plugin now back-fills missing dependencies instead of stopping at "already installed". Useful for users who installed one of our toolkits before we added the `dependencies` field — re-running `plugin install` pulls ctk automatically.
> - `claude plugin marketplace add <url>` now transitively resolves missing dependencies from configured marketplaces. Re-adding our marketplace auto-pulls ctk.
>
> **CC v2.1.118+ further strengthens this**: `plugin install` now also re-resolves dependencies installed at the *wrong version* (not just missing). If a user has ctk pinned at an older version than a toolkit's `dependencies` field allows, re-running `plugin install` fixes it. Auto-update skips driven by inter-plugin version constraints now surface in `/doctor` and the `/plugin` Errors tab — easier to debug "why is my plugin disabled".
>
> **CC v2.1.119+ closes the loop**: when plugin A pins plugin B to a version *range*, CC now auto-updates B to the highest satisfying git tag — no manual `plugin install` re-run needed. Our `dependencies: ["ctk"]` declarations are unversioned (any-ctk-satisfies), so this is a no-op for our current state. If we ever pin to a range like `["ctk@^2"]`, users will get rolling minor updates within the range automatically.

### Verifying a 5-plugin install with `/doctor` (CC v2.1.144+)

CC v2.1.144 removed the truncated skill listing from the startup notification — the full per-plugin breakdown is now only available via `/doctor`. For a 5-plugin install (ctk + 4 other core), this matters: the startup line no longer confirms whether every plugin's skills loaded.

After `claude plugin install` (or after a `/reload-plugins`), run `/doctor` to verify the full skill, agent, command, and hook count matches what each plugin declares. Mismatch usually points to a missing dependency (use `claude plugin install <name>` to re-resolve per v2.1.117+/v2.1.118+ behavior) or a hook-load error (visible in the `/plugin` Errors tab per v2.1.118+).

For a quick install/enablement census without full diagnostics, run `/plugin list` (CC v2.1.163+) — the `--enabled`/`--disabled` filters confirm all 5 plugins are enabled faster than `/doctor` when you only need presence, not counts. For a per-plugin **skill** census specifically, the `/plugin` Installed tab now has a dedicated **"Skills" section** (CC v2.1.186+), and the marketplace browser gained a search bar (v2.1.180).

### Authoring skills/agents/commands with `--dangerously-skip-permissions` (CC v2.1.121+)

When using `claude --dangerously-skip-permissions` to iterate on plugin authoring, CC v2.1.121+ no longer prompts for **writes** to `.claude/skills/`, `.claude/agents/`, and `.claude/commands/`. The flag bypasses all permission prompts globally; the v2.1.121 fix repaired a regression where these specific paths were still prompting under the flag.

Caveats (per CHANGELOG, verbatim):
- **Writes only**. Reads were never prompted under the flag.
- `.claude/hooks/` and `.claude/settings.json` are NOT in the exemption list — those still prompt under non-dangerous modes.
- Project-level `.claude/` vs user-level `~/.claude/` scope is unverified by the CHANGELOG; conservative reading is "both match by suffix".

This affects plugin authors iterating in their working tree, not end-user plugin installs.

### Periodic state saves with /loop
```bash
# Auto-save continuity state every 30 minutes
/loop 30m /save-state
```

> **Note**: `/proactive` is an alias for `/loop` (CC v2.1.105+). Both commands are interchangeable.
>
> **Cancel a running loop**: Press `Esc` to interrupt the current iteration and cancel the schedule (CC v2.1.113+). The loop will not fire again until restarted.

### Auditing token economics with `/usage` (CC v2.1.149+)

`/usage` now shows a per-category breakdown of what's driving your session's limit consumption — broken down by **skills**, **subagents**, **plugins**, and **per-MCP-server cost**. Useful when a skill or subagent feels expensive and you need to confirm before optimizing.

Common uses:
- After a long brainstorming session, check which subagent dispatches dominated cost
- After installing a new plugin, see which of its skills are getting auto-loaded into context
- When debugging "why is this conversation expensive", look at per-MCP-server cost (e.g., Atlassian MCP can be heavy)

Files are scanned with a streaming read in v2.1.152+, so memory stays flat even on long sessions.

### Update build config (rare)
Build configs are per-plugin (not symlinked). When updating, copy across all 5 plugins in the same commit.

## CI Pipeline

GitHub Actions runs `.github/workflows/ci.yml` on every push to `main` and on pull requests. Jobs:

- **`plugins`** — a matrix over all 5 plugins; each runs `npm ci` (shared hooks-infra + plugin hooks) then `npm run lint`, `npm run typecheck`, `npm test`. `fail-fast: false` so one plugin's failure doesn't cancel the others.
- **`shared-tests`** — runs the shared `hooks-infra` test suite (lock, dangerous-bash, input, guards, …).
- **`manifest-shape`** — runs `scripts/validate-manifest-shape.sh` against the fixtures (rejects top-level `themes`/`monitors` keys).
- **`validate`** — `claude plugin validate plugins/{name}` per plugin for static structure checks (frontmatter, hooks.json schema). Non-blocking (`continue-on-error: true`), since the CLI install path isn't available in every fork.

Node deps are cached via `actions/setup-node`'s `cache: npm`, keyed on each plugin's `package-lock.json`.

> **Future improvement (CC v2.1.129+)**: `claude --output-format stream-json -p test` populates `init.plugin_errors` with *runtime* plugin-load failures (missing files referenced by hooks.json, wrong wrapper-script permissions, etc.) — the kinds of defects `claude plugin validate` can't catch statically. Adding a runtime smoke job to CI (`jq -e '.init.plugin_errors | length == 0'`) would close that gap, but requires an `ANTHROPIC_API_KEY` repo secret because the command makes a real API call. Deferred until that secret-management work is in scope.

## Opus 4.7+/4.8 Usage Guidance

These behavioral shifts apply when the active model is **Opus 4.7 or 4.8** (4.8 is the current default; this monorepo is authored and audited on it). They affect how skill, agent, and command authors should write. **Opus 4.8 (CC v2.1.154) keeps the same authoring contract** and makes **high effort the session default** — and ships a **lean system prompt by default**, which makes guidance #5 (front-loading context) *more* load-bearing, not less. The five shifts:

1. **Fewer implicit tool calls.** Opus 4.7 calls tools *less* than 4.6. Skills must name the tool explicitly ("Use Grep to find X", "Read file Y", "Call `mcp__atlassian__search` with cloudId") rather than narrating intent ("find the relevant files", "gather context"). Narrative phrasing risks underperformance because 4.7 prefers reasoning over tool invocation when ambiguous.

2. **More judicious subagent delegation.** Commands that fan out to multiple subagents MUST say so explicitly. Preferred phrasing: **"Dispatch all agents in a single response by emitting multiple Agent tool calls in the same message"** or **"Spawn N subagents in the same turn."** Soft phrasing like "use parallel agents when possible" is insufficient — 4.7 will serialize by default. See `plugins/engineering-toolkit/skills/brainstorming/references/deep-mode-phases.md` and `plugins/engineering-toolkit/commands/review-mr.md` for canonical examples.

3. **`xhigh` is the recommended default effort** for coding/agentic skills (introduced in 4.7 between `high` and `max`; remains the recommended coding/agentic tier on 4.8, where ultracode resolves to `xhigh`). `max` overthinks and has runaway token usage; reserve for genuinely hard problems. Set in frontmatter:
   ```yaml
   ---
   name: my-skill
   effort: xhigh
   ---
   ```
   `xhigh` degrades gracefully on older models (falls back to `high`). Current monorepo convention: all long-horizon skills/agents (fix-bug, cover, experiment, brainstorming, dev-pipeline, tdd-implementer, devops-architect, etc.) declare `effort: xhigh`. Low/medium-effort skills stay as-is.

4. **Adaptive thinking replaces fixed budgets.** Do NOT set `budget_tokens`, `thinking_budget`, or hard-coded thinking token numbers in skill references or agent bodies — these are deprecated in 4.7. The model chooses when to think. Steer via prompt language: "Think carefully step-by-step" to increase, "Prioritize responding quickly" to decrease.

5. **Front-load context in agent prompts.** Intent, constraints, acceptance criteria, and file locations belong in the opening paragraph — not discovered across turns. Progressive disclosure degrades output quality on 4.7. A good agent prompt reads like a well-specified engineering ticket, not a conversation starter.

### Model economics for subagent dispatch

> Added 2026-06-11. All 14 agents currently declare `model: inherit`, so a Fable session runs Fable for *everything* — including log reduction and repo scans. Fable prices above Opus-tier and its tokenizer yields ~30% more tokens for the same content, so inherit-everywhere is the most expensive possible configuration for scan-shaped work.

**Keep on the session model** (the judgment layer): task decomposition, architecture and risk tradeoffs, resolving conflicts between agent reports, integration decisions, synthesis, final review.

**May route to a cheaper tier** — `sonnet` for bounded scans and execution, `haiku` for pure reduction — via agent frontmatter `model:` or Workflow `opts.model`: repo/docs inventory scans, search summaries, log and test-output reduction, browser/test execution passes, bounded mechanical edits.

Rules:
- **When delegating to a cheaper tier, include explicit stop conditions** in the prompt ("if the file doesn't match this description, stop and report — don't improvise").
- **Cheaper scan tiers raise the false-lead rate** — the existing vet discipline (review-mr evidence gating, verify-against-ground-truth workflows) is mandatory, not optional, for findings produced on cheaper tiers.
- **Status quo until piloted**: all agents stay `model: inherit`. Pilot by piggybacking an already-planned wave (next `/review-mr` scan agents or `/brainstorming --deep` research phase) with `opts.model: "sonnet"`, compare findings quality against an inherit baseline, and only then consider flipping any agent's frontmatter. The pilot rides existing work — it is not its own project.

### Model & MCP governance (CC v2.1.175–187)

The model-economics guidance above is **advisory**. As of the v2.1.175–187 line it can be made **enforceable** — turning the cost ceiling from intent into rules the harness applies. This is the enforcement layer the auto-research 2.8.0 port had to adapt around; adopt it for real teeth:

1. **`enforceAvailableModels` managed setting (v2.1.175).** Pin the allowed model set so a more expensive model can't be selected — for the session *or any subagent*. v2.1.176/180/187 hardened enforcement for alias picks, subagents, and the model picker. Set in **managed settings** for org-wide enforcement:
   ```json
   { "enforceAvailableModels": ["claude-sonnet-4-6", "claude-opus-4-8"] }
   ```
2. **`autoMode.soft_deny: ["Agent(model:fable)"]`** — prompt before an expensive subagent spawn instead of hard-blocking it (respects the `$defaults` merge semantics).

Why this matters here: **auto-research is the repo's highest-fan-out entry point** (a `design` route spawns ~11 agents), so it is exactly where an unconstrained model choice is most expensive. These settings are the enforceable backing for the advisory rule that fan-out must not defeat the cost ceiling. Configure in managed settings (org-wide) or `~/.claude/settings.local.json` (gitignored, per-developer).

## Output Budgeting

Long-form deliverables go to files, not inline chat. Streaming a multi-page artifact inline risks hitting CC's output-token cap (most sessions lost to this class are unrecoverable mid-write).

**Rule of thumb**: if the deliverable is longer than ~50 lines or ~3 KB, write it to a file and post a 5-bullet summary plus the file path in chat. Categories:

| Deliverable | Destination |
|---|---|
| PRDs, design docs, RFCs, ADRs | `docs/` (or `docs/adrs/` for ADRs) |
| Session handoffs | `.claude/continuity/handoffs/YYYY-MM-DD_<topic>.yaml` — use `/ctk:create-handoff` |
| Review summaries, audit reports | `docs/reviews/<mr-or-pr-id>.md` |
| Plans, multi-step strategies | `docs/plans/<topic>.md` |
| Playgrounds, artifacts | `docs/artifacts/` |
| Code snippets longer than ~30 lines | The actual file (`Edit` / `Write` tool), not inline blocks |

In chat:
- A short summary (5 bullets max) of what's in the file
- The file path, ideally with `file_path:line_number` anchors for key parts
- Any decisions that need the user's input

This is not a soft preference. The token ceiling is an actual session-killer; the fix is to never write long content inline in the first place. Skills that produce structured artifacts (`/ctk:create-handoff`, `/etk:cover`, `/etk:review-mr`, `/etk:investigate-sentry`) already do this — generalize the same pattern to any deliverable you produce.

## Skill Authoring Rules

### CSO (Claude Search Optimization)

Skill `description` fields are **trigger conditions only** — never workflow or process details.

- MUST start with "Use when..." or be a dash-separated list ending with trigger patterns
- Describe WHEN the skill activates, not WHAT it does
- End with `Triggers on <keyword1>, <keyword2>` for discoverability
- Claude reads description summaries and may skip full skill content if the description leaks workflow
- **Why lean matters**: a model-invoked `description` is permanent per-turn context rent — it loads into context every session whether or not the skill fires, so verbosity costs tokens continuously. Prune descriptions hardest. (A `disable-model-invocation` skill pays no context rent but spends human *cognitive* load instead — match the invocation type to the cost you can afford.)

**Good**: `"Run tests, linting, and type checking with evidence collection. Triggers on verify, run checks, quality check"`
**Bad**: `"First runs tests, then collects evidence, then presents a summary with pass/fail for each check"`

### Priority Hierarchy

Skills yield to explicit user directions. Every skill implicitly follows:

```
User instructions > Skill rules > System prompt defaults
```

Skills must never override explicit user preferences. If a user says "skip tests", the skill skips tests even if TDD is normally enforced.

### Skill body hygiene — pruning, sizing, completion criteria

The `description` rules above govern *discovery*; these govern the skill **body** as it ages. Adapted from Matt Pocock's `writing-great-skills` (mattpocock/skills, MIT), evaluated 2026-06-30.

- **Prune no-ops and sediment.** Skill bodies accrete inert instructions ("sediment") — the default fate without a pruning discipline. Audit each sentence against the model's *default*: if a line wouldn't change what the model already does, cut the whole sentence (don't trim words). Keep each *meaning* in one place — restating the same meaning in N spots makes a behavior change an N-place edit (e.g. auto-research once encoded its routing map in three places). **Carve-out**: deliberate repetition *as steering* — anti-rationalization tables (cover's Red-Flags/Rationalizations), safety-boundary restatement (review-mr's never-auto-post) — is NOT duplication; the redundancy IS the mechanism. Do not collapse it.
- **Write checkable, exhaustive completion criteria** for long-horizon skills (fix-bug, cover, experiment, develop). A step's done-condition should be both *checkable* (the model can tell done from not-done) and *demanding* ("every modified file accounted for", not "produce a change list") — vague bounds invite premature completion. In-repo exemplar: `verify`'s Step-4 quality-level table.
- **Soft size flag**: a SKILL.md over ~150 lines is a prompt to *review for progressive disclosure* (push branch-specific reference behind `${CLAUDE_SKILL_DIR}` pointers), **not** a hard ceiling — legitimately reference-dense skills (terraform, database, testing) may exceed it. The flag triggers a look, not a cut.
- The no-op test is **model-relative** ("settle by running, not by debating") and we have no behavioral eval harness — so audits emit *candidate* flags for human review, never auto-delete. **`/etk:audit-skill`** operationalizes these rules (it points back here as the single source of truth — it does not restate them). Run it on changed skills before a version bump (see Release Checklist).

### Read-only skill hardening with `disallowed-tools` (CC v2.1.152+)

Skills and slash commands can declare a `disallowed-tools` list in YAML frontmatter to remove tools from the model while the skill is active. Use for advisory/read-only skills where accidental writes would be a bug, not a feature.

```yaml
---
name: my-readonly-skill
description: ...
disallowed-tools:
  - Edit
  - Write
  - NotebookEdit
---
```

Convention in this monorepo:
- **Disallow** `Edit`, `Write`, `NotebookEdit` for pure advisory/explainer skills (caveman, zoom-out, code-review-playbook, coding-standards, security-checklist, testing-strategy-builder).
- **Keep** `Bash` available — these skills still need `git status`, `grep`, `find`, etc. The bash-side security is handled by ctk's `auto-approve-safe-bash` hook.
- **Don't** disallow `Agent` (subagent spawning) for review-style skills that fan out to specialists.
- For skills that mix read + targeted writes (e.g. ADR generation writes one specific file), prefer scoping via `paths:` or `Allowed` rules rather than a coarse `disallowed-tools` list.

> **Auditing note**: several etk skills are symlinks into `shared/skills/` — when auditing frontmatter, use `grep -R` or `find -L` (lowercase `grep -r` does not follow symlinks during traversal and reports false negatives; this produced a stale "rollout pending" verdict in the 2026-06-10 audit).

### Subagent Status Protocol

All agents MUST report one of 4 status codes as their final output:

| Status | When | Controller Action |
|--------|------|-------------------|
| `DONE` | Task fully completed, all checks pass | Accept, move to next task |
| `DONE_WITH_CONCERNS` | Completed but with caveats | Accept, log concerns for review |
| `NEEDS_CONTEXT` | Missing information to proceed | Provide context, re-dispatch |
| `BLOCKED` | Cannot proceed (external dependency, permission) | Escalate to user |

Format: `STATUS: <CODE>` on its own line, followed by a brief explanation.

### Subagent Scope Restate

Before the first `Edit`, `Write`, or `Bash(git commit*)` tool call, every agent MUST output a SCOPE block restating the task scope and acceptance criteria:

```
SCOPE: <one-sentence task statement, not the literal prompt text>
AC:
  - <bullet 1>
  - <bullet 2>
  - <bullet 3>
```

The restate surfaces interpretation drift BEFORE damage. Two common failures it catches:
- **Narrower than intended** — "you only fixed one of three findings" / "you only shipped login when the ticket covered login + reset + help"
- **Wider than intended** — "you refactored adjacent code without asking" / "you bumped unrelated dependencies"

Rules:
- 5 lines max (one SCOPE sentence + up to 4 AC bullets).
- If the AC drifts mid-task (parent revises scope, blocker forces reduction), output a new SCOPE block and pause for confirmation before continuing the new path.
- The SCOPE block goes before the first write, not at the end. Putting it at the end defeats the purpose.

This applies to agents spawned by the controller via the `Agent` tool. The controller itself follows the same rule when its own task involves destructive operations and the user has not pre-confirmed scope.

Since CC v2.1.172 subagents can spawn their own subagents; v2.1.180 raised the limit to 5 levels deep, and v2.1.187 fixed subagent depth-tracking and worktree-registration leaks; at any depth, "controller" means the immediate parent — the status protocol and SCOPE restate apply between each parent/child pair, and statuses bubble up one level at a time, not directly to the user. (Note: every agent in this repo currently excludes `Agent`/`Task` from its `tools:` list, so nesting is disabled by configuration here.)

## Adding a New Shared Library File

1. Create the file in `shared/hooks-infra/src/lib/`
2. Export from `shared/hooks-infra/src/lib/index.ts` if needed
3. All plugins see it immediately via symlinks
4. Add tests in `shared/hooks-infra/tests/lib/`

## Adding a New Plugin

> **Greenfield vs this monorepo (CC v2.1.153+)**: For a *standalone* plugin, prefer `claude plugin init`, which scaffolds `.claude-plugin/plugin.json` + a starter `SKILL.md` and auto-loads from `.claude/skills/` **without** a marketplace. That path does **not** apply here: every plugin in this repo lives in the shared-hook symlink architecture, which `init` does not scaffold. Continue using the manual procedure below.

1. Create `plugins/{name}/` with full hook structure
2. Symlink shared files:
   ```bash
   cd plugins/{name}/hooks
   ln -s ../../../../shared/hooks-infra/src/lib src/lib
   ln -s ../../../../shared/hooks-infra/src/types.ts src/types.ts
   ```
3. Add `preserveSymlinks: true` to `tsup.config.ts`
4. Set `CLAUDE_PLUGIN_NAME` in `run-hook-wrapper.sh`
5. Set `CLAUDE_PLUGIN_NAME` in `vitest.config.ts` env
6. Add the plugin's source directory to the `plugins` (and `validate`) matrix in `.github/workflows/ci.yml`

## Release Checklist (Bumping a Plugin Version)

Whenever you change a plugin's `dependencies` field, rename the plugin, or ship a meaningful change users should pick up, you **must** bump the plugin's version. CC's auto-update logic (v2.1.118+) only re-resolves an installed plugin when its declared version differs from the marketplace version — same-version changes are silently ignored, leaving users on stale installs.

**Files to update in the same commit:**

1. `plugins/{name}/.claude-plugin/plugin.json` `version` — **functional** (CC reads this)
2. `.claude-plugin/marketplace.json` `version` for that plugin — **functional** (CC reads this)
3. `plugins/{name}/CHANGELOG.md` — add an entry describing the change
4. `plugins/{name}/CLAUDE.md` `> Version:` header line if present
5. `README.md` (root) plugin table — version column for that row
6. `CLAUDE.md` (root) plugin tree comment (line ~42-48) — `(vX.Y.Z, installed as ...)`

**Skill quality gate (recurring — added 2026-06-30)**: if the bump touches any `skills/**/SKILL.md`, run **`/etk:audit-skill`** over the changed skills first and triage its flags (CSO compliance · >150-line progressive-disclosure review · no-op/sediment · completion criteria). This is the *recurring* trigger for the pruning discipline in "Skill body hygiene" above — sediment is the default fate without one, and a release is the natural cadence. The audit only flags; a human decides each cut. (Deferred hardening: a scheduled `/loop` sweep or a CI lint — a CI gate needs an `ANTHROPIC_API_KEY` because the audit is model-invoked, the same blocker as the deferred runtime-smoke job.)

**The dep-rename trap**: changing `dependencies: ["old-name"]` → `dependencies: ["new-name"]` without bumping the version means existing installs keep their stale `plugin.json` and the dep resolution silently breaks the next time the old dep is uninstalled. Always patch-bump on dep changes, even if nothing else changed.

**Prune behavior (CC v2.1.121+)**: after a dep rename, users on v2.1.121+ can run `claude plugin prune` to drop the orphaned old-name install in one step (or `claude plugin uninstall <new-toolkit> --prune` to cascade on uninstall). Plugins installed directly by the user are never auto-pruned — only auto-installed dependencies. Pre-2.1.121 users still need a manual `plugin uninstall <old-name>` after the rename takes effect.

## Auto Mode Environment

> **Note (CC v2.1.152+)**: Auto Mode no longer requires opt-in consent — it is enabled by default for any user with `autoMode` configured. The classifier path is the same; the user-facing acceptance dialog has been removed. No config migration needed; this note is informational.

When using Claude Code Auto Mode, the classifier uses this context to determine trusted infrastructure. Customize the `environment` array to match your organization and stack — the example below shows the shape:

```json
{
  "autoMode": {
    "environment": [
      "$defaults",
      "Organization: <your-org>. Domain: <your-domain>.",
      "Source control: <your-vcs-host> (list trusted repo groups)",
      "CI/CD: <your-ci-system> (describe pipeline structure)",
      "Cloud: <your-cloud-provider> (list services used)",
      "Package registries: npmjs.org, pypi.org (list trusted registries)",
      "MCP servers: <list-your-mcp-servers>"
    ]
  }
}
```

> **Note (CC v2.1.118+)**: include `"$defaults"` as a list entry to *append* your rules to the built-in list instead of *replacing* it. Previously (and still on older CC), supplying `autoMode.environment` replaced the defaults entirely. The same `"$defaults"` merge semantics apply to `autoMode.allow` and `autoMode.soft_deny`.

> **Note (CC v2.1.183 / v2.1.193)**: Auto Mode gained native safety since our baseline — **destructive `git` commands are now blocked natively** (v2.1.183), so the `hard_deny` git entries below are belt-and-suspenders (still valid, not redundant). **`autoMode.classifyAllShell`** (v2.1.193) routes *all* Bash/PowerShell through the classifier — a stronger lever than per-pattern denies for high-trust environments. **Denial reasons** now surface in the transcript, the denial toast, and `/permissions` recent-denials (v2.1.193) — use them to debug "why was this denied." Separately, `attribution.sessionUrl` (v2.1.183) controls whether the `claude.ai` session link is appended to commit trailers.

### Recommended `hard_deny` baseline (CC v2.1.136+)

`autoMode.hard_deny` (added in v2.1.136) is an unconditional block list — patterns matched here can never be auto-approved, regardless of `allow`/`soft_deny` rules. Use it for actions that should *always* require explicit human confirmation, even in trusted environments. Suggested floor for any project:

```json
{
  "autoMode": {
    "hard_deny": [
      "Bash(rm -rf /*)",
      "Bash(git push --force* origin main*)",
      "Bash(git push --force* origin master*)",
      "Bash(git reset --hard origin/main)",
      "Bash(git reset --hard origin/master)",
      "Bash(curl * | sh*)",
      "Bash(curl * | bash*)",
      "Bash(wget * | sh*)",
      "Bash(wget * | bash*)"
    ]
  }
}
```

Add organization-specific patterns on top — production deploy commands, secret-rotating CLIs, anything that touches shared state without an undo path. `hard_deny` is the right place for "never auto, ever"; `soft_deny` is the right place for "usually no but occasionally fine, prompt me."

Configure in `~/.claude/settings.local.json` (gitignored) or managed settings for organization-wide enforcement.

## Repository

All development happens in this monorepo: `github.com/ArieGoldkin/claude-forge`
