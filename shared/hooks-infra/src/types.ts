/**
 * Shared Hooks Infra - Hook System Type Definitions
 *
 * This module defines the TypeScript interfaces for the hook system,
 * matching the JSON contract established by the bash scripts in scripts/lib/common.sh.
 *
 * The hook system handles:
 * - PreToolUse: Permission auto-approval and security validation
 * - PostToolUse: Tracking file edits for dirty flag management
 * - SessionStart: Loading continuity context
 * - PreCompact: Saving state before context compaction
 *
 * @module hooks/types
 */

// =============================================================================
// TOOL TYPES
// =============================================================================

/**
 * Tool names that Claude Code can invoke.
 * These are the tools that hooks can intercept and validate.
 */
export type ToolName =
  | 'Bash'
  | 'Write'
  | 'Edit'
  | 'MultiEdit'
  | 'Read'
  | 'Glob'
  | 'Grep'
  | 'Task'
  | 'TodoWrite'
  | 'TodoRead'
  // Tools added in Claude Code v2.x
  | 'WebSearch'
  | 'WebFetch'
  | 'NotebookEdit'
  | 'Skill'
  | 'TaskOutput'
  | 'LSP'
  | 'TaskCreate'
  | 'TaskUpdate'
  | 'TaskList'
  | 'TaskGet'
  | 'SendMessage'
  | 'TeamCreate'
  | 'TeamDelete'
  | 'EnterPlanMode'
  | 'ExitPlanMode'
  | 'AskUserQuestion'
  | 'TaskStop'
  // Lifecycle events (not tools, but handled similarly)
  | 'PreCompact'
  | 'PostCompact'
  | 'SessionStart'
  | 'SessionEnd';

/**
 * Tool names that perform file write operations.
 * These tools are subject to security validation and permission hooks.
 */
export type FileWriteToolName = 'Write' | 'Edit' | 'MultiEdit';

/**
 * Tool names that perform read-only operations.
 * These tools are generally safe and may be auto-approved.
 */
export type ReadOnlyToolName = 'Read' | 'Glob' | 'Grep';

// =============================================================================
// HOOK INPUT TYPES
// =============================================================================

/**
 * Input provided to a hook by Claude Code.
 * This is the JSON structure received from stdin.
 *
 * Claude Code sends different fields depending on the event type:
 * - Tool events (PreToolUse, PostToolUse): use tool_name
 * - Lifecycle events (SessionStart, etc.): use hook_event_name
 *
 * The input parser normalizes both to tool_name for consistent handling.
 *
 * @example Tool event:
 * ```json
 * {
 *   "tool_name": "Write",
 *   "tool_input": { "file_path": "/path/to/file.ts", "content": "..." },
 *   "session_id": "abc123"
 * }
 * ```
 *
 * @example Lifecycle event:
 * ```json
 * {
 *   "hook_event_name": "SessionStart",
 *   "source": "startup",
 *   "session_id": "abc123"
 * }
 * ```
 */
export interface HookInput {
  /**
   * The name of the tool or event being invoked.
   * For lifecycle events, this is normalized from hook_event_name.
   * May be empty string if input was invalid (graceful handling).
   */
  tool_name: ToolName;

  /**
   * The input parameters for the tool.
   * Structure varies by tool type.
   * Empty object for lifecycle events.
   */
  tool_input: ToolInput;

  /**
   * Optional session identifier from Claude Code.
   * Falls back to CLAUDE_CODE_SESSION_ID (CC v2.1.132+), then to
   * CLAUDE_SESSION_ID (older runtimes), if not provided.
   */
  session_id?: string;

  /**
   * Original hook event name (for lifecycle events).
   * Present when Claude Code sends hook_event_name instead of tool_name.
   */
  hook_event_name?: string;

  /**
   * Source of session start (for SessionStart events).
   * Values: 'startup', 'resume', 'clear', 'compact'
   */
  source?: string;

