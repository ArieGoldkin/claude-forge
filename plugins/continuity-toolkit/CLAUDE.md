# Continuity Toolkit - Claude Code Plugin

> **Plugin Name**: ctk (formerly `continuity-toolkit`, renamed in v2.0.0)
> **Version**: 2.8.0
> **Last Updated**: 2026-07-18

## Overview

Session continuity and context management toolkit for Claude Code. Provides multi-session state persistence with ledger tracking, handoff documents, dirty file tracking, context window monitoring, and security guardrails.

**This plugin is the canonical owner of all shared hooks.** When multiple plugins are installed, only ctk runs shared hooks (security, permissions, lifecycle, etc.), preventing duplicate hook execution.

**Purpose**: Enable seamless multi-session development workflows with automatic state tracking, proactive context warnings, and session handoff management.

## Skills (11)

| Skill | Description |
|-------|-------------|
| `continuity-management` | Master skill for full continuity system documentation |
| `save-state` | Update project ledger with current state |
| `create-handoff` | End session with handoff document |
| `resume-session` | Load previous context |
| `check-maintenance` | Check continuity file health |
| `doctor` | Cross-plugin system diagnostics (installed plugins, hook builds, environment) |
| `archive-ledger` | Archive old ledger sections |
| `archive-handoffs` | Archive old handoff files |
| `continuity-metrics` | View session metrics dashboard |
| `setup-continuity` | Initialize continuity system |
| `setup-context-monitor` | Configure StatusLine context monitor |

## Agents (1)

| Agent | Description |
|-------|-------------|
| `web-research-analyst` | Web research specialist using WebFetch-first strategy with agent-browser escalation for JS-rendered pages |

## Commands (12)

| Command | Description |
|---------|-------------|
| `/save-state` | Update project ledger with current state |
| `/create-handoff` | End session with handoff document |
| `/resume-session` | Load previous context |
| `/check-maintenance` | Check continuity file health |
| `/doctor` | Cross-plugin system diagnostics |
| `/dashboard` | Start live session monitor dashboard |
| `/archive-ledger` | Archive old ledger sections |
| `/archive-handoffs` | Archive old handoff files |
| `/continuity-metrics` | View session metrics dashboard |
| `/setup-continuity` | Initialize continuity system |
| `/setup-context-monitor` | Configure StatusLine context monitor |
| `/web-research` | Research external websites for documentation, competitive intelligence, or market data |

## Hooks (35 registered — 32 shared + 3 ctk-specific)

This plugin owns all shared hooks from `shared/hooks-infra/`. Other plugins have been stripped to only their plugin-specific hooks to prevent duplication.

> **Canonical count basis**: the authoritative number is the `registerHook()` calls in `hooks/src/index.ts` — currently **35** (32 symlinked from `shared/hooks-infra/src/hooks/` + 3 ctk-specific: `hipaa-context-injector`, `phi-output-redactor`, `session-loader`). Update this basis first when the count changes; the table below is illustrative and may lag. (`grep -c 'registerHook(' hooks/src/index.ts` includes the 2 non-call occurrences — the function definition — so subtract those.)

| Hook | Event | Purpose |
|------|-------|---------|
| session-loader | SessionStart | Load continuity context, detect stale sessions, auto-surface latest `handoff-latest.json` summary |
| session-end | SessionEnd | Mark clean shutdown |
| pre-compact-saver | PreCompact | Save state before /compact; also writes machine-readable `handoff-latest.json` for SessionStart auto-resume |
| bash-combined | PreToolUse (Bash) | Combined: safe-bash + profile + git-validator + security |
| preflight-context-injector | PreToolUse (Bash) | Inject pwd/branch/remote/worktrees before destructive commands (git commit/push, terraform apply/destroy, rm -rf) |
| write-combined | PreToolUse (Write/Edit) | Combined: project-writes + profile + security |
| permission-request-combined | PermissionRequest | Auto-approve on permission dialog |
| security-blocker | PreToolUse | Block dangerous commands, protect sensitive files; force user approval prompt for `git push` (bypass with `CLAUDE_AUTO_APPROVE_PUSH=1`) |
| auto-approve-safe-bash | PreToolUse (Bash) | Auto-approve read-only commands |
| auto-approve-project-writes | PreToolUse (Write/Edit) | Auto-approve safe file writes |
| profile-evaluator | PreToolUse | Evaluate against permission profiles |
| git-validator | PreToolUse (Bash) | Validate git commit messages and branch names |
| dirty-state-tracker | PostToolUse (Write/Edit) | Track file edits, warn at thresholds |
| lint-checker | PostToolUse (Write/Edit) | Run ruff on Python files, report errors |
| secret-detector | PostToolUse (Bash) | Scan output for leaked secrets |
| error-warner | PostToolUse (Bash) | Suggest tips for common errors |
| failure-logger | PostToolUseFailure | Log failures and inject fix hints |
| context-monitor | UserPromptSubmit | Inject tiered context-pressure warnings (70/80/90%) with suggested handoff filename at tier 2+ |
| instructions-loaded | InstructionsLoaded | Log loaded CLAUDE.md files |
| teammate-idle-saver | TeammateIdle | Auto-save continuity state on teammate idle |
| task-completed-logger | TaskCompleted | Log task completion metrics |
| task-created-logger | TaskCreated | Log task creation events |
| stop-failure-handler | StopFailure | Log API errors that terminate a turn |
| (PostCompact HTTP) | PostCompact | Forward compaction events to session monitor |
| worktree-create | WorktreeCreate | Initialize continuity for new worktrees |
| worktree-remove | WorktreeRemove | Archive continuity state for removed worktrees |

