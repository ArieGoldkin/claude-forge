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
 * CC 2.1.220 (2026-07-25, 41 records via a temporary dumper hook). The complete
 * payload is: session_id, transcript_path, cwd, prompt_id, hook_event_name,
 * turn_id, message_id, index, final, delta.
 *
 * This function previously tried five candidate names — `message`, `text`,
 * `assistant_message`, `last_assistant_message`, `tool_input.message` — chosen
 * because "CC v2.1.152 docs are sparse on exact field naming". All five appear
 * in 0 of 41 captured records, so the hook was inert for every message it ever
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
 * At the boundaries actually OBSERVED, per-chunk scanning is safe: all 10
 * non-final chunks ended in a blank line and 0 of the 29 single-chunk deltas
 * contained one, and no phi-redactor pattern can span a blank line. So the
 * worked example an earlier draft gave here ("123-45-" | "6789") is unreachable
 * at a `\n\n` boundary.
 *
 * Do NOT read that as a guarantee. Claude Code's own hook documentation
 * describes a delta as "the newly completed LINES", which does not exclude a
 * flush on a single newline — and two patterns use a one-character separator
 * class that `\n` satisfies: `us-phone-parens` and `credit-card-spaced`. A card
 * number wrapped mid-number across a line, flushed as two deltas, would display
 * in full. Not observed; not excluded by the documented contract either.
 *
 * THE OUTPUT SIDE WAS ALSO WRONG, and is now fixed. This hook returned
 * `hookSpecificOutput.transformedMessage`; Claude Code reads `displayContent`
 * and drops unknown keys, so it redacted correctly, shipped the result under a
 * key nothing reads, and logged "Redacted N match(es)" while the original text
 * was displayed — an audit line asserting a redaction that never happened.
 * See `outputMessageDisplay` in lib/output.ts.
 *
 * SCOPE, from Claude Code's own hook documentation: "Display-only: the stored
 * message and what the model sees are untouched." This hook cannot remove PHI
 * from the transcript on disk, from what is sent to the API, or from /resume —
 * it only changes what is rendered. It also fails OPEN: a non-zero exit or a
 * timeout displays the original delta. Defense in depth, not a compliance
 * claim, and specifically not a control on data at rest.
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