  /**
   * Model identifier (for SessionStart events).
   */
  model?: string;

  /**
   * Current working directory.
   */
  cwd?: string;

  /**
   * Path to conversation transcript.
   */
  transcript_path?: string;

  /**
   * Current permission mode.
   */
  permission_mode?: string;

  /**
   * Unique identifier correlating PreToolUse and PostToolUse for the same call.
   * Available since Claude Code v2.0.43.
   */
  tool_use_id?: string;

  /**
   * Agent type when session started with --agent flag.
   * Available since Claude Code v2.1.2.
   */
  agent_type?: string;

  /**
   * Unique identifier for the subagent.
   * Present only when the hook fires inside a subagent call.
   * Available since Claude Code v2.1.10.
   */
  agent_id?: string;

  /**
   * Worktree path when hook fires inside a git worktree.
   * Available since Claude Code v2.1.70.
   */
  worktree_path?: string;

  /**
   * Worktree branch name.
   * Available since Claude Code v2.1.70.
   */
  worktree_branch?: string;

  /**
   * Last assistant message content, present in Stop/SubagentStop input.
   * Available since Claude Code v2.1.47.
   */
  last_assistant_message?: string;

  /**
   * Name of the agent-team teammate the event concerns.
   * Present in TeammateIdle, TaskCreated, and TaskCompleted input.
   *
   * NOT interchangeable with `agent_id`/`agent_type` -- those are absent from
   * these three payloads. Verified against the CC v2.1.215 binary, whose hook
   * descriptions read "Input to command is JSON with teammate_name and
   * team_name" (TeammateIdle) and "... task_id, task_subject,
   * task_description, teammate_name, and team_name" (Task*).
   *
   * This is the teammate's *name*, not its transcript id: a teammate named
   * `sec-reviewer` writes to `subagents/agent-a<name>-<hash>.jsonl`, so
   * locating its transcript needs a prefix match, not concatenation.
   */
  teammate_name?: string;

  /**
   * Agent-team name (e.g. "session-fc573d34").
   * Present in TeammateIdle, TaskCreated, and TaskCompleted input.
   */
  team_name?: string;

  /**
   * Task identifier. Present in TaskCreated and TaskCompleted input.
   */
  task_id?: string;

  /**
   * Short task subject line. Present in TaskCreated and TaskCompleted input.
   */
  task_subject?: string;

  /**
   * Full task description. Present in TaskCreated and TaskCompleted input.
   */
  task_description?: string;

  /**
   * Tool execution duration in milliseconds.
   * Present in PostToolUse and PostToolUseFailure hook inputs.
   * Available since Claude Code v2.1.119.
   */
  duration_ms?: number;

  /**
   * Effort level configured for the current session.
   * Values are open-ended (e.g. "low", "medium", "high", "xhigh", "max")
   * and may grow over time, so kept as `string` rather than a literal union.
   * Available since Claude Code v2.1.133.
   */
  effort?: {
    level?: string;
  };

  /**
   * Background tasks active when a Stop or SubagentStop hook fires.
   * Each entry describes a long-running task started via `run_in_background`
   * (Bash) or similar mechanisms that has not yet completed.
   *
   * Stop hooks observing a non-empty array should NOT deregister session
   * state — the model has finished a turn but background work is still
   * in flight.
   *
   * Available since Claude Code v2.1.145.
   */
  background_tasks?: ReadonlyArray<{
    /** Task identifier (e.g. shell_id for background Bash). */
    id?: string;
    /** Optional human-readable label or command summary. */
    description?: string;
    /** Status indicator if surfaced by CC (e.g. "running"). */
    status?: string;
  }>;

  /**
   * Active scheduled jobs ("crons") attached to this session when Stop or
   * SubagentStop fires. Each entry corresponds to a previously scheduled
   * cron/routine that may still fire after the current turn.
   *
   * Stop hooks observing a non-empty array should NOT deregister session
   * state — scheduled work may still produce results in this session.
   *
   * Available since Claude Code v2.1.145.
   */
  session_crons?: ReadonlyArray<{
    /** Cron job identifier. */
    id?: string;
    /** Optional schedule expression or description. */
    schedule?: string;
    /** Optional command or routine name. */
    command?: string;
  }>;
}