## Native Settings Alternatives

Some CC settings overlap with hook-based enforcement. When both exist, native settings run earlier in the pipeline and cannot be bypassed by a crashed or mis-configured hook. Prefer native settings for high-assurance controls.

| Setting | Purpose | Relation to Hooks |
|---------|---------|-------------------|
| `sandbox.network.deniedDomains` (CC v2.1.113+) | Deny network requests to matching domains at the sandbox layer | Native alternative to writing a `PreToolUse(Bash)` hook that pattern-matches `curl`/`wget`/`fetch` destinations. Denies `WebFetch`, `WebSearch`, and network syscalls from Bash in one place. |
| `sandbox.network.allowedDomains` | Allowlist-only egress | Complements `security-blocker` — if you already enforce an allowlist via native settings, the hook's egress patterns become defence-in-depth rather than primary control. |
| `permissions.deny` | Block specific tool+pattern combinations | CC applies these before any hook fires; redundant with our hook rules but more resistant to hook-infra breakage. |

Configure in `settings.json` (user-global) or `.claude/settings.json` (project-scoped):

```json
{
  "sandbox": {
    "network": {
      "deniedDomains": ["*.tracking.example.com", "raw.githubusercontent.com"]
    }
  }
}
```

When a HIPAA-sensitive project needs to block PHI exfil to third-party domains, use `deniedDomains` as the primary control — our `security-blocker` catches bash-level bypass attempts but does not intercept `WebFetch` / `WebSearch` tool calls directly.

## File Structure

The continuity system creates these directories in user projects:
```
.claude/continuity/ledgers/    # Project ledger (CONTINUITY_<project-name>.md)
.claude/continuity/handoffs/   # Session handoff documents
.claude/continuity/archive/    # Archived content
.claude/continuity/learnings/  # Extracted patterns
.claude/context/               # Shared context (shared-context.json)
```

## Output Budgeting

The handoff workflow is one consumer of the monorepo's **Output Budgeting** rule (see root [CLAUDE.md → Output Budgeting](../../CLAUDE.md#output-budgeting)). Any deliverable longer than ~50 lines / 3 KB belongs in a file, not inline chat — handoffs go to `.claude/continuity/handoffs/YYYY-MM-DD_<topic>.yaml` via `/ctk:create-handoff`; PRDs, plans, reviews, and audit reports go to `docs/` subdirectories. Streaming long-form artifacts inline risks CC's output-token cap, which has wholesale-killed sessions for users.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CONTINUITY_LOG_LEVEL` | `warn` | Log level: debug\|info\|warn\|error |
| `CLAUDE_PROJECT_DIR` | cwd | Project root directory |
| `CLAUDE_PLUGIN_ROOT` | - | Plugin installation path |
| `CLAUDE_SESSION_ID` | - | Current session identifier |
| `CLAUDE_AUTO_APPROVE_PUSH` | - | Set to `1` to bypass the approval-first gate for `git push` (security-blocker hook). Any other value keeps the gate active. Use in CI/CD jobs and automation flows where every push has been pre-authorized. |
| `CONTINUITY_STATUSLINE_COMPACT` | - | Set to `1` to collapse the statusline to the classic two lines (identity + context bar), dropping the rate-limit and token-accounting lines. |
| `CONTINUITY_TERMINAL_TITLE` | - | Set to `1` (exact match) to emit a terminal window title `<project> · <branch>` from `session-loader` via CC's `terminalSequence` field (v2.1.141+). Opt-in to avoid surprising users whose terminals are already managed. Skipped silently when CC < v2.1.141 (unknown field is ignored). |
| `CLAUDE_CODE_NO_FLICKER` | - | Set to `1` for flicker-free alt-screen rendering (CC 2.1.88+). Superseded by `/tui fullscreen` (CC 2.1.110+). |
| `ENABLE_PROMPT_CACHING_1H` | - | Set to `1` for 1-hour prompt cache TTL on all providers (CC 2.1.108+). Replaces deprecated `ENABLE_PROMPT_CACHING_1H_BEDROCK`. |
| `FORCE_PROMPT_CACHING_5M` | - | Set to `1` to force 5-minute prompt cache TTL (CC 2.1.108+) |
| `MCP_CONNECTION_NONBLOCKING` | - | Set to `true` in `-p` mode to skip MCP connection wait (CC 2.1.89+) |
| `showThinkingSummaries` | `false` | Set to `true` in settings.json to restore thinking summaries (CC 2.1.89+) |
| `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` | - | Set to `1` to strip Anthropic/cloud credentials from subprocesses (CC 2.1.83+). Recommended for HIPAA. |
| `OTEL_LOG_RAW_API_BODIES` | - | ⚠ **DO NOT ENABLE IN HIPAA CONTEXTS** — emits full API request/response bodies as OpenTelemetry log events (CC 2.1.111+). Exports PHI to observability backends. |
| `CLAUDE_CODE_USE_POWERSHELL_TOOL` | - | Set to `1` to enable PowerShell tool on Linux/macOS (CC 2.1.111+). Windows: progressive rollout, opt-out with `0`. |

## Detecting Plugin Dependency Failures (SDK / Headless)

CC v2.1.111+ includes a `plugin_errors` field in the headless `stream-json` init event when plugins are demoted for unsatisfied dependencies. Since v2.1.110 added `dependencies: ["ctk"]` to all non-continuity plugins, SDK users should check this field to detect dependency resolution failures:

```bash
claude --headless --output-format stream-json -p "..." | jq 'select(.type == "init") | .plugin_errors'
```

If `plugin_errors` contains entries for our plugins, the user is running with missing shared hooks (security, permissions, lifecycle). Recommended handling in CI/CD:

```bash
plugin_errors=$(claude --headless --output-format stream-json -p "..." | jq -r '. | select(.type == "init") | .plugin_errors // empty')
if [ -n "$plugin_errors" ]; then
  echo "ERROR: Plugin dependency failure: $plugin_errors"
  exit 1
