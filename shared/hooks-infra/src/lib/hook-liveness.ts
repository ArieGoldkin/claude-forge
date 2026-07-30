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
 * ## What ships here: the writer only
 *
 * A dead hook cannot report that it is dead, so whatever reads this marker must
 * run outside the hook system. This module is deliberately just the **writer**:
 * ctk hooks stamp a session-scoped marker, and `/doctor` Step 1b reads it on
 * demand. Absence of a marker is the signal.
 *
 * A passive reader — ctk's statusline warning on every refresh, which is what
 * would have caught #82 unprompted — was designed, built, and then **cut before
 * release**. Two rounds of adversarial review found three defects that all lived
 * in that reader, one of them architectural:
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
 * Resolving (1) needs a way to compare the loaded hook version against the
 * installed one, which is unsettled. Shipping the writer now means the marker
 * exists in the wild, so the reader can land later without a migration.
 *
 * **Do not add a reader here without solving (1).** A detector that cries wolf is
 * worth no more than the healthy-looking signals that caused #82, and a false
 * positive here is an alarm about *missing security hooks*.
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

import { renameSync, writeFileSync } from 'node:fs';
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
