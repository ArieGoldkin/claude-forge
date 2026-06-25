import * as fs from 'fs';
import { readSync, existsSync, mkdirSync, readdirSync, rmdirSync } from 'fs';
import * as path from 'path';
import { basename, dirname, join } from 'path';
import { homedir } from 'os';

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
  return pluginDataDir ? path.join(pluginDataDir, "logs") : path.join(process.env["HOME"] || "/tmp", ".claude", "logs", PLUGIN_NAME);
}
var cachedLogDir = null;
function resolveLogDir() {
  if (cachedLogDir === null) {
    cachedLogDir = computeLogDir();
  }
  return cachedLogDir;
}
function resolveHookLogFile() {
  return path.join(resolveLogDir(), "hooks.log");
}
function resolvePermissionLogFile() {
  return path.join(resolveLogDir(), "permission-feedback.log");
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
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    logDirCreated = true;
  } catch {
  }
}
function getFileSize(filePath) {
  try {
    const stats = fs.statSync(filePath);
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
      fs.renameSync(logFile, rotatedFile);
    }
  } catch {
  }
}
function getTimestamp() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function writeLogLine(logFile, line) {
  try {
    fs.appendFileSync(logFile, `${line}
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
var HOOK_NAME = "continuity-recommendation";
var CONTINUITY_NAMES = ["ctk", "continuity-toolkit"];
function isContinuityInstalled() {
  const pluginRoot = process.env["CLAUDE_PLUGIN_ROOT"];
  if (!pluginRoot) {
    logDebug(HOOK_NAME, "CLAUDE_PLUGIN_ROOT not set, skipping check");
    return true;
  }
  const currentPluginName = basename(pluginRoot);
  if (CONTINUITY_NAMES.includes(currentPluginName)) {
    return true;
  }
  const marketplaceDir = dirname(dirname(pluginRoot));
  for (const name of CONTINUITY_NAMES) {
    const marketplacePath = join(marketplaceDir, name);
    if (existsSync(marketplacePath)) {
      logDebug(HOOK_NAME, `Found continuity plugin at ${marketplacePath}`);
      return true;
    }
  }
  const parentDir = dirname(pluginRoot);
  for (const name of CONTINUITY_NAMES) {
    const siblingPath = join(parentDir, name);
    if (existsSync(siblingPath)) {
      logDebug(HOOK_NAME, `Found continuity plugin at ${siblingPath}`);
      return true;
    }
  }
  logDebug(HOOK_NAME, `continuity plugin (ctk) not found at ${marketplaceDir} or ${parentDir}`);
  return false;
}
function claimRecommendationMarker() {
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const claudeDir = join(homedir(), ".claude");
  const markerDir = join(claudeDir, `.continuity-rec-${today}`);
  try {
    mkdirSync(claudeDir, { recursive: true });
    mkdirSync(markerDir, { recursive: false });
    logDebug(HOOK_NAME, `Claimed recommendation marker: ${markerDir}`);
    return true;
  } catch (err) {
    const code = err.code;
    if (code === "EEXIST") {
      logDebug(HOOK_NAME, "Recommendation already shown by another plugin");
    } else {
      logDebug(HOOK_NAME, `Failed to create marker: ${code}`);
    }
    return false;
  }
}
function cleanStaleMarkers() {
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const claudeDir = join(homedir(), ".claude");
  try {
    const entries = readdirSync(claudeDir);
    for (const entry of entries) {
      if (entry.startsWith(".continuity-rec-") && !entry.endsWith(today)) {
        try {
          rmdirSync(join(claudeDir, entry));
        } catch {
        }
      }
    }
  } catch {
  }
}
async function continuityRecommendation(_input) {
  if (isContinuityInstalled()) {
    return outputSilentSuccess();
  }
  if (!claimRecommendationMarker()) {
    return outputSilentSuccess();
  }
  cleanStaleMarkers();
  const message = "\u{1F4A1} For full hook coverage (security guardrails, auto-permissions, context monitoring, session persistence), install ctk (continuity toolkit) alongside your other plugins: `/plugin install ctk@claude-forge`. For lighter-weight context restoration without ctk, CC v2.1.108+ has built-in /recap.";
  logDebug(HOOK_NAME, "ctk (continuity plugin) not detected, showing recommendation");
  return outputSuccess(message);
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
registerHook(
  "lifecycle/continuity-recommendation",
  "Recommend installing ctk for full hook coverage",
  continuityRecommendation
);

export { clearHooks, createLogger, createScopedLogger, getCommand, getContent, getCurrentLogLevel, getField, getFilePath, getHook, getHookEnvironment, getHookLogPath, getLogDir, getNewString, getOldString, getPattern, getPermissionLogPath, getProjectDir, getProviderInfo, getSessionId, getToolInput, getToolName, hasHook, isBashToolInput, isFileToolInput, isUserPromptInput, listHooks, logDebug, logError, logInfo, logPermission, logPermissionEntry, logWarn, outputAllow, outputAllowWithContext, outputAsk, outputDeny, outputPromptContext, outputSilentSuccess, outputStderrWarning, outputSuccess, outputWarning, outputWithContext, outputWithNotification, parseHookInput, readHookInput, readHookInputAsync, registerHook, resetLogLevel, unregisterHook };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map