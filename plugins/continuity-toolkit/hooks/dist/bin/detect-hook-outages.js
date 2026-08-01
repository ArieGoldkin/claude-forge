#!/usr/bin/env node
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

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
  const to = covered[covered.length - 1];
  const inWindow = (h) => h >= from && h < to;
  const analysed = [];
  let totalTools = 0;
  let totalLines = 0;
  for (const hour of [...activity.hooked.keys()].sort()) {
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

// bin/detect-hook-outages.ts
function resolveLogDir(configDir) {
  const fromEnv = process.env["CLAUDE_PLUGIN_DATA"];
  if (fromEnv) {
    const d = path.join(fromEnv, "logs");
    if (fs.existsSync(d)) return { dir: d, legacy: false };
  }
  const dataRoot = path.join(configDir, "plugins", "data");
  if (fs.existsSync(dataRoot)) {
    const candidates = fs.readdirSync(dataRoot).filter((n) => n.startsWith("ctk-") || n.startsWith("continuity")).map((n) => path.join(dataRoot, n, "logs")).filter((d) => fs.existsSync(d));
    const best = candidates[0];
    if (best) return { dir: best, legacy: false };
  }
  const legacy = path.join(configDir, "logs", "continuity");
  if (fs.existsSync(legacy)) return { dir: legacy, legacy: true };
  return null;
}
function* logLines(dir) {
  for (const name of fs.readdirSync(dir)) {
    if (!name.startsWith("permission-feedback.log") && !name.startsWith("hooks.log")) continue;
    let text;
    try {
      text = fs.readFileSync(path.join(dir, name), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) if (line) yield line;
  }
}
function* transcriptRecords(projectsRoot) {
  if (!fs.existsSync(projectsRoot)) return;
  for (const proj of fs.readdirSync(projectsRoot)) {
    const dir = path.join(projectsRoot, proj);
    let entries;
    try {
      if (!fs.statSync(dir).isDirectory()) continue;
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!name.endsWith(".jsonl")) continue;
      let text;
      try {
        text = fs.readFileSync(path.join(dir, name), "utf8");
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
  console.log(`log directory : ${log.dir}${log.legacy ? "  \u26A0 LEGACY FALLBACK" : ""}`);
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
function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const mi = argv.indexOf("--min-tools");
  const minTools = mi !== -1 && argv[mi + 1] ? Number(argv[mi + 1]) : DEFAULT_MIN_TOOLS;
  const configDir = process.env["CLAUDE_CONFIG_DIR"] || path.join(os.homedir(), ".claude");
  const log = resolveLogDir(configDir);
  if (!log) {
    console.log("VERDICT: INCONCLUSIVE (no ctk log directory found)");
    return 2;
  }
  const hookHours = hookHoursFromLines(logLines(log.dir));
  const activity = toolHoursFromRecords(transcriptRecords(path.join(configDir, "projects")));
  const { outages, hoursAnalysed, coverage, baseRate, rejectedAsChance } = detectOutages(
    hookHours,
    activity,
    { minTools }
  );
  if (json) {
    console.log(
      JSON.stringify(
        {
          logDir: log.dir,
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
  if (!coverage) return 2;
  return outages.length > 0 ? 1 : 0;
}
process.exit(main());
//# sourceMappingURL=detect-hook-outages.js.map
//# sourceMappingURL=detect-hook-outages.js.map