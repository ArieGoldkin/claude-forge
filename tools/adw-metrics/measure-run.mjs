#!/usr/bin/env node
/**
 * ADW run metrics — tokens, wall-clock, and message counts for one dispatched run.
 *
 * Maintainer-only tooling for issue #47 (T4, Gate 1 pilot). Ships in no plugin.
 *
 * ## Why transcripts rather than `/usage`
 *
 * Gate 1 must report tokens and wall-clock for an ADW. `/usage` cannot supply
 * them: it is session-scoped, so a run measured inside the session that also
 * planned it is contaminated by the planning. Every transcript record carries an
 * ISO `timestamp` and assistant records carry `message.usage`, which makes a run
 * measurable by TIME WINDOW instead — the property that lets a run be isolated
 * from the session hosting it.
 *
 * ## Why every subagent transcript, not just the fork's
 *
 * A forked skill gets its own file under `<session>/subagents/`. If that skill
 * spawns further agents, their usage lands in THEIR files — so summing only the
 * fork's transcript undercounts by however much it delegated. This scans every
 * `.jsonl` beneath `subagents/` AT ANY DEPTH (workflow runs nest at least one
 * level further) and filters by record timestamp, so nested work is captured
 * without depending on a directory layout that has not been verified.
 *
 * Usage:
 *   node measure-run.mjs --session <id> --start <ISO> [--end <ISO>] [--root <dir>]
 *   node measure-run.mjs --self-test
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_KEY = '-Users-ariegoldkin-Arie-projects-claude-plugins-main';
const DEFAULT_ROOT = join(homedir(), '.claude', 'projects', PROJECT_KEY);

/** Every .jsonl beneath `dir`, at any depth. */
function findTranscripts(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...findTranscripts(full));
    else if (entry.endsWith('.jsonl')) out.push(full);
  }
  return out;
}

const ZERO = { messages: 0, input: 0, cacheCreation: 0, cacheRead: 0, output: 0 };

/**
 * Sum usage over records whose timestamp falls inside [startMs, endMs].
 *
 * A malformed line is skipped rather than fatal — transcripts are appended live,
 * so the final line can be a partial write. Skipped lines are COUNTED and
 * surfaced: silently swallowing them would let a truncated transcript
 * masquerade as a cheap run.
 */
function measureFile(path, startMs, endMs) {
  const acc = { ...ZERO, skipped: 0, firstTs: null, lastTs: null, skills: new Set() };
  let lines;
  try {
    lines = readFileSync(path, 'utf8').split('\n');
  } catch {
    return acc;
  }

  for (const line of lines) {
    if (!line.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      acc.skipped++;
      continue;
    }
    if (!rec.timestamp) continue;
    const ts = Date.parse(rec.timestamp);
    if (Number.isNaN(ts) || ts < startMs || ts > endMs) continue;

    if (acc.firstTs === null || ts < acc.firstTs) acc.firstTs = ts;
    if (acc.lastTs === null || ts > acc.lastTs) acc.lastTs = ts;
    if (rec.attributionSkill) acc.skills.add(rec.attributionSkill);

    const u = rec.message?.usage;
    if (!u) continue;
    acc.messages++;
    acc.input += u.input_tokens ?? 0;
    acc.cacheCreation += u.cache_creation_input_tokens ?? 0;
    acc.cacheRead += u.cache_read_input_tokens ?? 0;
    acc.output += u.output_tokens ?? 0;
  }
  return acc;
}

export function measureRun(sessionId, startMs, endMs, root = DEFAULT_ROOT) {
  const main = join(root, `${sessionId}.jsonl`);
  const subagentDir = join(root, sessionId, 'subagents');
  const files = [...(existsSync(main) ? [main] : []), ...findTranscripts(subagentDir)];

  const per = [];
  const total = { ...ZERO, skipped: 0 };
  let firstTs = null;
  let lastTs = null;
  const skills = new Set();

  for (const f of files) {
    const m = measureFile(f, startMs, endMs);
    if (m.messages === 0 && m.firstTs === null) continue;
    per.push({ file: basename(f), isSubagent: f !== main, ...m, skills: [...m.skills] });
    for (const k of ['messages', 'input', 'cacheCreation', 'cacheRead', 'output', 'skipped']) {
      total[k] += m[k];
    }
    if (m.firstTs !== null && (firstTs === null || m.firstTs < firstTs)) firstTs = m.firstTs;
    if (m.lastTs !== null && (lastTs === null || m.lastTs > lastTs)) lastTs = m.lastTs;
    for (const s of m.skills) skills.add(s);
  }

  return {
    total,
    per,
    skills: [...skills],
    wallClockMs: firstTs !== null && lastTs !== null ? lastTs - firstTs : 0,
    filesScanned: files.length,
    filesMatched: per.length,
  };
}

// --- self-test ---------------------------------------------------------------
//
// HERMETIC by construction: it runs against `fixtures/`, committed alongside this
// file, not against a real transcript under ~/.claude. An earlier draft asserted
// against one specific local session — that version could not run in CI and would
// have rotted the moment that transcript was cleaned up. The fixture is synthetic
// so it also carries no session content into the repo.
//
// The fixture encodes four traps on purpose:
//   - a record BEFORE the window and one long AFTER it (2026-06) — excluded
//   - a deliberately malformed line — counted as skipped, not fatal, not summed
//   - a subagent transcript nested TWO levels deep (subagents/nested/) — found
//   - a `user` record with a timestamp but no usage — moves wall-clock, adds no tokens