/**
 * Agent context for audit logging.
 * Captures agent identity when hooks fire inside subagent calls.
 */
export interface AgentContext {
  agentId?: string | undefined;
  agentType?: string | undefined;
}

/**
 * Tool input parameters.
 * Different tools use different subsets of these fields.
 *
 * @remarks
 * - Write/Edit/MultiEdit use file_path and content
 * - Bash uses command
 * - Read uses file_path or path
 * - Glob/Grep use path and pattern
 */
export interface ToolInput {
  /**
   * File path for file operations (Write, Edit, MultiEdit, Read).
   * Always absolute since CC 2.1.88. Relative path handling kept for CC<2.1.88 compat.
   */
  file_path?: string;

  /**
   * Alternative path field used by some tools (Read, Glob, Grep).
   * Hook logic should check both file_path and path.
   */
  path?: string;

  /**
   * File content for Write tool.
   */
  content?: string;

  /**
   * Old string to replace for Edit tool.
   */
  old_string?: string;

  /**
   * New string replacement for Edit tool.
   */
  new_string?: string;

  /**
   * Bash command to execute for Bash tool.
   * Subject to security validation for dangerous patterns.
   */
  command?: string;

  /**
   * Optional command description for Bash tool.
   */
  description?: string;

  /**
   * Optional timeout for Bash tool in milliseconds.
   */
  timeout?: number;

  /**
   * Search pattern for Glob/Grep tools.
   */
  pattern?: string;

  /**
   * Glob pattern filter for Grep tool.
   */
  glob?: string;

  /**
   * File type filter for Grep tool.
   */
  type?: string;

  /**
   * Output mode for Grep tool.
   */
  output_mode?: 'content' | 'files_with_matches' | 'count';

  /**
   * Array of edits for MultiEdit tool.
   */
  edits?: Array<{
    file_path: string;
    old_string: string;
    new_string: string;
  }>;

  /**
   * When true, Bash tool runs without sandbox restrictions (v2.0.24).
   * Security-relevant: bypasses the default sandbox.
   */
  dangerouslyDisableSandbox?: boolean;

  /**
   * When true, Bash tool runs in background (v2.0.19).
   */
  run_in_background?: boolean;

  /**
   * Page range for Read tool PDF file access (v2.1.30).
   * Examples: "1-5", "3", "10-20"
   */
  pages?: string;
}

/**
 * Specialized input type for Bash tool operations.
 */
export interface BashToolInput extends ToolInput {
  command: string;
  description?: string;
  timeout?: number;
}

/**
 * Specialized input type for file write operations.
 */
export interface FileToolInput extends ToolInput {
  file_path: string;
  content?: string;
  old_string?: string;
  new_string?: string;
}

/**
 * Type guard to check if tool input is for Bash tool.
 */
export function isBashToolInput(input: ToolInput): input is BashToolInput {
  return typeof input.command === 'string';
}

/**
 * Type guard to check if tool input is for file operations (Write, Edit, MultiEdit).
 *
 * Checks only `file_path` because that is the field `FileToolInput` requires.
 * `ToolInput.path` is also used by Glob/Grep/Read and must NOT be included here
 * or the guard would falsely match those tools. Use `getFilePath()` from
 * `lib/input.ts` when you need to resolve whichever path field is present.
 */
export function isFileToolInput(input: ToolInput): input is FileToolInput {
  return typeof input.file_path === 'string';
}

/**
 * Input for UserPromptSubmit hooks.
 * Contains the user's prompt text before Claude processes it.
 */
export interface UserPromptInput {
  /**
   * The user's prompt text.
   */
  prompt: string;

  /**
   * Session identifier.
   */
  session_id?: string;

