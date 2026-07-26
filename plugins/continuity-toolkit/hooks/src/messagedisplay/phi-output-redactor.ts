/**
 * MessageDisplay hook — output-side PHI / PII redactor (CC v2.1.152+).
 *
 * Mirrors `prompt/hipaa-context-injector` on the OUTPUT side: where
 * the input-side hook injects compliance context into Claude's view
 * of the user's prompt, this hook scans Claude's outgoing message
 * text and redacts high-confidence PHI / PII patterns before display.
 *
 * Defense in depth, not a HIPAA compliance claim. The patterns are
 * conservative (SSN, US phone, credit card) and live in the shared
 * `phi-redactor` lib so they can be reused for handoff scrubbing.
 *
 * OPT-IN. Default OFF. Enable per-project with the env var:
 *
 *   CONTINUITY_PHI_OUTPUT_REDACT=1
 *
 * Rationale for opt-in: a silent output transform is invasive UX.
 * Users on regulated codebases should turn it on knowingly; default
 * users should not see surprise `[SSN-REDACTED]` placeholders when
 * pasting example data.
 *
 * @module messagedisplay/phi-output-redactor
 */

import { logDebug, logInfo } from '../lib/logging.js';
import { outputMessageDisplay, outputSilentSuccess } from '../lib/output.js';
import { redactPhi } from '../lib/phi-redactor.js';
import type { HookInput, HookResult } from '../types.js';

const HOOK_NAME = 'phi-output-redactor';
const OPT_IN_ENV_VAR = 'CONTINUITY_PHI_OUTPUT_REDACT';

/**
 * Extract the assistant message text from MessageDisplay hook input.
 *
 * The field is `delta`. That is not a guess — it comes from a live capture of
 * CC 2.1.220 (2026-07-25, 22 records via a temporary dumper hook). The complete
 * payload is: session_id, transcript_path, cwd, prompt_id, hook_event_name,
 * turn_id, message_id, index, final, delta.
 *
 * This function previously tried five candidate names — `message`, `text`,
 * `assistant_message`, `last_assistant_message`, `tool_input.message` — chosen
 * because "CC v2.1.152 docs are sparse on exact field naming". All five appear
 * in 0 of 22 captured records, so the hook was inert for every message it ever
 * saw, on a PHI redaction path (#54 item 2). Two independent causes stacked:
 * normalizeInput's allowlist stripped three of the names, AND all five names
 * were wrong. Fixing only the first would have changed nothing.
 *
 * CHUNKING IS ROUTINE, NOT HYPOTHETICAL. `delta` / `index` / `final` are a
 * streaming protocol and Claude Code emits ONE EVENT PER MARKDOWN BLOCK. At 41
 * captured records: index runs 0-9, `final` takes both values, and the largest
 * message arrived as 10 separate events. So this hook is invoked once per
 * paragraph of a multi-paragraph message, with no state between invocations.
 *
 * An earlier draft of this comment said a multi-chunk message "was never
 * observed"; that was true of the first 22 records and false as a general
 * claim. The reasoning behind it — "longest delta 202 chars" — mistook a
 * sampling artifact for a bound: every message in that sample happened to be a
 * single short paragraph. Recorded rather than quietly corrected, because the
 * error is the same one that produced the false timeout guarantee in PR #55:
 * a partial capture read as a complete one.
 *
 * The boundary rule makes per-chunk scanning SOUNDER than "best effort", not
 * weaker. All 10 non-final chunks end in a blank line, and 0 of the 29
 * single-chunk deltas contain one — Claude Code splits on `\n\n`. None of the
 * patterns in `phi-redactor` (SSN, US phone, credit card) can contain a blank
 * line, so a PHI token cannot straddle a boundary and each chunk is scanned
 * whole. The worked example an earlier draft gave here ("123-45-" | "6789") is
 * therefore close to unreachable.
 *
 * WHAT REMAINS UNVERIFIED is the OUTPUT side: what Claude Code does with
 * `hookSpecificOutput.transformedMessage` returned for chunk 3 of 10. If that
 * field is ignored or applied to the wrong span, this hook logs "Redacted N
 * match(es)" while displaying the PHI anyway — a log asserting a redaction that
 * did not happen, which is worse than no hook at all. Untested end-to-end.
 * Defense in depth, not a compliance claim.
 *
 * @returns The message text, or null if absent/empty (hook becomes a no-op)
 */
export function extractAssistantMessage(input: HookInput): string | null {
  const delta = input.delta;

  if (typeof delta === 'string' && delta.length > 0) {
    return delta;
  }

  return null;
}

/**
 * MessageDisplay hook entry point.
 *
 * Fast path: opt-in env var not set → returns outputSilentSuccess().
 * Slow path: scan message, redact if matched, return transformed text.
 */
export async function phiOutputRedactor(input: HookInput): Promise<HookResult> {
  // Opt-in check first — keeps the no-op path zero-cost
  if (process.env[OPT_IN_ENV_VAR] !== '1') {
    logDebug(HOOK_NAME, 'Opt-in not set, skipping');
    return outputSilentSuccess();
  }

  const message = extractAssistantMessage(input);
  if (!message) {
    logDebug(HOOK_NAME, 'No assistant message text found, skipping');
    return outputSilentSuccess();
  }

  const result = redactPhi(message);
  if (result.totalSubstitutions === 0) {
    logDebug(HOOK_NAME, `No PHI patterns matched in ${message.length}-char message`);
    return outputSilentSuccess();
  }

  logInfo(
    HOOK_NAME,
    `Redacted ${result.totalSubstitutions} match(es) across ${result.matchedPatterns.length} pattern(s): ${result.matchedPatterns.join(', ')}`
  );

  return outputMessageDisplay(result.text);
}

export default phiOutputRedactor;
