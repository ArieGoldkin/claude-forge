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
 *         node dist/bin/detect-hook-outages.js --state-diff
 *           (--state-diff exits 0 identical / 1 changed / 2 inconclusive;
 *            --json applies to the outage scan only)
 * Exit:   0 no outages · 1 outages found · 2 inconclusive (no coverage, nothing
 *         analysed, or a bad argument). Exit 0 is an ALL-CLEAR and is only ever
 *         emitted when hours were actually examined.
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
import {
  type PluginStateSnapshot,
  capturePluginState,
  diffSnapshots,
  resolvePluginStateDir,
} from '../src/lib/plugin-state-snapshot.js';

interface LogDir {
  /** Every ctk log directory found. ALL are read — see `resolveLogDir`. */
  dirs: string[];
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
    if (fs.existsSync(d)) return { dirs: [d], legacy: false };
  }
  // CC names the per-plugin data dir <plugin>-<marketplace>, so a machine that
  // predates the claude-dev-kit -> claude-forge rebrand has MORE THAN ONE.
  // Picking candidates[0] from an unsorted readdir was a coin flip that could
  // land on a stale, empty directory and report "hours analysed: 0 / OK" over a
  // live outage. Read them ALL: extra hook lines can only ever prove hooks ran,
  // so a union is strictly the conservative direction.
  const dataRoot = path.join(configDir, 'plugins', 'data');
  if (fs.existsSync(dataRoot)) {
    const candidates = fs
      .readdirSync(dataRoot)
      .sort()
      .filter((n) => n.startsWith('ctk-') || n.startsWith('continuity'))
      .map((n) => path.join(dataRoot, n, 'logs'))
      .filter((d) => fs.existsSync(d));
    if (candidates.length > 0) return { dirs: candidates, legacy: false };
  }
  const legacy = path.join(configDir, 'logs', 'continuity');
  if (fs.existsSync(legacy)) return { dirs: [legacy], legacy: true };
  return null;
}

function* logLines(dirs: string[]): Generator<string> {
  for (const dir of dirs)
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
  console.log(`log directory : ${log.dirs.join(', ')}${log.legacy ? '  ⚠ LEGACY FALLBACK' : ''}`);
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
  if (hoursAnalysed === 0) {
    console.log(
      '\nVERDICT       : INCONCLUSIVE (no hour had BOTH log coverage and hooked tool calls —\n' +
        '                nothing was actually examined, so this is not an all-clear)'
    );
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

/**
 * Compare the newest session-start plugin-tree snapshot against live state.
 *
 * This is the half that retained artifacts could never provide. `mtime` is
 * last-write-wins, so correlating a past outage against directory stamps proves
 * nothing; a snapshot taken while ctk was demonstrably alive gives a real
 * "before". `dirsRemoved` is the field that matters — a plugin directory present
 * at session start and gone now is the strongest available evidence for the
 * sweep hypothesis, and is exactly what the issue's version-name comparison
 * could not see.
 */
function stateDiff(configDir: string): number {
  // One resolver, shared with the writer in session-loader. Deriving this
  // independently on each side produced a legacy branch whose reader looked in a
  // directory the writer never used, and a `candidates[0]` pick off an unsorted
  // readdir — the coin flip resolveLogDir's own comment records as a bug.
  const resolved = resolvePluginStateDir(configDir);
  const snapDir = resolved.dir;
  if (resolved.legacy) {
    console.log('⚠ Falling back to the LEGACY data directory — snapshots there are written by');
    console.log('  the test suite, not by live hooks. Treat any result below as unreliable.\n');
  }
  let names: string[];
  try {
    names = fs
      .readdirSync(snapDir)
      .filter((n) => n.endsWith('.json'))
      .sort();
  } catch {
    console.log(`VERDICT: INCONCLUSIVE (no snapshots yet at ${snapDir})`);
    console.log('Snapshots begin at the next session start with ctk >= 2.17.0 loaded.');
    return 2;
  }
  const newest = names[names.length - 1];
  if (!newest) {
    console.log('VERDICT: INCONCLUSIVE (snapshot directory is empty)');
    return 2;
  }
  let before: PluginStateSnapshot;
  try {
    before = JSON.parse(fs.readFileSync(path.join(snapDir, newest), 'utf8'));
  } catch {
    console.log(`VERDICT: INCONCLUSIVE (snapshot ${newest} is unreadable)`);
    return 2;
  }
  const after = capturePluginState(path.join(configDir, 'plugins'), { sessionId: 'live' });
  const d = diffSnapshots(before, after);

  console.log(`snapshot      : ${newest}`);
  console.log(`captured      : ${before.capturedAt}  session=${before.sessionId}`);
  console.log(
    `snapshot dirs : ${Object.keys(before.dirs).length}${before.truncated ? '  ⚠ TRUNCATED' : ''}`
  );
  console.log(
    `live dirs     : ${Object.keys(after.dirs).length}${after.truncated ? '  ⚠ TRUNCATED' : ''}`
  );
  if (before.truncated || after.truncated) {
    console.log(
      '\n⚠ A truncated snapshot cannot be compared safely — missing entries look like\n' +
        '  removals. Treat any "removed" list below as unreliable.'
    );
  }
  if (d.identical) {
    console.log(
      '\nVERDICT       : IDENTICAL — the plugin tree has not changed since session start'
    );
    return 0;
  }
  console.log(
    `\nVERDICT       : CHANGED  (removed ${d.dirsRemoved.length}, added ${d.dirsAdded.length}, ` +
      `touched ${d.dirsTouched.length}, files ${d.filesChanged.length})`
  );
  const show = (label: string, xs: string[]): void => {
    if (xs.length === 0) return;
    console.log(`\n  ${label}:`);
    for (const x of xs.slice(0, 25)) console.log(`    ${x}`);
    if (xs.length > 25) console.log(`    … and ${xs.length - 25} more`);
  };
  show('REMOVED since session start (strongest sweep evidence)', d.dirsRemoved);
  show('added', d.dirsAdded);
  show('contents changed (mtime or entry count)', d.dirsTouched);
  show('state files changed', d.filesChanged);
  return 1;
}

function main(): number {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const mi = argv.indexOf('--min-tools');
  const rawMin = mi !== -1 ? Number(argv[mi + 1]) : Number.NaN;
  // NaN would silently disable the pre-filter, so a bad value is refused.
  if (mi !== -1 && (!Number.isFinite(rawMin) || rawMin < 0)) {
    console.error(
      `--min-tools requires a non-negative number (got: ${argv[mi + 1] ?? '<missing>'})`
    );
    return 2;
  }
  const minTools = Number.isFinite(rawMin) ? rawMin : DEFAULT_MIN_TOOLS;

  const configDir = process.env['CLAUDE_CONFIG_DIR'] || path.join(os.homedir(), '.claude');
  if (argv.includes('--state-diff')) return stateDiff(configDir);

  const log = resolveLogDir(configDir);
  if (!log) {
    console.log('VERDICT: INCONCLUSIVE (no ctk log directory found)');
    return 2;
  }

  const hookHours = hookHoursFromLines(logLines(log.dirs));
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
          logDirs: log.dirs,
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
  if (!coverage || hoursAnalysed === 0) return 2; // analysing nothing is not an all-clear
  return outages.length > 0 ? 1 : 0;
}

process.exit(main());