  /**
   * Timestamp of submission.
   */
  timestamp?: string;
}

/**
 * Type guard to check if input is for UserPromptSubmit event.
 */
export function isUserPromptInput(input: unknown): input is UserPromptInput {
  return (
    typeof input === 'object' &&
    input !== null &&
    'prompt' in input &&
    typeof (input as UserPromptInput).prompt === 'string'
  );
}

// =============================================================================
// HOOK RESULT TYPES
// =============================================================================

/**
 * Permission decision for PreToolUse hooks.
 * - 'allow': Auto-approve the operation (skip user prompt)
 * - 'deny': Block the operation with a reason
 * - 'ask': Prompt the user, optionally with modified input (v2.1.0)
 * - 'defer': Pause execution for headless sessions; resume with -p --resume (v2.1.89)
 */
export type PermissionDecision = 'allow' | 'deny' | 'ask' | 'defer';

/**
 * Hook-specific output data included in the result.
 * Used to communicate additional context to Claude Code.
 */
export interface HookSpecificOutput {
  /**
   * Hook event name for modern output format.
   * Required to avoid phantom "error" label in Claude Code UI.
   * @see https://github.com/anthropics/claude-code/issues/17088
   */
  hookEventName?:
    | 'PreToolUse'
    | 'PostToolUse'
    | 'PermissionRequest'
    | 'UserPromptSubmit'
    | 'MessageDisplay'
    | 'SessionStart'
    | 'Stop'
    | 'SubagentStop';

  /**
   * Permission decision from auto-approval hooks.
   * When set to 'allow', the operation is auto-approved.
   * When set to 'deny', the operation is blocked.
   */
  permissionDecision?: PermissionDecision;

  /**
   * Reason for permission denial.
   * Displayed to the user when operation is blocked.
   */
  permissionDecisionReason?: string;

  /**
   * Additional context to inject into Claude's context.
   * Used by output_allow_with_context() in bash hooks.
   * Also valid from Stop and SubagentStop hooks since CC v2.1.163 — gives
   * Claude feedback and continues the turn without the output being labeled
   * a hook error (mind the v2.1.78 infinite-loop hazard: a Stop hook that
   * always injects context can keep the turn alive indefinitely).
   */
  additionalContext?: string;

  /**
   * Modified tool input to substitute before execution.
   * PreToolUse hooks can rewrite tool inputs via this field (v2.0.10).
   * Used with permissionDecision 'allow' or 'ask'.
   */
  updatedInput?: Record<string, unknown>;

  /**
   * When true, tells Claude Code to retry the denied tool call (CC 2.1.88+).
   * Only meaningful for PermissionDenied hooks.
   */
  retry?: boolean;

  /**
   * Set session title from UserPromptSubmit hooks (CC 2.1.94+) or
   * SessionStart hooks (CC v2.1.152+).
   * The title is displayed in the session card and resume picker.
   */
  sessionTitle?: string;

  /**
   * SessionStart hooks (CC v2.1.152+): when true, CC re-scans skill
   * directories after the hook completes — same effect as /reload-skills.
   */
  reloadSkills?: boolean;

  /**
   * MessageDisplay hook — transformed assistant message text (CC v2.1.152+).
   * When set, replaces the original assistant message at display time.
   * Field name is informed by the v2.1.152 CHANGELOG description; CC will
   * silently ignore unknown fields, so this is safe to ship across versions.
   */
  transformedMessage?: string;

  /**
   * MessageDisplay hook — when true, hide the assistant message at display
   * time (CC v2.1.152+). Use sparingly; prefer transformedMessage with a
   * placeholder for transparency.
   */
  hide?: boolean;
}

