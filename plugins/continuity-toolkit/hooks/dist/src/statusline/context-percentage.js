#!/usr/bin/env node
import { execSync } from 'child_process';
import { writeFileSync, renameSync, readSync, existsSync, statSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { resolve, join, basename } from 'path';
import { fileURLToPath } from 'url';

var TEMP_PREFIX = "claude-context-pct-";
var FILLED_CHAR = "\u2588";
var EMPTY_CHAR = "\u2591";
var DEFAULT_BAR_WIDTH = 10;
var GIT_CACHE_STALE_MS = 5e3;
var MAX_PLAUSIBLE_RESET_MS = 8 * 24 * 60 * 60 * 1e3;
var FALLBACK_STATUS = "[?] \u{1F4C1} unknown\n\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591 --% | $0.00 | \u23F1\uFE0F 0m";
var ANSI = {
  RESET: "\x1B[0m",
  CYAN: "\x1B[36m",
  GREEN: "\x1B[32m",
  YELLOW: "\x1B[33m",
  RED: "\x1B[31m",
  MAGENTA: "\x1B[35m",
  DIM: "\x1B[2m"
};
function getContextEmoji(pct) {
  if (pct < 25) return "\u2728";
  if (pct < 50) return "\u{1F44D}";
  if (pct < 70) return "\u26A1";
  return "\u{1F525}";
}
function buildProgressBar(pct, width = DEFAULT_BAR_WIDTH) {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round(clamped / 100 * width);
  return FILLED_CHAR.repeat(filled) + EMPTY_CHAR.repeat(width - filled);
}
function getBarColor(pct) {
  if (pct >= 90) return ANSI.RED;
  if (pct >= 70) return ANSI.YELLOW;
  return ANSI.GREEN;
}
function formatCost(costUsd) {
  if (costUsd >= 10) return `$${Math.round(costUsd).toLocaleString("en-US")}`;
  return `$${costUsd.toFixed(2)}`;
}
function formatDuration(durationMs) {
  const totalMinutes = Math.floor(durationMs / 6e4);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
function extractWorkspaceName(data) {
  const workspace = data["workspace"];
  if (workspace) {
    const currentDir = workspace["current_dir"];
    if (typeof currentDir === "string" && currentDir.length > 0) {
      return basename(currentDir);
    }
  }
  return basename(process.cwd());
}
function extractWorktreePath(data) {
  const workspace = data["workspace"];
  if (workspace) {
    const worktree = workspace["git_worktree"];
    if (typeof worktree === "string" && worktree.length > 0) {
      return worktree;
    }
  }
  return "";
}
function extractCost(data) {
  const cost = data["cost"];
  if (!cost) return { costUsd: 0, durationMs: 0 };
  const totalCost = cost["total_cost_usd"];
  const totalDuration = cost["total_duration_ms"];
  const costUsd = typeof totalCost === "number" && !Number.isNaN(totalCost) ? totalCost : 0;
  const durationMs = typeof totalDuration === "number" && !Number.isNaN(totalDuration) ? totalDuration : 0;
  return { costUsd, durationMs };
}
function extractRateLimits(data) {
  const empty = {
    fiveHourPct: null,
    sevenDayPct: null,
    fiveHourResetsAt: null,
    sevenDayResetsAt: null
  };
  const rateLimits = data["rate_limits"];
  if (!rateLimits) return empty;
  const readWindow = (key) => {
    const win = rateLimits[key];
    if (!win) return null;
    const used = win["used_percentage"];
    if (typeof used !== "number" || Number.isNaN(used)) return null;
    return Math.round(used);
  };
  const readReset = (key) => {
    const win = rateLimits[key];
    if (!win) return null;
    const at = win["resets_at"];
    if (typeof at !== "number" || Number.isNaN(at) || at <= 0) return null;
    return at;
  };
  return {
    fiveHourPct: readWindow("five_hour"),
    sevenDayPct: readWindow("seven_day"),
    fiveHourResetsAt: readReset("five_hour"),
    sevenDayResetsAt: readReset("seven_day")
  };
}
function extractEffort(data) {
  const effort = data["effort"];
  const level = effort && typeof effort["level"] === "string" ? effort["level"] : null;
  const thinkingObj = data["thinking"];
  const thinking = thinkingObj?.["enabled"] === true;
  return { level, fastMode: data["fast_mode"] === true, thinking };
}
function extractTokenUsage(data) {
  const cw = data["context_window"];
  if (!cw) return null;
  const num = (v) => typeof v === "number" && !Number.isNaN(v) ? v : 0;
  const usage = cw["current_usage"];
  return {
    totalInput: num(cw["total_input_tokens"]),
    totalOutput: num(cw["total_output_tokens"]),
    cacheRead: num(usage?.["cache_read_input_tokens"]),
    windowSize: num(cw["context_window_size"])
  };
}
function extractPr(data) {
  const pr = data["pr"];
  if (!pr) return null;
  const num = pr["number"];
  if (typeof num !== "number" || Number.isNaN(num)) return null;
  const state = pr["review_state"];
  return { number: num, reviewState: typeof state === "string" && state ? state : null };
}
function extractSessionId(data) {
  const id = data["session_id"];
  if (typeof id === "string" && id.length > 0) return id;
  return process.env["CLAUDE_SESSION_ID"] || "default";
}
function extractModelName(data) {
  const model = data["model"];
  if (!model) return "?";
  const displayName = model["display_name"];
  if (typeof displayName === "string" && displayName.length > 0) return displayName;
  const id = model["id"];
  if (typeof id === "string" && id.length > 0) return id;
  return "?";
}
function formatEffortBadge(level, fastMode, thinking) {
  if (fastMode) return "\u26A1 fast";
  if (!level) return "";
  return thinking ? `\u25D0 ${level}` : level;
}
function formatResetIn(resetsAtSec, nowMs = Date.now()) {
  if (resetsAtSec === null) return "";
  const remainingMs = resetsAtSec * 1e3 - nowMs;
  if (remainingMs <= 0) return "";
  if (remainingMs > MAX_PLAUSIBLE_RESET_MS) return "";
  const totalMinutes = Math.floor(remainingMs / 6e4);
  const days = Math.floor(totalMinutes / 1440);
  if (days > 0) {
    const hours2 = Math.floor(totalMinutes % 1440 / 60);
    return `resets in ${days}d ${hours2}h`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `resets in ${hours}h ${minutes}m`;
  return `resets in ${minutes}m`;
}
function formatTokenCount(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
}
function formatPrSegment(pr) {
  if (!pr) return "";
  const base = `PR #${pr.number}`;
  return pr.reviewState ? `${base} ${pr.reviewState}` : base;
}
function formatLine1(modelName, workspaceName, gitBranch, worktreePath = "", effortBadge = "", prSegment = "") {
  const label = effortBadge ? `${modelName} ${effortBadge}` : modelName;
  const model = `${ANSI.CYAN}[${label}]${ANSI.RESET}`;
  let line = `${model} \u{1F4C1} ${workspaceName}`;
  if (gitBranch) {
    line += ` | \u{1F33F} ${gitBranch}`;
  }
  if (prSegment) {
    line += ` | ${ANSI.MAGENTA}${prSegment}${ANSI.RESET}`;
  }
  if (worktreePath) {
    line += ` | \u{1F333} wt:${basename(worktreePath)}`;
  }
  return line;
}
function formatLine2(pct, costUsd, durationMs) {
  const color = getBarColor(pct);
  const bar = buildProgressBar(pct);
  const emoji = getContextEmoji(pct);
  const cost = formatCost(costUsd);
  const duration = formatDuration(durationMs);
  return `${color}${bar}${ANSI.RESET} ${pct}% ${emoji} | ${ANSI.YELLOW}${cost}${ANSI.RESET} | \u23F1\uFE0F ${duration}`;
}
function formatLine3(fiveHourPct, sevenDayPct, fiveHourResetsAt = null, sevenDayResetsAt = null, nowMs = Date.now()) {
  const segments = [];
  const withReset = (label, pct, resetsAt) => {
    const bar = `${getBarColor(pct)}${buildProgressBar(pct)}${ANSI.RESET}`;
    const reset = formatResetIn(resetsAt, nowMs);
    const suffix = reset ? ` ${ANSI.DIM}(${reset})${ANSI.RESET}` : "";
    return `${label}: ${bar} ${pct}%${suffix}`;
  };
  if (fiveHourPct !== null) {
    segments.push(withReset("session", fiveHourPct, fiveHourResetsAt));
  }
  if (sevenDayPct !== null) {
    segments.push(withReset("weekly", sevenDayPct, sevenDayResetsAt));
  }
  return segments.join(" \xB7 ");
}
function formatLine4(usage) {
  if (!usage) return "";
  if (usage.totalInput === 0 && usage.totalOutput === 0 && usage.cacheRead === 0) return "";
  const parts = [
    `${formatTokenCount(usage.totalInput)} in`,
    `${formatTokenCount(usage.totalOutput)} out`
  ];
  if (usage.cacheRead > 0) {
    parts.push(`${formatTokenCount(usage.cacheRead)} cached`);
  }
  return `${ANSI.DIM}tokens: ${parts.join(" \xB7 ")}${ANSI.RESET}`;
}
function formatStatusLine(pct, modelName, workspaceName, gitBranch, costUsd, durationMs, worktreePath = "", fiveHourPct = null, sevenDayPct = null, extras = {}) {
  const line1 = formatLine1(
    modelName,
    workspaceName,
    gitBranch,
    worktreePath,
    extras.effortBadge ?? "",
    extras.prSegment ?? ""
  );
  const line2 = formatLine2(pct, costUsd, durationMs);
  if (extras.compact) return `${line1}
${line2}`;
  const line3 = formatLine3(
    fiveHourPct,
    sevenDayPct,
    extras.fiveHourResetsAt ?? null,
    extras.sevenDayResetsAt ?? null,
    extras.nowMs ?? Date.now()
  );
  const line4 = formatLine4(extras.tokens ?? null);
  return [line1, line2, line3, line4].filter(Boolean).join("\n");
}
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    hash = (hash << 5) - hash + ch | 0;
  }
  return Math.abs(hash).toString(36);
}
function getGitBranch() {
  const cwd = process.cwd();
  const cacheFile = join(tmpdir(), `statusline-git-cache-${hashString(cwd)}.json`);
  try {
    if (existsSync(cacheFile)) {
      const stat = statSync(cacheFile);
      const ageMs = Date.now() - stat.mtimeMs;
      if (ageMs < GIT_CACHE_STALE_MS) {
        const cached = JSON.parse(readFileSync(cacheFile, "utf8"));
        if (typeof cached.branch === "string") return cached.branch;
      }
    }
  } catch {
  }
  let branch = "";
  try {
    branch = execSync("git rev-parse --abbrev-ref HEAD", {
      timeout: 2e3,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "";
  }
  if (branch === "HEAD") return "";
  try {
    const tmpFile = `${cacheFile}.tmp`;
    writeFileSync(tmpFile, JSON.stringify({ branch }), "utf8");
    renameSync(tmpFile, cacheFile);
  } catch {
  }
  return branch;
}
function readStdinSync() {
  try {
    const chunks = [];
    const BUFSIZE = 256;
    const buf = Buffer.allocUnsafe(BUFSIZE);
    const fd = 0;
    while (true) {
      try {
        const bytesRead = readSync(fd, buf, 0, BUFSIZE, null);
        if (bytesRead === 0) break;
        chunks.push(Buffer.from(buf.subarray(0, bytesRead)));
      } catch {
        break;
      }
    }
    return Buffer.concat(chunks).toString("utf8").trim();
  } catch {
    return "";
  }
}
function main() {
  const silent = process.env["CONTINUITY_STATUSLINE_SILENT"] === "1";
  const emit = (text) => {
    if (!silent) process.stdout.write(text);
  };
  const raw = readStdinSync();
  if (!raw) {
    emit(`${FALLBACK_STATUS}
`);
    return;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    emit(`${FALLBACK_STATUS}
`);
    return;
  }
  const contextWindow = data["context_window"];
  if (!contextWindow) {
    emit(`${FALLBACK_STATUS}
`);
    return;
  }
  const usedPercentage = contextWindow["used_percentage"];
  if (typeof usedPercentage !== "number" || Number.isNaN(usedPercentage)) {
    emit(`${FALLBACK_STATUS}
`);
    return;
  }
  const pct = Math.round(usedPercentage);
  const modelName = extractModelName(data);
  const workspaceName = extractWorkspaceName(data);
  const { costUsd, durationMs } = extractCost(data);
  const { fiveHourPct, sevenDayPct, fiveHourResetsAt, sevenDayResetsAt } = extractRateLimits(data);
  const gitBranch = getGitBranch();
  const worktreePath = extractWorktreePath(data);
  const { level, fastMode, thinking } = extractEffort(data);
  const extras = {
    effortBadge: formatEffortBadge(level, fastMode, thinking),
    prSegment: formatPrSegment(extractPr(data)),
    fiveHourResetsAt,
    sevenDayResetsAt,
    tokens: extractTokenUsage(data),
    compact: process.env["CONTINUITY_STATUSLINE_COMPACT"] === "1"
  };
  const sessionId = extractSessionId(data);
  const tmpDir = tmpdir();
  const targetFile = join(tmpDir, `${TEMP_PREFIX}${sessionId}.txt`);
  const tmpFile = `${targetFile}.tmp`;
  try {
    writeFileSync(tmpFile, String(pct), "utf8");
    renameSync(tmpFile, targetFile);
  } catch {
  }
  emit(
    `${formatStatusLine(pct, modelName, workspaceName, gitBranch, costUsd, durationMs, worktreePath, fiveHourPct, sevenDayPct, extras)}
`
  );
}
if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  main();
}

export { ANSI, buildProgressBar, extractCost, extractEffort, extractModelName, extractPr, extractRateLimits, extractSessionId, extractTokenUsage, extractWorkspaceName, extractWorktreePath, formatCost, formatDuration, formatEffortBadge, formatLine1, formatLine2, formatLine3, formatLine4, formatPrSegment, formatResetIn, formatStatusLine, formatTokenCount, getBarColor, getContextEmoji, getGitBranch };
//# sourceMappingURL=context-percentage.js.map
//# sourceMappingURL=context-percentage.js.map