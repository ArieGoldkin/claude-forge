#!/usr/bin/env node
import * as fs2 from 'fs';
import * as os from 'os';
import * as path2 from 'path';

// src/lib/hook-outage-detector.ts
var HOOKED_TOOLS = /* @__PURE__ */ new Set(["Bash", "Write", "Edit", "MultiEdit"]);
var DEFAULT_MIN_TOOLS = 5;
var DEFAULT_ALPHA = 0.01;
function hourOf(timestamp) {
  if (typeof timestamp !== "string") return null;
  return /^\d{4}-\d{2}-\d{2}T\d{2}/.test(timestamp) ? timestamp.slice(0, 13) : null;
}
function hookHoursFromLines(lines) {
  const out = /* @__PURE__ */ new Map();
  for (const line of lines) {
    const h = hourOf(line);
    if (h) out.set(h, (out.get(h) ?? 0) + 1);
  }
  return out;
}
function toolHoursFromRecords(records) {
  const hooked = /* @__PURE__ */ new Map();
  const all = /* @__PURE__ */ new Map();
  const sessions = /* @__PURE__ */ new Map();
  const names = /* @__PURE__ */ new Map();
  for (const raw of records) {
    if (!raw || typeof raw !== "object") continue;
    const rec = raw;
    const h = hourOf(rec["timestamp"]);
    if (!h) continue;
    const msg = rec["message"];
    const content = msg && typeof msg === "object" ? msg["content"] : null;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const b = block;
      if (b["type"] !== "tool_use") continue;
      const name = typeof b["name"] === "string" ? b["name"] : "?";
      all.set(h, (all.get(h) ?? 0) + 1);
      let hist = names.get(h);
      if (!hist) {
        hist = /* @__PURE__ */ new Map();
        names.set(h, hist);
      }
      hist.set(name, (hist.get(name) ?? 0) + 1);
      if (HOOKED_TOOLS.has(name)) {
        hooked.set(h, (hooked.get(h) ?? 0) + 1);
        const sid = rec["sessionId"];
        if (typeof sid === "string" && sid) {
          let set = sessions.get(h);
          if (!set) {
            set = /* @__PURE__ */ new Set();
            sessions.set(h, set);
          }
          set.add(sid.slice(0, 8));
        }
      }
    }
  }
  return { hooked, all, sessions, names };
}
function detectOutages(hookHours, activity, opts = {}) {
  const minTools = opts.minTools ?? DEFAULT_MIN_TOOLS;
  const alpha = opts.alpha ?? DEFAULT_ALPHA;
  const covered = [...hookHours.keys()].sort();
  if (covered.length === 0) {
    return { outages: [], hoursAnalysed: 0, coverage: null, baseRate: 0, rejectedAsChance: 0 };
  }
  const from = covered[0];
  const toolHoursSorted = [...activity.hooked.keys()].sort();
  const lastLogged = covered[covered.length - 1];
  const lastTool = toolHoursSorted[toolHoursSorted.length - 1];
  const to = lastTool && lastTool > lastLogged ? lastTool : lastLogged;
  const inWindow = (h) => h >= from && h < to;
  const analysed = [];
  let totalTools = 0;
  let totalLines = 0;
  for (const hour of toolHoursSorted) {
    if (!inWindow(hour)) continue;
    analysed.push(hour);
    totalTools += activity.hooked.get(hour) ?? 0;
    totalLines += hookHours.get(hour) ?? 0;
  }
  const hoursAnalysed = analysed.length;
  const measured = totalTools > 0 ? totalLines / totalTools : 0;
  const baseRate = Math.min(0.99, Math.max(0.01, opts.baseRate ?? measured));
  const outages = [];
  let rejectedAsChance = 0;
  for (const hour of analysed) {
    if ((hookHours.get(hour) ?? 0) > 0) continue;
    const hookedTools = activity.hooked.get(hour) ?? 0;
    if (hookedTools < minTools) continue;
    const pValue = (1 - baseRate) ** hookedTools;
    const expectedByChance = pValue * Math.max(hoursAnalysed, 1);
    if (expectedByChance >= alpha) {
      rejectedAsChance++;
      continue;
    }
    outages.push({
      hour,
      hookedTools,
      allTools: activity.all.get(hour) ?? 0,
      sessions: [...activity.sessions.get(hour) ?? []].sort(),
      tools: [...activity.names.get(hour) ?? /* @__PURE__ */ new Map()].sort((a, b) => b[1] - a[1]),
      pValue,
      expectedByChance
    });
  }
  return { outages, hoursAnalysed, coverage: { from, to }, baseRate, rejectedAsChance };
}
function groupWindows(outages) {
  const windows = [];
  for (const o of outages) {
    const last = windows[windows.length - 1];
    if (last && nextHour(last.end) === o.hour) {
      last.end = o.hour;
      last.hours++;
    } else {
      windows.push({ start: o.hour, end: o.hour, hours: 1 });
    }
  }
  return windows;
}
function nextHour(hour) {
  const d = /* @__PURE__ */ new Date(`${hour}:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return "";
  d.setUTCHours(d.getUTCHours() + 1);
  return d.toISOString().slice(0, 13);
}
var DEFAULT_MAX_DEPTH = 4;
var MAX_ENTRIES = 5e3;
var STATE_FILES = [
  "installed_plugins.json",
  "known_marketplaces.json",
  "plugin-catalog-cache.json",
  ".last_inuse_sweep"
];
function capturePluginState(pluginsRoot, opts = {}) {
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxEntries = opts.maxEntries ?? MAX_ENTRIES;
  const dirs = {};
  const files = {};
  let truncated = false;
  let dirCount = 0;
  const excluded = opts.snapshotDir ? path2.resolve(opts.snapshotDir) : null;
  const walk = (abs, rel, depth) => {
    if (truncated) return;
    if (excluded && path2.resolve(abs) === excluded) return;
    let entries;
    try {
      entries = fs2.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    try {
      dirs[rel || "."] = { m: Math.round(fs2.statSync(abs).mtimeMs), n: entries.length };
    } catch {
      return;
    }
    dirCount++;
    if (dirCount >= maxEntries) {
      truncated = true;
      return;
    }
    if (depth >= maxDepth) return;
    for (const e of entries) {
      if (e.isDirectory())
        walk(path2.join(abs, e.name), rel ? `${rel}/${e.name}` : e.name, depth + 1);
    }
  };
  walk(pluginsRoot, "", 0);
  for (const name of STATE_FILES) {
    const p = path2.join(pluginsRoot, name);
    try {
      const st = fs2.statSync(p);
      const entry = { size: st.size, m: Math.round(st.mtimeMs) };
      if (st.size <= 64 * 1024) entry.content = fs2.readFileSync(p, "utf8");
      files[name] = entry;
    } catch {
    }
  }
  return {
    version: 1,
    capturedAt: opts.capturedAt ?? (/* @__PURE__ */ new Date()).toISOString(),
    sessionId: opts.sessionId ?? "unknown",
    dirs,
    files,
    truncated
  };
}
function diffSnapshots(before, after) {
  const b = before.dirs;
  const a = after.dirs;
  const dirsAdded = Object.keys(a).filter((k) => !(k in b)).sort();
  const dirsRemoved = Object.keys(b).filter((k) => !(k in a)).sort();
  const dirsTouched = Object.keys(a).filter((k) => k in b && (b[k]?.m !== a[k]?.m || b[k]?.n !== a[k]?.n)).sort();
  const names = /* @__PURE__ */ new Set([...Object.keys(before.files), ...Object.keys(after.files)]);
  const filesChanged = [...names].filter((n) => {
    const x = before.files[n];
    const y = after.files[n];
    if (!x || !y) return true;
    return x.size !== y.size || x.m !== y.m;
  }).sort();
  return {
    dirsAdded,
    dirsRemoved,
    dirsTouched,
    filesChanged,
    identical: dirsAdded.length === 0 && dirsRemoved.length === 0 && dirsTouched.length === 0 && filesChanged.length === 0
  };
}
function resolvePluginStateDir(configDir, env = process.env) {
  const explicit = env["CLAUDE_PLUGIN_DATA"];
  if (explicit) return { dir: path2.join(explicit, "plugin-state"), legacy: false };
  const dataRoot = path2.join(configDir, "plugins", "data");
  let candidates = [];
  try {
    candidates = fs2.readdirSync(dataRoot).sort().filter((n) => n.startsWith("ctk-") || n.startsWith("continuity")).map((n) => path2.join(dataRoot, n));
  } catch {
    candidates = [];
  }
  const populated = candidates.find((c) => {
    try {
      return fs2.readdirSync(path2.join(c, "plugin-state")).some((f) => f.endsWith(".json"));
    } catch {
      return false;
    }
  });
  const chosen = populated ?? candidates[candidates.length - 1];
  if (chosen) return { dir: path2.join(chosen, "plugin-state"), legacy: false };
  return { dir: path2.join(configDir, "logs", "continuity", "plugin-state"), legacy: true };
}

// bin/detect-hook-outages.ts
function resolveLogDir(configDir) {
  const fromEnv = process.env["CLAUDE_PLUGIN_DATA"];
  if (fromEnv) {
    const d = path2.join(fromEnv, "logs");
    if (fs2.existsSync(d)) return { dirs: [d], legacy: false };
  }
  const dataRoot = path2.join(configDir, "plugins", "data");
  if (fs2.existsSync(dataRoot)) {
    const candidates = fs2.readdirSync(dataRoot).sort().filter((n) => n.startsWith("ctk-") || n.startsWith("continuity")).map((n) => path2.join(dataRoot, n, "logs")).filter((d) => fs2.existsSync(d));
    if (candidates.length > 0) return { dirs: candidates, legacy: false };
  }
  const legacy = path2.join(configDir, "logs", "continuity");
  if (fs2.existsSync(legacy)) return { dirs: [legacy], legacy: true };
  return null;
}
function* logLines(dirs) {
  for (const dir of dirs)
    for (const name of fs2.readdirSync(dir)) {
      if (!name.startsWith("permission-feedback.log") && !name.startsWith("hooks.log")) continue;
      let text;
      try {
        text = fs2.readFileSync(path2.join(dir, name), "utf8");
      } catch {
        continue;
      }
      for (const line of text.split("\n")) if (line) yield line;
    }
}
function* transcriptRecords(projectsRoot) {
  if (!fs2.existsSync(projectsRoot)) return;
  for (const proj of fs2.readdirSync(projectsRoot)) {
    const dir = path2.join(projectsRoot, proj);
    let entries;
    try {
      if (!fs2.statSync(dir).isDirectory()) continue;
      entries = fs2.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!name.endsWith(".jsonl")) continue;
      let text;
      try {
        text = fs2.readFileSync(path2.join(dir, name), "utf8");
      } catch {
        continue;
      }
      for (const line of text.split("\n")) {
        if (!line || line.indexOf('"tool_use"') === -1) continue;
        try {
          yield JSON.parse(line);
        } catch {
        }
      }
    }
  }
}
function report({
  outages,
  hoursAnalysed,
  coverage,
  baseRate,
  rejectedAsChance,
  log
}) {
  console.log(`log directory : ${log.dirs.join(", ")}${log.legacy ? "  \u26A0 LEGACY FALLBACK" : ""}`);
  console.log(`log coverage  : ${coverage ? `${coverage.from} .. ${coverage.to}` : "(none)"}`);
  console.log(`hours analysed: ${hoursAnalysed}`);
  console.log(
    `logging rate  : ${baseRate.toFixed(2)} log lines per hooked tool call  (${rejectedAsChance} quiet hour(s) rejected as chance)`
  );
  if (log.legacy) {
    console.log(
      '\n\u26A0 CLAUDE_PLUGIN_DATA was not set and no plugin-data log dir was found, so this read the\n  LEGACY directory. That path is written by the test suite, not by live hooks \u2014 a clean\n  result here does NOT mean hooks are healthy. Locate the real log with:\n    find ~/.claude -name permission-feedback.log -newermt "-1 hour"'
    );
  }
  if (!coverage) {
    console.log("\nVERDICT       : INCONCLUSIVE (no hook-log coverage \u2014 nothing to be silent)");
    return;
  }
  if (hoursAnalysed === 0) {
    console.log(
      "\nVERDICT       : INCONCLUSIVE (no hour had BOTH log coverage and hooked tool calls \u2014\n                nothing was actually examined, so this is not an all-clear)"
    );
    return;
  }
  if (outages.length === 0) {
    console.log("\nVERDICT       : OK (no hour had hooked tool calls with zero hook activity)");
    return;
  }
  console.log(
    `
VERDICT       : ${outages.length} OUTAGE HOUR(S) \u2014 ctk hooks did not run while tools did`
  );
  for (const w of groupWindows(outages)) {
    console.log(`  window ${w.start} .. ${w.end}  (${w.hours}h)`);
  }
  console.log("");
  for (const o of outages) {
    console.log(
      `  ${o.hour}  hookedTools=${o.hookedTools}  allTools=${o.allTools}  sessions=${o.sessions.join(",") || "?"}`
    );
    console.log(`      tools: ${o.tools.map(([n, c]) => `${n}:${c}`).join(" ")}`);
  }
  console.log(
    "\nDuring these hours the session ran with no security-blocker, no permission hooks and no\ncontinuity lifecycle. See issue #82. If an outage is ONGOING, capture evidence before\nrepairing \u2014 /doctor Step 1b has the checklist."
  );
}
function stateDiff(configDir) {
  const resolved = resolvePluginStateDir(configDir);
  const snapDir = resolved.dir;
  if (resolved.legacy) {
    console.log("\u26A0 Falling back to the LEGACY data directory \u2014 snapshots there are written by");
    console.log("  the test suite, not by live hooks. Treat any result below as unreliable.\n");
  }
  let names;
  try {
    names = fs2.readdirSync(snapDir).filter((n) => n.endsWith(".json")).sort();
  } catch {
    console.log(`VERDICT: INCONCLUSIVE (no snapshots yet at ${snapDir})`);
    console.log("Snapshots begin at the next session start with ctk >= 2.17.0 loaded.");
    return 2;
  }
  const newest = names[names.length - 1];
  if (!newest) {
    console.log("VERDICT: INCONCLUSIVE (snapshot directory is empty)");
    return 2;
  }
  let before;
  try {
    before = JSON.parse(fs2.readFileSync(path2.join(snapDir, newest), "utf8"));
  } catch {
    console.log(`VERDICT: INCONCLUSIVE (snapshot ${newest} is unreadable)`);
    return 2;
  }
  const after = capturePluginState(path2.join(configDir, "plugins"), { sessionId: "live" });
  const d = diffSnapshots(before, after);
  console.log(`snapshot      : ${newest}`);
  console.log(`captured      : ${before.capturedAt}  session=${before.sessionId}`);
  console.log(
    `snapshot dirs : ${Object.keys(before.dirs).length}${before.truncated ? "  \u26A0 TRUNCATED" : ""}`
  );
  console.log(
    `live dirs     : ${Object.keys(after.dirs).length}${after.truncated ? "  \u26A0 TRUNCATED" : ""}`
  );
  if (before.truncated || after.truncated) {
    console.log(
      '\n\u26A0 A truncated snapshot cannot be compared safely \u2014 missing entries look like\n  removals. Treat any "removed" list below as unreliable.'
    );
  }
  if (d.identical) {
    console.log(
      "\nVERDICT       : IDENTICAL \u2014 the plugin tree has not changed since session start"
    );
    return 0;
  }
  console.log(
    `
VERDICT       : CHANGED  (removed ${d.dirsRemoved.length}, added ${d.dirsAdded.length}, touched ${d.dirsTouched.length}, files ${d.filesChanged.length})`
  );
  const show = (label, xs) => {
    if (xs.length === 0) return;
    console.log(`
  ${label}:`);
    for (const x of xs.slice(0, 25)) console.log(`    ${x}`);
    if (xs.length > 25) console.log(`    \u2026 and ${xs.length - 25} more`);
  };
  show("REMOVED since session start (strongest sweep evidence)", d.dirsRemoved);
  show("added", d.dirsAdded);
  show("contents changed (mtime or entry count)", d.dirsTouched);
  show("state files changed", d.filesChanged);
  return 1;
}
function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const mi = argv.indexOf("--min-tools");
  const rawMin = mi !== -1 ? Number(argv[mi + 1]) : Number.NaN;
  if (mi !== -1 && (!Number.isFinite(rawMin) || rawMin < 0)) {
    console.error(
      `--min-tools requires a non-negative number (got: ${argv[mi + 1] ?? "<missing>"})`
    );
    return 2;
  }
  const minTools = Number.isFinite(rawMin) ? rawMin : DEFAULT_MIN_TOOLS;
  const configDir = process.env["CLAUDE_CONFIG_DIR"] || path2.join(os.homedir(), ".claude");
  if (argv.includes("--state-diff")) return stateDiff(configDir);
  const log = resolveLogDir(configDir);
  if (!log) {
    console.log("VERDICT: INCONCLUSIVE (no ctk log directory found)");
    return 2;
  }
  const hookHours = hookHoursFromLines(logLines(log.dirs));
  const activity = toolHoursFromRecords(transcriptRecords(path2.join(configDir, "projects")));
  const { outages, hoursAnalysed, coverage, baseRate, rejectedAsChance } = detectOutages(
    hookHours,
    activity,
    { minTools }
  );
  if (json) {
    console.log(
      JSON.stringify(
        {
          logDirs: log.dirs,
          legacy: log.legacy,
          coverage,
          hoursAnalysed,
          baseRate,
          rejectedAsChance,
          outages
        },
        null,
        2
      )
    );
  } else {
    report({ outages, hoursAnalysed, coverage, baseRate, rejectedAsChance, log });
  }
  if (!coverage || hoursAnalysed === 0) return 2;
  return outages.length > 0 ? 1 : 0;
}
process.exit(main());
//# sourceMappingURL=detect-hook-outages.js.map
//# sourceMappingURL=detect-hook-outages.js.map