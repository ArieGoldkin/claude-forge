/**
 * Secret Detector PostToolUse Hook
 *
 * Scans Bash command output for leaked secrets and credentials.
 * When secrets are detected, warns the user and instructs Claude
 * not to repeat the sensitive values.
 *
 * @module posttool/secret-detector
 */

import { guardBash, guardHasCommand, runGuards } from '../lib/guards.js';
import { logDebug, logInfo, logWarn } from '../lib/logging.js';
import { outputSilentSuccess, outputWithNotification } from '../lib/output.js';
import type { HookInput, HookResult } from '../types.js';

const HOOK_NAME = 'secret-detector';

/** Maximum output size to scan (50KB) */
const MAX_OUTPUT_SIZE = 50 * 1024;

// =============================================================================
// TYPES
// =============================================================================

/**
 * Result of scanning text for secrets.
 */
export interface SecretScanResult {
  detected: boolean;
  secretTypes: string[];
}

// =============================================================================
// SECRET PATTERNS
// =============================================================================

/**
 * Secret detection patterns with descriptive type names.
 * Each pattern is designed to minimize false positives.
 */
export const SECRET_PATTERNS: ReadonlyArray<{ type: string; pattern: RegExp }> = [
  // AWS Access Key ID (starts with AKIA, exactly 20 chars)
  { type: 'AWS Access Key ID', pattern: /AKIA[0-9A-Z]{16}/ },
  // AWS Secret Access Key (40-char base64 after known key name)
  {
    type: 'AWS Secret Access Key',
    pattern: /(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[=:]\s*[A-Za-z0-9/+=]{40}/,
  },
  // AWS Session Token (long base64 after known key name, for STS/Bedrock)
  {
    type: 'AWS Session Token',
    pattern: /(?:aws_session_token|AWS_SESSION_TOKEN)\s*[=:]\s*[A-Za-z0-9/+=]{100,}/,
  },
  // Anthropic API Key
  { type: 'Anthropic API Key', pattern: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  // Private Key block — optional " BLOCK" suffix covers PGP armor headers
  // ("-----BEGIN PGP PRIVATE KEY BLOCK-----"), which the bare suffix missed
  { type: 'Private Key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----/ },
  // JWT Token (three base64url segments)
  {
    type: 'JWT Token',
    pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  },
  // Database connection string with credentials
  {
    type: 'Database Connection String',
    pattern: /(?:postgresql|mysql|mongodb|redis|amqp):\/\/[^:\s]+:[^@\s]+@/,
  },
  // Bearer token (20+ char minimum)
  { type: 'Bearer Token', pattern: /Bearer\s+[A-Za-z0-9_\-.]{20,}/ },
  // Secret key-value pairs (known key names with 8+ char values).
  // Accepts bare AND quoted values — `password="…"` is the dominant real
  // form in config files and previously escaped the bare-value pattern.
  // Quoted values stay whitespace-free so prose ("use a strong password
  // here" in docs) cannot trip the hard pre-write gate.
  {
    type: 'Secret Key-Value',
    pattern:
      /(?:password|secret|api_key|apikey|api_secret|access_token|auth_token|private_key|secret_key)\s*[=:]\s*(?:"[^"\s]{8,}"|'[^'\s]{8,}'|[^\s'"]{8,})/i,
  },
  // GitHub Token (ghp_, gho_, ghu_, ghs_, ghr_)
  { type: 'GitHub Token', pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/ },
  // GitHub fine-grained PAT (github_pat_ prefix, introduced 2022)
  { type: 'GitHub Fine-Grained Token', pattern: /github_pat_[A-Za-z0-9_]{22,}/ },
  // GitLab Personal/Project/Group Access Token
  { type: 'GitLab Token', pattern: /glpat-[A-Za-z0-9_-]{20,}/ },
  // Slack Token
  { type: 'Slack Token', pattern: /xox[bpsa]-[A-Za-z0-9-]{20,}/ },
  // Slack App-Level Token
  { type: 'Slack App Token', pattern: /xapp-[A-Za-z0-9-]{20,}/ },
  // OpenAI API Key (sk- prefix, but not sk-ant- which is Anthropic)
  { type: 'OpenAI API Key', pattern: /sk-(?!ant-)[A-Za-z0-9]{20,}/ },
  // OpenAI project-scoped key — hyphenated, so the legacy sk- pattern
  // (alphanumeric-only) never matched it
  { type: 'OpenAI Project Key', pattern: /sk-proj-[A-Za-z0-9_-]{20,}/ },
] as const;

// =============================================================================
// EXAMPLE-KEY ALLOWLIST
// =============================================================================

/**
 * Canonical documentation/example credentials that must never trip the
 * scanner (review !207 finding #2 — the pre-write gate blocked legitimate
 * test fixtures and docs quoting AWS's own example keys).
 *
 * Entries are built from split literals so this file's own content cannot
 * trigger the pre-write secret gate when edited.
 */
export const EXAMPLE_SECRET_ALLOWLIST: readonly string[] = [
  // AWS canonical documentation access keys (docs.aws.amazon.com)
  `AKIA${'IOSFODNN7EXAMPLE'}`,
  `AKIA${'I44QH8DHBEXAMPLE'}`,
  // AWS canonical documentation secret key
  `wJalrXUtnFEMI/K7MDENG/${'bPxRfiCYEXAMPLEKEY'}`,
];

/**
 * Replace allowlisted example credentials with a short inert placeholder
 * (< 8 chars so it cannot recombine with surrounding text into a new
 * key-value match).
 */
function stripExampleSecrets(text: string): string {
  let out = text;
  for (const example of EXAMPLE_SECRET_ALLOWLIST) {
    if (out.includes(example)) {
      out = out.split(example).join('EXAMPLE');
    }
  }
  return out;
}

// =============================================================================
// SCANNING
// =============================================================================

/**
 * Scan text for secret patterns.
 *
 * @param text - The text to scan for secrets
 * @returns Object with detected flag and list of secret types found
 */
export function scanForSecrets(text: string): SecretScanResult {
  const secretTypes: string[] = [];
  const sanitized = stripExampleSecrets(text);

  for (const { type, pattern } of SECRET_PATTERNS) {
    if (pattern.test(sanitized)) {
      secretTypes.push(type);
    }
  }

  return {
    detected: secretTypes.length > 0,
    secretTypes,
  };
}

// =============================================================================
// MAIN HOOK
// =============================================================================

/**
 * Secret detector PostToolUse hook.
 *
 * Scans Bash command output for leaked secrets and credentials.
 * When secrets are detected:
 * - User sees a warning about leaked secrets
 * - Claude receives instruction to NOT repeat the secret values
 *
 * @param input - Hook input from Claude Code (includes tool_response)
 * @returns HookResult with notification if secrets detected
 */
export async function secretDetector(input: HookInput): Promise<HookResult> {
  const skipped = runGuards(input, guardBash, guardHasCommand);
  if (skipped) return skipped;

  // Get tool output from the extended input
  // `tool_response` is declared on HookInput since #54 — no local interface.
  const toolOutput = input.tool_response;

  if (!toolOutput) {
    logDebug(HOOK_NAME, 'No tool output available');
    return outputSilentSuccess();
  }

  // Combine stdout, stderr, and output fields
  const outputText = [toolOutput.stdout, toolOutput.stderr, toolOutput.output]
    .filter(Boolean)
    .join('\n');

  if (!outputText) {
    logDebug(HOOK_NAME, 'Empty output, skipping');
    return outputSilentSuccess();
  }

  // Skip very large outputs to avoid performance issues
  if (outputText.length > MAX_OUTPUT_SIZE) {
    logDebug(HOOK_NAME, `Output too large (${outputText.length} bytes), skipping`);
    return outputSilentSuccess();
  }

  // Scan for secrets
  const result = scanForSecrets(outputText);

  if (!result.detected) {
    logDebug(HOOK_NAME, 'No secrets detected');
    return outputSilentSuccess();
  }

  const typesStr = result.secretTypes.join(', ');
  logWarn(HOOK_NAME, `Secrets detected in output: ${typesStr}`);

  const userMsg = `\u26a0 Potential secrets detected in command output: ${typesStr}. Review output carefully before sharing.`;
  const claudeCtx = `SECURITY WARNING: The command output contains potential secrets (${typesStr}). DO NOT repeat, echo, or include these secret values in your responses. If you need to reference them, describe what they are without showing the actual values.`;

  logInfo(HOOK_NAME, `Warning issued for: ${typesStr}`);
  return outputWithNotification(userMsg, claudeCtx);
}

export default secretDetector;
