/**
 * Hook liveness marker — detection for the silent total-unload failure (#82).
 *
 * On 2026-07-29 a session ran with **zero** ctk hook invocations while every
 * user-facing signal reported healthy: `claude plugin list` showed all five
 * plugins enabled, and `/doctor`'s install census matched. ctk owns 34 registered
 * hooks (31 shared + 3 ctk-specific), so that session had no `security-blocker`,
 * no permission hooks and no continuity lifecycle — and nothing announced it. The
 * trigger is still unidentified; this module is the *detection* half, which needs
 * no repro.
 *
 * ## The writer, and now the reader
 *
 * A dead hook cannot report that it is dead, so whatever reads this marker must
 * run outside the hook system. The **writer** is stamped by ctk hooks; `/doctor`
 * Step 1b reads it on demand, and {@link assessHookLiveness} reads it from ctk's
 * statusline, which Claude Code runs from `settings.json` with no plugin
 * machinery involved. Absence of a *stamp* is the signal.
 *
 * A passive statusline reader was designed, built, and **cut before release**
 * once. Two rounds of adversarial review found three defects that all lived in
 * that reader, one of them architectural:
 *
 * 1. Its capability check asked *"is a stamping-capable ctk **installed**?"* when
 *    the question is *"are the **loaded** hooks capable?"*. Plugin records flip at
 *    install time while a running session keeps the hooks it started with, so
 *    upgrading ctk mid-session would have made a perfectly healthy session display
 *    "no security guardrails" until it ended — on the very upgrade that installs
 *    the feature.
 * 2. Nothing pinned it: deleting the entire user-visible warning left all six test
 *    trees green.
 * 3. It sat below four early returns in the statusline's `main()`, so it could not
 *    run on a payload lacking `context_window` — the same inert-by-placement bug
 *    the writer side has a test against.
 *
 * **(1) is resolved by never asking the capability question.** The reader compares
 * the stamp against the **last user prompt in the transcript**, so the evidence is
 * the stamp itself and never an install record. A mid-session upgrade keeps the
 * already-loaded stamping hooks running, so stamps continue and nothing fires; a
 * session whose loaded hooks predate the writer has no marker at all, which is
 * {@link HookLivenessVerdict} `unknown` and stays silent. (2) and (3) are pinned
 * by tests in `tests/lib/hook-liveness.test.ts` and the statusline suite.
 *
 * A detector that cries wolf is worth no more than the healthy-looking signals
 * that caused #82, and a false positive here is an alarm about *missing security
 * hooks* — so every ambiguous case resolves to `unknown`, never to `suspect`.
 *
 * ## ⚠ What this does NOT catch: the session-start total unload
 *
 * #82's outage **began** in a session that started with **zero** plugins loaded.
 * No hook ran, so `session-loader` never stamped and **no marker exists at all** —
 * which this reader reports as `unknown`, i.e. silently. The onset is invisible
 * here, and this must not be described as closing #82.
 *
 * **It does not follow that the reader would have stayed silent for the event.**
 * An earlier revision of this header said exactly that, and it was too strong. The
 * 2026-07-29 outage ran ~15.5 h across many `/resume`s inside the one broken
 * process, and a resumed session **reuses its session id** — so `1ffd512a` still
 * carried a marker from its healthy 07-28 period. Measured 2026-08-03, in two
 * separable halves:
 *
 * - **Survival.** Markers in `os.tmpdir()` outlive the incident's ~7.5 h gap by a
 *   wide margin: **≥25.3 h passively** (mtime == atime, i.e. never re-read) and
 *   **98 h** where a read refreshes atime, measured on the same `/var/folders/…/T`
 *   this module writes to. No reboot fell inside that gap, and a reboot would not
 *   have mattered — a file **46 h older than the last boot** is still present.
 *   Nothing in ctk unlinks these files.
 * - **Predicate.** Driving this module with a 7.5 h-stale marker against a live
 *   prompt returns `suspect`; 15.5 h likewise. Grace-boundary controls hold at
 *   29 s ⇒ `healthy` and 31 s ⇒ `suspect`.
 *
 * The reader also survives the unload that silences the hooks, because ctk's
 * statusline launcher resolves its script with a filesystem `find` over the plugin
 * cache rather than through plugin resolution.
 *
 * So the honest scope on the one observed incident is: **silent from the process
 * start until the user's first prompt inside a resumed session — ~8 s — then
 * `suspect` for the remaining ~15.5 h.** (Not from the instant of resume: at that
 * point the newest prompt still predates the stamp, which is `healthy` by
 * construction. It is the first *new* prompt that makes the gap evidence.) That is
 * detection for the part that cost something, not a closure of #82 — the trigger
 * remains unidentified, and a process that only ever starts fresh sessions leaves
 * no marker and stays silent throughout.
 *
 * That blindness is forced, not an oversight. "No marker" has two causes that are
 * indistinguishable from inside a session — hooks are dead, or the loaded hooks
 * predate the writer — and separating them is exactly the capability question that
 * got the first reader cut. What ships here catches **mid-session onset**: hooks
 * that were stamping and stop. Extending it to session-start would need a signal
 * that survives an unload *and* dates the loaded build; the transcript's
 * `hook_success` attachment records were evaluated for this and rejected, because
 * they name the hook **event** rather than the plugin (measured: 1.4% of 10,913
 * local attachment records carry any ctk fingerprint, and non-plugin hooks
 * registered in `settings.json` keep producing them throughout an unload).
 *
 * ## Two false positives the writer already handles
 *
 * - **Session too young.** Stamping from `session-loader` (SessionStart) rather
 *   than only from a prompt-driven hook means a healthy session has a marker
 *   within its first second, before the user does anything.
 * - **Writer and reader keyed differently.** Marker lookups are keyed by session
 *   id, and the two layers that can supply a fallback chose *different* constants
 *   — `getDefaultSessionId()` in `lib/input.ts` substitutes `unknown`, while
 *   `lib/session-key.ts` falls back to `default`. A marker written under one and
 *   sought under the other is indistinguishable from dead hooks, so
 *   {@link stampHookLiveness} declines to write under either.
 *
 * Staleness is deliberately not recorded as a failure by any reader:
 * `context-monitor` stamps on UserPromptSubmit, so during one long agentic turn no
 * fresh stamp occurs and an old marker is perfectly healthy. The cost is a false
 * negative on `claude --resume`, which reuses the session id.
 *
 * @module lib/hook-liveness
 */

