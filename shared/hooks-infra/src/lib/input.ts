/**
 * Shared Hooks Infra - Input Parsing Library
 *
 * Provides robust JSON parsing and field extraction for hook inputs.
 * Uses synchronous stdin reading to avoid race conditions with async timeouts.
 *
 * Key features:
 * - Synchronous stdin reading with readSync (no timeout race conditions)
 * - Never returns null - always provides a valid default input
 * - Handles both 'tool_name' and 'hook_event_name' field names
 * - Input normalization for cross-version Claude Code compatibility
 *
 * @module hooks/lib/input
 */

import { readSync } from 'node:fs';
import type { HookInput, ToolInput, ToolName } from '../types.js';

// =============================================================================
// STDIN READING (Synchronous)
// =============================================================================

/**
 * Max consecutive EAGAIN retries before treating stdin as drained (~50ms).
 * The budget resets on every successful read, so a slow writer streaming a
 * large payload gets a fresh window per chunk.
 */
const MAX_EAGAIN_RETRIES = 50;

/**
 * Synchronous ~1ms sleep without burning CPU. Node permits main-thread
 * Atomics.wait (unlike browsers); a sync reader cannot await.
 */
function sleepSyncMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Read all data from stdin synchronously using readSync.
 *
 * This approach avoids the race condition with async timeouts that can
 * cause "invalid or empty input" errors when Claude Code is slow to pipe data.
 *
 * Key differences from async approach:
 * - Uses readSync() which blocks until data is available
 * - No timeout that can fire before data arrives
 * - Buffers data in 256-byte chunks
 * - Retries on EAGAIN/EWOULDBLOCK: a non-blocking stdin momentarily empty
 *   mid-stream is NOT end-of-input. Treating it as EOF truncated large
 *   payloads, failed the JSON parse, and handed security/permission hooks an
 *   empty default input that skipped their checks (audit P1).
 *
 * @returns stdin content as string, empty string on error
 */
function readStdinSync(): string {
  try {
    const chunks: Buffer[] = [];
    const BUFSIZE = 256;
    const buf = Buffer.allocUnsafe(BUFSIZE);
    const fd = 0; // stdin file descriptor
    let eagainRetries = 0;

    // Read stdin synchronously in chunks until EOF
    while (true) {
      try {
        const bytesRead = readSync(fd, buf, 0, BUFSIZE, null);
        if (bytesRead === 0) break; // EOF reached
        chunks.push(Buffer.from(buf.subarray(0, bytesRead)));
        eagainRetries = 0; // progress — reset the retry budget
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if ((code === 'EAGAIN' || code === 'EWOULDBLOCK') && eagainRetries < MAX_EAGAIN_RETRIES) {
          // Pipe momentarily empty while the writer is still flushing —
          // wait briefly and retry instead of truncating the payload.
          eagainRetries++;
          sleepSyncMs(1);
          continue;
        }
        // Genuine end of input (EOF on closed pipe, EBADF, …) or retry
        // budget exhausted - stop reading
        break;
      }
    }

    return Buffer.concat(chunks).toString('utf8').trim();
  } catch {
    // Fatal error reading stdin
    return '';
  }
}

// =============================================================================
// JSON PARSING & NORMALIZATION
// =============================================================================

/**
 * Safely parse JSON string, returning null on any error.
 *
 * Handles:
 * - null/undefined input
 * - Non-string input
 * - Empty strings
 * - Whitespace-only strings
 * - Malformed JSON
 * - Partial JSON (truncated)
 *
 * @param jsonString - Raw JSON string to parse
 * @returns Parsed object or null if parsing fails
 */
