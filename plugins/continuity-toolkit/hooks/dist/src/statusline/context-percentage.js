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
var FALLBACK_STATUS = "[?] \u{1F4C1} unknown\n\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591 --% | $0.00 | \u23F1\uFE0F 0m";
var ANSI = {
  RESET: "\x1B[0m",
  CYAN: "\x1B[36m",
  GREEN: "\x1B[32m",
  YELLOW: "\x1B[33m",
  RED: "\x1B[31m"
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
  const rateLimits = data["rate_limits"];
  if (!rateLimits) return { fiveHourPct: null, sevenDayPct: null };
  const readWindow = (key) => {
    const win = rateLimits[key];
    if (!win) return null;
    const used = win["used_percentage"];
    if (typeof used !== "number" || Number.isNaN(used)) return null;
    return Math.round(used);
  };
  return {
    fiveHourPct: readWindow("five_hour"),
    sevenDayPct: readWindow("seven_day")
  };
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
function formatLine1(modelName, workspaceName, gitBranch, worktreePath = "") {
  const model = `${ANSI.CYAN}[${modelName}]${ANSI.RESET}`;
  let line = `${model} \u{1F4C1} ${workspaceName}`;
  if (gitBranch) {
    line += ` | \u{1F33F} ${gitBranch}`;
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
function formatLine3(fiveHourPct, sevenDayPct) {
  const segments = [];
  if (fiveHourPct !== null) {
    segments.push(
      `session: ${getBarColor(fiveHourPct)}${buildProgressBar(fiveHourPct)}${ANSI.RESET} ${fiveHourPct}%`
    );
  }
  if (sevenDayPct !== null) {
    segments.push(
      `weekly: ${getBarColor(sevenDayPct)}${buildProgressBar(sevenDayPct)}${ANSI.RESET} ${sevenDayPct}%`
    );
  }
  return segments.join(" \xB7 ");
}
function formatStatusLine(pct, modelName, workspaceName, gitBranch, costUsd, durationMs, worktreePath = "", fiveHourPct = null, sevenDayPct = null) {
  const line1 = formatLine1(modelName, workspaceName, gitBranch, worktreePath);
  const line2 = formatLine2(pct, costUsd, durationMs);
  const line3 = formatLine3(fiveHourPct, sevenDayPct);
  return line3 ? `${line1}
${line2}
${line3}` : `${line1}
${line2}`;
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
    branch = execSync("git branch --show-current", {
      timeout: 2e3,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "";
  }
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
  const raw = readStdinSync();
  if (!raw) {
    process.stdout.write(`${FALLBACK_STATUS}
`);
    return;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    process.stdout.write(`${FALLBACK_STATUS}
`);
    return;
  }
  const contextWindow = data["context_window"];
  if (!contextWindow) {
    process.stdout.write(`${FALLBACK_STATUS}
`);
    return;
  }
  const usedPercentage = contextWindow["used_percentage"];
  if (typeof usedPercentage !== "number" || Number.isNaN(usedPercentage)) {
    process.stdout.write(`${FALLBACK_STATUS}
`);
    return;
  }
  const pct = Math.round(usedPercentage);
  const modelName = extractModelName(data);
  const workspaceName = extractWorkspaceName(data);
  const { costUsd, durationMs } = extractCost(data);
  const { fiveHourPct, sevenDayPct } = extractRateLimits(data);
  const gitBranch = getGitBranch();
  const worktreePath = extractWorktreePath(data);
  const sessionId = process.env["CLAUDE_SESSION_ID"] || "default";
  const tmpDir = tmpdir();
  const targetFile = join(tmpDir, `${TEMP_PREFIX}${sessionId}.txt`);
  const tmpFile = `${targetFile}.tmp`;
  try {
    writeFileSync(tmpFile, String(pct), "utf8");
    renameSync(tmpFile, targetFile);
  } catch {
  }
  process.stdout.write(
    `${formatStatusLine(pct, modelName, workspaceName, gitBranch, costUsd, durationMs, worktreePath, fiveHourPct, sevenDayPct)}
`
  );
}
if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  main();
}

export { ANSI, buildProgressBar, extractCost, extractModelName, extractRateLimits, extractWorkspaceName, extractWorktreePath, formatCost, formatDuration, formatLine1, formatLine2, formatLine3, formatStatusLine, getBarColor, getContextEmoji, getGitBranch };
//# sourceMappingURL=context-percentage.js.map
//# sourceMappingURL=context-percentage.js.map