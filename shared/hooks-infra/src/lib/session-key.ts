/**
 * Session-scoped temp-file keying — the single source of truth.
 *
 * Several ctk surfaces exchange state through files in the OS temp directory,
 * keyed by session id: the statusline writes a context percentage that the
 * `context-monitor` hook reads, and (since #82) hooks write a liveness marker
 * that the statusline reads. Every one of those pairs is a writer in one process
 * and a reader in another.
 *
 * That makes the keying rule load-bearing in a way it does not look. ctk's
 * flagship context warnings **had never worked**: the writer and reader resolved
 * the session id with different precedence, and because CC does not export
 * `CLAUDE_SESSION_ID` into the statusline child process, the writer keyed every
 * file as `default` while the hook looked for `<uuid>`. A missing file is a
 * legitimate "not configured yet" state, so the failure was invisible by
 * construction and shipped for as long as the feature existed (fixed in ctk
 * 2.8.0).
 *
 * The fix was to make both sides agree. This module exists because "both sides
 * agree" was then maintained by two independent copies of the same predicate —
 * one in `hooks/prompt/context-monitor.ts`, one in ctk's statusline — each
 * carrying a comment warning that applying a validator to only one side would
 * desynchronise the filename. Two copies of a rule whose entire purpose is that
 * two processes agree is the same hazard #83 was: three combined wrappers each
 * held a private copy of `isDenyDecision`, one drifted, and a denial expressed
 * the other documented way fell through to auto-approve.
 *
 * So: one implementation, imported by every participant. Adding a third
 * participant must not mean writing the rule a third time.
 *
 * @module lib/session-key
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Value used when no usable session id is available from any source. */
export const DEFAULT_SESSION_ID = 'default';

/**
 * Fallback ids that do NOT identify a session, and so cannot be trusted to make
 * writer and reader agree.
 *
 * `'default'` is this module's own last resort; `'unknown'` is the one
 * `getDefaultSessionId()` in `lib/input.ts` substitutes when it populates
 * `session_id` on a payload that arrived without one. Because those two layers
 * chose *different* constants, a session that falls all the way through keys the
 * hook's marker as `unknown` and the statusline's lookup as `default` — a
 * guaranteed mismatch. Rather than unify the constants (`default` is baked into
 * the documented `claude-context-pct-default.txt` diagnostic and into
 * `/doctor`'s Step 4a table), consumers that need writer/reader agreement ask
 * {@link isTrustedSessionKey} and decline to draw conclusions without it.
 */
const UNTRUSTED_SESSION_IDS: readonly string[] = [DEFAULT_SESSION_ID, 'unknown'];

/**
 * Whether a resolved session id actually identifies a session.
 *
 * A detector keyed on an untrusted id must stay silent: it cannot distinguish
 * "the writer never ran" from "the writer keyed a different fallback constant",
 * and guessing produces a false alarm about missing security hooks.
 */
export function isTrustedSessionKey(sessionId: string): boolean {
  return isSafeSessionId(sessionId) && !UNTRUSTED_SESSION_IDS.includes(sessionId);
}

/**
 * Whether a value is usable as a session id inside a filename.
 *
 * This is a path-safety check, not a format check — it deliberately does not
 * require a UUID, because the id is also read from an environment variable and
 * from CC payloads whose shape we do not control.
 *
 * `..` is rejected outright in addition to the charset test: the charset alone
 * permits it (`.` is allowed, for ids that legitimately contain dots), and a
 * traversal segment has no business in a session id even where the surrounding
 * prefix and `.txt` suffix would defuse it.
 */
export function isSafeSessionId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.includes('..')) return false;
  return /^[A-Za-z0-9._-]{1,128}$/.test(value);
}

/**
 * Resolve a session id from a payload value, then the environment, then a
 * constant fallback.
 *
 * The precedence is the contract every participant must share: payload first
 * (hooks receive `session_id` on stdin; the statusline receives it in its JSON),
 * then the environment, then {@link DEFAULT_SESSION_ID}. Do not put the
 * environment first — it is absent in the statusline child process, so a reader
 * preferring it would key files differently from a writer preferring the payload.
 * That asymmetry is precisely the defect described in this module's header.
 *
 * Both environment names are checked, newest first, matching
 * `getDefaultSessionId()` in `lib/input.ts` — which is what populates
 * `session_id` on hook payloads, so disagreeing with it here would reintroduce
 * the very writer/reader split this module exists to prevent. CC **added**
 * `CLAUDE_CODE_SESSION_ID` in v2.1.132 ("Bash subprocesses now get
 * CLAUDE_CODE_SESSION_ID matching hook session_id"). This is NOT a rename — an
 * earlier draft of this comment asserted one, and that was invented. Plain
 * `CLAUDE_SESSION_ID` is a long-standing upstream request that CC does not set,
 * so the second entry is a legacy fallback rather than compatibility with a
 * former name. Do not delete it on the grounds that it "was never real": a user
 * or a wrapper script may still export it.
 *
 * @param candidate - the session id carried by the payload, if any
 */
export function resolveSessionId(candidate: unknown): string {
  if (isSafeSessionId(candidate)) return candidate;
  for (const name of ['CLAUDE_CODE_SESSION_ID', 'CLAUDE_SESSION_ID'] as const) {
    const fromEnv = process.env[name];
    if (isSafeSessionId(fromEnv)) return fromEnv;
  }
  return DEFAULT_SESSION_ID;
}

/**
 * Build the path of a session-scoped file in the OS temp directory.
 *
 * Centralised so that a prefix and a session id are combined the same way by
 * every writer and reader. The session id is re-validated here rather than
 * trusted: callers that resolved it through {@link resolveSessionId} are already
 * safe, but this function is also reachable with an id from elsewhere, and a
 * path built from an unvalidated id is the one mistake this module cannot allow.
 *
 * @param prefix - filename prefix, e.g. `claude-context-pct-`
 * @param sessionId - session id; falls back to {@link DEFAULT_SESSION_ID} when unsafe
 */
export function sessionScopedTmpPath(prefix: string, sessionId: string): string {
  const safe = isSafeSessionId(sessionId) ? sessionId : DEFAULT_SESSION_ID;
  return join(tmpdir(), `${prefix}${safe}.txt`);
}
