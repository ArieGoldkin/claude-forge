#!/usr/bin/env node
/**
 * Continuity Plugin - Hook CLI Runner
 *
 * Entry point for executing TypeScript hooks from Claude Code.
 * This script is invoked by hooks.json with the hook name as an argument.
 *
 * Usage:
 *   node hooks/dist/bin/run-hook.js <hook-name>
 *
 * The hook receives JSON input from stdin and outputs JSON to stdout.
 * Exit codes:
 *   0 - Hook completed successfully (continue=true) — INCLUDING a denial, which
 *       since #65 is carried by hookSpecificOutput.permissionDecision:'deny'
 *       rather than continue:false, so a blocked operation now exits 0
 *   1 - Handler returned continue=false (no shared hook does this any more)
 *
 * Note: run-hook-wrapper.sh discards this exit code and always exits 0, so
 * Claude Code decides from the emitted JSON, never from the process status.
 *
 * Environment:
 *   CLAUDE_PLUGIN_ROOT - Required. Path to the plugin root directory.
 *                        Set by Claude Code when running plugin hooks.
 *
 * @module continuity-hooks/bin/run-hook
 */

// Process-level error handlers — catch anything that escapes hook try/catch
// These ensure Claude Code always gets valid JSON, even on catastrophic failures
process.on('uncaughtException', (error) => {
  try {
    process.stderr.write(`[continuity-hooks] Uncaught: ${error.message}\n`);
  } catch {}
  try {
    process.stdout.write('{"continue":true,"suppressOutput":true}\n');
  } catch {}
  process.exit(0);
});
process.on('unhandledRejection', (reason) => {
  try {
    const msg = reason instanceof Error ? reason.message : String(reason);
    process.stderr.write(`[continuity-hooks] Unhandled: ${msg}\n`);
  } catch {}
  try {
    process.stdout.write('{"continue":true,"suppressOutput":true}\n');
  } catch {}
  process.exit(0);
});

import * as fs from 'node:fs';
import * as path from 'node:path';
import { getHook, readHookInput } from '../src/index.js';
import type { HookInput, HookResult } from '../src/types.js';

/**
 * Output a valid JSON result to stdout.
 * Always outputs valid JSON, even on error.
 */
export function outputResult(result: HookResult): void {
  try {
    console.log(JSON.stringify(result));
  } catch {
    // Fallback if JSON.stringify fails (shouldn't happen with valid HookResult)
    console.log('{"continue":true,"suppressOutput":true}');
  }
}

/**
 * Create a silent success result.
 * Used when the hook should allow operation without blocking.
 */
export function silentSuccess(): HookResult {
  return {
    continue: true,
    suppressOutput: true,
  };
}

/**
 * Security-critical hooks that CANNOT be disabled via project-level overrides.
 *
 * SECURITY: A malicious repository could include `.claude/hook-overrides.json`
 * to silently disable hooks. These hooks are essential for security and must
 * always run regardless of override configuration.
 */
const NON_DISABLEABLE_HOOKS: ReadonlySet<string> = new Set(['pretool/security-blocker']);

/**
 * Check if a hook is disabled via project-level overrides.
 *
 * Reads `.claude/hook-overrides.json` from CLAUDE_PROJECT_DIR.
 * Expected format: { "disabled": ["posttool/lint-checker", ...] }
 *
 * SECURITY: Hooks listed in NON_DISABLEABLE_HOOKS cannot be disabled,
 * even if they appear in the overrides file. This prevents a malicious
 * repository from silently disabling security-critical hooks.
 *
 * Graceful degradation: missing file, invalid JSON, or missing key
 * all treated as "no overrides" (hook is enabled).
 *
 * @param hookName - The hook name to check (e.g. "posttool/lint-checker")
 * @returns true if the hook is disabled, false otherwise
 */
export function isHookDisabled(hookName: string): boolean {
  // Security-critical hooks cannot be disabled via project-level overrides
  if (NON_DISABLEABLE_HOOKS.has(hookName)) {
    return false;
  }

  const projectDir = process.env['CLAUDE_PROJECT_DIR'];
  if (!projectDir) return false;

  const overridesPath = path.join(projectDir, '.claude', 'hook-overrides.json');

  try {
    const content = fs.readFileSync(overridesPath, 'utf-8');
    const parsed = JSON.parse(content);
    if (parsed && Array.isArray(parsed.disabled)) {
      return parsed.disabled.includes(hookName);
    }
  } catch {
    // Missing file, invalid JSON, or read error — treat as no overrides
  }

  return false;
}

/**
 * Core hook execution logic, extracted for testability.
 * Returns the result and exit code without calling process.exit() or writing to stdout.
 *
 * @param hookName - The hook name from CLI args (undefined if missing)
 * @param inputOverride - Optional hook input; if omitted, reads from stdin
 * @returns The exit code and hook result
 */
export async function executeHook(
  hookName: string | undefined,
  inputOverride?: HookInput
): Promise<{ exitCode: number; result: HookResult }> {
  // Validate hook name argument
  if (!hookName) {
    console.error('Usage: run-hook.ts <hook-name>');
    console.error('');
    console.error('Available hooks can be listed by importing listHooks() from the module.');
    return { exitCode: 1, result: silentSuccess() };
  }

  // Look up the hook in the registry
  const hook = getHook(hookName);

  if (!hook) {
    // Hook not found - don't block, just continue silently
    return { exitCode: 0, result: silentSuccess() };
  }

  // Check project-level overrides before executing
  if (isHookDisabled(hookName)) {
    return { exitCode: 0, result: silentSuccess() };
  }

  try {
    // Read and parse input from stdin, or use override for testing
    const input = inputOverride ?? readHookInput();

    // Execute the hook handler
    const result = await hook.handler(input);

    return { exitCode: result.continue ? 0 : 1, result };
  } catch (error: unknown) {
    // Handle any unexpected errors gracefully
    const message = error instanceof Error ? error.message : 'Unknown error';

    // Log to stderr for debugging (visible with --debug flag)
    console.error(`[continuity-hooks] Error in ${hookName}: ${message}`);

    // Return silent success to not block Claude Code
    return { exitCode: 0, result: silentSuccess() };
  }
}

/**
 * Main entry point.
 * Reads hook name from argv, executes the hook, outputs result, and exits.
 */
async function main(): Promise<void> {
  const { exitCode, result } = await executeHook(process.argv[2]);
  outputResult(result);
  process.exit(exitCode);
}

// ESM main-module guard: only run when executed directly, not when imported for testing
const isMainModule =
  typeof process.argv[1] === 'string' &&
  (process.argv[1].endsWith('run-hook.js') || process.argv[1].endsWith('run-hook.ts'));

if (isMainModule) {
  main().catch((error: unknown) => {
    // Last resort error handler
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[continuity-hooks] Fatal error: ${message}`);
    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
    process.exit(0);
  });
}