fi
```

## Permission Allowlist Strategy

Two complementary layers for reducing permission prompts:

1. **Static (code-driven)**: `auto-approve-safe-bash` hook in this plugin auto-approves read-only commands (`ls`, `find`, `grep`, `cat`, etc.) using a curated prefix allowlist. Version-controlled and reviewed.
2. **Dynamic (user-driven)**: CC v2.1.111+ `/less-permission-prompts` skill scans your transcripts for common read-only Bash/MCP calls and proposes a prioritized allowlist for `.claude/settings.json`. Run periodically to catch patterns the hook misses.

CC v2.1.111 also natively auto-approves read-only bash with glob patterns (`ls *.ts`) and `cd <project-dir> &&` prefixed commands — our hook's handling of these is now redundant but harmless.

## CC v2.1.97 Compatibility Notes

Settings and features available in Claude Code v2.1.83-2.1.97 that affect plugin operation:

| Feature | Version | Description |
|---------|---------|-------------|
| `managed-settings.d/` | 2.1.83 | Drop-in directory alongside `managed-settings.json` for modular team policies. Files merge alphabetically. Use for per-team HIPAA/permission rules. |
| `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` | 2.1.83 | Strips Anthropic and cloud provider credentials from Bash tool, hooks, and MCP stdio servers. Recommended for HIPAA compliance. |
| `disableSkillShellExecution` | 2.1.91 | Settings.json flag to disable inline shell execution in skills and plugin commands. Use in locked-down environments. |
| `_meta["anthropic/maxResultSizeChars"]` | 2.1.91 | MCP tool annotation to override result truncation (up to 500K chars). Useful for large DB schemas or API responses. |
| `allowedChannelPlugins` | 2.1.85 | Managed setting for team/enterprise admins to define channel plugin allowlist. |
| `keep-coding-instructions` | 2.1.94 | SKILL.md frontmatter field. When true, skill instructions persist across turns (not just the invoking turn). Used by 15 pattern/standard skills. |
| `hookSpecificOutput.sessionTitle` | 2.1.94 | UserPromptSubmit hooks can set session title. Our session-title hook auto-sets from git branch name. |
| `refreshInterval` | 2.1.97 | StatusLine setting to re-run command every N seconds. Our context-monitor uses 30s refresh. |
| `workspace.git_worktree` | 2.1.97 | StatusLine JSON input includes worktree path. Our status line shows worktree indicator when present. |
| Thinking summaries off | 2.1.89 | Thinking summaries no longer generated by default. Set `showThinkingSummaries: true` in settings.json to restore. |

## Development

```bash
cd hooks && npm install      # Install dependencies
cd hooks && npm run build    # Build hooks
cd hooks && npm run typecheck # Type check
cd hooks && npm test         # Run tests
```

**Log files**: `~/.claude/logs/continuity/hooks.log`
**Audit file**: `~/.claude/logs/continuity/permission-feedback.log`