import {
  closeSync,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { isTrustedSessionKey, sessionScopedTmpPath } from './session-key.js';

/** Filename prefix for the per-session liveness marker. */
export const HOOK_ALIVE_PREFIX = 'claude-ctk-hook-alive-';

/** Shape recorded in the marker file. */
export interface HookLivenessRecord {
  /** ISO-8601 timestamp of the most recent stamp. */
  at: string;
  /** Name of the hook that stamped, for diagnosis. */
  hook: string;
}

/** Absolute path of the per-session liveness marker. */
export function getHookLivenessPath(sessionId: string): string {
  return sessionScopedTmpPath(HOOK_ALIVE_PREFIX, sessionId);
}

/**
 * Record that a ctk hook ran in this session.
 *
 * Written atomically (scratch file then rename), matching how the statusline
 * writes the context-percentage file. A torn read of this marker would parse as
 * absent, and absent is the failure signal — so a partial write would surface as a
 * spurious "no security guardrails" verdict on a healthy session.
 *
 * Best-effort and **never throws**: this is called from live hooks, and a
 * temp-directory write failure must not turn an observability feature into a
 * broken guardrail. A hook that cannot stamp degrades to "not detected", which is
 * the pre-#82 status quo — never to a crash.
 *
 * @param sessionId - already-resolved session id (see `lib/session-key`)
 * @param hookName - stamping hook, recorded for diagnosis
 */
export function stampHookLiveness(sessionId: string, hookName: string): void {
  // No marker under an untrusted fallback id. A reader distrusts those keys, so
  // such a file can never be read as evidence — it would only be litter in the
  // user's temp directory, and litter named like a real marker invites a future
  // reader to trust it. Writing nothing is the honest outcome of an unknown key.
  if (!isTrustedSessionKey(sessionId)) return;

  const record: HookLivenessRecord = { at: new Date().toISOString(), hook: hookName };
  const target = getHookLivenessPath(sessionId);
  const scratch = `${target}.tmp`;
  try {
    writeFileSync(scratch, JSON.stringify(record), 'utf8');
    renameSync(scratch, target);
  } catch {
    // Cannot stamp → the detector reports "not detected", the pre-#82 status quo.
  }
}

// =============================================================================
// READER — runs in ctk's statusline, outside the hook system
// =============================================================================

/**
 * Verdict on whether this session's ctk hooks are still running.
 *
 * There is no `dead`. `suspect` is the strongest claim the evidence supports, and
 * `unknown` absorbs every case that cannot be told apart from a healthy one.
 */
export type HookLivenessVerdict = 'healthy' | 'suspect' | 'unknown';

/**
 * Grace applied to the stamp before a newer prompt counts as evidence.
 *
 * Claude Code writes the user's prompt into the transcript **before** it runs
 * `UserPromptSubmit` hooks, so for a short window every healthy session has a
 * prompt newer than its stamp. Measured across 20 live healthy sessions, the
 * stamp lands **62–378 ms** after the prompt record. A statusline refresh inside
 * that window would otherwise flash "no security guardrails" on every prompt.
 *
 * 30 s is ~80× the measured worst case, which leaves room for hook cold-start
 * under load (ctk registers 34 hooks), and costs nothing in detection: a real
 * outage never re-stamps, so the gap grows without bound and crosses any fixed
 * grace within the first half-minute and stays across.
 *
 * This is not the threshold the design set out to avoid. That one was a count of
 * *hooked tool calls*, which would have fired on long agentic turns; keying on
 * user prompts makes a long turn identical to a healthy session by construction.
 * This grace covers a measured write-ordering race, not a behavioural guess.
 *
 * **One consequence worth knowing.** `context-monitor` is registered with
 * `timeout: 2`, so a single invocation that exceeds it leaves that prompt
 * unstamped; if the user then sits idle for longer than this grace, the banner
 * appears. That is arguably *correct* — a hook that timed out genuinely did not
 * run, and the banner's claim is that hooks are not running — and it self-heals
 * on the next prompt that does stamp. It is documented rather than suppressed
 * because widening the grace to hide it would blunt real detection, and
 * suppressing it would mean deciding that some non-runs do not count.
 */
export const LIVENESS_RACE_GRACE_MS = 30_000;

/**
 * How far back from EOF to scan a transcript for the last user prompt.
 *
 * The statusline re-runs on a refresh interval, so reading whole transcripts is a
 * recurring cost in a UI path: measured locally, transcripts run to a **median of
 * 4 MB and a maximum of 12 MB**, while the last real user prompt sits at most
 * **1.6 MB** from EOF (p99 0.95 MB) across 111 of them. A 2 MB tail covered
 * 111/111 with headroom.
 *
 * When the tail holds no user prompt — a single turn that produced more than 2 MB
 * of tool results — the reader returns `null` and the verdict degrades to
 * `unknown`. That is the safe direction: a missed alarm, never a false one.
 */
export const TRANSCRIPT_TAIL_BYTES = 2 * 1024 * 1024;

/** Read this session's marker, or `null` when there is none to read. */
export function readHookLiveness(sessionId: string): HookLivenessRecord | null {
  if (!isTrustedSessionKey(sessionId)) return null;
  try {
    const raw = readFileSync(getHookLivenessPath(sessionId), 'utf8');
    const parsed = JSON.parse(raw) as Partial<HookLivenessRecord>;
    if (typeof parsed?.at !== 'string') return null;
    return { at: parsed.at, hook: typeof parsed.hook === 'string' ? parsed.hook : '?' };
  } catch {
    // Absent, unreadable, or torn — all indistinguishable, and all report as
    // "no marker", which the verdict resolves to `unknown` rather than `suspect`.
    return null;
  }
}

/**
 * Whether a transcript record is a prompt the **user actually submitted**.
 *
 * This predicate is the whole feature, and it is an **allowlist on purpose**.
 *
 * The question it must answer is not "does this look like a user message?" but
 * "did this raise `UserPromptSubmit`?" — because that is the event whose absence
 * of a stamp is the alarm. Those are not the same set, and an exclusion list got
 * it badly wrong: Claude Code writes `type: 'user'` records for tool results,
 * built-in slash commands (`/model`, `/plugin`), `<local-command-stdout>`, and
 * **interrupts** (`[Request interrupted by user]`) — none of which raise
 * `UserPromptSubmit`, so none of which are followed by a stamp.
 *
 * Replayed at **every position** across 113 local transcripts:
 *
 * | predicate | false `suspect` verdicts |
 * |---|---|
 * | exclusion list (`type: user` minus tool results / meta / sidechain) | **493, across 73 of 113 transcripts** |
 * | this allowlist (`promptSource` present) | **0, across 0 of 113** |
 *
 * The exclusion list's worst case was the one the design calls safest: pressing
 * `Esc` during a long agentic turn writes an interrupt record, which it counted
 * as a fresh prompt and alarmed on — a "no security guardrails" banner precisely
 * when nothing is wrong.
 *
 * `promptSource` is Claude Code's own marker for a submitted prompt (observed
 * values: `typed`, `queued`, `system`, `suggestion_accepted` — all four are
 * followed by `UserPromptSubmit` firings at comparable rates, so none is
 * special-cased). No record in any of the four non-submitting classes carries it.
 *
 * Coverage is **partial**, and the reproducible way to state that is per session
 * rather than per record: in **0 of 99** local sessions did every genuine prompt
 * lack the marker, so there is no session — and no CC version between 2.1.191 and
 * 2.1.220, which is the range this corpus spans — for which the reader is
 * permanently inert. Per-*record* coverage depends on how "genuine prompt" is
 * labelled, and there is no mechanical way to do that (this module's own figure
 * came from content-matching the four classes, which a reader cannot reconstruct;
 * a reviewer using a different denominator measured a different number, and both
 * were right about different things). Whatever the denominator, an unmarked
 * prompt can only cause a **missed** alarm, never a false one.
 *
 * **Allowlist, not denylist, is the load-bearing choice.** If Claude Code renames
 * or drops this field, every record fails the predicate, no prompt is found, and
 * the verdict degrades to `unknown` — silent. A denylist fails the other way: an
 * unrecognised record class becomes a false alarm about missing security hooks.
 *
 * The `isMeta` guard is kept and is still measured — 32 records carry both
 * `promptSource` and `isMeta`. The `tool_result` and `isSidechain` guards have
 * **zero** measured overlap once `promptSource` is required; they are retained as
 * cheap defence-in-depth, not because evidence demands them.
 */
function isUserPromptRecord(record: Record<string, unknown>): boolean {
  if (record['type'] !== 'user') return false;
  // The positive marker. Everything below is defence-in-depth behind it.
  if (!Object.hasOwn(record, 'promptSource')) return false;
  if (record['isMeta'] === true) return false;
  if (record['isSidechain'] === true) return false;
  const message = record['message'] as Record<string, unknown> | undefined;
  const content = message?.['content'];
  if (Array.isArray(content)) {
    for (const block of content) {
      if (
        block &&
        typeof block === 'object' &&
        (block as Record<string, unknown>)['type'] === 'tool_result'
      ) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Last {@link TRANSCRIPT_TAIL_BYTES} of a file as whole lines, or `null`.
 *
 * Any leading partial line is dropped: a tail almost certainly begins mid-record,
 * and a fragment either fails to parse or — worse — parses as something it is not.
 */
function readTranscriptTail(filePath: string): string | null {
  let fd: number;
  try {
    fd = openSync(filePath, 'r');
  } catch {
    return null;
  }
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - TRANSCRIPT_TAIL_BYTES);
    const length = size - start;
    if (length <= 0) return null;
    const buffer = Buffer.allocUnsafe(length);
    // Decode only what was actually read. `allocUnsafe` hands back uninitialised
    // heap, so on a short read the tail of the buffer is arbitrary memory that
    // would be scanned as if it were transcript. `readStdinSync` in the
    // statusline already respects this return value; this now matches it.
    const bytesRead = readSync(fd, buffer, 0, length, start);
    if (bytesRead <= 0) return null;
    const text = buffer.subarray(0, bytesRead).toString('utf8');
    if (start === 0) return text;
    const firstBreak = text.indexOf('\n');
    return firstBreak === -1 ? null : text.slice(firstBreak + 1);
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

/**
 * Epoch-ms timestamp of the newest genuine user prompt in a transcript, or `null`.
 *
 * Reads only the tail (see {@link TRANSCRIPT_TAIL_BYTES}) and takes the maximum
 * timestamp rather than the last matching line, so an out-of-order write cannot
 * make the reader look at an older prompt than one already on disk.
 */
export function lastUserPromptAt(transcriptPath: string): number | null {
  const text = readTranscriptTail(transcriptPath);
  if (text === null) return null;

  let newest: number | null = null;
  for (const line of text.split('\n')) {
    // Cheap prefilter: parsing every tool-result record is the bulk of the cost.
    if (!line || line.indexOf('"user"') === -1) continue;
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      // A truncated trailing line is normal for a live transcript.
      continue;
    }
    if (!isUserPromptRecord(record)) continue;
    const at = Date.parse(String(record['timestamp']));
    if (Number.isNaN(at)) continue;
    if (newest === null || at > newest) newest = at;
  }
  return newest;
}

/**
 * Decide whether this session still has running ctk hooks.
 *
 * | situation | evidence | verdict |
 * |---|---|---|
 * | healthy | stamp at or after the last user prompt | `healthy` |
 * | long agentic turn | no new prompt since the stamp | `healthy` *by construction* |
 * | mid-session outage | a user prompt newer than the stamp by more than the grace | `suspect` |
 * | no marker, no transcript, untrusted key, unparsable tail | — | `unknown` |
 *
 * Read the module header before changing the last row: `unknown` is what keeps a
 * mid-session ctk upgrade from alarming on a healthy session, and it is also why
 * a session-start total unload goes undetected.
 */
export function assessHookLiveness(input: {
  sessionId: string;
  transcriptPath?: string | undefined;
  graceMs?: number;
}): HookLivenessVerdict {
  const { sessionId, transcriptPath, graceMs = LIVENESS_RACE_GRACE_MS } = input;
  if (!transcriptPath) return 'unknown';

  const marker = readHookLiveness(sessionId);
  if (!marker) return 'unknown';
  const stampedAt = Date.parse(marker.at);
  if (Number.isNaN(stampedAt)) return 'unknown';

  const promptAt = lastUserPromptAt(transcriptPath);
  if (promptAt === null) return 'unknown';

  return promptAt - stampedAt > graceMs ? 'suspect' : 'healthy';
}