/**
 * Result returned from a hook to Claude Code.
 * This is the JSON structure written to stdout by bash hooks.
 *
 * @example Success with suppressed output:
 * ```json
 * {"continue": true, "suppressOutput": true}
 * ```
 *
 * @example Denial with reason:
 * ```json
 * {
 *   "continue": false,
 *   "stopReason": "Environment file modification blocked",
 *   "hookSpecificOutput": {
 *     "permissionDecision": "deny",
 *     "permissionDecisionReason": "Environment file modification blocked"
 *   }
 * }
 * ```
 *
 * @example Auto-approval:
 * ```json
 * {
 *   "continue": true,
 *   "suppressOutput": true,
 *   "hookSpecificOutput": {
 *     "permissionDecision": "allow"
 *   }
 * }
 * ```
 */
export interface HookResult {
  /**
   * Whether to continue with the operation.
   * - true: Proceed with the tool invocation
   * - false: Block the operation
   */
  continue: boolean;

  /**
   * Whether to suppress hook output from being shown to user.
   * When true, the hook runs silently.
   */
  suppressOutput?: boolean;

  /**
   * Reason for stopping/blocking the operation.
   * Only used when continue is false.
   * Displayed to the user and logged.
   */
  stopReason?: string;

  /**
   * System message to display to the user.
   * Used for warnings or informational messages.
   * Supports Unicode escape sequences (e.g., \\u26a0 for warning symbol).
   */
  systemMessage?: string;

  /**
   * Hook-specific output data.
   * Contains permission decisions and additional context.
   */
  hookSpecificOutput?: HookSpecificOutput;

  /**
   * Terminal escape sequence emitted on the hook's behalf.
   * Restricted by CC to OSC 0/1/2/9/99/777 and BEL. Anything outside
   * the allowlist is silently ignored. Common uses:
   *
   *  - `\x1b]2;<title>\x07` — set window title (OSC 2 + BEL)
   *  - `\x1b]9;<text>\x07` — iTerm2/Windows Terminal/WezTerm notification
   *  - `\x07` — bare BEL
   *
   * Available since Claude Code v2.1.141. Use `buildWindowTitleSequence()`
   * from `lib/terminal-sequence.ts` for the title case.
   */
  terminalSequence?: string;
}

// =============================================================================
// HOOK FUNCTION TYPES
// =============================================================================

/**
 * Hook function signature.
 * Hooks receive input and return a result (sync or async).
 */
export type HookFunction = (input: HookInput) => Promise<HookResult> | HookResult;

/**
 * Async hook function signature.
 * For hooks that perform async operations (file I/O, etc.).
 */
export type AsyncHookFunction = (input: HookInput) => Promise<HookResult>;

/**
 * Sync hook function signature.
 * For simple hooks that don't require async operations.
 */
export type SyncHookFunction = (input: HookInput) => HookResult;

// =============================================================================
// HOOK EVENT TYPES
// =============================================================================

/**
 * Hook event types as defined in hooks.json.
 */
export type HookEvent =
  | 'SessionStart'
  | 'PreCompact'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'UserPromptSubmit'
  | 'PostToolUseFailure'
  | 'SubagentStart'
  | 'SubagentStop'
  // Events added in Claude Code v2.x
  | 'Stop'
  | 'SessionEnd'
  | 'PermissionRequest'
  | 'Notification'
  | 'TeammateIdle'
  | 'TaskCompleted'
  | 'ConfigChange'
  // Events added in Claude Code v2.1.50
  | 'WorktreeCreate'
  | 'WorktreeRemove'
  // Events added in Claude Code v2.1.69
  | 'InstructionsLoaded'
  // Events added in Claude Code v2.1.76
  | 'PostCompact'
  | 'StopFailure'
  // Events added in Claude Code v2.1.83
  | 'CwdChanged'
  | 'FileChanged'
  // Events added in Claude Code v2.1.84
  | 'TaskCreated'
  // Events added in Claude Code v2.1.88
  | 'PermissionDenied'
  // Events added in Claude Code v2.1.89
  | 'Setup'
  | 'Elicitation'
  | 'ElicitationResult'
  // Events added in Claude Code v2.1.152 (same release as transformedMessage/hide)
  | 'MessageDisplay';