function safeJsonParse(jsonString: string): unknown {
  if (!jsonString || typeof jsonString !== 'string') {
    return null;
  }

  const trimmed = jsonString.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/**
 * Get session ID from environment or generate default.
 *
 * @returns Session ID string
 */
function getDefaultSessionId(): string {
  // Prefer CLAUDE_CODE_SESSION_ID (CC v2.1.132+); fall back to the older
  // CLAUDE_SESSION_ID for backwards compat.
  return process.env['CLAUDE_CODE_SESSION_ID'] || process.env['CLAUDE_SESSION_ID'] || 'unknown';
}

/**
 * Create a default HookInput for when stdin is empty or invalid.
 *
 * This ensures hooks never receive null - they always get a valid input.
 * Graceful fallback instead of failure.
 *
 * @returns Default HookInput with empty tool_name
 */
function createDefaultInput(): HookInput {
  return {
    tool_name: '' as ToolName,
    session_id: getDefaultSessionId(),
    tool_input: {},
  };
}

/**
 * Normalize raw input to handle different Claude Code versions.
 *
 * Claude Code may send:
 * - PreToolUse/PostToolUse: { tool_name: "Bash", tool_input: {...} }
 * - SessionStart: { hook_event_name: "SessionStart", source: "startup" }
 *
 * This function normalizes both formats to a consistent HookInput.
 *
 * @param raw - Raw parsed object from stdin
 * @returns Normalized HookInput
 */
function normalizeInput(raw: unknown): HookInput {
  if (!raw || typeof raw !== 'object') {
    return createDefaultInput();
  }

  const obj = raw as Record<string, unknown>;

  // Handle both field names: tool_name (tool events) OR hook_event_name (lifecycle)
  // Priority: tool_name > hook_event_name (for compatibility)
  const eventName = (obj['tool_name'] || obj['hook_event_name'] || '') as string;

  // Get tool_input, defaulting to empty object for lifecycle events
  let toolInput = obj['tool_input'];
  if (toolInput === undefined || toolInput === null) {
    toolInput = {};
  } else if (typeof toolInput !== 'object') {
    toolInput = {};
  }

  // Get session_id from input or environment
  const sessionId =
    typeof obj['session_id'] === 'string' && obj['session_id']
      ? obj['session_id']
      : getDefaultSessionId();

  // Build normalized input
  const normalized: HookInput = {
    tool_name: eventName as ToolName,
    session_id: sessionId,
    tool_input: toolInput as ToolInput,
  };

  // Preserve hook_event_name for lifecycle events (in case handlers need it)
  if (obj['hook_event_name']) {
    (normalized as unknown as Record<string, unknown>)['hook_event_name'] = obj['hook_event_name'];
  }

  // Pass through other common fields from Claude Code.
  //
  // IMPORTANT: this is an ALLOWLIST — any field absent here is silently dropped
  // before handlers ever see it. A handler that reads a field missing from this
  // list is inert, and fails as a plausible-looking default rather than an error.
  // ctk 2.8.4 shipped exactly that bug: the agent-team lifecycle handlers were
  // corrected to read `teammate_name`/`team_name`, but those names were not added
  // here, so they were stripped and every idle still logged "unknown". When adding
  // a field read to any handler, add it here too and cover it end-to-end.
  const passThrough = [
    'source',
    'model',
    // Agent-team lifecycle: TeammateIdle sends teammate_name + team_name;
    // Task* additionally send task_id / task_subject / task_description.
    // Verified against a captured live TeammateIdle payload (2026-07-25).
    'teammate_name',
    'team_name',
    'task_id',
    'task_subject',
    'task_description',
    // PostToolUse / PostToolUseFailure payloads. All three captured live from
    // CC 2.1.220 (2026-07-25): PostToolUse sends `tool_response`;
    // PostToolUseFailure sends `error` + `is_interrupt`. Neither sends
    // `tool_output` -- three handlers read that non-existent key until 2.9.0.
    'tool_response',
    'error',
    'is_interrupt',
    // Legacy/other event names. CC does NOT send these for TeammateIdle or Task*
    // (that was the 2.8.4 finding); kept for any event that does.
    'agent_type',
    'agent_id',
    'worktree_path',
    'worktree_branch',
    'cwd',
    'transcript_path',
    'permission_mode',
    'prompt',
    'tool_use_id',
    'last_assistant_message',
    'duration_ms',
  ];
  for (const field of passThrough) {
    if (obj[field] !== undefined) {
      (normalized as unknown as Record<string, unknown>)[field] = obj[field];
    }
  }

  return normalized;
}

/**
 * Validate that input has minimum required fields to be useful.
 *
 * More lenient than before - accepts inputs with:
 * - Empty tool_name (will be handled gracefully by hooks)
 * - Missing tool_input (gets default empty object)
 *
 * @param input - Normalized HookInput to validate
 * @returns True if input is usable
 */
function isUsableInput(input: HookInput): boolean {
  // Must have tool_name string (can be empty for graceful handling)
  if (typeof input.tool_name !== 'string') {
    return false;
  }

  // Must have tool_input object
  if (!input.tool_input || typeof input.tool_input !== 'object') {
    return false;
  }

  return true;
}

// =============================================================================
// MAIN INPUT FUNCTIONS
// =============================================================================

/**
 * Read hook input from stdin (synchronous).
 *
 * Uses synchronous stdin reading to avoid race conditions with async timeouts.
 * NEVER returns null - always returns a valid HookInput.
 *
 * Key improvements over previous async implementation:
 * - No 100ms timeout that can expire before data arrives
 * - Handles both 'tool_name' and 'hook_event_name' field names
 * - Returns default input on empty/invalid stdin instead of null
 *
 * @returns HookInput object (always valid, never null)
 *
 * @example
 * ```typescript
 * const input = readHookInput();
 * // No null check needed - always returns valid input
 * const toolName = getToolName(input);
 * ```
 */
export function readHookInput(): HookInput {
  const rawInput = readStdinSync();

  // Empty stdin - return default (don't fail)
  if (!rawInput) {
    return createDefaultInput();
  }

  // Parse JSON
  const parsed = safeJsonParse(rawInput);

  // Invalid JSON - return default (don't fail)
  if (!parsed) {
    return createDefaultInput();
  }

  // Normalize input to handle different field names
  const normalized = normalizeInput(parsed);

  // Validate minimum requirements
  if (!isUsableInput(normalized)) {
    return createDefaultInput();
  }

  return normalized;
}

/**
 * Async wrapper for readHookInput (for backward compatibility).
 *
 * @deprecated Use synchronous readHookInput() instead
 * @returns Promise resolving to HookInput (never null)
 */
export async function readHookInputAsync(): Promise<HookInput> {
  return readHookInput();
}

/**
 * Parse hook input from a string (for testing or non-stdin sources).
 *
 * @param jsonString - JSON string to parse
 * @returns HookInput object (always valid, never null)
 *
 * @example
 * ```typescript
 * const input = parseHookInput('{"tool_name":"Bash","tool_input":{"command":"ls"}}');
 * console.log(getToolName(input)); // "Bash"
 * ```
 */
export function parseHookInput(jsonString: string): HookInput {
  const parsed = safeJsonParse(jsonString);

  if (!parsed) {
    return createDefaultInput();
  }

  const normalized = normalizeInput(parsed);

  if (!isUsableInput(normalized)) {
    return createDefaultInput();
  }

  return normalized;
}

// =============================================================================
// FIELD EXTRACTION FUNCTIONS
// =============================================================================

/**
 * Extract tool name from hook input.
 *
 * Equivalent to bash: get_tool_name()
 *
 * @param input - Hook input object
 * @returns Tool name string (typed as ToolName)
 *
 * @example
 * ```typescript
 * const toolName = getToolName(input); // "Bash" | "Write" | "Edit" | ...
 * ```
 */
export function getToolName(input: HookInput): ToolName {
  return input.tool_name;
}

/**
 * Extract file path from tool input.
 *
 * Handles both 'file_path' and 'path' fields, as different tools use
 * different field names. Returns undefined if neither is present.
 *
 * Equivalent to bash: get_file_path()
 *
 * @param input - Hook input object
 * @returns File path string or undefined if not present
 *
 * @example
 * ```typescript
 * const filePath = getFilePath(input); // "/path/to/file.ts" | undefined
 * ```
 */
export function getFilePath(input: HookInput): string | undefined {
  const toolInput = input.tool_input;

  // Check file_path first (primary field name)
  if (typeof toolInput.file_path === 'string' && toolInput.file_path) {
    return toolInput.file_path;
  }

  // Fall back to path (alternative field name used by some tools)
  if (typeof toolInput.path === 'string' && toolInput.path) {
    return toolInput.path;
  }

  return undefined;
}

/**
 * Extract command from tool input (for Bash tool).
 *
 * Equivalent to bash: get_command()
 *
 * @param input - Hook input object
 * @returns Command string or undefined if not present
 *
 * @example
 * ```typescript
 * const command = getCommand(input); // "git status" | undefined
 * ```
 */
export function getCommand(input: HookInput): string | undefined {
  const toolInput = input.tool_input;

  if (typeof toolInput.command === 'string') {
    return toolInput.command;
  }

  return undefined;
}

/**
 * Strip CLI proxy prefixes (e.g., `rtk git ...` → `git ...`) so pattern
 * matching works regardless of whether a token-optimizing proxy is active.
 *
 * Known proxies: rtk (token-optimizing command proxy)
 *
 * @param command - Raw command string
 * @returns Command with proxy prefix stripped
 */
export function stripProxyPrefix(command: string): string {
  return command.replace(/^rtk\s+/, '');
}

/**
 * Extract session ID from hook input or environment.
 *
 * Falls back to CLAUDE_CODE_SESSION_ID (CC v2.1.132+), then CLAUDE_SESSION_ID
 * (older runtimes), if not in input.
 *
 * Equivalent to bash: get_session_id()
 *
 * @param input - Hook input object
 * @returns Session ID string or 'unknown' if not available
 *
 * @example
 * ```typescript
 * const sessionId = getSessionId(input); // "abc123" | "unknown"
 * ```
 */
export function getSessionId(input: HookInput): string {
  // Check input first
  if (typeof input.session_id === 'string' && input.session_id) {
    return input.session_id;
  }

  // Fall back to environment variable (prefer the newer CC v2.1.132+ name).
  const envSessionId = process.env['CLAUDE_CODE_SESSION_ID'] || process.env['CLAUDE_SESSION_ID'];
  if (envSessionId) {
    return envSessionId;
  }

  return 'unknown';
}

/**
 * Extract agent ID from hook input.
 *
 * Present only when the hook fires inside a subagent call.
 * Available since Claude Code v2.1.10.
 *
 * @param input - Hook input object
 * @returns Agent ID string or undefined if not in a subagent context
 */
export function getAgentId(input: HookInput): string | undefined {
  return input.agent_id;
}

/**
 * Extract agent type from hook input.
 *
 * Present when the session uses --agent or the hook fires inside a subagent.
 * Available since Claude Code v2.1.2.
 *
 * @param input - Hook input object
 * @returns Agent type string or undefined if not in an agent context
 */
export function getAgentType(input: HookInput): string | undefined {
  return input.agent_type;
}

/**
 * Extract worktree path from hook input.
 *
 * Present when the hook fires inside a git worktree.
 * Available since Claude Code v2.1.70.
 *
 * @param input - Hook input object
 * @returns Worktree path string or undefined if not in a worktree
 */
export function getWorktreePath(input: HookInput): string | undefined {
  return input.worktree_path;
}

/**
 * Extract worktree branch from hook input.
 *
 * Present when the hook fires inside a git worktree.
 * Available since Claude Code v2.1.70.
 *
 * @param input - Hook input object
 * @returns Worktree branch string or undefined if not in a worktree
 */
export function getWorktreeBranch(input: HookInput): string | undefined {
  return input.worktree_branch;
}

/**
 * Extract tool execution duration in milliseconds from hook input.
 *
 * Present in PostToolUse and PostToolUseFailure inputs only.
 * Available since Claude Code v2.1.119.
 *
 * @param input - Hook input object
 * @returns Duration in milliseconds, or undefined if not a Post* event or pre-v2.1.119 CC
 */
export function getDurationMs(input: HookInput): number | undefined {
  return input.duration_ms;
}

/**
 * Extract project directory from environment.
 *
 * Uses CLAUDE_PROJECT_DIR environment variable, falling back to the current
 * working directory (process.cwd()).
 *
 * @returns Project directory path
 *
 * @example
 * ```typescript
 * const projectDir = getProjectDir(); // "/path/to/project" | process.cwd()
 * ```
 */
export function getProjectDir(): string {
  return process.env['CLAUDE_PROJECT_DIR'] || process.cwd();
}

/**
 * Extract content from tool input (for Write tool).
 *
 * @param input - Hook input object
 * @returns Content string or undefined if not present
 */
export function getContent(input: HookInput): string | undefined {
  const toolInput = input.tool_input;

  if (typeof toolInput.content === 'string') {
    return toolInput.content;
  }

  return undefined;
}

/**
 * Extract pattern from tool input (for Grep/Glob tools).
 *
 * @param input - Hook input object
 * @returns Pattern string or undefined if not present
 */
export function getPattern(input: HookInput): string | undefined {
  const toolInput = input.tool_input;

  if (typeof toolInput.pattern === 'string') {
    return toolInput.pattern;
  }

  return undefined;
}

/**
 * Extract old_string from tool input (for Edit tool).
 *
 * @param input - Hook input object
 * @returns Old string or undefined if not present
 */
export function getOldString(input: HookInput): string | undefined {
  const toolInput = input.tool_input;

  if (typeof toolInput.old_string === 'string') {
    return toolInput.old_string;
  }

  return undefined;
}

/**
 * Extract new_string from tool input (for Edit tool).
 *
 * @param input - Hook input object
 * @returns New string or undefined if not present
 */
export function getNewString(input: HookInput): string | undefined {
  const toolInput = input.tool_input;

  if (typeof toolInput.new_string === 'string') {
    return toolInput.new_string;
  }

  return undefined;
}

/**
 * Get arbitrary field from tool input.
 *
 * Equivalent to bash: get_field()
 *
 * @param input - Hook input object
 * @param field - Field name to extract
 * @returns Field value or undefined if not present
 *
 * @example
 * ```typescript
 * const timeout = getField<number>(input, 'timeout');
 * const glob = getField<string>(input, 'glob');
 * ```
 */
export function getField<T = unknown>(
  input: HookInput,
  field: keyof ToolInput | string
): T | undefined {
  const toolInput = input.tool_input;
  const value = toolInput[field as keyof ToolInput];
  return value as T | undefined;
}

/**
 * Get the raw tool_input object for advanced use cases.
 *
 * @param input - Hook input object
 * @returns The tool input object
 */
export function getToolInput(input: HookInput): ToolInput {
  return input.tool_input;
}

// =============================================================================
// PROVIDER DETECTION
// =============================================================================

/**
 * Provider information for debugging and conditional behavior.
 */
export interface ProviderInfo {
  provider: 'bedrock' | 'anthropic' | 'vertex' | 'foundry';
  model: string | null;
  /** Override model for Sonnet tier (ANTHROPIC_DEFAULT_SONNET_MODEL) */
  defaultSonnetModel: string | null;
  /** Override model for Opus tier (ANTHROPIC_DEFAULT_OPUS_MODEL) */
  defaultOpusModel: string | null;
  /** Override model for Haiku tier (ANTHROPIC_DEFAULT_HAIKU_MODEL) */
  defaultHaikuModel: string | null;
}

/**
 * Detect whether the current session is using Bedrock or Anthropic subscription.
 *
 * Uses the `CLAUDE_CODE_USE_BEDROCK` environment variable set by Bedrock users.
 * Also captures `ANTHROPIC_MODEL` if set (common in Bedrock configurations).
 *
 * @returns Provider info with type and optional model name
 *
 * @example
 * ```typescript
 * const { provider } = getProviderInfo();
 * logDebug('hook', `Provider: ${provider}`);
 * ```
 */
export function getProviderInfo(): ProviderInfo {
  const defaultSonnetModel = process.env['ANTHROPIC_DEFAULT_SONNET_MODEL'] || null;
  const defaultOpusModel = process.env['ANTHROPIC_DEFAULT_OPUS_MODEL'] || null;
  const defaultHaikuModel = process.env['ANTHROPIC_DEFAULT_HAIKU_MODEL'] || null;
  const model = process.env['ANTHROPIC_MODEL'] || null;

  if (process.env['CLAUDE_CODE_USE_BEDROCK'] === '1') {
    return { provider: 'bedrock', model, defaultSonnetModel, defaultOpusModel, defaultHaikuModel };
  }
  if (process.env['CLAUDE_CODE_USE_VERTEX'] === '1') {
    return { provider: 'vertex', model, defaultSonnetModel, defaultOpusModel, defaultHaikuModel };
  }
  if (process.env['CLAUDE_CODE_USE_AZURE'] === '1') {
    return { provider: 'foundry', model, defaultSonnetModel, defaultOpusModel, defaultHaikuModel };
  }
  return {
    provider: 'anthropic',
    model: null,
    defaultSonnetModel,
    defaultOpusModel,
    defaultHaikuModel,
  };
}