const FIXTURE = {
  root: join(HERE, 'fixtures'),
  session: 'test-session',
  start: '2026-01-01T00:00:00Z',
  end: '2026-01-01T00:10:00Z',
  expect: {
    messages: 3,
    input: 6,
    cacheCreation: 600,
    cacheRead: 0,
    output: 60,
    skipped: 1,
    filesMatched: 2,
    wallClockMs: 300000,
  },
};

function selfTest() {
  let failures = 0;
  const check = (name, actual, expected) => {
    const ok = actual === expected;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${actual}, expected ${expected}`);
    if (!ok) failures++;
  };

  console.log('--- T1: fixture measures to its known values ---');
  const r = measureRun(
    FIXTURE.session,
    Date.parse(FIXTURE.start),
    Date.parse(FIXTURE.end),
    FIXTURE.root
  );
  check('messages', r.total.messages, FIXTURE.expect.messages);
  check('input', r.total.input, FIXTURE.expect.input);
  check('cacheCreation', r.total.cacheCreation, FIXTURE.expect.cacheCreation);
  check('cacheRead', r.total.cacheRead, FIXTURE.expect.cacheRead);
  check('output', r.total.output, FIXTURE.expect.output);
  check('skipped (malformed line counted)', r.total.skipped, FIXTURE.expect.skipped);
  check('filesMatched (nested subagent found)', r.filesMatched, FIXTURE.expect.filesMatched);
  check('wallClockMs', r.wallClockMs, FIXTURE.expect.wallClockMs);
  check('skills attributed', r.skills.join(','), 'fix-bug');

  // CONTROL A — vary the INPUT, not the failure mode. A window outside the run
  // must match nothing. Without this, a harness that ignored its window and
  // summed whole files would pass every check above and be silently wrong for
  // every real measurement. (The fixture's 2026-06 record exists to be excluded;
  // if the window were ignored, `output` above would read 10059, not 60.)
  console.log('\n--- CONTROL A: a window outside the run must measure zero ---');
  const empty = measureRun(
    FIXTURE.session,
    Date.parse('2020-01-01T00:00:00Z'),
    Date.parse('2020-01-02T00:00:00Z'),
    FIXTURE.root
  );
  check('control.messages', empty.total.messages, 0);
  check('control.output', empty.total.output, 0);
  check('control.filesMatched', empty.filesMatched, 0);
  check('control.wallClockMs', empty.wallClockMs, 0);

  // CONTROL B — the assertion machinery must be able to report red.
  //
  // The obvious version — `expect output !== 999999` — is a TAUTOLOGY: it asserts
  // that a wrong number is wrong and never enters check()'s failure path. So drive
  // the REAL check() with a known-bad value, confirm it incremented the counter
  // exactly once, then unwind that deliberate failure.
  console.log('\n--- CONTROL B: the real check() must register a failure on a wrong value ---');
  const before = failures;
  check('(deliberate) output', r.total.output, 999999);
  const registered = failures === before + 1;
  failures = before;
  console.log(`${registered ? 'PASS' : 'FAIL'}  control B: check() reported red exactly once`);
  if (!registered) failures++;

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  return failures;
}

// --- cli ---------------------------------------------------------------------

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};

if (argv.includes('--self-test')) {
  process.exit(selfTest() === 0 ? 0 : 1);
}

const session = arg('session');
const start = arg('start');
if (!session || !start) {
  console.error('usage: measure-run.mjs --session <id> --start <ISO> [--end <ISO>] [--root <dir>]');
  console.error('       measure-run.mjs --self-test');
  process.exit(2);
}

const startMs = Date.parse(start);
const endMs = arg('end') ? Date.parse(arg('end')) : Date.now();
const r = measureRun(session, startMs, endMs, arg('root') ?? DEFAULT_ROOT);

console.log(`window        ${new Date(startMs).toISOString()} → ${new Date(endMs).toISOString()}`);
console.log(`transcripts   ${r.filesMatched} matched of ${r.filesScanned} scanned`);
console.log(`wall clock    ${(r.wallClockMs / 1000).toFixed(1)}s (${(r.wallClockMs / 60000).toFixed(1)} min)`);
if (r.skills.length) console.log(`skills seen   ${r.skills.join(', ')}`);
console.log('');
for (const p of r.per) {
  console.log(`  ${p.isSubagent ? 'subagent' : 'main    '} ${p.file}`);
  console.log(`           msgs=${p.messages} in=${p.input} cacheW=${p.cacheCreation} cacheR=${p.cacheRead} out=${p.output}${p.skipped ? ` skipped=${p.skipped}` : ''}`);
}
console.log('');
console.log(`TOTAL  msgs=${r.total.messages}  input=${r.total.input}  cache_creation=${r.total.cacheCreation}  cache_read=${r.total.cacheRead}  output=${r.total.output}`);
if (r.total.skipped) console.log(`WARNING: ${r.total.skipped} unparseable line(s) — the total may undercount.`);
