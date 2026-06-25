#!/usr/bin/env node
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
var HOOK_LOG_MAX_SIZE = 204800;
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
registerHook(
  "lifecycle/continuity-recommendation",
  "Recommend installing ctk for full hook coverage",
  continuityRecommendation
);

// bin/run-hook.ts
process.on("uncaughtException", (error) => {
  try {
    process.stderr.write(`[frontend-toolkit-hooks] Uncaught: ${error.message}
`);
  } catch {
  }
  try {
    process.stdout.write('{"continue":true,"suppressOutput":true}\n');
  } catch {
  }
  process.exit(0);
});
process.on("unhandledRejection", (reason) => {
  try {
    const msg = reason instanceof Error ? reason.message : String(reason);
    process.stderr.write(`[frontend-toolkit-hooks] Unhandled: ${msg}
`);
  } catch {
  }
  try {
    process.stdout.write('{"continue":true,"suppressOutput":true}\n');
  } catch {
  }
  process.exit(0);
});
function outputResult(result) {
  try {
    console.log(JSON.stringify(result));
  } catch {
    console.log('{"continue":true,"suppressOutput":true}');
  }
}
function silentSuccess() {
  return {
    continue: true,
    suppressOutput: true
  };
}
function isHookDisabled(hookName) {
  const projectDir = process.env["CLAUDE_PROJECT_DIR"];
  if (!projectDir) return false;
  const overridesPath = path.join(projectDir, ".claude", "hook-overrides.json");
  try {
    const content = fs.readFileSync(overridesPath, "utf-8");
    const parsed = JSON.parse(content);
    if (parsed && Array.isArray(parsed.disabled)) {
      return parsed.disabled.includes(hookName);
    }
  } catch {
  }
  return false;
}
async function main() {
  const hookName = process.argv[2];
  if (!hookName) {
    console.error("Usage: run-hook.ts <hook-name>");
    console.error("");
    console.error("Available hooks can be listed by importing listHooks() from the module.");
    process.exit(1);
  }
  const hook = getHook(hookName);
  if (!hook) {
    outputResult(silentSuccess());
    process.exit(0);
  }
  if (isHookDisabled(hookName)) {
    outputResult(silentSuccess());
    process.exit(0);
  }
  try {
    const input = readHookInput();
    const result = await hook.handler(input);
    outputResult(result);
    process.exit(result.continue ? 0 : 1);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[frontend-toolkit-hooks] Error in ${hookName}: ${message}`);
    outputResult(silentSuccess());
    process.exit(0);
  }
}
var isMainModule = typeof process.argv[1] === "string" && (process.argv[1].endsWith("run-hook.js") || process.argv[1].endsWith("run-hook.ts"));
if (isMainModule) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[frontend-toolkit-hooks] Fatal error: ${message}`);
    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
    process.exit(0);
  });
}

export { isHookDisabled };
//# sourceMappingURL=run-hook.js.map
//# sourceMappingURL=run-hook.js.map