# Claude Code Plugin Hook System

A reference guide for building Claude Code plugin hooks. Hooks are event-driven sidecar processes that intercept, validate, and augment Claude Code's behavior.

## Overview

Hooks are shell commands that Claude Code invokes at specific lifecycle points. The contract is simple:

1. Claude Code sends **JSON on stdin** (the event payload)
2. Your hook processes the input
3. Your hook writes **JSON to stdout** (the decision)

Hooks can **allow**, **deny**, **warn**, **inject context**, or **rewrite tool input** — depending on the event type.

## Hook Events

Claude Code fires hooks at 6 primary lifecycle points:

| Event | When It Fires | Matcher | Can Block? |
|-------|--------------|---------|------------|
| `SessionStart` | Session begins (startup, resume, clear, compact) | No | No |
| `PreToolUse` | Before a tool executes | Yes (tool name regex) | Yes |
| `PostToolUse` | After a tool executes | Yes (tool name regex) | No |
| `UserPromptSubmit` | User sends a message | No | No |
| `PreCompact` | Before context compaction | No | No |
| `SessionEnd` | Session ends (clear, logout, exit) | No | No |

**Matcher** means the hook only fires when the tool name matches a regex pattern (e.g., `"Bash"`, `"Write|Edit|MultiEdit"`). Events without matchers fire for all occurrences.

### SessionStart

Fires when a session begins. The `source` field indicates why:
- `startup` — fresh session
- `resume` — resumed from previous session
- `clear` — after `/clear`
- `compact` — after context compaction

**Typical uses**: Load saved context, detect stale sessions, initialize state files.

### PreToolUse

Fires before Claude executes a tool. This is the only event that can **block** operations.

The `matcher` field in hooks.json controls which tools trigger the hook:
```json
{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "...", "timeout": 5 }] }
{ "matcher": "Write|Edit|MultiEdit", "hooks": [{ "type": "command", "command": "...", "timeout": 5 }] }
```

**Possible decisions**: `allow`, `deny`, `ask` (prompt user), or allow with injected context.

### PostToolUse

Fires after a tool executes. Cannot block — the operation already happened.

Supports `async: true` in hooks.json to run without blocking Claude's response.

**Typical uses**: Track file edits, run linters, update state.

### UserPromptSubmit

Fires when the user sends a message, before Claude processes it. Can inject invisible context into Claude's conversation via `additionalContext`.

**Typical uses**: Inject compliance reminders, context warnings, domain rules.

### PreCompact

Fires before Claude compacts its context window. Use this to save important state before context is trimmed.

**Typical uses**: Save ledger state, checkpoint progress.

### SessionEnd

Fires when a session ends. The `source` field indicates why:
- `clear` — user ran `/clear`
- `logout` — user logged out
- `prompt_input_exit` — user exited at prompt
- `other` — other reasons

**Typical uses**: Mark clean shutdown, finalize state.

## Execution Pipeline

```
Claude Code (event fires)
     |
     v
hooks.json — matcher evaluation (regex match on tool name)
     |
     v
run-hook-wrapper.sh — POSIX shell, always exits 0
     |  - Derives CLAUDE_PLUGIN_ROOT from script location
     |  - Checks dist/ exists and node is in PATH
     |  - Reads stdin, pipes to Node runner
     |  - Validates output starts with '{'
     |  - Falls back to safe JSON on any failure
     v
node dist/bin/run-hook.js <hookName>
     |  - Process-level uncaughtException/unhandledRejection handlers
     |  - Registry lookup: getHook(hookName)
     |  - Override check: isHookDisabled(hookName)
     |  - Reads stdin: readHookInput() (synchronous)
     |  - Calls hook.handler(input)
     v
hook.handler(input) — your TypeScript function
     |  - Receives HookInput, returns HookResult
     v
JSON result written to stdout
     |
     v
Wrapper validates JSON (grep '^{' | tail -1)
     |
     v
Claude Code reads result
```

Every layer has a safe fallback: `{"continue":true,"suppressOutput":true}`. A hook crash never blocks Claude Code.

## JSON Protocol: HookInput

This is what your hook receives on stdin:

```typescript
interface HookInput {
  // Tool or event identification
  tool_name: string;         // Tool name (e.g., "Write") or event name (e.g., "SessionStart")
  tool_input: ToolInput;     // Tool parameters — {} for lifecycle events

  // Session context
  session_id?: string;       // Session identifier
  hook_event_name?: string;  // Original event name (lifecycle events)
  source?: string;           // "startup"|"resume"|"clear"|"compact" (SessionStart/SessionEnd)
  model?: string;            // Model identifier (e.g., "claude-opus-4-7")
  cwd?: string;              // Current working directory
  transcript_path?: string;  // Path to conversation transcript
  permission_mode?: string;  // Current permission mode

  // Version-gated fields
  tool_use_id?: string;             // Correlates Pre/PostToolUse (v2.0.43+)
  agent_type?: string;              // Agent type flag (v2.1.2+)
  last_assistant_message?: string;  // Last assistant message (v2.1.47+)
}
```

### ToolInput by Tool Type

| Tool | Key Fields |
|------|-----------|
| **Bash** | `command`, `description?`, `timeout?`, `dangerouslyDisableSandbox?` |
| **Write** | `file_path`, `content` |
| **Edit** | `file_path`, `old_string`, `new_string` |
| **MultiEdit** | `file_path`, `edits: [{file_path, old_string, new_string}]` |
| **Read** | `file_path` or `path`, `pages?` |
| **Glob/Grep** | `path`, `pattern`, `glob?`, `type?`, `output_mode?` |
| **Lifecycle** | `{}` (empty object) |

### Input Normalization

Claude Code sends tool events with `tool_name` and lifecycle events with `hook_event_name`. The input parser normalizes both into `tool_name` for consistent handling. Your hook always reads `input.tool_name`.

## JSON Protocol: HookResult

This is what your hook writes to stdout:

```typescript
interface HookResult {
  // Primary gate
  continue: boolean;           // true = proceed, false = block

  // User communication
  suppressOutput?: boolean;    // true = silent (no terminal output)
  stopReason?: string;         // Shown to user when continue=false
  systemMessage?: string;      // Shown to user in terminal

  // Hook-specific behavior
  hookSpecificOutput?: {
    hookEventName?: string;              // "PreToolUse"|"PostToolUse"|"UserPromptSubmit"|"PermissionRequest"
    permissionDecision?: string;         // "allow"|"deny"|"ask"
    permissionDecisionReason?: string;   // Reason for deny/ask
    additionalContext?: string;          // Injected into Claude's context (invisible to user)
    updatedInput?: Record<string, unknown>;  // Rewrite tool input (v2.0.10+)
  };
}
```

### Two Communication Channels

- **`systemMessage`** — visible to the **user** in their terminal
- **`additionalContext`** — visible to **Claude** in its conversation context, invisible to the user

Use `outputWithNotification(userMsg, claudeCtx)` to send different messages to each.

## hooks.json Configuration

Register hooks in `hooks.json` at your plugin root:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [{
          "type": "command",
          "command": "sh ${CLAUDE_PLUGIN_ROOT}/hooks/bin/wrapper.sh lifecycle/my-loader",
          "timeout": 30
        }]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{
          "type": "command",
          "command": "sh ${CLAUDE_PLUGIN_ROOT}/hooks/bin/wrapper.sh pretool/my-validator",
          "timeout": 5
        }]
      },
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [{
          "type": "command",
          "command": "sh ${CLAUDE_PLUGIN_ROOT}/hooks/bin/wrapper.sh pretool/my-validator",
          "timeout": 5
        }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [{
          "type": "command",
          "command": "sh ${CLAUDE_PLUGIN_ROOT}/hooks/bin/wrapper.sh posttool/my-tracker",
          "timeout": 10,
          "async": true
        }]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [{
          "type": "command",
          "command": "sh ${CLAUDE_PLUGIN_ROOT}/hooks/bin/wrapper.sh prompt/my-monitor",
          "timeout": 2
        }]
      }
    ],
    "PreCompact": [
      {
        "hooks": [{
          "type": "command",
          "command": "sh ${CLAUDE_PLUGIN_ROOT}/hooks/bin/wrapper.sh lifecycle/my-saver",
          "timeout": 10
        }]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [{
          "type": "command",
          "command": "sh ${CLAUDE_PLUGIN_ROOT}/hooks/bin/wrapper.sh lifecycle/my-cleanup",
          "timeout": 5
        }]
      }
    ]
  }
}
```

### HookConfig Fields

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"command"` \| `"prompt"` \| `"agent"` | Handler type. Most plugins use `"command"`. |
| `command` | `string` | Shell command to execute. Supports `${CLAUDE_PLUGIN_ROOT}` expansion. |
| `timeout` | `number` | Max execution time in seconds. |
| `matcher` | `string` | Regex matching tool names. Only for PreToolUse/PostToolUse. |
| `async` | `boolean` | Run non-blocking (PostToolUse only). Default: `false`. |
| `once` | `boolean` | Fire only once per session (v2.1.0+). Default: `false`. |
| `prompt` | `string` | Prompt text for `"prompt"`/`"agent"` types (v2.1.49+). |
| `model` | `string` | Model for `"prompt"`/`"agent"` types. |
| `statusMessage` | `string` | Status shown while hook runs. |