/**
 * Hook configuration from hooks.json.
 */
export interface HookConfig {
  /**
   * Type of hook handler.
   * - 'command': Execute a shell command (our hooks use this)
   * - 'prompt': Single-turn LLM evaluation (v2.1.49+)
   * - 'agent': Multi-turn subagent handler (v2.1.49+)
   */
  type: 'command' | 'prompt' | 'agent';

  /**
   * Command to execute for the hook.
   * Supports environment variable expansion (e.g., ${CLAUDE_PLUGIN_ROOT}).
   * Required for type 'command' unless `args` is supplied.
   */
  command?: string;

  /**
   * Argument vector form for type 'command' hooks (CC v2.1.139+).
   * When set, Claude Code spawns the binary directly without a shell,
   * eliminating shell-quoting and injection risks. Prefer over `command`
   * for any hook whose arguments may contain user-controlled values.
   *
   * The first element is the executable; the rest are positional args.
   * `${CLAUDE_PLUGIN_ROOT}` and other env vars are still expanded per element.
   *
   * If both `command` and `args` are provided, CC uses `args`.
   */
  args?: string[];

  /**
   * Prompt text for LLM evaluation.
   * Required for type 'prompt' and 'agent'.
   */
  prompt?: string;

  /**
   * Model to use for prompt/agent hook types.
   * Optional, uses default model if not specified.
   */
  model?: string;

  /**
   * Status message shown while the hook is running.
   * Optional, used by prompt/agent hook types.
   */
  statusMessage?: string;

  /**
   * Timeout in seconds.
   * Permission hooks typically use 2s, security hooks 5s.
   */
  timeout: number;

  /**
   * When true, hook runs only once per session (v2.1.0).
   * Useful for context injection hooks that only need to fire once.
   */
  once?: boolean;

  /**
   * When true, hook runs asynchronously without blocking the tool call (v2.1.0).
   * Useful for non-blocking PostToolUse hooks like state tracking and linting.
   * Security-critical hooks (e.g., secret-detector) should remain synchronous.
   */
  async?: boolean;

  /**
   * Controls turn behavior when a `PostToolUse` hook rejects a tool's output.
   *
   * Default (`false` or unset): a rejection from the hook terminates the
   * current turn — Claude does not get to respond to the rejection.
   *
   * When `true`: the hook's rejection reason is fed back to Claude as
   * additional context and the turn continues. Useful when the hook's
   * rejection is informational (e.g., "lint found errors, please fix")
   * rather than terminal (e.g., "secret detected, halt immediately").
   *
   * Available since Claude Code v2.1.139. Ignored for non-PostToolUse events.
   */
  continueOnBlock?: boolean;
}

/**
 * Hook matcher configuration.
 * Defines which tools a hook applies to.
 */
export interface HookMatcher {
  /**
   * Tool name pattern (regex supported).
   * Examples: "Bash", "Write|Edit|MultiEdit"
   */
  matcher?: string;

  /**
   * Hooks to execute when matcher matches.
   */
  hooks: HookConfig[];
}

/**
 * Complete hooks configuration from hooks.json.
 */
