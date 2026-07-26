/**
 * PHI / PII redactor — pure functions for output-side scrubbing.
 *
 * Designed for the CC v2.1.152 MessageDisplay hook event. Scans
 * assistant message text for high-confidence PHI / PII patterns and
 * replaces matches with stable placeholders. Email and date heuristics
 * are deliberately excluded — they over-match on technical content
 * (commit emails, ISO timestamps).
 *
 * KNOWN FALSE POSITIVES. This module used to claim "only patterns with
 * very low false-positive rates". That is not true of the dashed
 * patterns, whose surface form is genuinely ambiguous, and measuring
 * beats asserting:
 *
 *   commits 100-200-3000   -> [PHONE-REDACTED]   (us-phone-dashed)
 *   build 123-45-6789      -> [SSN-REDACTED]     (ssn-dashed)
 *
 * Nothing in a regex separates those from a real phone number or SSN;
 * only surrounding words would, and word lists are their own false-
 * positive source. The card patterns ARE precise, because Luhn gates
 * them — a grouped non-card number now survives untouched.
 *
 * The cost of a false positive here is confusion, not data loss: the
 * transform is display-only and the stored message is untouched. The
 * cost of a false negative is unredacted PHI on screen. The bias is
 * deliberate, and worth restating whenever a pattern is added.
 *
 * Stays purely synchronous and dependency-free so it can be reused
 * outside the hook (e.g., handoff scrubbing).
 *
 * @module lib/phi-redactor
 */

export interface PhiPattern {
  /** Stable identifier used in logs. */
  id: string;
  /** Regex (with `g` flag) describing the pattern. */
  regex: RegExp;
  /** Replacement placeholder (does not need to be the same length). */
  replacement: string;
  /**
   * Optional second-stage check on a regex match. Return false to leave the
   * match alone. Lets a pattern be written loosely enough for recall and then
   * tightened by something a regex cannot express — see `luhn`.
   */
  validate?: (match: string) => boolean;
}

/**
 * Luhn checksum. Every real payment card satisfies it and a randomly grouped
 * 16-digit number satisfies it about 1 time in 10, so gating the card patterns
 * on this is close to pure precision: no recall is lost and most build numbers,
 * ids and version strings stop matching.
 *
 * Note it does NOT rescue `4111-1111-1111-1111` from being redacted — that is
 * the industry's standard test card and it is Luhn-valid by construction.
 */
export function luhn(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;

  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Default conservative pattern set. Each pattern is high-confidence:
 * the surface form is rarely produced by non-PHI content.
 *
 * NOT included (deliberately):
 * - Generic email (false-positives on commit / CI emails).
 * - Generic date (false-positives on log timestamps, version strings).
 * - Names (impossible without an NLP dependency).
 * - MRN / chart numbers (format varies by EHR vendor).
 */
export const DEFAULT_PHI_PATTERNS: ReadonlyArray<PhiPattern> = [
  {
    id: 'ssn-dashed',
    // ###-##-#### — explicit dashes only, to avoid matching arbitrary 9-digit
    // numbers (timestamps, IDs).
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
    replacement: '[SSN-REDACTED]',
  },
  {
    id: 'us-phone-parens',
    // (###) ###-#### with optional space
    regex: /\(\d{3}\)\s?\d{3}-\d{4}/g,
    replacement: '[PHONE-REDACTED]',
  },
  {
    id: 'us-phone-dashed',
    // ###-###-#### — three dashed groups
    regex: /\b\d{3}-\d{3}-\d{4}\b/g,
    replacement: '[PHONE-REDACTED]',
  },
  {
    id: 'credit-card-spaced',
    // #### #### #### #### (Visa/MC/Discover formatting), Luhn-gated so that
    // grouped non-card numbers (build ids, key fragments) are left alone.
    regex: /\b\d{4}[\s-]\d{4}[\s-]\d{4}[\s-]\d{4}\b/g,
    replacement: '[CC-REDACTED]',
    validate: luhn,
  },
  {
    id: 'credit-card-plain',
    // 13-19 unseparated digits. Only safe to include BECAUSE of the Luhn gate —
    // without it this would match most long numeric ids. Closes a recall gap:
    // a pasted card is at least as likely to arrive unformatted as formatted.
    regex: /\b\d{13,19}\b/g,
    replacement: '[CC-REDACTED]',
    validate: luhn,
  },
] as const;

export interface RedactionResult {
  /** The redacted text (input unchanged when nothing matched). */
  text: string;
  /** Pattern IDs that matched at least once. */
  matchedPatterns: string[];
  /** Total number of substitutions applied across all patterns. */
  totalSubstitutions: number;
}

/**
 * Apply a set of redaction patterns to a string. Returns the redacted
 * text plus diagnostic counters (which patterns matched, how many
 * substitutions in total). Original text is returned unchanged when
 * no patterns match — useful for the hook's fast path.
 *
 * Patterns are applied in the order given. The regexes are reset
 * (`lastIndex = 0`) before each use so the function is safe to call
 * repeatedly even with shared global-flag regexes.
 */
export function redactPhi(
  text: string,
  patterns: ReadonlyArray<PhiPattern> = DEFAULT_PHI_PATTERNS
): RedactionResult {
  // Non-string input FAILS CLOSED. The declared parameter type is `string`, but
  // this module advertises reuse outside the hook, and callers reached from
  // JSON or `any` can hand it anything. It used to throw
  // `current.match is not a function` on a number/object/array, and to return
  // `{ text: null }` for null — a value its own `text: string` type says is
  // impossible. A redactor must never hand back something it did not inspect,
  // so unusable input yields empty text, not the original. Found by adversarial
  // review of #56.
  if (typeof text !== 'string') {
    return { text: '', matchedPatterns: [], totalSubstitutions: 0 };
  }

  if (!text) {
    return { text, matchedPatterns: [], totalSubstitutions: 0 };
  }

  const matchedPatterns: string[] = [];
  let totalSubstitutions = 0;
  let current = text;

  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0;
    let substitutions = 0;

    // `replace` with a callback so `validate` can veto an individual match.
    // Counting inside the callback keeps the tally equal to the number of
    // substitutions actually applied — a separate `match()` pass would count
    // vetoed matches too and report redactions that never happened, which is
    // the failure mode this release spent its time removing.
    const next = current.replace(pattern.regex, (match) => {
      if (pattern.validate && !pattern.validate(match)) {
        return match;
      }
      substitutions++;
      return pattern.replacement;
    });

    if (substitutions > 0) {
      matchedPatterns.push(pattern.id);
      totalSubstitutions += substitutions;
      current = next;
    }
  }

  return { text: current, matchedPatterns, totalSubstitutions };
}