## Output Helper Patterns

Common HookResult patterns and their JSON output:

| Pattern | Function | JSON Output | Use Case |
|---------|----------|-------------|----------|
| Silent allow | `outputSilentSuccess()` | `{continue:true, suppressOutput:true}` | Default pass-through |
| Allow with message | `outputSuccess(msg)` | `{continue:true, systemMessage:msg}` | Informational feedback |
| Warning | `outputWarning(msg)` | `{continue:true, systemMessage:"⚠ msg"}` | Non-blocking alert |
| Block | `outputDeny(reason)` | `{continue:false, stopReason:reason, hookSpecificOutput:{permissionDecision:"deny",...}}` | Security enforcement |
| Auto-approve | `outputAllow()` | `{continue:true, suppressOutput:true, hookSpecificOutput:{permissionDecision:"allow"}}` | Skip user confirmation |
| Allow + context | `outputAllowWithContext(ctx)` | `{..., hookSpecificOutput:{permissionDecision:"allow", additionalContext:ctx}}` | Approve + inform Claude |
| Inject context | `outputPromptContext(ctx)` | `{..., hookSpecificOutput:{hookEventName:"UserPromptSubmit", additionalContext:ctx}}` | Invisible guidance |
| Post-tool context | `outputWithContext(ctx)` | `{..., hookSpecificOutput:{additionalContext:ctx}}` | Post-tool Claude context |
| Ask user | `outputAsk(updatedInput?)` | `{continue:true, hookSpecificOutput:{permissionDecision:"ask", updatedInput?}}` | Prompt user + optional rewrite |
| Dual channel | `outputWithNotification(userMsg, claudeCtx)` | `{continue:true, systemMessage:userMsg, hookSpecificOutput:{additionalContext:claudeCtx}}` | Different messages to user/Claude |
| Stderr warning | `outputStderrWarning(msg)` | Writes to stderr, exits code 2 | **Blocking error** — see the exit-2 note under Debugging |

## Safety Patterns

Build these safety guarantees into every plugin:

### 1. Shell Wrapper Always Exits 0

Claude Code treats non-zero exit codes as hook errors. Your shell wrapper must catch all failures:

```sh
set -eu
SAFE_JSON='{"continue":true,"suppressOutput":true}'

OUTPUT=$(printf '%s' "$INPUT" | node "$HOOK_RUNNER" "$HOOK_NAME" 2>/dev/null) || true

if [ -n "$OUTPUT" ] && printf '%s\n' "$OUTPUT" | head -1 | grep -q '^{'; then
  printf '%s\n' "$OUTPUT" | grep '^{' | tail -1
else
  echo "$SAFE_JSON"
fi

exit 0
```

### 2. Process-Level Error Handlers

Catch uncaught exceptions and unhandled rejections in Node.js:

```typescript
process.on('uncaughtException', (error) => {
  process.stderr.write(`[my-plugin] Uncaught: ${error.message}\n`);
  process.stdout.write('{"continue":true,"suppressOutput":true}\n');
  process.exit(0);
});
process.on('unhandledRejection', (reason) => {
  process.stdout.write('{"continue":true,"suppressOutput":true}\n');
  process.exit(0);
});
```

### 3. Atomic File Writes

When writing shared state files, use `.tmp` + `rename` for atomicity:

```typescript
const tmpPath = `${targetPath}.tmp`;
fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
fs.renameSync(tmpPath, targetPath);  // POSIX rename is atomic
```

### 4. Directory-Based Locking

Use `mkdir` for atomic locking (POSIX guarantees mkdir is atomic):

```typescript
async function acquireLock(lockPath: string, maxAttempts = 50): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      fs.mkdirSync(lockPath);
      return true;
    } catch {
      await new Promise(r => setTimeout(r, 100));  // 100ms retry
    }
  }
  return false;
}

function releaseLock(lockPath: string): void {
  try { fs.rmSync(lockPath, { recursive: true }); } catch {}
}
```

### 5. Non-Disableable Security Hooks

Prevent project-level `.claude/hook-overrides.json` from disabling critical hooks:

```typescript
const NON_DISABLEABLE_HOOKS = new Set(['pretool/security-blocker']);

function isHookDisabled(hookName: string): boolean {
  if (NON_DISABLEABLE_HOOKS.has(hookName)) return false;
  // ... check overrides file
}
```

## Practical Examples

### Example A: SessionStart — Load Context

```typescript
async function sessionLoader(input: HookInput): Promise<HookResult> {
  const projectDir = process.env['CLAUDE_PROJECT_DIR'] || '.';
  const contextPath = path.join(projectDir, '.my-plugin', 'context.json');

  if (!fs.existsSync(contextPath)) {
    return outputSuccess('No saved context found. Run /setup to initialize.');
  }

  const context = JSON.parse(fs.readFileSync(contextPath, 'utf-8'));
  const summary = `Loaded context: ${context.filesTracked} files tracked.`;
  return outputSuccess(summary);
}
```

### Example B: PreToolUse — Block Dangerous Paths

```typescript
function securityBlocker(input: HookInput): HookResult {
  const filePath = input.tool_input.file_path;
  if (!filePath) return outputSilentSuccess();

  if (/\.env($|\.)/.test(filePath)) {
    return outputDeny('Write to .env files is blocked by security policy');
  }
  if (/\.ssh\//.test(filePath)) {
    return outputDeny('Write to .ssh/ directory is blocked');
  }

  return outputSilentSuccess();
}
```

### Example C: PostToolUse — Track Edits (async)

```typescript
async function dirtyTracker(input: HookInput): Promise<HookResult> {
  const filePath = input.tool_input.file_path;
  if (!filePath) return outputSilentSuccess();

  const statePath = path.join(projectDir, '.my-plugin', 'state.json');
  const lockPath = `${statePath}.lock`;

  if (!(await acquireLock(lockPath))) return outputSilentSuccess();
  try {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    if (!state.editedFiles.includes(filePath)) {
      state.editedFiles.push(filePath);
    }
    const tmpPath = `${statePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2));
    fs.renameSync(tmpPath, statePath);
  } finally {
    releaseLock(lockPath);
  }

  return outputSilentSuccess();
}
```

In hooks.json, mark this as async so it doesn't block:
```json
{ "matcher": "Write|Edit|MultiEdit", "hooks": [{ "type": "command", "command": "...", "timeout": 10, "async": true }] }
```

### Example D: UserPromptSubmit — Inject Context

```typescript
function contextMonitor(input: HookInput): HookResult {
  const contextUsed = readContextPercentage();  // your implementation

  if (contextUsed > 90) {
    return outputPromptContext(
      'CONTEXT CRITICAL: ' + contextUsed + '% used. Run /save-state then /clear soon.'
    );
  }
  if (contextUsed > 70) {
    return outputPromptContext(
      'Context at ' + contextUsed + '%. Consider saving state when at a stopping point.'
    );
  }

  return outputSilentSuccess();
}
```

The user never sees these messages — only Claude does, via `additionalContext`.

## Debugging

- **Log level**: Set `CONTINUITY_LOG_LEVEL=debug` to see verbose hook output in `~/.claude/logs/continuity/hooks.log`
- **stderr**: Hook stderr goes to log files, not to the user
- **Exit code 2**: a hook **blocking error**, not a plain user notice. ⚠ This line previously read
  "writes stderr message to user's terminal (not to Claude's context)" — true only for the events where
  exit 2 is non-blocking. On `PreToolUse` / `PostToolUse` / `Stop` it **blocks the operation** and the
  message reaches Claude. `outputStderrWarning()` wraps it but takes no event parameter, so the caller
  owns that judgement; use `outputWarning()` for a warning that blocks nothing. Measured on CC 2.1.221:
  the binary carries `hook blocking error from command:` and `hook returned blocking error`. The exact
  per-event stderr routing was **not** measured — that part follows CC's documented hook contract.
  Corrected under issue #67.
- **Safe fallback**: If you see unexpected `{"continue":true,"suppressOutput":true}` output, check that `dist/` exists (bundle may not be built)
- **JSON validation**: The shell wrapper only accepts lines starting with `{`. Non-JSON output is replaced with the safe fallback

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CLAUDE_PLUGIN_ROOT` | Plugin installation path (set by Claude Code) |
| `CLAUDE_PROJECT_DIR` | Current project directory |
| `CLAUDE_SESSION_ID` | Current session identifier |
| `CLAUDE_ENV_FILE` | Path to env file for hook-written exports |