export interface HooksConfig {
  hooks: {
    SessionStart?: HookMatcher[];
    PreCompact?: HookMatcher[];
    PreToolUse?: HookMatcher[];
    PostToolUse?: HookMatcher[];
    UserPromptSubmit?: HookMatcher[];
    PostToolUseFailure?: HookMatcher[];
    SubagentStart?: HookMatcher[];
    SubagentStop?: HookMatcher[];
    // Events added in Claude Code v2.x
    Stop?: HookMatcher[];
    SessionEnd?: HookMatcher[];
    PermissionRequest?: HookMatcher[];
    Notification?: HookMatcher[];
    TeammateIdle?: HookMatcher[];
    TaskCompleted?: HookMatcher[];
    ConfigChange?: HookMatcher[];
    // Events added in Claude Code v2.1.50
    WorktreeCreate?: HookMatcher[];
    WorktreeRemove?: HookMatcher[];
    // Events added in Claude Code v2.1.69
    InstructionsLoaded?: HookMatcher[];
    // Events added in Claude Code v2.1.76
    PostCompact?: HookMatcher[];
    StopFailure?: HookMatcher[];
    // Events added in Claude Code v2.1.83
    CwdChanged?: HookMatcher[];
    FileChanged?: HookMatcher[];
    // Events added in Claude Code v2.1.84
    TaskCreated?: HookMatcher[];
    // Events added in Claude Code v2.1.88
    PermissionDenied?: HookMatcher[];
    // Events added in Claude Code v2.1.89
    Setup?: HookMatcher[];
    Elicitation?: HookMatcher[];
    ElicitationResult?: HookMatcher[];
    // Events added in Claude Code v2.1.152 (same release as transformedMessage/hide)
    MessageDisplay?: HookMatcher[];
  };
}

// =============================================================================
// HOOK METADATA TYPES
// =============================================================================

/**
 * Hook metadata for registration and discovery.
 */
export interface HookMetadata {
  /**
   * Unique identifier for the hook.
   * Examples: "auto-approve-safe-bash", "pre-tool-use-security"
   */
  name: string;

  /**
   * Human-readable description of what the hook does.
   */
  description: string;

  /**
   * Hook event type (when the hook runs).
   */
  event: HookEvent;

  /**
   * Tool matcher pattern (for PreToolUse/PostToolUse hooks).
   * If not specified, hook applies to all tools.
   */
  matcher?: string;

  /**
   * Hook timeout in seconds.
   */
  timeout: number;

  /**
   * Hook handler function.
   */
  handler: HookFunction;
}

/**
 * Registry of all hooks for programmatic access.
 */
export interface HookRegistry {
  /**
   * All registered hooks indexed by name.
   */
  hooks: Map<string, HookMetadata>;

  /**
   * Register a new hook.
   */
  register(metadata: HookMetadata): void;

  /**
   * Get a hook by name.
   */
  get(name: string): HookMetadata | undefined;

  /**
   * Get all hooks for a specific event.
   */
  getByEvent(event: HookEvent): HookMetadata[];

  /**
   * Get hooks that match a specific tool name.
   */
  getMatchingHooks(event: HookEvent, toolName: ToolName): HookMetadata[];
}

// =============================================================================
// ENVIRONMENT TYPES
// =============================================================================

/**
 * Environment variables used by the hook system.
 */
export interface HookEnvironment {
  /**
   * Project directory path (from CLAUDE_PROJECT_DIR).
   * Defaults to current working directory.
   */
  projectDir: string;

  /**
   * Plugin root path (from CLAUDE_PLUGIN_ROOT).
   */
  pluginRoot: string;

  /**
   * Session ID (from CLAUDE_CODE_SESSION_ID — CC v2.1.132+ — or
   * CLAUDE_SESSION_ID for older runtimes).
   */
  sessionId: string;

  /**
   * Log level (from `${PLUGIN_NAME}_LOG_LEVEL` env var, e.g. `CONTINUITY_LOG_LEVEL`).
   * Defaults to 'warn'.
   */
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Get hook environment from process.env.
 *
 * Log level is resolved from `${PLUGIN_NAME}_LOG_LEVEL` where PLUGIN_NAME
 * comes from CLAUDE_PLUGIN_NAME (defaulting to 'plugin' when unset).
 */
export function getHookEnvironment(): HookEnvironment {
  const pluginName = process.env['CLAUDE_PLUGIN_NAME'] || 'plugin';
  const envVar = `${pluginName.toUpperCase()}_LOG_LEVEL`;
  return {
    projectDir: process.env['CLAUDE_PROJECT_DIR'] || process.cwd(),
    pluginRoot: process.env['CLAUDE_PLUGIN_ROOT'] || '',
    sessionId:
      process.env['CLAUDE_CODE_SESSION_ID'] || process.env['CLAUDE_SESSION_ID'] || 'unknown',
    logLevel: (process.env[envVar] as HookEnvironment['logLevel']) || 'warn',
  };
}

// =============================================================================
// SECURITY PATTERN TYPES
// =============================================================================

/**
 * Security pattern configuration for file path validation.
 */
export interface SecurityPatterns {
  /**
   * Environment file patterns (always blocked).
   * Examples: \.env$, \.envrc$
   */
  envPatterns: RegExp[];

