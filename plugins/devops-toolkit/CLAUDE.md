# dtk — DevOps Toolkit (Claude Code Plugin)

> **Plugin Name**: dtk (formerly `devops-toolkit`, renamed in v2.0.0)
> **Version**: 2.0.15
> **Last Updated**: 2026-06-26

## Overview

Claude Code plugin for DevOps, infrastructure, and backend development. Provides 15 skills, 2 agents, 12 commands, and 1 plugin-specific hook.

**Purpose**: Standardize AI-assisted development across infrastructure and backend projects with security guardrails, AWS/Terraform patterns, and automated developer experience.

**Note**: Shared hooks (security, permissions, lifecycle, etc.) are provided by ctk. This plugin keeps only `repo-access-guard` (SessionStart).

## Plugin Structure

```
devops-toolkit/
├── .claude-plugin/
│   ├── plugin.json           # Plugin manifest (hooks auto-discovered)
│   └── marketplace.json      # Marketplace config
├── .claude/                   # Hook fallback configs (tracked) + local dev state (gitignored)
│   ├── permissions/          # Default permission profiles (tracked, hooks fallback)
│   ├── rules/                # Default error rules (tracked, hooks fallback)
│   ├── context/              # Local dev state (gitignored)
│   └── continuity/           # Local dev state (gitignored)
├── skills/                    # 15 specialized skill directories
├── agents/                    # 2 agent markdown files
├── commands/                  # 12 slash command definitions
├── hooks/                     # Hook system (TypeScript)
│   ├── hooks.json            # Hook configurations
│   ├── bin/                  # Shell wrapper + CLI runner
│   │   ├── run-hook-wrapper.sh # Resilient POSIX wrapper (Bedrock compat)
│   │   └── run-hook.ts       # TypeScript hook CLI runner
│   ├── src/                  # TypeScript source
│   │   ├── lifecycle/        # SessionStart, PreCompact hooks
│   │   ├── permission/       # Auto-approval hooks
│   │   ├── pretool/          # Security validation hooks
│   │   ├── posttool/         # Post-execution hooks
│   │   └── lib/              # Shared utilities
│   └── dist/                 # Compiled JavaScript (tracked in git)
├── instructions/              # Agent instruction files
├── docs/                      # Plugin documentation
└── README.md                  # Installation & usage guide
```

## Hook Architecture

The plugin uses a layered hook system (TypeScript, runs via Node.js).
All hooks are invoked through `run-hook-wrapper.sh`, a POSIX shell wrapper that provides defense-in-depth: it derives `CLAUDE_PLUGIN_ROOT` if unset, checks that `dist/` and `node` exist, validates JSON output, and falls back to safe JSON on any failure. This ensures Bedrock marketplace installs work even without a local build step.

### Hook Types

| Event | Hook | Purpose |
|-------|------|---------|
| SessionStart | repo-access-guard | Block non-Bedrock users from restricted repositories |

## Hook Library (hooks/src/lib/)

### Output Helpers (output.ts)

```typescript
outputSilentSuccess()           // {"continue":true,"suppressOutput":true}
outputDeny("reason")            // {"continue":false,"stopReason":"reason"}
outputWarning("msg")            // {"continue":true,"systemMessage":"⚠ msg"}
outputAllow()                   // Permission auto-approve
outputSuccess("msg")            // Success with system message
outputPromptContext("ctx")      // Inject invisible context (UserPromptSubmit)
outputWithContext("ctx")        // PostToolUse invisible context injection
outputStderrWarning("msg")     // stderr + exit 2 = BLOCKING error (see note below)
outputWithNotification("u","c") // Dual-channel: systemMessage + additionalContext
```

> ⚠ **`outputStderrWarning` exits 2, which is a hook *blocking error* — not a plain
> notice.** This line previously read "user sees, Claude doesn't", which is true only
> for the events where exit 2 is non-blocking; on `PreToolUse` / `PostToolUse` / `Stop`
> it **blocks the operation** and the message reaches Claude. The function takes no
> event parameter, so the caller owns that judgement. For a warning that blocks
> nothing, use `outputWarning()`. Corrected under issue #67 — the claim had never been
> exercised, because nothing in the repo calls the function.

