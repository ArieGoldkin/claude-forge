#!/usr/bin/env node
/**
 * CLI: retrospective detector for silent plugin unloads (#82).
 *
 * `/doctor` Step 1b asks "is a hook firing in THIS session?" — it cannot see an
 * outage that already ended. This asks "did hooks stop at any point in retained
 * history, when, and how often?" Applying it found a second, previously unknown
 * outage and showed both began and ended MID-SESSION.
 *
 * All detection logic lives in `lib/hook-outage-detector.ts` and is unit-tested
 * against the shapes that made earlier versions wrong. This file is I/O only.
 *
 * Usage:  node dist/bin/detect-hook-outages.js [--json] [--min-tools N]
 * Exit:   0 no outages · 1 outages found · 2 inconclusive (no log coverage)
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  DEFAULT_MIN_TOOLS,
  type Outage,
  detectOutages,
  groupWindows,
  hookHoursFromLines,
  toolHoursFromRecords,
} from '../src/lib/hook-outage-detector.js';

interface LogDir {
  dir: string;
  /** true when this is the legacy `~/.claude/logs/<name>/` fallback. */
  legacy: boolean;
}

/**
 * Resolve the log directory HONESTLY.
 *
 * `logging.ts` prefers `CLAUDE_PLUGIN_DATA`; `~/.claude/logs/<name>/` is a
 * fallback written only when that variable is unset — in practice by the TEST
 * SUITE, whose `session=unknown` fixture entries read exactly like recent live
 * activity. Reading the legacy path and reporting an all-clear is the specific
 * mistake this tool must never make, so the legacy case is reported, not hidden.
 */
function resolveLogDir(configDir: string): LogDir | null {
  const fromEnv = process.env['CLAUDE_PLUGIN_DATA'];
  if (fromEnv) {
    const d = path.join(fromEnv, 'logs');
    if (fs.existsSync(d)) return { dir: d, legacy: false };
  }
  // CC names the per-plugin data dir <plugin>-<marketplace>.
  const dataRoot = path.join(configDir, 'plugins', 'data');
  if (fs.existsSync(dataRoot)) {
    const candidates = fs
      .readdirSync(dataRoot)
      .filter((n) => n.startsWith('ctk-') || n.startsWith('continuity'))
      .map((n) => path.join(dataRoot, n, 'logs'))
      .filter((d) => fs.existsSync(d));
    const best = candidates[0];
    if (best) return { dir: best, legacy: false };
  }
  const legacy = path.join(configDir, 'logs', 'continuity');
  if (fs.existsSync(legacy)) return { dir: legacy, legacy: true };
  return null;
}

function* logLines(dir: string): Generator<string> {
  for (const name of fs.readdirSync(dir)) {
    if (!name.startsWith('permission-feedback.log') && !name.startsWith('hooks.log')) continue;
    let text: string;
    try {
      text = fs.readFileSync(path.join(dir, name), 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) if (line) yield line;
  }
}

function* transcriptRecords(projectsRoot: string): Generator<unknown> {
  if (!fs.existsSync(projectsRoot)) return;
  for (const proj of fs.readdirSync(projectsRoot)) {
    const dir = path.join(projectsRoot, proj);
    let entries: string[];
    try {
      if (!fs.statSync(dir).isDirectory()) continue;
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!name.endsWith('.jsonl')) continue;
      let text: string;
      try {
        text = fs.readFileSync(path.join(dir, name), 'utf8');
      } catch {
        continue;
      }
      for (const line of text.split('\n')) {
        // Fast prefilter: only tool_use records can affect the result.
        if (!line || line.indexOf('"tool_use"') === -1) continue;
        try {
          yield JSON.parse(line);
        } catch {
          /* a truncated trailing line is normal for a live transcript */
        }
      }
    }
  }
}

interface ReportInput {
  outages: Outage[];
  hoursAnalysed: number;
  coverage: { from: string; to: string } | null;
  baseRate: number;
  rejectedAsChance: number;
  log: LogDir;
}

function report({
  outages,
  hoursAnalysed,
  coverage,
  baseRate,
  rejectedAsChance,
  log,
}: ReportInput): void {
  console.log(`log directory : ${log.dir}${log.legacy ? '  ⚠ LEGACY FALLBACK' : ''}`);
  console.log(`log coverage  : ${coverage ? `${coverage.from} .. ${coverage.to}` : '(none)'}`);
  console.log(`hours analysed: ${hoursAnalysed}`);
  console.log(
    `logging rate  : ${baseRate.toFixed(2)} log lines per hooked tool call` +
      `  (${rejectedAsChance} quiet hour(s) rejected as chance)`
  );
  if (log.legacy) {
    console.log(
      '\n⚠ CLAUDE_PLUGIN_DATA was not set and no plugin-data log dir was found, so this read the\n' +
        '  LEGACY directory. That path is written by the test suite, not by live hooks — a clean\n' +
        '  result here does NOT mean hooks are healthy. Locate the real log with:\n' +
        '    find ~/.claude -name permission-feedback.log -newermt "-1 hour"'
    );
  }
  if (!coverage) {
    console.log('\nVERDICT       : INCONCLUSIVE (no hook-log coverage — nothing to be silent)');
    return;
  }
  if (outages.length === 0) {
    console.log('\nVERDICT       : OK (no hour had hooked tool calls with zero hook activity)');
    return;
  }
  console.log(
    `\nVERDICT       : ${outages.length} OUTAGE HOUR(S) — ctk hooks did not run while tools did`
  );
  for (const w of groupWindows(outages)) {
    console.log(`  window ${w.start} .. ${w.end}  (${w.hours}h)`);
  }
  console.log('');
  for (const o of outages) {
    console.log(
      `  ${o.hour}  hookedTools=${o.hookedTools}  allTools=${o.allTools}  sessions=${o.sessions.join(',') || '?'}`
    );
    console.log(`      tools: ${o.tools.map(([n, c]) => `${n}:${c}`).join(' ')}`);
  }
  console.log(
    '\nDuring these hours the session ran with no security-blocker, no permission hooks and no\n' +
      'continuity lifecycle. See issue #82. If an outage is ONGOING, capture evidence before\n' +
      'repairing — /doctor Step 1b has the checklist.'
  );
}

function main(): number {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const mi = argv.indexOf('--min-tools');
  const minTools = mi !== -1 && argv[mi + 1] ? Number(argv[mi + 1]) : DEFAULT_MIN_TOOLS;

  const configDir = process.env['CLAUDE_CONFIG_DIR'] || path.join(os.homedir(), '.claude');
  const log = resolveLogDir(configDir);
  if (!log) {
    console.log('VERDICT: INCONCLUSIVE (no ctk log directory found)');
    return 2;
  }

  const hookHours = hookHoursFromLines(logLines(log.dir));
  const activity = toolHoursFromRecords(transcriptRecords(path.join(configDir, 'projects')));
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
          outages,
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
