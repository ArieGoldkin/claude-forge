/**
 * Continuity Plugin - HIPAA Context Injector Hook
 *
 * UserPromptSubmit hook that detects HIPAA/health keywords in user prompts
 * and injects compliance reminders into Claude's context. The user sees
 * nothing — the context is invisible system-level guidance.
 *
 * Solves the .claude/rules/ context decay problem: rules get pushed out
 * after 4-5 messages, but this hook injects fresh context per message.
 *
 * @module prompt/hipaa-context-injector
 */

import { logDebug, logInfo } from '../lib/logging.js';
import { outputPromptContext, outputSilentSuccess } from '../lib/output.js';
import type { HookInput, HookResult } from '../types.js';

// =============================================================================
// CONSTANTS
// =============================================================================

const HOOK_NAME = 'hipaa-context-injector';

/** Maximum number of context rules to inject per prompt (prevents bloat). */
const MAX_RULES_PER_PROMPT = 3;

// =============================================================================
// CONTEXT RULES
// =============================================================================

interface ContextRule {
  /** Rule identifier for logging. */
  id: string;
  /** Regex patterns to match against the user's prompt (case-insensitive). */
  patterns: RegExp[];
  /** Context string to inject when matched. */
  context: string;
}

/**
 * HIPAA/health context rules.
 * Each rule has patterns (word-boundary to avoid false positives) and
 * a short compliance reminder (100-200 chars).
 */
const CONTEXT_RULES: readonly ContextRule[] = [
  {
    id: 'phi-handling',
    patterns: [
      /\bPHI\b/,
      /\bpatient data\b/i,
      /\bmedical record/i,
      /\bhealth data\b/i,
      /\bhealth information\b/i,
      /\bprotected health\b/i,
    ],
    context:
      'HIPAA: PHI must be encrypted at rest (AES-256) and in transit (TLS 1.2+). Never log PHI fields. Use tokenization for PHI in non-production environments.',
  },
  {
    id: 'pii-handling',
    patterns: [
      /\bPII\b/,
      /\bSSN\b/,
      /\bdate of birth\b/i,
      /\bmember name\b/i,
      /\bsocial security\b/i,
      /\bpersonal(?:ly)? identif/i,
    ],
    context:
      'HIPAA: PII fields (SSN, DOB, name, address) require field-level encryption. Implement minimum necessary access principle. Mask PII in logs and error messages.',
  },
  {
    id: 'database-queries',
    patterns: [
      /\bSQL\b/,
      /\bdatabase\b/i,
      /\bmigration\b/i,
      /\bSELECT\b/,
      /\bINSERT\b/,
      /\bUPDATE\b/,
      /\bDELETE\b/,
      /\bquery\b/i,
    ],
    context:
      'HIPAA: Use parameterized queries to prevent SQL injection. Apply row-level security for PHI tables. Audit log all access to PHI-containing tables.',
  },
  {
    id: 'logging-handling',
    patterns: [
      /\blogging\b/i,
      /\berror handling\b/i,
      /\bsentry\b/i,
      /\bcloudwatch\b/i,
      /\blog level/i,
      /\bstack trace/i,
    ],
    context:
      'HIPAA: Never log PHI/PII in application logs, error messages, or stack traces. Use structured logging with PHI field scrubbing. Set log retention policies (max 6 years).',
  },
  {
    id: 'auth-access',
    patterns: [
      /\bauthenticat/i,
      /\bJWT\b/,
      /\bRBAC\b/,
      /\baccess control\b/i,
      /\bauthoriz/i,
      /\btoken\b/i,
      /\bsession\b/i,
    ],
    context:
      'HIPAA: Implement RBAC with minimum necessary access. JWT tokens must expire (max 1hr for PHI access). Log all authentication events and access to PHI resources.',
  },
  {
    id: 'health-domain',
    patterns: [
      /\bassessment\b/i,
      /\bhealth score\b/i,
      /\bfall risk\b/i,
      /\bcare plan\b/i,
      /\bhealth program\b/i,
    ],
    context:
      'Health domain: Assessment scores and care plans contain PHI. Apply HIPAA safeguards to health data. Use de-identified data for analytics and reporting.',
  },
] as const;

// =============================================================================
// PROMPT EXTRACTION
// =============================================================================

/**
 * Extract the user's prompt text from hook input.
 *
 * UserPromptSubmit sends `{ prompt: "..." }` at the top level,
 * but we also handle tool_input.prompt as a fallback for compatibility.
 */
function extractPrompt(input: HookInput): string | null {
  // Primary: top-level prompt field (from UserPromptSubmit passthrough)
  const topLevel = (input as unknown as Record<string, unknown>)['prompt'];
  if (typeof topLevel === 'string' && topLevel.length > 0) {
    return topLevel;
  }

  // Fallback: tool_input.prompt
  const toolInputPrompt = (input.tool_input as Record<string, unknown>)?.['prompt'];
  if (typeof toolInputPrompt === 'string' && toolInputPrompt.length > 0) {
    return toolInputPrompt;
  }

  return null;
}

// =============================================================================
// MATCHING
// =============================================================================

/**
 * Find context rules that match the user's prompt.
 * Returns up to MAX_RULES_PER_PROMPT matched rules.
 */
function findMatchingRules(prompt: string): ContextRule[] {
  const matched: ContextRule[] = [];

  for (const rule of CONTEXT_RULES) {
    if (matched.length >= MAX_RULES_PER_PROMPT) {
      break;
    }

    for (const pattern of rule.patterns) {
      if (pattern.test(prompt)) {
        matched.push(rule);
        break; // One pattern match per rule is enough
      }
    }
  }

  return matched;
}

// =============================================================================
// HOOK ENTRY POINT
// =============================================================================

/**
 * HIPAA Context Injector — UserPromptSubmit hook.
 *
 * Scans user prompts for HIPAA/health keywords and injects
 * compliance context that Claude sees but the user doesn't.
 *
 * Fast path: Most prompts won't match → returns outputSilentSuccess() in <1ms.
 * Slow path: Keyword match → builds context string and returns outputPromptContext().
 */
export async function hipaaContextInjector(input: HookInput): Promise<HookResult> {
  const prompt = extractPrompt(input);

  if (!prompt) {
    logDebug(HOOK_NAME, 'No prompt text found, skipping');
    return outputSilentSuccess();
  }

  logDebug(HOOK_NAME, `Scanning prompt (${prompt.length} chars)`);

  const matchedRules = findMatchingRules(prompt);

  if (matchedRules.length === 0) {
    logDebug(HOOK_NAME, 'No keyword matches');
    return outputSilentSuccess();
  }

  // Build combined context from matched rules
  const ruleIds = matchedRules.map((r) => r.id);
  logInfo(HOOK_NAME, `Matched ${matchedRules.length} rule(s): ${ruleIds.join(', ')}`);

  const context = matchedRules.map((r) => r.context).join('\n');

  return outputPromptContext(context);
}