  /**
   * Git internal patterns (always blocked).
   * Examples: ^\.git/, \.gitconfig$
   */
  gitPatterns: RegExp[];

  /**
   * SSH key patterns (always blocked).
   * Examples: \.ssh/id_, \.ssh/.*\.pem$
   */
  sshPatterns: RegExp[];

  /**
   * Credential file patterns (always blocked).
   * Examples: \.aws/credentials$, \.npmrc$
   */
  credentialPatterns: RegExp[];

  /**
   * System directory patterns (always blocked).
   * Examples: ^/etc/, ^/usr/, ^/var/
   */
  systemDirPatterns: RegExp[];

  /**
   * Dangerous bash command patterns (always blocked).
   * Examples: rm -rf /, dd of=/dev/
   */
  dangerousCommandPatterns: RegExp[];

  /**
   * Safe bash command prefixes (auto-approved).
   * Examples: ls, git status, npm list
   */
  safeCommandPrefixes: string[];

  /**
   * Safe file extensions (auto-approved within project).
   * Examples: .ts, .js, .py, .md
   */
  safeExtensions: RegExp[];

  /**
   * Protected directories (require manual approval).
   * Examples: node_modules/, .git/, dist/
   */
  protectedDirs: string[];
}

// =============================================================================
// LOGGING TYPES
// =============================================================================

/**
 * Log level enumeration.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Permission log entry for audit trail.
 */
export interface PermissionLogEntry {
  /**
   * Timestamp in ISO 8601 format.
   */
  timestamp: string;

  /**
   * Permission decision: allow, deny, or warn.
   */
  decision: 'allow' | 'deny' | 'warn';

  /**
   * Reason for the decision.
   */
  reason: string;

  /**
   * Tool that was evaluated.
   */
  tool: ToolName;

  /**
   * Session ID for correlation.
   */
  sessionId: string;

  /**
   * File path or command that was evaluated (if applicable).
   */
  target?: string;
}

/**
 * Logger interface for hooks.
 */
export interface HookLogger {
  debug(hookName: string, message: string): void;
  info(hookName: string, message: string): void;
  warn(hookName: string, message: string): void;
  error(hookName: string, message: string): void;
  permission(entry: PermissionLogEntry): void;
}

// =============================================================================
// CONTEXT FILE TYPES (shared-context.json)
// =============================================================================

/**
 * Session heartbeat tracking in shared-context.json.
 */
export interface SessionHeartbeat {
  /**
   * Timestamp when session started.
   */
  session_start?: string;

  /**
   * Whether the session was cleanly ended with /create-handoff.
   */
  was_cleanly_ended: boolean;

  /**
   * Timestamp of last activity.
   */
  last_activity?: string;
}

/**
 * Dirty tracking for file edits in shared-context.json.
 */
export interface DirtyTracking {
  /**
   * Number of unique files edited this session.
   */
  files_edited_count: number;

  /**
   * Array of file paths edited this session.
   */
  files_edited_this_session: string[];

  /**
   * Timestamp of last edit.
   */
  last_edit_timestamp?: string;

  /**
   * Threshold for warning about handoff.
   */
  threshold_warning: number;

  /**
   * Threshold for auto-suggesting handoff.
   */
  threshold_auto_suggest: number;
}

/**
 * Shared context file structure.
 */
export interface SharedContext {
  session_heartbeat: SessionHeartbeat;
  dirty_tracking: DirtyTracking;
}
