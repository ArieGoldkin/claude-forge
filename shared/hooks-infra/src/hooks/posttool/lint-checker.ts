/**
 * Lint Checker PostToolUse Hook
 *
 * Runs ruff on Python files after Write/Edit/MultiEdit operations.
 * Reports lint errors and format issues as a system message so Claude
 * can fix them immediately. Security (bandit S-prefix) violations are
 * highlighted for security awareness.
 *
 * Linter discovery: checks for ruff in project .venv/bin, mise shims,
 * and PATH (in that order). Silently skips if no linter is found.
 *
 * Security: uses execFileSync (no shell) for ruff invocations to
 * prevent command injection via file paths.
 *
 * @module posttool/lint-checker
 */

import { execFileSync, execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { guardWriteEdit, runGuards } from '../lib/guards.js';
import { getFilePath, getToolName } from '../lib/input.js';
import { logDebug, logInfo, logWarn } from '../lib/logging.js';
import { outputSilentSuccess, outputWithNotification } from '../lib/output.js';
import type { HookInput, HookResult } from '../types.js';

const HOOK_NAME = 'lint-checker';

// =============================================================================
// TYPES
// =============================================================================

/**
 * A single ruff violation from JSON output (ruff 0.15.0 schema).
 */
export interface RuffViolation {
  code: string;
  message: string;
  filename: string;
  location: {
    row: number;
    column: number;
  };
  end_location: {
    row: number;
    column: number;
  };
  noqa_row: number;
  cell?: number | null;
  fix?: {
    applicability: 'safe' | 'unsafe' | 'display_only';
    message?: string;
    edits?: Array<{
      content: string;
      location: { row: number; column: number };
      end_location: { row: number; column: number };
    }>;
  };
  url?: string;
}

/**
 * A single diagnostic from `biome check --reporter=json` (biome 1.9.x schema).
 *
 * Shape differs from ruff in three ways that matter:
 * - `location.path` is an object, not a string
 * - `location.span` is a [startByte, endByte] pair, NOT row/column
 * - `span` is null for `format` diagnostics
 */
export interface BiomeDiagnostic {
  category: string;
  severity: string;
  description?: string;
  location?: {
    path?: { file?: string };
    span?: [number, number] | null;
    sourceCode?: string | null;
  };
}

/**
 * The common display shape both linters normalize into.
 *
 * This is the minimum `formatViolationLine` needs. `RuffViolation` is
 * structurally assignable to it, so widening the formatters to accept
 * `LintViolation` leaves every existing ruff path untouched -- while
 * sparing the biome path from forging meaningless ruff-only fields
 * (`noqa_row`, `end_location`).
 */
export interface LintViolation {
  code: string;
  message: string;
  filename: string;
  location: {
    row: number;
    column: number;
  };
  fix?: {
    applicability: 'safe' | 'unsafe' | 'display_only';
    message?: string;
  };
}

/**
 * Violations partitioned into security and general.
 *
 * Security = ruff's bandit `S`-prefix, or biome's `lint/security/*` category.
 */
export interface ClassifiedViolations {
  security: LintViolation[];
  general: LintViolation[];
  totalCount: number;
}

/**
 * Combined lint and format check results.
 */
export interface LintResults {
  violations: ClassifiedViolations;
  formatIssueFiles: string[];
  /** Formatter named in the format-issue hint. Defaults to ruff (Python). */
  formatter?: 'ruff' | 'biome';
}

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Python file extensions -- linted by ruff.
 */
const PYTHON_EXTENSIONS = new Set(['.py', '.pyi']);

/**
 * JS/TS file extensions -- linted by biome.
 *
 * Must stay in sync with the `if` condition wired in each plugin's hooks.json.
 * They disagreed once already: the matcher fired on .ts/.tsx/.js while this
 * hook only handled Python, so every TypeScript edit was silently unlinted.
 */
const JS_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

/**
 * Biome's category prefix for security rules (its analogue of bandit's `S`).
 */
const BIOME_SECURITY_PREFIX = 'lint/security/';

/**
 * Biome's category for "this file needs formatting". Carries a null span.
 */
const BIOME_FORMAT_CATEGORY = 'format';

/**
 * Maximum number of violations to show in the message.
 */
const MAX_VIOLATIONS_SHOWN = 20;

/**
 * Maximum total message length to include in the system message.
 */
const MAX_MESSAGE_LENGTH = 3000;

/**
 * Timeout for linter execution in milliseconds.
 */
const LINTER_TIMEOUT_MS = 5000;

// =============================================================================
// LINTER DISCOVERY
// =============================================================================

/**
 * Cached linter path (null = not yet checked, undefined = not found).
 */
let cachedLinterPath: string | null | undefined = null;

/**
 * Find the ruff linter binary.
 *
 * Search order:
 * 1. Project .venv/bin/ruff (virtualenv)
 * 2. mise shims (~/.local/share/mise/shims/ruff)
 * 3. PATH (which ruff)
 *
 * @param projectDir - The project directory to check for .venv
 * @returns Path to ruff binary, or undefined if not found
 */
export function findLinter(projectDir: string): string | undefined {
  if (cachedLinterPath !== null) {
    return cachedLinterPath ?? undefined;
  }

  // 1. Check project virtualenv
  const venvRuff = path.join(projectDir, '.venv', 'bin', 'ruff');
  if (fs.existsSync(venvRuff)) {
    cachedLinterPath = venvRuff;
    logDebug(HOOK_NAME, `Found ruff in venv: ${venvRuff}`);
    return venvRuff;
  }

  // 2. Check mise shims
  const homeDir = process.env['HOME'] || '/tmp';
  const miseRuff = path.join(homeDir, '.local', 'share', 'mise', 'shims', 'ruff');
  if (fs.existsSync(miseRuff)) {
    cachedLinterPath = miseRuff;
    logDebug(HOOK_NAME, `Found ruff in mise shims: ${miseRuff}`);
    return miseRuff;
  }

  // 3. Check PATH
  try {
    const whichResult = execSync('which ruff 2>/dev/null', {
      timeout: 2000,
      encoding: 'utf8',
    }).trim();
    if (whichResult) {
      cachedLinterPath = whichResult;
      logDebug(HOOK_NAME, `Found ruff in PATH: ${whichResult}`);
      return whichResult;
    }
  } catch {
    // ruff not in PATH
  }

  cachedLinterPath = undefined;
  logDebug(HOOK_NAME, 'ruff not found');
  return undefined;
}

/**
 * Reset cached linter path. Used for testing.
 */
export function resetLinterCache(): void {
  cachedLinterPath = null;
}

// =============================================================================
// LINT EXECUTION
// =============================================================================

/**
 * Run ruff check on files and return structured violations.
 *
 * Uses execFileSync (args array, no shell) to prevent command injection.
 * Batches all files in a single ruff invocation.
 *
 * @param linterPath - Absolute path to the ruff binary
 * @param filePaths - Absolute paths to Python files to check
 * @returns Array of RuffViolation objects, empty if clean or on error
 */
export function runRuffCheck(linterPath: string, filePaths: string[]): RuffViolation[] {
  try {
    execFileSync(linterPath, ['check', '--output-format', 'json', '--no-cache', ...filePaths], {
      timeout: LINTER_TIMEOUT_MS,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    // Exit code 0 = no lint errors
    return [];
  } catch (err: unknown) {
    const execError = err as { stdout?: string; stderr?: string; status?: number };

    // Exit code 1 = lint errors found, stdout contains JSON
    if (execError.status === 1 && execError.stdout) {
      try {
        const parsed = JSON.parse(execError.stdout);
        if (Array.isArray(parsed)) {
          return parsed as RuffViolation[];
        }
        return [];
      } catch {
        // JSON parse failure (older ruff without --output-format json)
        logWarn(HOOK_NAME, 'Failed to parse ruff JSON output, skipping');
        return [];
      }
    }

    // Exit code 2 = ruff config/invocation error
    if (execError.status === 2) {
      logWarn(HOOK_NAME, `ruff config error: ${execError.stderr || 'unknown'}`);
      return [];
    }

    // Timeout or other unexpected error
    logWarn(HOOK_NAME, `ruff execution error: ${String(err)}`);
    return [];
  }
}

/**
 * Run ruff format --check on files and return files needing formatting.
 *
 * Uses execFileSync (args array, no shell) to prevent command injection.
 *
 * @param linterPath - Absolute path to the ruff binary
 * @param filePaths - Absolute paths to Python files to check
 * @returns Array of file paths that need formatting, empty if all formatted or on error
 */
export function runRuffFormat(linterPath: string, filePaths: string[]): string[] {
  try {
    execFileSync(linterPath, ['format', '--check', ...filePaths], {
      timeout: LINTER_TIMEOUT_MS,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    // Exit code 0 = all files formatted
    return [];
  } catch (err: unknown) {
    const execError = err as { stdout?: string; status?: number };

    // Exit code 1 = files need formatting, stdout lists them with "Would reformat: " prefix
    if (execError.status === 1 && execError.stdout) {
      const PREFIX = 'Would reformat: ';
      return execError.stdout
        .trim()
        .split('\n')
        .filter((line) => line.startsWith(PREFIX))
        .map((line) => line.slice(PREFIX.length));
    }

    // Any other error = silently skip format check
    return [];
  }
}

// =============================================================================
// BIOME (JS/TS)
// =============================================================================

/**
 * Cached biome path (null = not yet checked, undefined = not found).
 */
let cachedBiomePath: string | null | undefined = null;

/**
 * Find the biome binary.
 *
 * Search order:
 * 1. Project node_modules/.bin/biome (the normal case for a JS repo)
 * 2. PATH (which biome)
 *
 * @param projectDir - The project directory to check for node_modules
 * @returns Path to biome binary, or undefined if not found
 */
export function findBiome(projectDir: string): string | undefined {
  if (cachedBiomePath !== null) {
    return cachedBiomePath ?? undefined;
  }

  // 1. Project-local install
  const localBiome = path.join(projectDir, 'node_modules', '.bin', 'biome');
  if (fs.existsSync(localBiome)) {
    cachedBiomePath = localBiome;
    logDebug(HOOK_NAME, `Found biome in node_modules: ${localBiome}`);
    return localBiome;
  }

  // 2. PATH
  try {
    const whichResult = execSync('which biome 2>/dev/null', {
      timeout: 2000,
      encoding: 'utf8',
    }).trim();
    if (whichResult) {
      cachedBiomePath = whichResult;
      logDebug(HOOK_NAME, `Found biome in PATH: ${whichResult}`);
      return whichResult;
    }
  } catch {
    // biome not in PATH
  }

  cachedBiomePath = undefined;
  logDebug(HOOK_NAME, 'biome not found');
  return undefined;
}

/**
 * Reset cached biome path. Used for testing.
 */
export function resetBiomeCache(): void {
  cachedBiomePath = null;
}

/**
 * Convert a UTF-8 byte offset into a 1-based row/column.
 *
 * Biome reports spans as byte offsets; ruff reports row/column. JS strings are
 * UTF-16, so slicing by a byte offset is wrong for any non-ASCII source --
 * go through a Buffer.
 *
 * @param content - Full file contents
 * @param byteOffset - UTF-8 byte offset into that content
 * @returns 1-based row and column
 */
export function offsetToRowCol(
  content: string,
  byteOffset: number
): { row: number; column: number } {
  const buf = Buffer.from(content, 'utf8');
  const clamped = Math.max(0, Math.min(byteOffset, buf.length));
  const before = buf.subarray(0, clamped).toString('utf8');
  const lines = before.split('\n');
  return {
    row: lines.length,
    column: (lines[lines.length - 1]?.length ?? 0) + 1,
  };
}

/**
 * Normalize a biome diagnostic into the common LintViolation shape.
 *
 * Returns null for diagnostics that carry no usable location (notably
 * `format`, whose span is null -- those are handled as format issues, not
 * violations).
 *
 * @param diag - A single biome diagnostic
 * @param fileContents - Map of filename to contents, for span conversion
 * @returns LintViolation, or null if not a locatable lint violation
 */
export function normalizeBiomeDiagnostic(
  diag: BiomeDiagnostic,
  fileContents: Map<string, string>
): LintViolation | null {
  const filename = diag.location?.path?.file;
  if (!filename) return null;

  const span = diag.location?.span;
  let location = { row: 1, column: 1 };
  if (span && Array.isArray(span) && typeof span[0] === 'number') {
    const content = fileContents.get(filename);
    if (content !== undefined) {
      location = offsetToRowCol(content, span[0]);
    }
  }

  return {
    code: diag.category,
    message: diag.description || '(no description)',
    filename,
    location,
  };
}

/**
 * Run `biome check` on files, returning violations and files needing formatting.
 *
 * Unlike ruff (separate `check` and `format --check`), a single `biome check`
 * reports both: lint rules as `lint/<group>/<rule>` categories, and formatting
 * as a `format` category with a null span.
 *
 * Uses execFileSync (args array, no shell) to prevent command injection.
 *
 * @param biomePath - Absolute path to the biome binary
 * @param filePaths - Absolute paths to JS/TS files to check
 * @returns Violations plus the files that need formatting
 */
function execBiomeJson(biomePath: string, filePaths: string[]): string | null {
  try {
    execFileSync(biomePath, ['check', '--reporter=json', ...filePaths], {
      timeout: LINTER_TIMEOUT_MS,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return null; // exit 0 = clean, nothing to parse
  } catch (err: unknown) {
    const execError = err as { stdout?: string; status?: number };
    // Exit code 1 = diagnostics found, JSON on stdout
    if (execError.status === 1 && execError.stdout) {
      return execError.stdout;
    }
    logWarn(HOOK_NAME, `biome execution error: ${String(err)}`);
    return null;
  }
}

function parseBiomeDiagnostics(stdout: string): BiomeDiagnostic[] {
  try {
    const parsed = JSON.parse(stdout) as { diagnostics?: BiomeDiagnostic[] };
    return Array.isArray(parsed.diagnostics) ? parsed.diagnostics : [];
  } catch {
    logWarn(HOOK_NAME, 'Failed to parse biome JSON output, skipping');
    return [];
  }
}

/** Read each referenced file once, for span -> row/col conversion. */
function readDiagnosticSources(diagnostics: BiomeDiagnostic[]): Map<string, string> {
  const contents = new Map<string, string>();
  for (const diag of diagnostics) {
    const f = diag.location?.path?.file;
    if (!f || contents.has(f)) continue;
    try {
      contents.set(f, fs.readFileSync(f, 'utf8'));
    } catch {
      // unreadable -- normalizeBiomeDiagnostic falls back to 1:1
    }
  }
  return contents;
}

export function runBiomeCheck(
  biomePath: string,
  filePaths: string[]
): { violations: LintViolation[]; formatIssueFiles: string[] } {
  const stdout = execBiomeJson(biomePath, filePaths);
  if (!stdout) return { violations: [], formatIssueFiles: [] };

  const diagnostics = parseBiomeDiagnostics(stdout);
  const fileContents = readDiagnosticSources(diagnostics);

  const violations: LintViolation[] = [];
  const formatIssueFiles = new Set<string>();

  for (const diag of diagnostics) {
    if (diag.category === BIOME_FORMAT_CATEGORY) {
      const f = diag.location?.path?.file;
      if (f) formatIssueFiles.add(f);
      continue;
    }
    const normalized = normalizeBiomeDiagnostic(diag, fileContents);
    if (normalized) violations.push(normalized);
  }

  return { violations, formatIssueFiles: Array.from(formatIssueFiles) };
}

// =============================================================================
// CLASSIFICATION
// =============================================================================

/**
 * Partition violations into security and general.
 *
 * Security is ruff's bandit `S`-prefix (S101, S608, ...) or biome's
 * `lint/security/*` category. Both linters normalize into LintViolation,
 * so one classifier serves both.
 *
 * @param violations - Array of violations from either linter
 * @returns Classified violations with counts
 */
export function classifyViolations(violations: LintViolation[]): ClassifiedViolations {
  const security: LintViolation[] = [];
  const general: LintViolation[] = [];

  for (const v of violations) {
    if (v.code.startsWith('S') || v.code.startsWith(BIOME_SECURITY_PREFIX)) {
      security.push(v);
    } else {
      general.push(v);
    }
  }

  return { security, general, totalCount: violations.length };
}

// =============================================================================
// MESSAGE FORMATTING
// =============================================================================

/**
 * Format a single violation line.
 */
function formatViolationLine(v: LintViolation): string {
  const loc = `${path.basename(v.filename)}:${v.location.row}:${v.location.column}`;
  let fixHint = 'no auto-fix';
  if (v.fix) {
    fixHint = v.fix.applicability === 'safe' ? 'safe fix' : 'unsafe fix';
  }
  return `  ${v.code} ${loc} ${v.message} [${fixHint}]`;
}

function plural(n: number, singular: string): string {
  return `${n} ${singular}${n === 1 ? '' : 's'}`;
}

/**
 * Format the security violations section.
 */
function formatSecuritySection(security: LintViolation[]): string {
  const shown = security.slice(0, 10);
  const lines = shown.map(formatViolationLine);
  let section = `Security lint violations (${security.length}) -- fix immediately:\n${lines.join('\n')}`;
  if (security.length > 10) {
    section += `\n  ... and ${security.length - 10} more security issues`;
  }
  return section;
}

/**
 * Format the general violations section.
 */
function formatGeneralSection(general: LintViolation[], securityCount: number): string {
  const maxGeneral = Math.max(MAX_VIOLATIONS_SHOWN - securityCount, 0);
  const shown = general.slice(0, maxGeneral);
  const lines = shown.map(formatViolationLine);
  let section = `Lint violations (${general.length}):\n${lines.join('\n')}`;
  if (general.length > maxGeneral) {
    section += `\n  ... and ${general.length - maxGeneral} more`;
  }
  return section;
}

/**
 * Format the formatting issues section.
 *
 * The fix hint must name the formatter that actually owns the file --
 * telling a TypeScript author to run `ruff format` is worse than useless.
 */
function formatFormatSection(files: string[], formatter: 'ruff' | 'biome' = 'ruff'): string {
  const cmd = formatter === 'biome' ? 'biome format --write' : 'ruff format';
  const fileLines = files.map((f) => `  ${path.basename(f)} needs formatting (run \`${cmd}\`)`);
  return `Format issues (${plural(files.length, 'file')}):\n${fileLines.join('\n')}`;
}

/**
 * Build the summary line.
 */
function formatSummaryLine(
  classified: ClassifiedViolations,
  formatIssueFiles: string[],
  fileCount: number
): string {
  const parts: string[] = [];
  if (classified.totalCount > 0) {
    const secNote =
      classified.security.length > 0 ? ` (${classified.security.length} security)` : '';
    parts.push(`${plural(classified.totalCount, 'lint issue')}${secNote}`);
  }
  if (formatIssueFiles.length > 0) {
    parts.push(plural(formatIssueFiles.length, 'formatting issue'));
  }
  return `Total: ${parts.join(', ')} in ${plural(fileCount, 'file')}.`;
}

/**
 * Format the complete lint/format results message.
 *
 * @param results - Combined lint and format results
 * @param fileCount - Number of files checked
 * @returns Formatted message string, empty if nothing to report
 */
export function formatMessage(results: LintResults, fileCount: number): string {
  const { violations, formatIssueFiles, formatter } = results;
  const { security, general, totalCount } = violations;

  if (totalCount === 0 && formatIssueFiles.length === 0) {
    return '';
  }

  const sections: string[] = [];

  if (security.length > 0) {
    sections.push(formatSecuritySection(security));
  }
  if (general.length > 0) {
    sections.push(formatGeneralSection(general, security.length));
  }
  if (formatIssueFiles.length > 0) {
    sections.push(formatFormatSection(formatIssueFiles, formatter));
  }
  sections.push(formatSummaryLine(violations, formatIssueFiles, fileCount));

  let message = sections.join('\n\n');
  if (message.length > MAX_MESSAGE_LENGTH) {
    message = `${message.slice(0, MAX_MESSAGE_LENGTH)}\n... (truncated)`;
  }

  return message;
}

// =============================================================================
// FILE PATH EXTRACTION FOR MULTIEDIT
// =============================================================================

/**
 * Extract all unique file paths from a MultiEdit tool input.
 *
 * @param input - Hook input
 * @returns Array of unique file paths
 */
function getMultiEditPaths(input: HookInput): string[] {
  const edits = input.tool_input.edits;
  if (!Array.isArray(edits)) {
    return [];
  }

  const paths = new Set<string>();
  for (const edit of edits) {
    if (typeof edit.file_path === 'string' && edit.file_path) {
      paths.add(edit.file_path);
    }
  }
  return Array.from(paths);
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Collect lintable file paths from hook input, partitioned by linter.
 *
 * @param input - Hook input
 * @param toolName - The tool name (Write, Edit, MultiEdit)
 * @returns Python and JS/TS file paths (either may be empty)
 */
function collectLintableFiles(
  input: HookInput,
  toolName: string
): { python: string[]; js: string[] } {
  let filePaths: string[];
  if (toolName === 'MultiEdit') {
    filePaths = getMultiEditPaths(input);
  } else {
    const fp = getFilePath(input);
    filePaths = fp ? [fp] : [];
  }

  const python: string[] = [];
  const js: string[] = [];
  for (const fp of filePaths) {
    const ext = path.extname(fp).toLowerCase();
    if (PYTHON_EXTENSIONS.has(ext)) {
      python.push(fp);
    } else if (JS_EXTENSIONS.has(ext)) {
      js.push(fp);
    }
  }
  return { python, js };
}

// =============================================================================
// MAIN HOOK
// =============================================================================

/** Keep only paths that exist on disk. */
function filterExisting(filePaths: string[]): string[] {
  return filePaths.filter((fp) => {
    if (!fs.existsSync(fp)) {
      logDebug(HOOK_NAME, `File not found: ${fp}`);
      return false;
    }
    return true;
  });
}

/**
 * Lint checker PostToolUse hook.
 *
 * After Write/Edit/MultiEdit, lints the touched files with the linter that
 * owns them: ruff for Python (check + format --check), biome for JS/TS
 * (a single `check` covers both). Security violations -- ruff's bandit
 * `S`-prefix or biome's `lint/security/*` -- are highlighted.
 *
 * Always continues (never blocks) -- lint feedback is advisory so
 * Claude can self-correct.
 *
 * @param input - Hook input from Claude Code
 * @returns HookResult with lint feedback or silent success
 */
/** One linter's contribution to the combined run. */
interface LinterRun {
  violations: LintViolation[];
  formatIssueFiles: string[];
  checkedCount: number;
}

const EMPTY_RUN: LinterRun = { violations: [], formatIssueFiles: [], checkedCount: 0 };

function lintPythonFiles(files: string[], projectDir: string): LinterRun {
  if (files.length === 0) return EMPTY_RUN;
  const ruffPath = findLinter(projectDir);
  if (!ruffPath) {
    logDebug(HOOK_NAME, 'ruff not available, skipping Python files');
    return EMPTY_RUN;
  }
  return {
    violations: runRuffCheck(ruffPath, files),
    formatIssueFiles: runRuffFormat(ruffPath, files),
    checkedCount: files.length,
  };
}

function lintJsFiles(files: string[], projectDir: string): LinterRun {
  if (files.length === 0) return EMPTY_RUN;
  const biomePath = findBiome(projectDir);
  if (!biomePath) {
    logDebug(HOOK_NAME, 'biome not available, skipping JS/TS files');
    return EMPTY_RUN;
  }
  const { violations, formatIssueFiles } = runBiomeCheck(biomePath, files);
  return { violations, formatIssueFiles, checkedCount: files.length };
}

/**
 * Label the terminal summary by which linter actually ran.
 *
 * Deliberately NOT derived from `formatter`: a TS file with lint errors but
 * clean formatting leaves `formatter` at its 'ruff' default, which would
 * label a biome run "ruff".
 */
function linterLabelFor(pythonCount: number, jsCount: number): string {
  if (pythonCount > 0 && jsCount > 0) return 'lint';
  return pythonCount > 0 ? 'ruff' : 'biome';
}

function buildUserSummary(
  label: string,
  classified: ClassifiedViolations,
  formatIssueCount: number,
  fileCount: number
): string {
  const { totalCount, security } = classified;
  const secNote = security.length > 0 ? ` (${security.length} security)` : '';
  const fmtNote = formatIssueCount > 0 ? `, ${formatIssueCount} formatting` : '';
  return `${label}: ${plural(totalCount, 'lint issue')}${secNote}${fmtNote} in ${plural(fileCount, 'file')} -- fix before continuing`;
}

export async function lintChecker(input: HookInput): Promise<HookResult> {
  const skipped = runGuards(input, guardWriteEdit);
  if (skipped) return skipped;

  const { python, js } = collectLintableFiles(input, getToolName(input));
  const existingPython = filterExisting(python);
  const existingJs = filterExisting(js);
  if (existingPython.length === 0 && existingJs.length === 0) {
    return outputSilentSuccess();
  }

  const projectDir = process.env['CLAUDE_PROJECT_DIR'] || '.';
  const ruffRun = lintPythonFiles(existingPython, projectDir);
  const biomeRun = lintJsFiles(existingJs, projectDir);

  const checkedCount = ruffRun.checkedCount + biomeRun.checkedCount;
  if (checkedCount === 0) {
    return outputSilentSuccess();
  }

  const formatIssueFiles = [...ruffRun.formatIssueFiles, ...biomeRun.formatIssueFiles];
  // Name the formatter that owns the format issues. Ruff wins a mixed batch;
  // biome only when it is the sole contributor.
  const formatter: 'ruff' | 'biome' =
    ruffRun.formatIssueFiles.length === 0 && biomeRun.formatIssueFiles.length > 0
      ? 'biome'
      : 'ruff';

  const classified = classifyViolations([...ruffRun.violations, ...biomeRun.violations]);
  const message = formatMessage(
    { violations: classified, formatIssueFiles, formatter },
    checkedCount
  );
  if (!message) {
    logDebug(HOOK_NAME, `Lint clean: ${[...existingPython, ...existingJs].join(', ')}`);
    return outputSilentSuccess();
  }

  logInfo(HOOK_NAME, `Found ${classified.totalCount} lint issues in ${checkedCount} file(s)`);

  // Dual-channel: brief summary for the user's terminal, full details for Claude
  const label = linterLabelFor(ruffRun.checkedCount, biomeRun.checkedCount);
  return outputWithNotification(
    buildUserSummary(label, classified, formatIssueFiles.length, checkedCount),
    `Lint issues found -- please fix before continuing:\n\`\`\`\n${message}\n\`\`\``
  );
}

export default lintChecker;