### Input Parsing (input.ts)

```typescript
getToolName(input)              // Extract tool name from hook input
getFilePath(input)              // Extract file path
getCommand(input)               // Extract bash command
getSessionId(input)             // Extract session ID
getProviderInfo()              // Detect Bedrock vs Anthropic provider
```

### Path Utilities (path-utils.ts)

```typescript
resolveRealPath("path")         // Follow symlinks (ME-001 security)
normalizePath("path")           // Remove ./, collapse //
isWithinProject("path")         // Check project boundary
```

### Logging (logging.ts)

```typescript
logDebug("hook", "msg")         // Debug level (off by default)
logInfo("hook", "msg")          // Info level
logWarn("hook", "msg")          // Warning level
logError("hook", "msg")         // Error level
logPermission("allow", "reason", "tool", "session")  // Audit trail
```

### Guards (guards.ts)

```typescript
runGuards(input, ...guards)    // Run guards in sequence, short-circuit on first non-null
guardBash(input)               // Skip if not Bash tool
guardWriteEdit(input)          // Skip if not Write/Edit/MultiEdit
guardHasCommand(input)         // Skip if no command present
guardHasFilePath(input)        // Skip if no file path present
guardFileExtension(input, ...) // Skip if extension doesn't match
guardWithinProject(input)      // Skip if outside project directory
guardSkipInternal(input)       // Skip node_modules, .git, __pycache__, .venv
```

**Log files**: `$CLAUDE_PLUGIN_DATA/logs/hooks.log` (200KB rotation)
**Audit file**: `$CLAUDE_PLUGIN_DATA/logs/permission-feedback.log` (100KB rotation)

⚠ When `CLAUDE_PLUGIN_DATA` is unset the log path falls back to
`$CLAUDE_CONFIG_DIR/logs/devops/`, and only then to `~/.claude/logs/devops/`. Neither fallback
holds live-hook output. Resolve the real path with
`find ~/.claude -name permission-feedback.log -newermt "-1 hour"` before treating an absence of
log lines as evidence. **ctk's CLAUDE.md → "Log locations" is the single source of truth for this
three-tier rule — consult it rather than trusting a restatement.** (The `CLAUDE_CONFIG_DIR` tier
was added in #105; before it, test runs wrote into the developer's real home.)

## Development

### Testing Hooks

```bash
# Run hook test suite
cd hooks && npm test

# Run specific test file
cd hooks && npm test -- security-blocker

# Type check
cd hooks && npm run typecheck

# Build hooks
cd hooks && npm run build
```

### Environment Variables

```bash
CLAUDE_PROJECT_DIR    # Project root (from Claude Code)
CLAUDE_PLUGIN_ROOT    # Plugin installation path
CLAUDE_SESSION_ID     # Current session identifier
DEVOPS_LOG_LEVEL      # Log level: debug|info|warn|error (default: warn)
CLAUDE_CODE_USE_BEDROCK  # Set to "1" for Bedrock provider detection
```

### Adding New Hooks

1. Create TypeScript file in appropriate `hooks/src/` subdirectory
2. Import helpers from `../lib/input.js`, `../lib/output.js`, `../lib/logging.js`
3. Export an async function that takes `HookInput` and returns `Promise<HookResult>`
4. Add to `hooks/hooks.json` with appropriate matcher and timeout
5. Run `cd hooks && npm run build` to compile

## Session Continuity

Continuity features (save-state, create-handoff, resume-session, etc.) are provided by the **ctk** plugin.

## Installation

### From Marketplace (Recommended)

```bash
# Add the marketplace
/plugin marketplace add https://github.com/ArieGoldkin/claude-forge.git

# Install plugin (new name: dtk)
/plugin install dtk@claude-forge
```

### Local Development

```bash
# Clone the monorepo
git clone git@github.com:ArieGoldkin/claude-forge.git

# Test locally
claude --plugin-dir ./claude-forge/plugins/devops-toolkit
```

---

**Repository**: https://github.com/ArieGoldkin/claude-forge
**Maintainer**: Arie Goldkin
